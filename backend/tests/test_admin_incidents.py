from __future__ import annotations

from unittest.mock import AsyncMock, PropertyMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import create_app


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("ADMIN_SECRET", "test-admin-secret")
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="https://test") as value:
        yield value


@pytest.mark.asyncio
async def test_dashboard_query_key_never_authenticates_or_sets_cookie(client):
    response = await client.get(
        "/admin/dashboard?key=test-admin-secret",
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/admin/dashboard"
    assert "set-cookie" not in response.headers
    assert "test-admin-secret" not in response.text
    assert "test-admin-secret" not in response.headers["location"]


@pytest.mark.asyncio
async def test_dashboard_ignores_invalid_query_key_without_echoing_it(client):
    response = await client.get("/admin/dashboard?key=wrong", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/admin/dashboard"
    assert "set-cookie" not in response.headers
    assert "wrong" not in response.text
    assert "wrong" not in response.headers["location"]


@pytest.mark.asyncio
async def test_dashboard_without_session_renders_post_login_form(client):
    response = await client.get("/admin/dashboard")

    assert response.status_code == 200
    assert 'method="post"' in response.text
    assert 'action="/admin/session"' in response.text
    assert "set-cookie" not in response.headers


@pytest.mark.asyncio
async def test_admin_post_session_sets_cookie_and_redirects_without_secret(client):
    response = await client.post(
        "/admin/session",
        data={"key": "test-admin-secret"},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/admin/dashboard"
    cookie = response.headers["set-cookie"]
    assert "mw_admin_session=" in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=strict" in cookie
    assert "test-admin-secret" not in cookie
    assert "test-admin-secret" not in response.headers["location"]


@pytest.mark.asyncio
async def test_admin_reports_setup_error_when_secret_is_missing(client, monkeypatch):
    monkeypatch.delenv("ADMIN_SECRET", raising=False)

    response = await client.get("/admin/dashboard")

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "error_code": "admin_not_configured",
            "message": "Admin dashboard is not configured on this server.",
        }
    }


@pytest.mark.asyncio
async def test_dashboard_renders_durable_incidents(client, monkeypatch):
    enabled = patch.object(type(settings), "supabase_enabled", new_callable=PropertyMock, return_value=True)
    enabled.start()
    monkeypatch.setattr("app.admin._load_analysis_runs", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        "app.admin.supabase_ops.select",
        AsyncMock(return_value=[{
            "created_at": "2026-07-16T10:00:00Z",
            "event_type": "backend_error",
            "meta": {"path": "/api/analyze", "message": "internal failure"},
        }]),
    )
    try:
        response = await client.get(
            "/admin/dashboard",
            headers={"Authorization": "Bearer test-admin-secret"},
        )
    finally:
        enabled.stop()

    assert response.status_code == 200
    assert "Operational Incidents" in response.text
    assert "internal failure" in response.text


@pytest.mark.asyncio
async def test_incident_loading_degrades_when_ops_table_is_unavailable(client, monkeypatch):
    enabled = patch.object(type(settings), "supabase_enabled", new_callable=PropertyMock, return_value=True)
    enabled.start()
    monkeypatch.setattr("app.admin._load_analysis_runs", AsyncMock(return_value=[]))
    monkeypatch.setattr("app.admin._load_operational_incidents", AsyncMock(return_value=[]))
    try:
        response = await client.get(
            "/admin/dashboard",
            headers={"Authorization": "Bearer test-admin-secret"},
        )
    finally:
        enabled.stop()

    assert response.status_code == 200
    assert "No operational incidents recorded" in response.text
