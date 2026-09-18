from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from ..deps import DbSession, get_superuser
from ..models import User
from ..schemas import PasswordChangeSchema, UserOutSchema, UserRegisterSchema
from ..security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_superuser)])


@router.post("/users", response_model=UserOutSchema, status_code=status.HTTP_201_CREATED)
async def create_user(data: UserRegisterSchema, session: DbSession) -> UserOutSchema:
    """Create a user (superuser flag is never settable). 409 if username exists."""
    existing = await session.scalar(select(User).where(User.username == data.username))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует")
    user = User(username=data.username, password_hash=hash_password(data.password))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserOutSchema.model_validate(user)


@router.get("/users", response_model=list[UserOutSchema])
async def list_users(session: DbSession) -> list[UserOutSchema]:
    """List all users. Requires superuser; 403 otherwise."""
    users = (await session.execute(select(User).order_by(User.id))).scalars().all()
    return [UserOutSchema.model_validate(user) for user in users]


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, session: DbSession) -> None:
    """Delete a user. 404 if absent, 409 if target is a superuser."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if user.is_superuser:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя удалить суперпользователя")
    await session.delete(user)
    await session.commit()


@router.post("/users/{user_id}/set-password", status_code=status.HTTP_204_NO_CONTENT)
async def set_password(data: PasswordChangeSchema, user_id: int, session: DbSession) -> None:
    """Set a new password for a user (length validated by schema). 404 if absent."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    user.password_hash = hash_password(data.password)
    await session.commit()
