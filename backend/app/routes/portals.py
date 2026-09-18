from __future__ import annotations

import asyncio
from collections import Counter
from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session_factory
from ..deps import (
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
    CurrentUser,
    DbSession,
    authenticate_session_token,
    get_current_user,
)
from ..exceptions import BadAction
from ..models import Action, ActionLogEntry, Portal
from ..notifications import portal_update_hub
from ..schemas import (
    ActionLogEntrySchema,
    ActionLogListSchema,
    PortalListSchema,
    PortalSchema,
    StatsSchema,
)

router = APIRouter(prefix="/portals", tags=["portals"], dependencies=[Depends(get_current_user)])


async def _portal_page(session: AsyncSession, page: int, items_per_page: int) -> PortalListSchema:
    total = int((await session.execute(select(func.count()).select_from(Portal))).scalar_one())
    portals = (
        (
            await session.execute(
                select(Portal).order_by(Portal.id).offset((page - 1) * items_per_page).limit(items_per_page)
            )
        )
        .scalars()
        .all()
    )
    return PortalListSchema(
        items=[PortalSchema.model_validate(portal) for portal in portals],
        page=page,
        items_per_page=items_per_page,
        total=total,
    )


@router.get("", response_model=PortalListSchema)
async def list_portals(
    session: DbSession,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> PortalListSchema:
    """List portals (paginated). Requires login; 401 otherwise."""
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
        snapshot = await _portal_page(session, page, items_per_page)
        await websocket.send_json(snapshot.model_dump(mode="json"))

        queue = await portal_update_hub.subscribe()
        try:
            while True:
                receive_task = asyncio.create_task(websocket.receive_text())
                update_task = asyncio.create_task(queue.get())
                done, pending = await asyncio.wait({receive_task, update_task}, return_when=asyncio.FIRST_COMPLETED)
                if update_task in done and update_task.result() is None:
                    receive_task.cancel()
                    snapshot = await _portal_page(session, page, items_per_page)
                    await websocket.send_json(snapshot.model_dump(mode="json"))
                else:
                    for task in pending:
                        task.cancel()
                    try:
                        await receive_task
                    except WebSocketDisconnect:
                        break
        finally:
            portal_update_hub.unsubscribe(queue)
            with suppress(RuntimeError):
                await websocket.close()


@router.post("/{portal_id}", response_model=PortalSchema)
async def execute_action(portal_id: int, action: Action, session: DbSession, user: CurrentUser) -> PortalSchema:
    """Commit an action on a portal. 404 unknown portal, 409 action not allowed."""
    portal = await session.get(Portal, portal_id)
    if portal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Портал не найден")
    try:
        getattr(portal, action.value.lower())()
    except BadAction as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.add(ActionLogEntry(user_id=user.id, portal_id=portal.id, action=action))
    await session.commit()
    await session.refresh(portal)
    return PortalSchema.model_validate(portal)


@router.get("/log", response_model=ActionLogListSchema)
async def action_log(
    session: DbSession,
    page: int = Query(1, ge=1),
    items_per_page: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> ActionLogListSchema:
    """List recorded action log entries (paginated). Requires login; 401 otherwise."""
    total = int((await session.execute(select(func.count()).select_from(ActionLogEntry))).scalar_one())
    entries = (
        (
            await session.execute(
                select(ActionLogEntry)
                .order_by(ActionLogEntry.timestamp.desc(), ActionLogEntry.id.desc())
                .offset((page - 1) * items_per_page)
                .limit(items_per_page)
            )
        )
        .scalars()
        .all()
    )
    return ActionLogListSchema(
        items=[ActionLogEntrySchema.model_validate(entry) for entry in entries],
        page=page,
        items_per_page=items_per_page,
        total=total,
    )


@router.get("/stats", response_model=StatsSchema)
async def stats(session: DbSession) -> StatsSchema:
    """General stats about portals. Danger distribution and avg risk cover open portals."""
    portals = (await session.execute(select(Portal))).scalars().all()
    open_portals = [portal for portal in portals if not portal.closed]
    danger_levels = Counter(portal.danger_level for portal in open_portals)
    return StatsSchema(
        total=len(portals),
        open=len(open_portals),
        closed=len(portals) - len(open_portals),
        marked=sum(portal.is_marked for portal in portals),
        with_observer=sum(portal.has_observer for portal in portals),
        danger_levels=dict(danger_levels),
        avg_risk=sum(portal.risk_factor for portal in open_portals) / len(open_portals) if open_portals else 0.0,
    )
