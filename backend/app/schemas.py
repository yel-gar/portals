from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .constants import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH
from .models import Action, DangerLevel


class PortalSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    destination_world: str
    energy_level: int
    stability: int
    closed: bool
    creatures_count: int
    is_marked: bool
    has_observer: bool
    last_update: datetime
    expires_at: datetime
    risk_factor: float
    danger_level: DangerLevel


class PortalListSchema(BaseModel):
    items: list[PortalSchema]
    page: int
    items_per_page: int
    total: int


class UserRegisterSchema(BaseModel):
    username: str = Field(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class LoginSchema(BaseModel):
    username: str
    password: str


class PasswordChangeSchema(BaseModel):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class UserOutSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_superuser: bool


class ActionLogEntrySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    portal_id: int
    action: Action
    timestamp: datetime
    user: UserOutSchema | None


class ActionLogListSchema(BaseModel):
    items: list[ActionLogEntrySchema]
    page: int
    items_per_page: int
    total: int


class StatsSchema(BaseModel):
    total: int
    open: int
    closed: int
    marked: int
    with_observer: int
    danger_levels: dict[DangerLevel, int]
    avg_risk: float
