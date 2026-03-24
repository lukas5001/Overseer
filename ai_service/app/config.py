"""AI Service configuration."""
import os

AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer",
)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
