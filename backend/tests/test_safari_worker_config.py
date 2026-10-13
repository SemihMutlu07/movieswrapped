from pathlib import Path

import pytest

from app.worker import safari_worker


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
    monkeypatch.setattr(safari_worker, "ENV_PATH", env)
    cfg = safari_worker.read_config()
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
    monkeypatch.setattr(safari_worker, "ENV_PATH", env)
    with pytest.raises(SystemExit, match="TMDB_API_KEY"):
        safari_worker.read_config()


def test_worker_requirements_pin_pandas_for_python_314():
    text = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text(encoding="utf-8")
    assert "pandas==2.3.1" not in text
    assert "pandas>=2.3.3,<3" in text


def test_worker_does_not_import_camoufox():
    import app.worker.safari_worker as mod

    assert "camoufox" not in mod.__file__
    assert not hasattr(mod, "camoufox_pool")
    assert mod.SCRAPE_TRANSPORT == "curl_cffi_safari"
