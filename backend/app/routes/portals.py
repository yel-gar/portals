from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session_factory
from ..deps import (
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
    CurrentUser,
    DbSession,
    authenticate_session_token,
)
from ..exceptions import BadAction
from ..models import Action, ActionLogEntry, DangerLevel, Portal, utc_now
from ..notifications import (
    ACTION_LOG_NOTIFY_CHANNEL,
    PORTAL_NOTIFY_CHANNEL,
    UpdateHub,
    action_log_hub,
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


async def _portal_page(session: AsyncSession, page: int, items_per_page: int) -> PortalListSchema:
    total = int((await session.scalar(select(func.count()).select_from(Portal))) or 0)
    portals = (
        await session.scalars(
            select(Portal).order_by(Portal.id).offset((page - 1) * items_per_page).limit(items_per_page)
        )
    ).all()
    return PortalListSchema(
        items=cast(list[PortalSchema], portals),
        page=page,
        items_per_page=items_per_page,
        total=total,
    )


async def _action_log_page(session: AsyncSession, page: int, items_per_page: int) -> ActionLogListSchema:
    total = int((await session.scalar(select(func.count()).select_from(ActionLogEntry))) or 0)
    entries = (
        await session.scalars(
            select(ActionLogEntry)
            .order_by(ActionLogEntry.timestamp.desc(), ActionLogEntry.id.desc())
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
    """Push a fresh page snapshot on every hub refresh event until the client disconnects."""
    queue = await hub.subscribe()
    try:
        while True:
            receive_task = asyncio.create_task(websocket.receive_text())
            update_task = asyncio.create_task(queue.get())
            done, pending = await asyncio.wait({receive_task, update_task}, return_when=asyncio.FIRST_COMPLETED)
            if update_task in done:
                receive_task.cancel()
                snapshot = await snapshot_factory()
                await websocket.send_json(snapshot.model_dump(mode="json"))
            else:
                for task in pending:
                    task.cancel()
                try:
                    await receive_task
                except WebSocketDisconnect:
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
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": PORTAL_NOTIFY_CHANNEL, "payload": f"portal:{portal_id}"},
    )
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": ACTION_LOG_NOTIFY_CHANNEL, "payload": f"log:{portal_id}"},
    )


@router.get(
    "",
    response_model=PortalListSchema,
    responses=_LOGIN_RESPONSES,
    description="Список порталов с пагинацией.",
    summary="Список порталов",
)
async def list_portals(
    session: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> PortalListSchema:
    return await _portal_page(session, page, items_per_page)


@router.websocket("/ws")
async def portal_updates(
    websocket: WebSocket,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> None:
    """Push live portal page snapshots. Requires a valid session cookie."""
    token = websocket.cookies.get(settings.session_cookie_name)
    async with get_session_factory()() as session:
        user = await authenticate_session_token(session, token)
        if user is None:
            await websocket.close(code=4401)
            return

        await websocket.accept()
        logger.info("WebSocket подключение пользователя id=%d", user.id)
        snapshot = await _portal_page(session, page, items_per_page)
        await websocket.send_json(snapshot.model_dump(mode="json"))
        await _hub_snapshot_loop(websocket, portal_update_hub, lambda: _portal_page(session, page, items_per_page))
        logger.info("WebSocket отключение пользователя id=%d", user.id)


@router.websocket("/log/ws")
async def action_log_updates(
    websocket: WebSocket,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> None:
    """Push live action log page snapshots. Requires a valid session cookie."""
    token = websocket.cookies.get(settings.session_cookie_name)
    async with get_session_factory()() as session:
        user = await authenticate_session_token(session, token)
        if user is None:
            await websocket.close(code=4401)
            return

        await websocket.accept()
        logger.info("WebSocket подключение журнала действий пользователя id=%d", user.id)
        snapshot = await _action_log_page(session, page, items_per_page)
        await websocket.send_json(snapshot.model_dump(mode="json"))
        await _hub_snapshot_loop(websocket, action_log_hub, lambda: _action_log_page(session, page, items_per_page))
        logger.info("WebSocket отключение журнала действий пользователя id=%d", user.id)


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
    session.add(ActionLogEntry(user_id=user.id, portal_id=portal.id, action=action))
    await session.flush()
    await _notify_action_committed(session, portal.id)
    await session.commit()
    await session.refresh(portal)
    logger.info("Действие %s выполнено порталом id=%d пользователем id=%d", action.value, portal.id, user.id)
    return portal


@router.get(
    "/log",
    response_model=ActionLogListSchema,
    responses=_LOGIN_RESPONSES,
    description="Журнал действий с пагинацией.",
    summary="Журнал действий",
)
async def action_log(
    session: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> ActionLogListSchema:
    return await _action_log_page(session, page, items_per_page)


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

    ttl = func.greatest(func.extract("epoch", Portal.expires_at - now), 0.0)
    ttl_factor = 0.04 * ttl
    risk = (
        (Portal.energy_level / 100.0) * 0.2
        + (1.0 - Portal.stability / 100.0) * 0.2
        + (0.1 * Portal.creatures_count / (0.1 * Portal.creatures_count + 1.0)) * 0.3
        + (1.0 - ttl_factor / (ttl_factor + 1.0)) * 0.3
    )
    danger_bucket = case(
        (risk <= 0.3, DangerLevel.LOW.value),
        (risk <= 0.6, DangerLevel.MEDIUM.value),
        (risk <= 0.9, DangerLevel.HIGH.value),
        else_=DangerLevel.CRITICAL.value,
    )
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
