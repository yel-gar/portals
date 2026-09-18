from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Response, status
from sqlalchemy import delete, select

from ..config import settings
from ..deps import CurrentUser, DbSession
from ..models import LoginSession, User, utc_now
from ..schemas import LoginSchema, UserOutSchema, UserRegisterSchema
from ..security import hash_password, verify_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOutSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {"description": "Пользователь с таким именем уже существует"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Некорректные username или password"},
    },
    description="Регистрация нового пользователя. Возвращает данные пользователя.",
    summary="Регистрация",
)
async def register(data: UserRegisterSchema, session: DbSession) -> User:
    existing = await session.scalar(select(User).where(User.username == data.username))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует")
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    logger.info("Зарегистрирован пользователь username=%s id=%d", user.username, user.id)
    return user


@router.post(
    "/login",
    response_model=UserOutSchema,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Неверное имя пользователя или пароль"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Некорректные username или password"},
    },
    description="Вход в систему; при успехе в cookie выдаётся токен сессии.",
    summary="Вход",
)
async def login(data: LoginSchema, session: DbSession, response: Response) -> User:
    user = await session.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
        logger.warning("Неудачная попытка входа username=%s", data.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверное имя пользователя или пароль")

    token = secrets.token_hex(32)
    login_session = LoginSession(
        user_id=user.id,
        token=token,
        expires_at=utc_now() + timedelta(days=settings.session_ttl_days),
    )
    session.add(login_session)
    await session.commit()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    logger.info("Вход пользователя username=%s id=%d", user.username, user.id)
    return user


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    description="Завершение сессии: токен удаляется из БД, cookie очищается. Идемпотентно.",
    summary="Выход",
)
async def logout(
    session: DbSession,
    token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> Response:
    if token is not None:
        await session.execute(delete(LoginSession).where(LoginSession.token == token))
        await session.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return response


@router.get(
    "/me",
    response_model=UserOutSchema,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Требуется авторизация"},
    },
    description="Данные текущего пользователя (id и username).",
    summary="Текущий пользователь",
)
async def me(user: CurrentUser) -> User:
    return user
