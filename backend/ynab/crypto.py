"""Encryption for the stored YNAB token.

The token is a live financial credential. This database is streamed to object
storage by Litestream (the file and its WAL), so a plaintext token in a row
would also be sitting in a bucket. Encrypting it means a leaked bucket, or a
stray restore, yields ciphertext only.

The key comes from the environment (YNAB_TOKEN_ENCRYPTION_KEY) and is never in
the database, so the two would have to leak separately. Rotating it does not lose
anything important: the token becomes unreadable, the app says so, and you
paste a new token. YNAB tokens are revocable in YNAB's account settings.
"""
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


class TokenKeyMissing(Exception):
    """YNAB_TOKEN_ENCRYPTION_KEY is not set, so nothing may be encrypted or read."""


class TokenUnreadable(Exception):
    """The stored token doesn't decrypt under the current key (rotated, or corrupt)."""


def key_configured():
    return bool(getattr(settings, 'YNAB_TOKEN_ENCRYPTION_KEY', ''))


def _box():
    key = getattr(settings, 'YNAB_TOKEN_ENCRYPTION_KEY', '')
    if not key:
        raise TokenKeyMissing(
            'YNAB_TOKEN_ENCRYPTION_KEY is not set, so a YNAB token cannot be stored safely.'
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        # A malformed key must never fall back to storing the token in the clear.
        raise TokenKeyMissing(
            'YNAB_TOKEN_ENCRYPTION_KEY is not a valid Fernet key. Generate one with: '
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        ) from exc


def encrypt_token(plain):
    if not isinstance(plain, str) or not plain.strip():
        raise ValueError('A token is required.')
    return _box().encrypt(plain.strip().encode()).decode()


def decrypt_token(blob):
    try:
        return _box().decrypt((blob or '').encode()).decode()
    except InvalidToken as exc:
        raise TokenUnreadable(
            'The saved YNAB token could not be read with this server’s key. '
            'Connect YNAB again to store a fresh one.'
        ) from exc
