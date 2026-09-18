"""WSGI entry point for gunicorn.

Defaults to prod settings, so a server booted without DJANGO_SETTINGS_MODULE
cannot quietly come up in dev mode. manage.py defaults to dev instead.
"""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.prod')

application = get_wsgi_application()
