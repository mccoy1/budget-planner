"""Settings shared by every environment.

Nothing here reads a secret with a fallback. Values that are dangerous to get
wrong live in prod.py, where a missing one stops the process from booting.
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# backend/ (this file is backend/config/settings/base.py)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Local convenience only. Real environment variables win (load_dotenv does not
# override), so the file is inert on Render.
load_dotenv(BASE_DIR / '.env')


def env_list(name, default=()):
    """Read a comma-separated env var into a list of stripped, non-empty items."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == '':
        return list(default)
    return [item.strip() for item in raw.split(',') if item.strip()]


def env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or raw.strip() == '':
        return default
    return int(raw)


# SECRET_KEY, DEBUG, ALLOWED_HOSTS, CORS and CSRF origins: see dev.py / prod.py.

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'corsheaders',
    'axes',

    'accounts',
    'budgets',
]

MIDDLEWARE = [
    # First, so /health answers before host validation or the HTTPS redirect.
    'config.middleware.HealthCheckMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    # Must sit above CommonMiddleware so CORS headers reach every response.
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Last, per django-axes: it turns a lockout flag set during the view into a response.
    'axes.middleware.AxesMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database: one SQLite file
# ---------------------------------------------------------------------------
# In production this file lives on Render's ephemeral disk and Litestream
# streams its WAL to R2 (see start.sh). WAL mode is what Litestream replicates,
# and synchronous=NORMAL is the durable setting under WAL. IMMEDIATE takes the
# write lock at BEGIN, so two gunicorn workers queue on busy_timeout instead
# of failing with "database is locked" when a read transaction upgrades.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('DB_PATH') or BASE_DIR / 'db.sqlite3',
        'OPTIONS': {
            'transaction_mode': 'IMMEDIATE',
            'timeout': 5,
            'init_command': 'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;',
        },
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = 'accounts.User'

AUTHENTICATION_BACKENDS = [
    # First, so a locked-out login is refused before the password is checked.
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

SESSION_COOKIE_AGE = 60 * 60 * 24 * 30  # 30 days
SESSION_COOKIE_HTTPONLY = True

# Lockout keys on the account alone. Keying on IP as well would mean trusting
# Render's X-Forwarded-For chain; per-account is enough to cap guessing at 10
# tries per 15 minutes, and the worst case is that someone locks an account out
# for 15 minutes.
AXES_FAILURE_LIMIT = 10
AXES_COOLOFF_TIME = timedelta(minutes=15)
AXES_LOCKOUT_PARAMETERS = ['username']
AXES_RESET_ON_SUCCESS = True
AXES_LOCKOUT_CALLABLE = 'accounts.views.lockout_response'
# Count failures against the normalized email. Axes otherwise keys on the text
# as typed, so SARAH@… and sarah@… would each get their own 10 tries.
AXES_USERNAME_CALLABLE = 'accounts.views.axes_username'
# W006 says that without ip_address, rotating user agents or cookies bypasses the
# limit. That applies to combined keys like [username, user_agent]; a lockout
# keyed on the username alone counts every attempt on the account, whatever
# the client.
SILENCED_SYSTEM_CHECKS = ['axes.W006']

# ---------------------------------------------------------------------------
# Static files (the admin only)
# ---------------------------------------------------------------------------
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}
