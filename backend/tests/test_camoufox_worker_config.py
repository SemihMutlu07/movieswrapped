from pathlib import Path

import pytest

from app.worker.camoufox_worker import read_config


def test_read_config_from_worker_env(tmp_path: Path, monkeypatch):
    env = tmp_path / "worker.env"
    env.write_text(
        "WORKER_TOKEN=secret-token\n"
        "TMDB_API_KEY=tmdb-key\n"
        "API_BASE_URL=https://wrapped-backend.onrender.com\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.delenv("API_BASE_URL", raising=False)
    monkeypatch.delenv("WORKER_BACKEND_URL", raising=False)
    monkeypatch.setattr("app.worker.camoufox_worker.ENV_PATH", env)
    cfg = read_config()
    assert cfg.token == "secret-token"
    assert cfg.tmdb_api_key == "tmdb-key"
    assert cfg.base_url == "https://wrapped-backend.onrender.com"


def test_read_config_requires_fields(tmp_path: Path, monkeypatch):
    env = tmp_path / "worker.env"
    env.write_text("WORKER_TOKEN=only-token\n", encoding="utf-8")
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.delenv("API_BASE_URL", raising=False)
    monkeypatch.delenv("WORKER_BACKEND_URL", raising=False)
    monkeypatch.setattr("app.worker.camoufox_worker.ENV_PATH", env)
    with pytest.raises(SystemExit, match="TMDB_API_KEY"):
        read_config()
