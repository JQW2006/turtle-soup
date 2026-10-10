from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", ROOT_DIR / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"

    # Optional shared secret. When set, every /api request must carry it.
    app_access_token: str = ""
    # Make the Settings page read-only (recommended for public deployments without a token,
    # otherwise visitors could change the API key or point the base URL at their own server).
    settings_locked: bool = False

    database_url: str = f"sqlite:///{ROOT_DIR / 'data' / 'soup.db'}"
    frontend_dist: Path = ROOT_DIR / "frontend" / "dist"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    llm_timeout: float = 120.0
    llm_max_retries: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
