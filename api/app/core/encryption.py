"""AES-256-GCM field-level encryption for sensitive DB columns.

Re-exports the shared implementation so API code can import from here.
"""
from shared.encryption import encrypt_field, decrypt_field  # noqa: F401
