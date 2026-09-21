from __future__ import annotations

import enum
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy import (
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .constants import (
    DANGER_HIGH_THRESHOLD,
    DANGER_LOW_THRESHOLD,
    DANGER_MEDIUM_THRESHOLD,
    DESTINATION_WORLD_MAX_LENGTH,
    DISMISS_DURATION_SECONDS,
    DISMISS_MIN_TTL_SECONDS,
    LOGIN_TOKEN_LENGTH,
    PASSWORD_HASH_MAX_LENGTH,
    PORTAL_NAME_MAX_LENGTH,
    RECOMMEND_TTL_RECALL_SECONDS,
    RECOMMEND_TTL_SEND_WARN_SECONDS,
    RISK_CREATURES_SCALE,
    RISK_CREATURES_WEIGHT,
    RISK_ENERGY_WEIGHT,
    RISK_STABILITY_WEIGHT,
    RISK_TTL_SCALE,
    RISK_TTL_WEIGHT,
    STABILITY_INCREASE_RAND_RANGE,
    USERNAME_MAX_LENGTH,
)
from .db import Base
from .exceptions import BadAction


class Action(enum.StrEnum):
    CLOSE = "CLOSE"
    STABILIZE = "STABILIZE"
    DISMISS = "DISMISS"
    SEND_OBSERVER = "SEND_OBSERVER"
    RECALL_OBSERVER = "RECALL_OBSERVER"
    MARK = "MARK"
    UNMARK = "UNMARK"
    WARN_CREATURES = "WARN_CREATURES"


class DangerLevel(enum.StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class PortalOrder(enum.StrEnum):
    RISK = "risk"
    EXPIRES_AT = "expires_at"
    CREATURES = "creatures"
    NAME = "name"


class LogOrder(enum.StrEnum):
    NEWEST = "newest"
    OLDEST = "oldest"


def utc_now() -> datetime:
    return datetime.now(UTC)


def risk_factor_for(energy_level: int, stability: int, creatures_count: int, ttl_seconds: float) -> float:
    """Compute the portal risk factor from raw values (mirror of the SQL expression).

    Single source of truth on the Python side; the parameter values come from
    ``app.constants`` and are shared with ``routes/portals.py`` SQL expressions.
    """
    ttl = max(ttl_seconds, 0.0)
    return (
        (energy_level / 100.0) * RISK_ENERGY_WEIGHT
        + (1.0 - stability / 100.0) * RISK_STABILITY_WEIGHT
        + (RISK_CREATURES_SCALE * creatures_count / (RISK_CREATURES_SCALE * creatures_count + 1.0))
        * RISK_CREATURES_WEIGHT
        + (1.0 - RISK_TTL_SCALE * ttl / (RISK_TTL_SCALE * ttl + 1.0)) * RISK_TTL_WEIGHT
    )


class Portal(Base):
    __tablename__ = "portals"
    __table_args__ = (
        CheckConstraint("energy_level >= 0 AND energy_level <= 100", name="ck_portals_energy_range"),
        CheckConstraint("stability >= 0 AND stability <= 100", name="ck_portals_stability_range"),
        CheckConstraint("creatures_count >= 0", name="ck_portals_creatures_non_negative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(PORTAL_NAME_MAX_LENGTH), nullable=False)
    destination_world: Mapped[str] = mapped_column(String(DESTINATION_WORLD_MAX_LENGTH), nullable=False)
    energy_level: Mapped[int] = mapped_column(Integer, nullable=False)
    stability: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    creatures_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Touched only by explicit actions (routes/portals.py sets it on commit), so
    # «обновлено» reflects operator activity — simulator noise never bumps it.
    last_update: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Set by DISMISS («оставить открытым»): while in the future, the portal is
    # parked below non-dismissed open portals in every ordering.
    dismissed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_marked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_observer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    actions: Mapped[list[ActionLogEntry]] = relationship(
        back_populates="portal", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def risk_factor(self) -> float:
        ttl = max((self.expires_at - utc_now()).total_seconds(), 0.0)
        return risk_factor_for(self.energy_level, self.stability, self.creatures_count, ttl)

    @property
    def danger_level(self) -> DangerLevel:
        risk = self.risk_factor
        if risk <= DANGER_LOW_THRESHOLD:
            return DangerLevel.LOW
        if risk <= DANGER_MEDIUM_THRESHOLD:
            return DangerLevel.MEDIUM
        if risk <= DANGER_HIGH_THRESHOLD:
            return DangerLevel.HIGH
        return DangerLevel.CRITICAL

    @property
    def closed(self) -> bool:
        return self.expires_at <= utc_now() or self.is_closed

    def _deny_if_closed(self) -> None:
        if self.closed:
            raise BadAction("Портал закрыт, выполнить действие невозможно")

    def close(self, *, force: bool = False) -> None:
        self._deny_if_closed()
        if self.creatures_count > 0:
            if not force:
                raise BadAction("Нельзя закрыть портал: внутри есть существа")
            if self.danger_level != DangerLevel.CRITICAL:
                raise BadAction("Принудительное закрытие разрешено только для порталов с критическим уровнем опасности")
        # An operator closing a portal pulls the observer out with it — a closed
        # portal can never keep an observer inside.
        self.has_observer = False
        self.is_closed = True

    @property
    def recommended_action(self) -> Action:
        """Scored recommendation over the portal state (MARK/UNMARK never suggested).

        Every matching condition below adds its points, the highest total wins;
        ties resolve in CLOSE > SEND_OBSERVER > WARN_CREATURES > RECALL_OBSERVER
        > STABILIZE > DISMISS order. No points at all falls back to DISMISS.
        Closed portals always fall back to DISMISS — no action is valid on them.
        """
        if self.closed:
            return Action.DISMISS
        scores: dict[Action, int] = {}

        def add(action: Action, points: int) -> None:
            scores[action] = scores.get(action, 0) + points

        ttl_seconds = (self.expires_at - utc_now()).total_seconds()
        if not self.has_observer:
            if self.stability < 50:
                add(Action.STABILIZE, 1)
            if self.creatures_count == 0:
                add(Action.CLOSE, 10)
            if ttl_seconds < RECOMMEND_TTL_SEND_WARN_SECONDS:
                add(Action.SEND_OBSERVER, 1)
        else:
            if self.stability < 50:
                add(Action.STABILIZE, 1)
            if ttl_seconds < RECOMMEND_TTL_RECALL_SECONDS:
                add(Action.RECALL_OBSERVER, 1)
            if ttl_seconds < RECOMMEND_TTL_SEND_WARN_SECONDS:
                add(Action.WARN_CREATURES, 1)
            if self.creatures_count == 0:
                add(Action.RECALL_OBSERVER, 10)
        if not scores:
            return Action.DISMISS
        best = max(scores.values())
        for candidate in (
            Action.CLOSE,
            Action.SEND_OBSERVER,
            Action.WARN_CREATURES,
            Action.RECALL_OBSERVER,
            Action.STABILIZE,
            Action.DISMISS,
        ):
            if scores.get(candidate) == best:
                return candidate
        return Action.DISMISS

    def stabilize(self) -> None:
        self._deny_if_closed()
        if self.stability >= 50:
            raise BadAction("Стабильность портала уже не ниже 50%")
        self.stability += random.randint(*STABILITY_INCREASE_RAND_RANGE)
        self.stability = min(self.stability, 100)

    def dismiss(self) -> None:
        self._deny_if_closed()
        ttl_seconds = (self.expires_at - utc_now()).total_seconds()
        if ttl_seconds <= DISMISS_MIN_TTL_SECONDS:
            raise BadAction("Нельзя отложить портал: до истечения менее 5 минут")
        self.dismissed_until = utc_now() + timedelta(seconds=DISMISS_DURATION_SECONDS)

    def send_observer(self) -> None:
        self._deny_if_closed()
        if self.danger_level == DangerLevel.CRITICAL:
            raise BadAction("Нельзя отправить наблюдателя: критический уровень опасности")
        if self.has_observer:
            raise BadAction("Наблюдатель уже находится внутри портала")
        self.has_observer = True

    def recall_observer(self) -> None:
        self._deny_if_closed()
        if not self.has_observer:
            raise BadAction("Внутри портала нет наблюдателя, некого отзывать")
        self.has_observer = False

    def mark(self) -> None:
        if self.is_marked:
            raise BadAction("Портал уже отмечен")
        self.is_marked = True

    def unmark(self) -> None:
        if not self.is_marked:
            raise BadAction("Портал не отмечен")
        self.is_marked = False

    def warn_creatures(self) -> None:
        self._deny_if_closed()
        if not self.has_observer:
            raise BadAction("Нет наблюдателя, через которого можно предупредить существ")
        if self.creatures_count == 0:
            raise BadAction("Внутри портала нет существ, некого предупреждать")
        self.creatures_count = 0


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(USERNAME_MAX_LENGTH), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(PASSWORD_HASH_MAX_LENGTH), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    login_sessions: Mapped[list[LoginSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    log_entries: Mapped[list[ActionLogEntry]] = relationship(back_populates="user", passive_deletes=True)


class LoginSession(Base):
    __tablename__ = "login_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token: Mapped[str] = mapped_column(String(LOGIN_TOKEN_LENGTH), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(lazy="joined")


class ActionLogEntry(Base):
    __tablename__ = "action_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    portal_id: Mapped[int] = mapped_column(ForeignKey("portals.id", ondelete="CASCADE"), index=True, nullable=False)
    action: Mapped[Action] = mapped_column(SQLEnum(Action, name="action"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User | None] = relationship(lazy="joined")
    portal: Mapped[Portal] = relationship(back_populates="actions")
