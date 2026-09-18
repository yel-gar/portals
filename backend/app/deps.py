from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db_session
from .models import LoginSession, User

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

PAGE_SIZE_MAX = 100
PAGE_SIZE_DEFAULT = 20


async def authenticate_session_token(session: AsyncSession, token: str | None) -> User | None:
    if token is None:
        return None
    login_session = (
        await session.execute(select(LoginSession).where(LoginSession.token == token))
    ).scalar_one_or_none()
    if login_session is None or login_session.user is None:
        return None
    if login_session.expires_at <= datetime.now(UTC):
        return None
    return login_session.user


async def get_current_user(session: DbSession, request: Request) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    user = await authenticate_session_token(session, token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_superuser(user: CurrentUser) -> User:
    if not user.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
    return user


SuperUser = Annotated[User, Depends(get_superuser)]
