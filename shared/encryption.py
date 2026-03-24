"""AES-256-GCM field-level encryption for sensitive DB columns."""
import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    raw = os.getenv("FIELD_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("FIELD_ENCRYPTION_KEY not set")
    # Expect base64url-encoded 32-byte key
    key_bytes = base64.urlsafe_b64decode(raw + "==")
    if len(key_bytes) < 32:
        raise ValueError("FIELD_ENCRYPTION_KEY must decode to at least 32 bytes")
    return key_bytes[:32]


def encrypt_field(plaintext: str) -> str:
    """Returns base64-encoded nonce+ciphertext string for DB storage."""
    if not plaintext:
        return plaintext
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_field(ciphertext: str) -> str:
    """Decrypts a value produced by encrypt_field(). Returns plaintext."""
    if not ciphertext:
        return ciphertext
    # Detect if value is already plaintext (legacy, unencrypted)
    try:
        raw = base64.urlsafe_b64decode(ciphertext + "==")
    except Exception:
        return ciphertext  # not base64 → treat as plaintext legacy value
    if len(raw) < 13:
        return ciphertext  # too short to be valid ciphertext
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce, ct = raw[:12], raw[12:]
    try:
        return aesgcm.decrypt(nonce, ct, None).decode()
    except Exception:
        return ciphertext  # legacy plaintext fallback
