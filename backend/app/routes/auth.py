from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from ..config import settings
from ..deps import CurrentUser, DbSession
from ..models import LoginSession, User, utc_now
from ..schemas import LoginSchema, UserOutSchema, UserRegisterSchema
from ..security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOutSchema, status_code=status.HTTP_201_CREATED)
async def register(data: UserRegisterSchema, session: DbSession) -> UserOutSchema:
    """Register a new user. 409 if the username is already taken."""
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
    return UserOutSchema.model_validate(user)


@router.post("/login", response_model=UserOutSchema)
async def login(data: LoginSchema, session: DbSession, response: Response) -> UserOutSchema:
    """Log in, issue a session cookie. 401 on invalid credentials."""
    user = await session.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
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
    return UserOutSchema.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(session: DbSession, request: Request) -> Response:
    """Drop the session token and unset the cookie. Idempotent."""
    token = request.cookies.get(settings.session_cookie_name)
    if token is not None:
        await session.execute(delete(LoginSession).where(LoginSession.token == token))
        await session.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return response


@router.get("/me", response_model=UserOutSchema)
async def me(user: CurrentUser) -> UserOutSchema:
    """Return the currently authenticated user's id and username. 401 if not authenticated."""
    return UserOutSchema.model_validate(user)
