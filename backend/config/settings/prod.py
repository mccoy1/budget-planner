"""Production settings, the default for wsgi.py.

No dangerous defaults: every value whose wrong guess is a security or
data-loss incident is read from the environment with no fallback, and a
missing one raises ImproperlyConfigured at import, so the process refuses to
boot rather than coming up quietly misconfigured.
"""
import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import MIDDLEWARE, env_int, env_list


def _required(name, hint):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ImproperlyConfigured(f'{name} is not set. {hint}')
    return value


SECRET_KEY = _required(
    'DJANGO_SECRET_KEY',
    'Generate one with: python -c "from django.core.management.utils import '
    'get_random_secret_key as k; print(k())"',
)
if SECRET_KEY.startswith('django-insecure-'):
    raise ImproperlyConfigured('DJANGO_SECRET_KEY is a development key.')

DEBUG = False

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS')
if not ALLOWED_HOSTS:
    raise ImproperlyConfigured(
        'DJANGO_ALLOWED_HOSTS is not set (comma-separated hostnames, '
        'e.g. api.budget.msmccoy.com).'
    )

# The database must be the file Litestream replicates. Falling back to a path
# inside the checkout would work perfectly until the next restart, then lose
# everything, so there is no fallback.
_required('DB_PATH', 'It must match the path in litestream.yml.')

# ---------------------------------------------------------------------------
# CORS / CSRF: the frontend is a different origin (GitHub Pages)
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list('DJANGO_CORS_ALLOWED_ORIGINS')
if not CORS_ALLOWED_ORIGINS:
    raise ImproperlyConfigured(
        'DJANGO_CORS_ALLOWED_ORIGINS is not set (e.g. https://budget.msmccoy.com).'
    )
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_TRUSTED_ORIGINS', CORS_ALLOWED_ORIGINS)

# ---------------------------------------------------------------------------
# HTTPS
# ---------------------------------------------------------------------------
# Render terminates TLS and forwards the original scheme in this header.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = True
# Short by default: a browser that cached a long max-age cannot be told to
# forget it. Raise via env once HTTPS has been stable for a while.
SECURE_HSTS_SECONDS = env_int('DJANGO_SECURE_HSTS_SECONDS', 3600)

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

# ---------------------------------------------------------------------------
# Static files for the admin, served by WhiteNoise (directly after SecurityMiddleware)
# ---------------------------------------------------------------------------
MIDDLEWARE = list(MIDDLEWARE)
MIDDLEWARE.insert(
    MIDDLEWARE.index('django.middleware.security.SecurityMiddleware') + 1,
    'whitenoise.middleware.WhiteNoiseMiddleware',
)
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
