"""Local development: the static frontend on :5500 calling this API on :8500."""
from .base import *  # noqa: F401,F403
from .base import env_list

SECRET_KEY = 'django-insecure-budget-planner-dev-only'
DEBUG = True
ALLOWED_HOSTS = ['localhost', '127.0.0.1']

# The frontend must be opened on the same hostname the API is called on:
# localhost and 127.0.0.1 are different sites, and the session cookie is not
# sent across sites.
_DEV_ORIGINS = ['http://localhost:5500', 'http://127.0.0.1:5500']
CORS_ALLOWED_ORIGINS = env_list('DJANGO_CORS_ALLOWED_ORIGINS', _DEV_ORIGINS)
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_TRUSTED_ORIGINS', CORS_ALLOWED_ORIGINS)
