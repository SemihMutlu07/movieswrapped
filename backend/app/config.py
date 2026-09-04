from __future__ import annotations

import os
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    tmdb_api_key: str = ""
    tmdb_requests_per_second: int = 25
    tmdb_429_retries: int = 2
    frontend_origins: str = ""
    debug_cinema_scale: bool = False
    log_level: str = "INFO"

    # Optional: mirror run logs to Supabase so the admin dashboard survives Render
    # restarts (local runs/ is ephemeral there). Anon key only — never service_role.
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_ops_email: str = ""
    supabase_ops_password: str = ""
    run_retention_days: int = 30

    @property
    def supabase_enabled(self) -> bool:
        return bool(
            self.supabase_url
            and self.supabase_anon_key
            and self.supabase_ops_email
            and self.supabase_ops_password
        )

    @property
    def cors_origins(self) -> List[str]:
        base = [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://movieswrapped.com",
            "https://www.movieswrapped.com",
            "https://movieswrapped.netlify.app",
            "https://letterboxd-wrapped.netlify.app",
        ]
        extra = [o.strip() for o in self.frontend_origins.split(",") if o.strip()]
        return base + extra


settings = Settings()


def backend_git_sha() -> str | None:
    """Commit SHA of the running backend, from whichever env var the platform sets."""
    return os.getenv("BACKEND_GIT_SHA") or os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT")
