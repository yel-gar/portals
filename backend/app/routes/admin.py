from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from ..deps import DbSession, get_superuser
from ..models import LoginSession, User
from ..schemas import PasswordChangeSchema, UserOutSchema, UserRegisterSchema
from ..security import hash_password

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_superuser)],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Требуется авторизация"},
        status.HTTP_403_FORBIDDEN: {"description": "Недостаточно прав (нужен суперпользователь)"},
    },
)


@router.post(
    "/users",
    response_model=UserOutSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {"description": "Пользователь с таким именем уже существует"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Некорректные username или password"},
    },
    description="Создание пользователя. Флаг суперпользователя никогда не устанавливается.",
    summary="Создать пользователя",
)
async def create_user(data: UserRegisterSchema, session: DbSession) -> User:
    existing = await session.scalar(select(User).where(User.username == data.username))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует")
    user = User(username=data.username, password_hash=hash_password(data.password))
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует") from exc
    await session.refresh(user)
    logger.info("Администратор создал пользователя username=%s id=%d", user.username, user.id)
    return user


@router.get(
    "/users",
    response_model=list[UserOutSchema],
    description="Список всех пользователей.",
    summary="Список пользователей",
)
async def list_users(session: DbSession) -> list[User]:
    return list((await session.scalars(select(User).order_by(User.id))).all())


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Пользователь не найден"},
        status.HTTP_409_CONFLICT: {"description": "Нельзя удалить суперпользователя"},
    },
    description="Удаление пользователя. Суперпользователя удалить нельзя.",
    summary="Удалить пользователя",
)
async def delete_user(user_id: int, session: DbSession) -> None:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if user.is_superuser:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя удалить суперпользователя")
    await session.delete(user)
    await session.commit()
    logger.info("Администратор удалил пользователя id=%d", user_id)


@router.post(
    "/users/{user_id}/set-password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Пользователь не найден"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"description": "Пароль не удовлетворяет требованиям длины"},
    },
    description="Смена пароля пользователя. Все его сессии завершаются. Длина пароля валидируется схемой.",
    summary="Сменить пароль",
)
async def set_password(data: PasswordChangeSchema, user_id: int, session: DbSession) -> None:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    user.password_hash = hash_password(data.password)
    await session.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    await session.commit()
    logger.info("Администратор сменил пароль пользователю id=%d", user_id)
