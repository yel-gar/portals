from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..constants import (
    DANGER_HIGH_THRESHOLD,
    DANGER_LOW_THRESHOLD,
    DANGER_MEDIUM_THRESHOLD,
    RISK_CREATURES_SCALE,
    RISK_CREATURES_WEIGHT,
    RISK_ENERGY_WEIGHT,
    RISK_STABILITY_WEIGHT,
    RISK_TTL_SCALE,
    RISK_TTL_WEIGHT,
)
from ..db import get_session_factory
from ..deps import (
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
    CurrentUser,
    DbSession,
    authenticate_session_token,
)
from ..exceptions import BadAction
from ..models import Action, ActionLogEntry, DangerLevel, LogOrder, Portal, PortalOrder, utc_now
from ..notifications import (
    UpdateHub,
    action_log_hub,
    notify_action_log_changed,
    notify_portal_changed,
    portal_update_hub,
)
from ..schemas import (
    ActionLogEntrySchema,
    ActionLogListSchema,
    PortalListSchema,
    PortalSchema,
    StatsSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portals", tags=["portals"])

_LOGIN_RESPONSES: dict[int | str, dict[str, Any]] = {
    status.HTTP_401_UNAUTHORIZED: {"description": "Требуется авторизация"}
}


def _risk_expression(now: datetime) -> ColumnElement[float]:
    """Risk factor as an SQL expression (mirrors ``Portal.risk_factor``)."""
    ttl = func.greatest(func.extract("epoch", Portal.expires_at - now), 0.0)
    ttl_factor = RISK_TTL_SCALE * ttl
    return cast(
        ColumnElement[float],
        (Portal.energy_level / 100.0) * RISK_ENERGY_WEIGHT
        + (1.0 - Portal.stability / 100.0) * RISK_STABILITY_WEIGHT
        + (RISK_CREATURES_SCALE * Portal.creatures_count / (RISK_CREATURES_SCALE * Portal.creatures_count + 1.0))
        * RISK_CREATURES_WEIGHT
        + (1.0 - ttl_factor / (ttl_factor + 1.0)) * RISK_TTL_WEIGHT,
    )


def _danger_bucket_expression(now: datetime) -> ColumnElement[str]:
    """Danger level as an SQL CASE expression (mirrors ``Portal.danger_level``)."""
    risk = _risk_expression(now)
    return cast(
        ColumnElement[str],
        case(
            (risk <= DANGER_LOW_THRESHOLD, DangerLevel.LOW.value),
            (risk <= DANGER_MEDIUM_THRESHOLD, DangerLevel.MEDIUM.value),
            (risk <= DANGER_HIGH_THRESHOLD, DangerLevel.HIGH.value),
            else_=DangerLevel.CRITICAL.value,
        ),
    )


def _danger_rank_expression(now: datetime) -> ColumnElement[int]:
    """Danger level as an integer rank (CRITICAL=3 … LOW=0) for ordering."""
    risk = _risk_expression(now)
    return cast(
        ColumnElement[int],
        case(
            (risk <= DANGER_LOW_THRESHOLD, 0),
            (risk <= DANGER_MEDIUM_THRESHOLD, 1),
            (risk <= DANGER_HIGH_THRESHOLD, 2),
            else_=3,
        ),
    )


def _portal_filter_clauses(
    *,
    closed: bool | None,
    danger_level: DangerLevel | None,
    has_observer: bool | None,
    is_marked: bool | None,
    search: str | None,
    now: datetime,
) -> list[ColumnElement[Any]]:
    clauses: list[ColumnElement[Any]] = []
    if closed is not None:
        if closed:
            clauses.append(or_(Portal.is_closed.is_(True), Portal.expires_at <= now))
        else:
            clauses.append(and_(Portal.is_closed.is_(False), Portal.expires_at > now))
    if danger_level is not None:
        clauses.append(_danger_bucket_expression(now) == danger_level.value)
    if has_observer is not None:
        clauses.append(Portal.has_observer.is_(has_observer))
    if is_marked is not None:
        clauses.append(Portal.is_marked.is_(is_marked))
    if search:
        pattern = f"%{search}%"
        clauses.append(or_(Portal.name.ilike(pattern), Portal.destination_world.ilike(pattern)))
    return clauses


def _portal_order_clauses(order_by: PortalOrder, now: datetime) -> list[Any]:
    # Open portals first: risk and expiry estimates are meaningless for closed
    # portals (an expired TTL clamps to zero, inflating the risk term), so they
    # sink below open ones while keeping their own relative order.
    open_first = case((and_(Portal.is_closed.is_(False), Portal.expires_at > now), 0), else_=1).asc()
    # DISMISS («оставить открытым») parks the portal below open non-dismissed
    # ones while the dismissal window (dismissed_until) is active. A NULL
    # dismissed_until simply falls into the else branch (0).
    dismissed_sinks = case((Portal.dismissed_until > now, 1), else_=0).asc()
    if order_by is PortalOrder.RISK:
        return [
            open_first,
            dismissed_sinks,
            # Order by the discrete danger level (CRITICAL first), not the raw
            # risk value; within a level the earlier expiry wins.
            _danger_rank_expression(now).desc(),
            Portal.expires_at.asc(),
            Portal.has_observer.desc(),
            Portal.creatures_count.desc(),
            Portal.id.asc(),
        ]
    if order_by is PortalOrder.EXPIRES_AT:
        return [open_first, dismissed_sinks, Portal.expires_at.asc(), Portal.id.asc()]
    if order_by is PortalOrder.CREATURES:
        return [open_first, dismissed_sinks, Portal.creatures_count.desc(), Portal.id.asc()]
    return [open_first, dismissed_sinks, func.lower(Portal.name).asc(), Portal.id.asc()]


def _action_log_filter_clauses(
    *,
    action: Action | None,
    portal_id: int | None,
    user_id: int | None,
) -> list[ColumnElement[Any]]:
    clauses: list[ColumnElement[Any]] = []
    if action is not None:
        clauses.append(ActionLogEntry.action == action)
    if portal_id is not None:
        clauses.append(ActionLogEntry.portal_id == portal_id)
    if user_id is not None:
        clauses.append(ActionLogEntry.user_id == user_id)
    return clauses


def _action_log_order_clauses(order_by: LogOrder) -> list[Any]:
    if order_by is LogOrder.OLDEST:
        return [ActionLogEntry.timestamp.asc(), ActionLogEntry.id.asc()]
    return [ActionLogEntry.timestamp.desc(), ActionLogEntry.id.desc()]


async def _portal_page(
    session: AsyncSession,
    page: int,
    items_per_page: int,
    *,
    closed: bool | None = None,
    danger_level: DangerLevel | None = None,
    has_observer: bool | None = None,
    is_marked: bool | None = None,
    search: str | None = None,
    order_by: PortalOrder = PortalOrder.RISK,
) -> PortalListSchema:
    now = utc_now()
    filters = _portal_filter_clauses(
        closed=closed,
        danger_level=danger_level,
        has_observer=has_observer,
        is_marked=is_marked,
        search=search,
        now=now,
    )
    total = int((await session.scalar(select(func.count()).select_from(Portal).where(*filters))) or 0)
    portals = (
        await session.scalars(
            select(Portal)
            .where(*filters)
            .order_by(*_portal_order_clauses(order_by, now))
            .offset((page - 1) * items_per_page)
            .limit(items_per_page)
        )
    ).all()
    return PortalListSchema(
        items=cast(list[PortalSchema], portals),
        page=page,
        items_per_page=items_per_page,
        total=total,
    )


async def _action_log_page(
    session: AsyncSession,
    page: int,
    items_per_page: int,
    *,
    action: Action | None = None,
    portal_id: int | None = None,
    user_id: int | None = None,
    order_by: LogOrder = LogOrder.NEWEST,
) -> ActionLogListSchema:
    filters = _action_log_filter_clauses(action=action, portal_id=portal_id, user_id=user_id)
    total = int((await session.scalar(select(func.count()).select_from(ActionLogEntry).where(*filters))) or 0)
    entries = (
        await session.scalars(
            select(ActionLogEntry)
            .where(*filters)
            .order_by(*_action_log_order_clauses(order_by))
            .offset((page - 1) * items_per_page)
            .limit(items_per_page)
        )
    ).all()
    return ActionLogListSchema(
        items=cast(list[ActionLogEntrySchema], entries),
        page=page,
        items_per_page=items_per_page,
        total=total,
    )


async def _hub_snapshot_loop(
    websocket: WebSocket,
    hub: UpdateHub,
    snapshot_factory: Callable[[], Awaitable[BaseModel]],
) -> None:
    """Subscribe to the hub, push an initial snapshot, then re-push on every refresh event.

    The subscription happens before the initial render so an event landing in
    between is not missed; a burst of events is coalesced into a single re-query.
    A failing snapshot query is logged and the loop keeps running, so a transient
    DB error never drops the subscriber. Only a client disconnect or a failed send
    terminates the loop.
    """
    queue = await hub.subscribe()
    try:
        try:
            snapshot = await snapshot_factory()
            await websocket.send_json(snapshot.model_dump(mode="json"))
        except WebSocketDisconnect:
            return
        except Exception:
            logger.exception("WebSocket: ошибка при формировании начального снапшота")
            return
        receive_task: asyncio.Task[str] | None = None
        while True:
            update_task = asyncio.create_task(queue.get())
            if receive_task is None:
                receive_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait({update_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)
            cancelled: list[asyncio.Task[Any]] = []
            disconnected = False
            if receive_task in done:
                try:
                    await receive_task
                except WebSocketDisconnect:
                    disconnected = True
                receive_task = None
                if update_task in pending:
                    update_task.cancel()
                    cancelled.append(update_task)
            if update_task in done:
                if receive_task is not None and receive_task in pending:
                    receive_task.cancel()
                    cancelled.append(receive_task)
                receive_task = None
                # Drain queued refresh events so a burst triggers a single re-query.
                while not queue.empty():
                    queue.get_nowait()
                try:
                    snapshot = await snapshot_factory()
                    await websocket.send_json(snapshot.model_dump(mode="json"))
                except WebSocketDisconnect:
                    disconnected = True
                except Exception:
                    logger.exception("WebSocket: ошибка при обновлении снапшота страницы")
            if disconnected:
                for task in (update_task, receive_task):
                    if task is not None and not task.done() and task not in cancelled:
                        task.cancel()
                        cancelled.append(task)
            # Finalize cancelled tasks so none is left "pending" after the loop.
            for task in cancelled:
                with suppress(asyncio.CancelledError, WebSocketDisconnect):
                    await task
            if disconnected:
                break
    finally:
        hub.unsubscribe(queue)
        with suppress(RuntimeError):
            await websocket.close()


async def _notify_action_committed(session: AsyncSession, portal_id: int) -> None:
    """Produce LISTEN/NOTIFY events for the committed action.

    Runs inside the action transaction, so Postgres delivers the notifications
    only when the transaction commits; a failed action never wakes subscribers.
    """
    await notify_portal_changed(session, portal_id)
    await notify_action_log_changed(session, portal_id)


@router.get(
    "",
    response_model=PortalListSchema,
    responses=_LOGIN_RESPONSES,
    description=(
        "Список порталов с пагинацией, фильтрами и сортировкой.\n\n"
        "Фильтры: `closed` (true — только закрытые/истёкшие, false — только открытые), "
        "`danger_level` (LOW/MEDIUM/HIGH/CRITICAL), `has_observer`, `is_marked`, "
        "`search` (подстрока в названии или целевом мире, без учёта регистра).\n\n"
        "Сортировка `order_by`: `risk` (по умолчанию — по уровню опасности DESC: CRITICAL, HIGH, "
        "MEDIUM, LOW; внутри одного уровня — срок истечения ASC, наблюдатель внутри DESC, "
        "существа внутри DESC), `expires_at` (срок истечения ASC), "
        "`creatures` (существа внутри DESC), `name` (название ASC). Во всех режимах "
        "закрытые/истёкшие порталы выводятся в конце списка — открытые всегда первыми."
    ),
    summary="Список порталов",
)
async def list_portals(
    session: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
    closed: bool | None = Query(None),
    danger_level: DangerLevel | None = Query(None),
    has_observer: bool | None = Query(None),
    is_marked: bool | None = Query(None),
    search: str | None = Query(None, max_length=256),
    order_by: PortalOrder = Query(PortalOrder.RISK),
) -> PortalListSchema:
    return await _portal_page(
        session,
        page,
        items_per_page,
        closed=closed,
        danger_level=danger_level,
        has_observer=has_observer,
        is_marked=is_marked,
        search=search,
        order_by=order_by,
    )


@router.websocket("/ws")
async def portal_updates(
    websocket: WebSocket,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
    closed: bool | None = Query(None),
    danger_level: DangerLevel | None = Query(None),
    has_observer: bool | None = Query(None),
    is_marked: bool | None = Query(None),
    search: str | None = Query(None, max_length=256),
    order_by: PortalOrder = Query(PortalOrder.RISK),
) -> None:
    """Push live portal page snapshots. Requires a valid session cookie."""
    token = websocket.cookies.get(settings.session_cookie_name)
    if token is None:
        await websocket.close(code=4401)
        return
    async with get_session_factory()() as session:
        user = await authenticate_session_token(session, token)
    if user is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    logger.info("WebSocket подключение пользователя id=%d", user.id)

    # A fresh short-lived session per snapshot keeps the connection pool free
    # instead of pinning one connection for the whole socket lifetime.
    async def snapshot_factory() -> PortalListSchema:
        async with get_session_factory()() as session:
            return await _portal_page(
                session,
                page,
                items_per_page,
                closed=closed,
                danger_level=danger_level,
                has_observer=has_observer,
                is_marked=is_marked,
                search=search,
                order_by=order_by,
            )

    try:
        await _hub_snapshot_loop(websocket, portal_update_hub, snapshot_factory)
    finally:
        logger.info("WebSocket отключение пользователя id=%d", user.id)


@router.websocket("/log/ws")
async def action_log_updates(
    websocket: WebSocket,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
    action: Action | None = Query(None),
    portal_id: int | None = Query(None, ge=1),
    user_id: int | None = Query(None, ge=1),
    order_by: LogOrder = Query(LogOrder.NEWEST),
) -> None:
    """Push live action log page snapshots. Requires a valid session cookie."""
    token = websocket.cookies.get(settings.session_cookie_name)
    if token is None:
        await websocket.close(code=4401)
        return
    async with get_session_factory()() as session:
        user = await authenticate_session_token(session, token)
    if user is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    logger.info("WebSocket подключение журнала действий пользователя id=%d", user.id)

    async def snapshot_factory() -> ActionLogListSchema:
        async with get_session_factory()() as session:
            return await _action_log_page(
                session,
                page,
                items_per_page,
                action=action,
                portal_id=portal_id,
                user_id=user_id,
                order_by=order_by,
            )

    try:
        await _hub_snapshot_loop(websocket, action_log_hub, snapshot_factory)
    finally:
        logger.info("WebSocket отключение журнала действий пользователя id=%d", user.id)


@router.get(
    "/log",
    response_model=ActionLogListSchema,
    responses=_LOGIN_RESPONSES,
    description=(
        "Журнал действий с пагинацией, фильтрами и сортировкой.\n\n"
        "Фильтры: `action` (тип действия), `portal_id`, `user_id`.\n\n"
        "Сортировка `order_by`: `newest` (по умолчанию — сначала новые) или `oldest`."
    ),
    summary="Журнал действий",
)
async def action_log(
    session: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
    action: Action | None = Query(None),
    portal_id: int | None = Query(None, ge=1),
    user_id: int | None = Query(None, ge=1),
    order_by: LogOrder = Query(LogOrder.NEWEST),
) -> ActionLogListSchema:
    return await _action_log_page(
        session,
        page,
        items_per_page,
        action=action,
        portal_id=portal_id,
        user_id=user_id,
        order_by=order_by,
    )


@router.get(
    "/stats",
    response_model=StatsSchema,
    responses=_LOGIN_RESPONSES,
    description=(
        "Сводная статистика порталов: количество открытых/закрытых, распределение по уровням "
        "опасности и средний риск по открытым порталам."
    ),
    summary="Статистика порталов",
)
async def stats(session: DbSession, _user: CurrentUser) -> StatsSchema:
    now = utc_now()
    open_portal = and_(Portal.is_closed.is_(False), Portal.expires_at > now)
    closed_portal = or_(Portal.is_closed.is_(True), Portal.expires_at <= now)

    total, open_count, closed_count, marked, with_observer = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(open_portal),
                func.count().filter(closed_portal),
                func.count().filter(Portal.is_marked.is_(True)),
                func.count().filter(Portal.has_observer.is_(True)),
            ).select_from(Portal)
        )
    ).one()

    risk = _risk_expression(now)
    danger_bucket = _danger_bucket_expression(now)
    danger_rows = (
        await session.execute(select(danger_bucket, func.count()).where(open_portal).group_by(danger_bucket))
    ).all()
    danger_levels = {DangerLevel(bucket): count for bucket, count in danger_rows}
    for level in DangerLevel:
        danger_levels.setdefault(level, 0)

    avg_risk = float(await session.scalar(select(func.avg(risk)).where(open_portal)) or 0.0)
    return StatsSchema(
        total=total,
        open=open_count,
        closed=closed_count,
        marked=marked,
        with_observer=with_observer,
        danger_levels=danger_levels,
        avg_risk=avg_risk,
    )


@router.post(
    "/{portal_id}",
    response_model=PortalSchema,
    responses={
        **_LOGIN_RESPONSES,
        status.HTTP_404_NOT_FOUND: {"description": "Портал не найден"},
        status.HTTP_409_CONFLICT: {"description": "Действие недопустимо для данного портала"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Неизвестное действие или некорректный id"},
    },
    description="Выполнить действие над порталом. Действие записывается в журнал.",
    summary="Действие над порталом",
)
async def execute_action(portal_id: int, action: Action, session: DbSession, user: CurrentUser) -> Portal:
    portal = await session.get(Portal, portal_id, with_for_update=True)
    if portal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Портал не найден")
    try:
        getattr(portal, action.value.lower())()
    except BadAction as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    # «Обновлено» reflects operator actions only — the simulator never touches it.
    portal.last_update = utc_now()
    session.add(ActionLogEntry(user_id=user.id, portal_id=portal.id, action=action))
    await session.flush()
    await _notify_action_committed(session, portal.id)
    await session.commit()
    await session.refresh(portal)
    logger.info("Действие %s выполнено порталом id=%d пользователем id=%d", action.value, portal.id, user.id)
    return portal


@router.get(
    "/{portal_id}",
    response_model=PortalSchema,
    responses={
        **_LOGIN_RESPONSES,
        status.HTTP_404_NOT_FOUND: {"description": "Портал не найден"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Некорректный id портала"},
    },
    description=(
        "Подробная информация об одном портале (та же структура, что и в списке, "
        "включая расчётные risk_factor и danger_level)."
    ),
    summary="Информация о портале",
)
async def portal_info(portal_id: int, session: DbSession, _user: CurrentUser) -> Portal:
    portal = await session.get(Portal, portal_id)
    if portal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Портал не найден")
    return portal
