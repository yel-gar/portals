import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocketDisconnect
from httpx import AsyncClient
from pydantic import BaseModel

from app.config import settings
from app.models import Action, Portal
from app.notifications import action_log_hub, portal_update_hub
from app.routes.portals import _hub_snapshot_loop, action_log_updates, portal_updates


class _MockWebSocket:
    def __init__(self, cookies: dict[str, str] | None = None) -> None:
        self.cookies = cookies or {}
        self.sent: list[Any] = []
        self.accepted = False
        self.closed_code: int | None = None
        self.disconnect = asyncio.Event()
        self._receive: Callable[[], Awaitable[str]] | None = None

    def set_receive(self, receive: Callable[[], Awaitable[str]]) -> None:
        self._receive = receive

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, data: Any) -> None:
        self.sent.append(data)

    async def receive_text(self) -> str:
        if self._receive is not None:
            return await self._receive()
        await self.disconnect.wait()
        raise WebSocketDisconnect()

    async def close(self, code: int = 1000) -> None:
        self.closed_code = code


class _Snapshot(BaseModel):
    snapshot: int


async def _wait_until(predicate: Callable[[], bool], limit: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + limit
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError("условие не выполнилось за отведённое время")
        await asyncio.sleep(0.01)


def _ping_then_disconnect() -> Callable[[], Awaitable[str]]:
    states = iter(["ping", "disconnect"])

    async def receive() -> str:
        state = next(states)
        if state == "disconnect":
            raise WebSocketDisconnect()
        return state

    return receive


async def _login(client: AsyncClient) -> None:
    response = await client.post("/auth/register", json={"username": "alice", "password": "supersecret1"})
    assert response.status_code == 201, response.text
    login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert login.status_code == 200, login.text


async def _noop_snapshot() -> BaseModel:
    return _Snapshot(snapshot=0)


async def test_hub_snapshot_loop_exits_on_disconnect() -> None:
    websocket = _MockWebSocket()
    websocket.disconnect.set()
    await _hub_snapshot_loop(websocket, action_log_hub, _noop_snapshot)  # type: ignore[arg-type]
    assert websocket.sent == []
    assert action_log_hub.subscriber_count == 0


async def test_hub_snapshot_loop_pushes_snapshot_on_event() -> None:
    websocket = _MockWebSocket()
    calls = 0

    async def factory() -> BaseModel:
        nonlocal calls
        calls += 1
        return _Snapshot(snapshot=calls)

    task = asyncio.create_task(_hub_snapshot_loop(websocket, portal_update_hub, factory))  # type: ignore[arg-type]
    try:
        await _wait_until(lambda: portal_update_hub.subscriber_count == 1)
        await portal_update_hub.broadcast()
        await _wait_until(lambda: len(websocket.sent) == 1)
    finally:
        websocket.disconnect.set()
        await asyncio.wait_for(task, timeout=5.0)
    assert [entry["snapshot"] for entry in websocket.sent] == [1]
    assert portal_update_hub.subscriber_count == 0


async def test_hub_snapshot_loop_ignores_client_ping() -> None:
    websocket = _MockWebSocket()
    websocket.set_receive(_ping_then_disconnect())
    await _hub_snapshot_loop(websocket, action_log_hub, _noop_snapshot)  # type: ignore[arg-type]
    assert websocket.sent == []
    assert action_log_hub.subscriber_count == 0


async def test_portal_ws_rejects_anonymous() -> None:
    websocket = _MockWebSocket()
    await portal_updates(websocket, page=1, items_per_page=20)  # type: ignore[arg-type]
    assert websocket.closed_code == 4401
    assert websocket.accepted is False


async def test_log_ws_rejects_anonymous() -> None:
    websocket = _MockWebSocket()
    await action_log_updates(websocket, page=1, items_per_page=20)  # type: ignore[arg-type]
    assert websocket.closed_code == 4401
    assert websocket.accepted is False


async def test_portal_ws_sends_initial_snapshot_and_exits(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    token = client.cookies.get(settings.session_cookie_name)
    assert token is not None
    await create_portal(name="Alpha")

    websocket = _MockWebSocket(cookies={settings.session_cookie_name: token})
    websocket.disconnect.set()
    await portal_updates(websocket, page=1, items_per_page=20)  # type: ignore[arg-type]
    assert websocket.accepted is True
    assert len(websocket.sent) == 1
    payload = websocket.sent[0]
    assert payload["total"] == 1
    assert payload["items"][0]["name"] == "Alpha"


async def test_log_ws_sends_initial_snapshot_and_exits(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    token = client.cookies.get(settings.session_cookie_name)
    assert token is not None
    portal = await create_portal()
    await client.post(f"/portals/{portal.id}", params={"action": Action.MARK.value})

    websocket = _MockWebSocket(cookies={settings.session_cookie_name: token})
    websocket.disconnect.set()
    await action_log_updates(websocket, page=1, items_per_page=20)  # type: ignore[arg-type]
    assert websocket.accepted is True
    assert len(websocket.sent) == 1
    payload = websocket.sent[0]
    assert payload["total"] == 1
    assert payload["items"][0]["action"] == Action.MARK.value
