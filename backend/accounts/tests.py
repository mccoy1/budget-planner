import json
import os
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase

User = get_user_model()

FRONTEND = 'http://localhost:5500'
PASSWORD = 'correct-horse-battery'


class ApiClientMixin:
    """A client that behaves like the frontend: CSRF enforced, token from /session."""

    def make_client(self):
        return Client(enforce_csrf_checks=True, HTTP_ORIGIN=FRONTEND)

    def csrf(self, client):
        return client.get('/api/auth/session').json()['csrfToken']

    def send(self, client, method, path, body=None, token=None):
        headers = {'HTTP_X_CSRFTOKEN': token} if token else {}
        if method == 'GET':
            return client.get(path, **headers)
        return getattr(client, method.lower())(
            path, data=json.dumps(body) if body is not None else None,
            content_type='application/json', **headers,
        )

    def sign_in(self, client, email, password=PASSWORD):
        token = self.csrf(client)
        response = self.send(client, 'POST', '/api/auth/login', {'email': email, 'password': password}, token)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['csrfToken']


class UserModelTests(TestCase):
    def test_email_is_stored_lowercase(self):
        user = User.objects.create_user('Sarah@Example.COM', PASSWORD)
        self.assertEqual(user.email, 'sarah@example.com')

    def test_email_is_required(self):
        with self.assertRaises(ValueError):
            User.objects.create_user('', PASSWORD)


class SessionTests(ApiClientMixin, TestCase):
    def setUp(self):
        self.user = User.objects.create_user('sarah@example.com', PASSWORD)
        self.client = self.make_client()

    def test_anonymous_session_has_no_user_but_has_a_token(self):
        body = self.client.get('/api/auth/session').json()
        self.assertIsNone(body['user'])
        self.assertTrue(body['csrfToken'])

    def test_sign_in_then_session_shows_the_user(self):
        self.sign_in(self.client, 'sarah@example.com')
        self.assertEqual(self.client.get('/api/auth/session').json()['user'], {'email': 'sarah@example.com'})

    def test_sign_in_ignores_email_case(self):
        self.sign_in(self.client, '  SARAH@example.com ')

    def test_wrong_password_is_401(self):
        token = self.csrf(self.client)
        response = self.send(self.client, 'POST', '/api/auth/login',
                             {'email': 'sarah@example.com', 'password': 'nope'}, token)
        self.assertEqual(response.status_code, 401)
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])

    def test_missing_fields_is_400(self):
        token = self.csrf(self.client)
        response = self.send(self.client, 'POST', '/api/auth/login', {'email': 'sarah@example.com'}, token)
        self.assertEqual(response.status_code, 400)

    def test_sign_in_without_csrf_token_is_refused(self):
        response = self.send(self.client, 'POST', '/api/auth/login',
                             {'email': 'sarah@example.com', 'password': PASSWORD})
        self.assertEqual(response.status_code, 403)

    def test_sign_in_from_an_untrusted_origin_is_refused_even_with_a_token(self):
        token = self.csrf(self.client)
        response = self.client.post(
            '/api/auth/login', data=json.dumps({'email': 'sarah@example.com', 'password': PASSWORD}),
            content_type='application/json', HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://evil.example',
        )
        self.assertEqual(response.status_code, 403)

    def test_sign_out(self):
        token = self.sign_in(self.client, 'sarah@example.com')
        response = self.send(self.client, 'POST', '/api/auth/logout', token=token)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['user'])
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])

    def test_get_on_login_is_405(self):
        self.assertEqual(self.client.get('/api/auth/login').status_code, 405)


class LockoutTests(ApiClientMixin, TestCase):
    def setUp(self):
        User.objects.create_user('sarah@example.com', PASSWORD)
        self.client = self.make_client()

    def test_ten_failures_lock_the_account_even_for_the_right_password(self):
        token = self.csrf(self.client)
        for _ in range(10):
            self.send(self.client, 'POST', '/api/auth/login',
                      {'email': 'sarah@example.com', 'password': 'wrong'}, token)
        response = self.send(self.client, 'POST', '/api/auth/login',
                             {'email': 'sarah@example.com', 'password': PASSWORD}, token)
        self.assertEqual(response.status_code, 429)
        self.assertIn('Too many', response.json()['error'])

    def test_lockout_follows_the_account_across_email_case(self):
        token = self.csrf(self.client)
        for i in range(10):
            email = 'SARAH@example.com' if i % 2 else 'sarah@example.com'
            self.send(self.client, 'POST', '/api/auth/login', {'email': email, 'password': 'wrong'}, token)
        response = self.send(self.client, 'POST', '/api/auth/login',
                             {'email': 'sarah@example.com', 'password': PASSWORD}, token)
        self.assertEqual(response.status_code, 429)


class ChangePasswordTests(ApiClientMixin, TestCase):
    def setUp(self):
        User.objects.create_user('sarah@example.com', PASSWORD)
        self.client = self.make_client()
        self.token = self.sign_in(self.client, 'sarah@example.com')

    def change(self, current, new):
        return self.send(self.client, 'POST', '/api/auth/password',
                         {'currentPassword': current, 'newPassword': new}, self.token)

    def test_wrong_current_password(self):
        response = self.change('wrong', 'a-much-better-passphrase')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['field'], 'currentPassword')

    def test_weak_new_password(self):
        response = self.change(PASSWORD, 'short')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['field'], 'newPassword')

    def test_success_keeps_this_session_and_the_new_password_works(self):
        response = self.change(PASSWORD, 'a-much-better-passphrase')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/auth/session').json()['user']['email'], 'sarah@example.com')
        self.sign_in(self.make_client(), 'sarah@example.com', 'a-much-better-passphrase')

    def test_requires_sign_in(self):
        client = self.make_client()
        response = self.send(client, 'POST', '/api/auth/password',
                             {'currentPassword': PASSWORD, 'newPassword': 'x' * 12}, self.csrf(client))
        self.assertEqual(response.status_code, 401)


class CorsTests(TestCase):
    def preflight(self, origin):
        return self.client.options(
            '/api/auth/login', HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type, x-csrftoken',
        )

    def test_frontend_origin_is_allowed_with_credentials(self):
        response = self.preflight(FRONTEND)
        self.assertEqual(response['Access-Control-Allow-Origin'], FRONTEND)
        self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
        self.assertIn('x-csrftoken', response['Access-Control-Allow-Headers'])

    def test_other_origins_get_no_cors_headers(self):
        response = self.preflight('https://evil.example')
        self.assertNotIn('Access-Control-Allow-Origin', response)


class EnsureAdminTests(TestCase):
    def run_command(self, **env):
        out = StringIO()
        with mock.patch.dict(os.environ, env, clear=False):
            for name in ('DJANGO_ADMIN_EMAIL', 'DJANGO_ADMIN_PASSWORD'):
                if name not in env:
                    os.environ.pop(name, None)
            call_command('ensure_admin', stdout=out)
        return out.getvalue()

    def test_skips_without_an_email(self):
        self.assertIn('skipping', self.run_command())
        self.assertFalse(User.objects.exists())

    def test_creates_a_superuser(self):
        self.run_command(DJANGO_ADMIN_EMAIL='Admin@Example.com', DJANGO_ADMIN_PASSWORD=PASSWORD)
        admin = User.objects.get()
        self.assertEqual(admin.email, 'admin@example.com')
        self.assertTrue(admin.is_superuser and admin.is_staff)
        self.assertTrue(admin.check_password(PASSWORD))

    def test_never_resets_an_existing_password(self):
        User.objects.create_superuser('admin@example.com', 'changed-in-the-admin')
        self.run_command(DJANGO_ADMIN_EMAIL='admin@example.com', DJANGO_ADMIN_PASSWORD=PASSWORD)
        self.assertTrue(User.objects.get().check_password('changed-in-the-admin'))

    def test_new_admin_without_a_password_is_an_error(self):
        with self.assertRaises(CommandError):
            self.run_command(DJANGO_ADMIN_EMAIL='admin@example.com')
