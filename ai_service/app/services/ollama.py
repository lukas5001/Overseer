"""Async HTTP client for Ollama API."""
import httpx

from ai_service.app.config import OLLAMA_URL, OLLAMA_MODEL


async def chat_completion(messages: list[dict], temperature: float = 0.3) -> str:
    """Send chat messages to Ollama and return the assistant response."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature},
            },
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def get_embedding(text: str) -> list[float]:
    """Generate an embedding vector for the given text."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": OLLAMA_MODEL, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
