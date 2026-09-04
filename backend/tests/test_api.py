"""
Backend integration tests.

Run from backend/ directory:
    pytest
"""
import io
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch


# ---- fixtures ----------------------------------------------------------------

@pytest.fixture
def minimal_watched_csv() -> bytes:
    return b"Name,Year,Letterboxd URI\nInception,2010,https://letterboxd.com/film/inception/\n"


@pytest.fixture
def zip_with_watched(minimal_watched_csv: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("watched.csv", minimal_watched_csv)
    return buf.getvalue()


@pytest.fixture
async def client():
    """ASGI test client — lifespan is bypassed; network clients are mocked."""
    with patch.dict("os.environ", {"TMDB_API_KEY": "test-key"}):
        from app.main import create_app  # noqa: PLC0415

        app = create_app()

        # Route handlers only pass this through to mocked service calls in tests.
        session = object()
        app.state.aiohttp_session = session

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


# ---- health ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_root(client: AsyncClient):
    r = await client.get("/")
    assert r.status_code == 200
    assert "message" in r.json()


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ---- analyze (happy path — background task) ---------------------------------

@pytest.mark.asyncio
async def test_analyze_returns_202_task_id(client: AsyncClient, zip_with_watched: bytes):
    """POST /api/analyze should accept a ZIP and return 202 + task_id."""
    async def fake_run_analysis(*args, **kwargs):
        return None

    with patch(
        "app.routes.analyze._run_analysis",
        side_effect=fake_run_analysis,
    ):
        files = {"files": ("export.zip", zip_with_watched, "application/zip")}
        r = await client.post("/api/analyze", files=files)

    assert r.status_code == 202
    body = r.json()
    assert "task_id" in body
    assert body["status"] == "pending"


@pytest.mark.asyncio
async def test_analyze_missing_files(client: AsyncClient):
    """POST /api/analyze with no files should return 422."""
    r = await client.post("/api/analyze")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_analyze_accepts_letterboxd_utc_export_name(client: AsyncClient, zip_with_watched: bytes):
    """Letterboxd downloads are often named letterboxd-user-YYYY-MM-DD-HH-MM-utc without .zip."""
    async def fake_run_analysis(*args, **kwargs):
        return None

    with patch(
        "app.routes.analyze._run_analysis",
        side_effect=fake_run_analysis,
    ):
        files = {
            "files": (
                "letterboxd-semihmutsuz-2026-09-02-03-29-utc",
                zip_with_watched,
                "application/zip",
            )
        }
        r = await client.post("/api/analyze", files=files)

    assert r.status_code == 202
    assert "task_id" in r.json()


@pytest.mark.asyncio
async def test_analyze_accepts_extensionless_zip_named_download(client: AsyncClient, zip_with_watched: bytes):
    captured: dict = {}

    async def fake_run_analysis(task_id, session, csv_files, request_dir, username=None):
        captured.update(csv_files)

    with patch("app.routes.analyze._run_analysis", side_effect=fake_run_analysis):
        response = await client.post(
            "/api/analyze",
            files={"files": ("download", zip_with_watched, "application/octet-stream")},
        )

    assert response.status_code == 202
    assert "watched.csv" in captured


@pytest.mark.asyncio
async def test_analyze_corrupt_zip(client: AsyncClient):
    """POST /api/analyze with a corrupt ZIP should return 400."""
    files = {"files": ("bad.zip", b"not a zip", "application/zip")}
    r = await client.post("/api/analyze", files=files)
    assert r.status_code == 400


# ---- progress polling --------------------------------------------------------

@pytest.mark.asyncio
async def test_progress_unknown_task(client: AsyncClient):
    """GET /api/progress/{task_id} for a non-existent task returns 404 with
    enough context (boot_age_seconds/likely_server_restart) for the frontend
    to distinguish a genuinely invalid task_id from an in-memory task queue
    wiped by a backend restart."""
    r = await client.get("/api/progress/nonexistent-task-id")
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail["error_code"] == "task_not_found"
    assert isinstance(detail["boot_age_seconds"], (int, float))
    assert detail["likely_server_restart"] is True  # test process just booted


@pytest.mark.asyncio
async def test_progress_legacy_removed(client: AsyncClient):
    r = await client.get("/api/progress")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_task_id_polling_flow(client: AsyncClient, zip_with_watched: bytes):
    """Submit a job, then poll its task_id — should reach a terminal state."""
    import asyncio

    async def fake_run_analysis(task_id, session, csv_files, request_dir, username=None):
        from app import task_manager

        task_manager.set_task_done(task_id, {"status": "success", "stats": {"total_films": 1, "mock": True}})

    with patch(
        "app.routes.analyze._run_analysis",
        side_effect=fake_run_analysis,
    ):
        files = {"files": ("export.zip", zip_with_watched, "application/zip")}
        r = await client.post("/api/analyze", files=files)
        assert r.status_code == 202
        task_id = r.json()["task_id"]
        poll_token = r.json()["poll_token"]

        # Give the background task a moment to run
        await asyncio.sleep(0.2)

        denied = await client.get(f"/api/progress/{task_id}")
        assert denied.status_code == 403
        poll = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": poll_token})
        assert poll.status_code == 200
        body = poll.json()
        assert body["status"] in ("pending", "running", "done", "failed")


@pytest.mark.asyncio
async def test_analyze_letterboxd_zip_with_deleted_subfolder(client: AsyncClient, minimal_watched_csv: bytes):
    """Real Letterboxd exports include deleted/ and orphaned/ copies of diary.csv etc."""
    import io
    import zipfile

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("watched.csv", minimal_watched_csv)
        zf.writestr("diary.csv", "Date,Name,Year\n")
        zf.writestr("deleted/diary.csv", "Date,Name,Year\n")
        zf.writestr("orphaned/reviews.csv", "Date,Name,Year\n")

    async def fake_run_analysis(*args, **kwargs):
        return None

    with patch("app.routes.analyze._run_analysis", side_effect=fake_run_analysis):
        response = await client.post(
            "/api/analyze",
            files={"files": ("letterboxd-user-2026-utc.zip", archive.getvalue(), "application/zip")},
        )

    assert response.status_code == 202


@pytest.mark.asyncio
async def test_rejects_zip_path_traversal(client: AsyncClient):
    import io
    import zipfile

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../watched.csv", "Name,Year\nExample,2024\n")
    response = await client.post(
        "/api/analyze",
        files={"files": ("export.zip", archive.getvalue(), "application/zip")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "unsafe_archive"


@pytest.mark.asyncio
async def test_analyze_rate_limit_has_retry_after(client: AsyncClient):
    for _ in range(3):
        response = await client.post("/api/analyze", files={"files": ("bad.txt", b"bad", "text/plain")})
        assert response.status_code == 400
    limited = await client.post("/api/analyze", files={"files": ("bad.txt", b"bad", "text/plain")})
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


# ---- parse-username ----------------------------------------------------------

@pytest.mark.asyncio
async def test_parse_username_known_pattern(client: AsyncClient):
    r = await client.post("/api/parse-username", json={"filename": "letterboxd-johndoe-2024-01-01.zip"})
    assert r.status_code == 200
    assert r.json()["username"] == "johndoe"


@pytest.mark.asyncio
async def test_parse_username_simple_export_name(client: AsyncClient):
    r = await client.post("/api/parse-username", json={"filename": "letterboxd-johndoe.zip"})
    assert r.status_code == 200
    assert r.json()["username"] == "johndoe"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "username"),
    [
        ("letterboxd-johndoe-utc.zip", "johndoe"),
        ("letterboxd-johndoe-2024.zip", "johndoe"),
        ("Letterboxd_johndoe_Export_2024.zip", "johndoe"),
        ("./path/letterboxd-johndoe.zip", "johndoe"),
        ("letterboxd-john-doe.zip", None),
    ],
)
async def test_parse_username_edge_cases(client: AsyncClient, filename: str, username: str | None):
    r = await client.post("/api/parse-username", json={"filename": filename})
    assert r.status_code == 200
    assert r.json()["username"] == username


@pytest.mark.asyncio
async def test_parse_username_no_match(client: AsyncClient):
    r = await client.post("/api/parse-username", json={"filename": "random_file.csv"})
    assert r.status_code == 200
    assert r.json()["username"] is None

