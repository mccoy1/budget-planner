"""Tests for the YNAB integration.

They run against a fake YNAB served on localhost (YNAB_API_BASE points at it),
so the real client code — headers, error mapping, JSON shape — is exercised
without touching the network or anyone's real budget.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from accounts.tests import PASSWORD, ApiClientMixin
from budgets.models import Scenario

from .models import ScenarioAnchor, YnabConnection

User = get_user_model()

KEY = Fernet.generate_key().decode()
TOKEN = 'ynab-personal-access-token'
PLAN = '11111111-1111-1111-1111-111111111111'
GROCERIES = 'aaaaaaaa-0000-0000-0000-000000000001'
SCHOOL = 'aaaaaaaa-0000-0000-0000-000000000002'
HIDDEN = 'aaaaaaaa-0000-0000-0000-000000000003'
STATE = {'income': {'amount': 7560, 'period': 'monthly'}, 'currency': 'USD', 'categories': []}


class FakeYnab:
    """A stand-in for api.ynab.com, with just the three reads."""

    def __init__(self):
        self.plans = [{'id': PLAN, 'name': 'Family'}]
        self.groups = [{
            'name': 'Monthly Bills', 'hidden': False, 'deleted': False,
            'categories': [
                {'id': GROCERIES, 'name': 'Groceries', 'hidden': False, 'deleted': False},
                {'id': SCHOOL, 'name': 'School Supplies', 'hidden': False, 'deleted': False},
                {'id': HIDDEN, 'name': 'Old Thing', 'hidden': True, 'deleted': False},
            ],
        }]
        # category id → budgeted, in milliunits
        self.budgeted = {GROCERIES: 700000, SCHOOL: 130000, HIDDEN: 5000}
        self.force_status = None      # answer every call with this status instead
        self.requests = []            # (path, authorization header)

    def body_for(self, path):
        if path == '/plans':
            return {'data': {'plans': self.plans}}
        if path.endswith('/categories'):
            return {'data': {'category_groups': self.groups}}
        if '/months/' in path:
            return {'data': {'month': {'categories': [
                {'id': cid, 'name': cid, 'budgeted': amount, 'deleted': False}
                for cid, amount in self.budgeted.items()
            ]}}}
        return None


class FakeYnabServer:
    def __init__(self, fake):
        handler = _handler_for(fake)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self):
        host, port = self.server.server_address[:2]
        return f'http://{host}:{port}'

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def _handler_for(fake):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's naming
            fake.requests.append((self.path, self.headers.get('Authorization')))
            if fake.force_status:
                return self._send(fake.force_status, {'error': {'detail': 'nope'}})
            body = fake.body_for(self.path)
            return self._send(200, body) if body else self._send(404, {'error': {'detail': 'not found'}})

        def _send(self, status, payload):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass  # keep the test output clean

    return Handler


@override_settings(YNAB_TOKEN_KEY=KEY)
class YnabTestCase(ApiClientMixin, TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fake = FakeYnab()
        cls.ynab = FakeYnabServer(cls.fake)
        cls.override = override_settings(YNAB_API_BASE=cls.ynab.base)
        cls.override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.override.disable()
        cls.ynab.stop()
        super().tearDownClass()

    def setUp(self):
        self.fake.__init__()  # fresh plans, amounts and request log per test
        self.user = User.objects.create_user('sarah@example.com', PASSWORD)
        self.client = self.make_client()
        self.token = self.sign_in(self.client, 'sarah@example.com')

    def api(self, method, path, body=None):
        return self.send(self.client, method, path, body, self.token)

    def connect(self, token=TOKEN):
        response = self.api('PUT', '/api/ynab/connection', {'token': token})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['connection']

    def scenario(self, name='September'):
        return Scenario.objects.create(owner=self.user, name=name, data=STATE)

    def anchor(self, scenario, month='2026-09', ids=(GROCERIES, SCHOOL)):
        return self.api(
            'PUT', f'/api/ynab/scenarios/{scenario.id}/anchor',
            {'month': month, 'categoryIds': list(ids)},
        )


class AuthTests(YnabTestCase):
    def test_every_endpoint_is_401_when_signed_out(self):
        client = self.make_client()
        token = self.csrf(client)
        sid = self.scenario().id
        for method, path in [
            ('GET', '/api/ynab/state'), ('PUT', '/api/ynab/connection'),
            ('PATCH', '/api/ynab/connection'), ('DELETE', '/api/ynab/connection'),
            ('GET', '/api/ynab/plans'), ('GET', '/api/ynab/categories'),
            ('PUT', f'/api/ynab/scenarios/{sid}/anchor'),
            ('DELETE', f'/api/ynab/scenarios/{sid}/anchor'),
            ('POST', f'/api/ynab/scenarios/{sid}/refresh'),
        ]:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.send(client, method, path, {}, token).status_code, 401)

    def test_writes_need_the_csrf_token(self):
        response = self.send(self.client, 'PUT', '/api/ynab/connection', {'token': TOKEN}, None)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(YnabConnection.objects.exists())


class ConnectionTests(YnabTestCase):
    def test_state_before_connecting(self):
        body = self.api('GET', '/api/ynab/state').json()
        self.assertEqual(body['anchors'], {})
        self.assertTrue(body['connection']['configured'])
        self.assertFalse(body['connection']['connected'])

    def test_connecting_stores_the_token_encrypted_and_picks_the_only_plan(self):
        connection = self.connect()
        self.assertTrue(connection['connected'])
        self.assertEqual(connection['planId'], PLAN)
        self.assertEqual(connection['planName'], 'Family')

        stored = YnabConnection.objects.get()
        self.assertNotIn(TOKEN, stored.token_encrypted)
        self.assertEqual(Fernet(KEY.encode()).decrypt(stored.token_encrypted.encode()).decode(), TOKEN)

    def test_the_token_never_comes_back_to_the_browser(self):
        self.connect()
        for path in ['/api/ynab/state', '/api/ynab/plans']:
            self.assertNotIn(TOKEN, self.api('GET', path).content.decode())

    def test_the_token_is_sent_to_ynab_as_a_bearer_header(self):
        self.connect()
        self.assertIn(('/plans', f'Bearer {TOKEN}'), self.fake.requests)

    def test_a_token_ynab_refuses_is_not_stored(self):
        self.fake.force_status = 401
        response = self.api('PUT', '/api/ynab/connection', {'token': 'wrong'})
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json()['reconnect'])
        self.assertFalse(YnabConnection.objects.exists())

    def test_an_empty_token_is_refused(self):
        self.assertEqual(self.api('PUT', '/api/ynab/connection', {'token': '  '}).status_code, 400)
        self.assertFalse(YnabConnection.objects.exists())

    @override_settings(YNAB_TOKEN_KEY='')
    def test_without_a_server_key_nothing_is_stored(self):
        response = self.api('PUT', '/api/ynab/connection', {'token': TOKEN})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(YnabConnection.objects.exists())
        self.assertFalse(self.api('GET', '/api/ynab/state').json()['connection']['configured'])

    def test_several_plans_leaves_the_choice_open(self):
        self.fake.plans.append({'id': '22222222-2222-2222-2222-222222222222', 'name': 'Rental'})
        connection = self.connect()
        self.assertIsNone(connection['planId'] or None)
        self.assertEqual(len(connection['plans']), 2)

        chosen = self.api('PATCH', '/api/ynab/connection', {'planId': '22222222-2222-2222-2222-222222222222'})
        self.assertEqual(chosen.json()['connection']['planName'], 'Rental')

    def test_a_plan_the_token_cannot_see_is_refused(self):
        self.connect()
        self.assertEqual(self.api('PATCH', '/api/ynab/connection', {'planId': PLAN[::-1]}).status_code, 400)

    def test_disconnecting_forgets_the_token_but_keeps_the_anchor(self):
        self.connect()
        scenario = self.scenario()
        self.anchor(scenario)
        self.assertEqual(self.api('DELETE', '/api/ynab/connection').status_code, 204)
        self.assertFalse(YnabConnection.objects.exists())

        body = self.api('GET', '/api/ynab/state').json()
        self.assertFalse(body['connection']['connected'])
        self.assertEqual(body['anchors'][str(scenario.id)]['incomeMilli'], 830000)

    def test_endpoints_that_need_a_connection_say_so(self):
        scenario = self.scenario()
        for method, path, body in [
            ('GET', '/api/ynab/categories?month=2026-09', None),
            ('GET', '/api/ynab/plans', None),
            ('PUT', f'/api/ynab/scenarios/{scenario.id}/anchor', {'month': '2026-09', 'categoryIds': [GROCERIES]}),
        ]:
            with self.subTest(path=path):
                self.assertEqual(self.api(method, path, body).status_code, 409)


class PickerTests(YnabTestCase):
    def setUp(self):
        super().setUp()
        self.connect()

    def test_categories_carry_the_month_assignments_and_skip_hidden_ones(self):
        body = self.api('GET', '/api/ynab/categories?month=2026-09').json()
        self.assertEqual(body['month'], '2026-09-01')
        self.assertEqual(body['monthLabel'], 'September 2026')
        names = {c['name']: c['budgetedMilli'] for g in body['groups'] for c in g['categories']}
        self.assertEqual(names, {'Groceries': 700000, 'School Supplies': 130000})

    def test_a_bad_month_is_refused_before_ynab_is_called(self):
        before = len(self.fake.requests)
        for month in ['', 'nonsense', '2026-13', '1999-01']:
            with self.subTest(month=month):
                self.assertEqual(self.api('GET', f'/api/ynab/categories?month={month}').status_code, 400)
        self.assertEqual(len(self.fake.requests), before)


class AnchorTests(YnabTestCase):
    def setUp(self):
        super().setUp()
        self.connect()
        self.scenario_obj = self.scenario()

    def test_anchoring_makes_income_the_sum_of_assigned_amounts(self):
        body = self.anchor(self.scenario_obj).json()['anchor']
        self.assertEqual(body['incomeMilli'], 700000 + 130000)
        self.assertEqual(body['month'], '2026-09-01')
        self.assertEqual(body['monthLabel'], 'September 2026')
        self.assertEqual(
            {c['name']: c['budgetedMilli'] for c in body['categories']},
            {'Groceries': 700000, 'School Supplies': 130000},
        )
        self.assertEqual({c['groupName'] for c in body['categories']}, {'Monthly Bills'})
        self.assertTrue(body['lastPulledAt'])

    def test_the_anchor_shows_up_in_state(self):
        self.anchor(self.scenario_obj)
        anchors = self.api('GET', '/api/ynab/state').json()['anchors']
        self.assertEqual(list(anchors), [str(self.scenario_obj.id)])

    def test_changing_the_categories_keeps_the_month(self):
        self.anchor(self.scenario_obj)
        body = self.api(
            'PUT', f'/api/ynab/scenarios/{self.scenario_obj.id}/anchor',
            {'categoryIds': [SCHOOL]},
        ).json()['anchor']
        self.assertEqual(body['month'], '2026-09-01')
        self.assertEqual(body['incomeMilli'], 130000)
        self.assertEqual(len(body['categories']), 1)

    def test_the_month_is_pinned_and_cannot_be_edited(self):
        self.anchor(self.scenario_obj)
        response = self.anchor(self.scenario_obj, month='2026-10')
        self.assertEqual(response.status_code, 400)
        self.assertIn('September 2026', response.json()['error'])
        self.assertEqual(ScenarioAnchor.objects.get().month.isoformat(), '2026-09-01')

    def test_a_duplicate_can_anchor_the_same_categories_to_another_month(self):
        self.anchor(self.scenario_obj)
        october = self.scenario('October')
        body = self.anchor(october, month='2026-10').json()['anchor']
        self.assertEqual(body['month'], '2026-10-01')
        self.assertEqual(ScenarioAnchor.objects.count(), 2)

    def test_anchoring_needs_a_month_the_first_time(self):
        response = self.api(
            'PUT', f'/api/ynab/scenarios/{self.scenario_obj.id}/anchor',
            {'categoryIds': [GROCERIES]},
        )
        self.assertEqual(response.status_code, 400)

    def test_categories_outside_the_plan_are_refused(self):
        response = self.anchor(self.scenario_obj, ids=[GROCERIES, 'not-a-category'])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ScenarioAnchor.objects.exists())

    def test_an_empty_category_list_is_refused(self):
        self.assertEqual(self.anchor(self.scenario_obj, ids=[]).status_code, 400)

    def test_unanchoring_leaves_the_scenario_alone(self):
        self.anchor(self.scenario_obj)
        self.assertEqual(self.api('DELETE', f'/api/ynab/scenarios/{self.scenario_obj.id}/anchor').status_code, 204)
        self.assertEqual(self.api('GET', '/api/ynab/state').json()['anchors'], {})
        self.assertEqual(self.api('DELETE', f'/api/ynab/scenarios/{self.scenario_obj.id}/anchor').status_code, 404)
        self.scenario_obj.refresh_from_db()
        self.assertEqual(self.scenario_obj.data, STATE)

    def test_another_account_cannot_anchor_or_read_my_scenario(self):
        self.anchor(self.scenario_obj)
        User.objects.create_user('mallory@example.com', PASSWORD)
        other = self.make_client()
        other_token = self.sign_in(other, 'mallory@example.com')
        path = f'/api/ynab/scenarios/{self.scenario_obj.id}/anchor'
        self.assertEqual(self.send(other, 'PUT', path, {'month': '2026-09', 'categoryIds': [GROCERIES]}, other_token).status_code, 404)
        self.assertEqual(self.send(other, 'DELETE', path, None, other_token).status_code, 404)
        self.assertEqual(self.send(other, 'POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh', None, other_token).status_code, 404)
        self.assertEqual(self.send(other, 'GET', '/api/ynab/state', None, other_token).json()['anchors'], {})


class RefreshTests(YnabTestCase):
    def setUp(self):
        super().setUp()
        self.connect()
        self.scenario_obj = self.scenario()
        self.anchor(self.scenario_obj)

    def test_refresh_follows_a_change_made_in_ynab(self):
        self.fake.budgeted[SCHOOL] = 180000
        body = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh').json()['anchor']
        self.assertEqual(body['incomeMilli'], 700000 + 180000)

    def test_refresh_reads_only_the_month(self):
        self.fake.requests.clear()
        self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh')
        self.assertEqual([p for p, _ in self.fake.requests], [f'/plans/{PLAN}/months/2026-09-01'])

    def test_a_category_that_vanishes_keeps_its_last_amount_and_is_flagged(self):
        del self.fake.budgeted[SCHOOL]
        body = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh').json()['anchor']
        self.assertEqual(body['incomeMilli'], 700000 + 130000)
        gone = next(c for c in body['categories'] if c['name'] == 'School Supplies')
        self.assertTrue(gone['missing'])
        self.assertEqual(gone['budgetedMilli'], 130000)

    def test_a_category_that_comes_back_is_no_longer_flagged(self):
        del self.fake.budgeted[SCHOOL]
        self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh')
        self.fake.budgeted[SCHOOL] = 130000
        body = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh').json()['anchor']
        self.assertFalse(any(c['missing'] for c in body['categories']))

    def test_a_revoked_token_asks_for_a_reconnect_and_is_recorded(self):
        self.fake.force_status = 401
        response = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh')
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json()['reconnect'])
        self.assertTrue(YnabConnection.objects.get().last_error)
        self.assertTrue(self.api('GET', '/api/ynab/state').json()['connection']['lastError'])

    def test_a_rate_limited_token_answers_429(self):
        self.fake.force_status = 429
        response = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh')
        self.assertEqual(response.status_code, 429)
        self.assertNotIn('reconnect', response.json())

    def test_refreshing_an_unanchored_scenario_is_404(self):
        plain = self.scenario('Not anchored')
        self.assertEqual(self.api('POST', f'/api/ynab/scenarios/{plain.id}/refresh').status_code, 404)

    def test_a_key_the_stored_token_does_not_decrypt_under_asks_for_a_reconnect(self):
        with override_settings(YNAB_TOKEN_KEY=Fernet.generate_key().decode()):
            response = self.api('POST', f'/api/ynab/scenarios/{self.scenario_obj.id}/refresh')
        self.assertEqual(response.status_code, 502)
        self.assertIn('again', response.json()['error'])
