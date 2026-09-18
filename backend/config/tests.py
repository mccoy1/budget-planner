import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase, TestCase

BACKEND = Path(__file__).resolve().parent.parent

PROD_ENV = {
    'DJANGO_SETTINGS_MODULE': 'config.settings.prod',
    'DJANGO_SECRET_KEY': 'x' * 50,
    'DJANGO_ALLOWED_HOSTS': 'api.budget.example.com',
    'DJANGO_CORS_ALLOWED_ORIGINS': 'https://budget.example.com',
    'DB_PATH': '/tmp/budget-planner-settings-test.sqlite3',
}


class HealthTests(TestCase):
    def test_ok_without_signing_in(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_answers_whatever_host_the_checker_sends(self):
        # Runs before ALLOWED_HOSTS is consulted, so Render's internal checker
        # doesn't need its hostname listed.
        response = self.client.get('/health', HTTP_HOST='10.0.0.7:10000')
        self.assertEqual(response.status_code, 200)


class ProdSettingsTests(SimpleTestCase):
    """prod.py must refuse to boot when misconfigured, in a fresh interpreter."""

    def load(self, env):
        script = (
            'import django; django.setup(); from django.conf import settings as s; '
            'print(s.DEBUG, s.SESSION_COOKIE_SECURE, s.CSRF_COOKIE_SECURE, s.SECURE_SSL_REDIRECT, '
            's.CSRF_TRUSTED_ORIGINS, s.DATABASES["default"]["NAME"])'
        )
        clean = {k: v for k, v in os.environ.items() if not k.startswith(('DJANGO_', 'DB_PATH'))}
        return subprocess.run(
            [sys.executable, '-c', script], cwd=BACKEND, env={**clean, **env},
            capture_output=True, text=True,
        )

    def test_boots_with_everything_set(self):
        result = self.load(PROD_ENV)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            "False True True True ['https://budget.example.com'] /tmp/budget-planner-settings-test.sqlite3",
        )

    def test_refuses_to_boot_when_a_required_value_is_missing(self):
        for name in ('DJANGO_SECRET_KEY', 'DJANGO_ALLOWED_HOSTS', 'DJANGO_CORS_ALLOWED_ORIGINS', 'DB_PATH'):
            with self.subTest(missing=name):
                env = {k: v for k, v in PROD_ENV.items() if k != name}
                result = self.load(env)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)

    def test_refuses_a_dev_secret_key(self):
        result = self.load({**PROD_ENV, 'DJANGO_SECRET_KEY': 'django-insecure-abc'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('development key', result.stderr)
