import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.tests import PASSWORD, ApiClientMixin

from .models import Prefs, Scenario

User = get_user_model()

STATE = {
    'income': {'amount': 7560, 'period': 'monthly'},
    'currency': 'USD',
    'categories': [{'id': 'c1', 'name': 'Groceries', 'colorType': 'expense',
                    'amountType': 'fixed', 'value': 700, 'period': 'monthly', 'location': 'budget'}],
}
GROUPS = [
    {'key': 'expense', 'name': 'Everyday expense', 'color': '#7BAFD4'},
    {'key': 'g1a2b3c', 'name': 'Kids', 'color': '#e2918c'},
]


class BudgetApiTestCase(ApiClientMixin, TestCase):
    def setUp(self):
        self.sarah = User.objects.create_user('sarah@example.com', PASSWORD)
        self.client = self.make_client()
        self.token = self.sign_in(self.client, 'sarah@example.com')

    def api(self, method, path, body=None, client=None, token=None):
        return self.send(client or self.client, method, path, body, token or self.token)

    def create(self, name='Main', data=STATE):
        response = self.api('POST', '/api/scenarios', {'name': name, 'data': data})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def other_user(self):
        User.objects.create_user('mallory@example.com', PASSWORD)
        client = self.make_client()
        return client, self.sign_in(client, 'mallory@example.com')


class AuthRequiredTests(ApiClientMixin, TestCase):
    def test_every_endpoint_is_401_when_signed_out(self):
        client = self.make_client()
        token = self.csrf(client)
        some_id = uuid.uuid4()
        for method, path in [
            ('GET', '/api/bootstrap'), ('GET', '/api/scenarios'), ('POST', '/api/scenarios'),
            ('GET', f'/api/scenarios/{some_id}'), ('PATCH', f'/api/scenarios/{some_id}'),
            ('DELETE', f'/api/scenarios/{some_id}'), ('GET', '/api/prefs'), ('PATCH', '/api/prefs'),
            ('POST', '/api/import'),
        ]:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.send(client, method, path, {}, token).status_code, 401)


class ScenarioCrudTests(BudgetApiTestCase):
    def test_create_list_get(self):
        created = self.create()
        self.assertEqual(created['version'], 1)
        self.assertEqual(created['data'], STATE)
        self.assertIsInstance(created['updatedAt'], int)

        listed = self.api('GET', '/api/scenarios').json()['scenarios']
        self.assertEqual([s['id'] for s in listed], [created['id']])
        self.assertNotIn('data', listed[0])

        fetched = self.api('GET', f"/api/scenarios/{created['id']}").json()
        self.assertEqual(fetched, created)

    def test_patch_bumps_version(self):
        created = self.create()
        response = self.api('PATCH', f"/api/scenarios/{created['id']}",
                            {'version': 1, 'data': {**STATE, 'currency': 'EUR'}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['version'], 2)
        self.assertEqual(response.json()['data']['currency'], 'EUR')

    def test_rename_only(self):
        created = self.create()
        response = self.api('PATCH', f"/api/scenarios/{created['id']}", {'version': 1, 'name': '  Lean  '})
        self.assertEqual(response.json()['name'], 'Lean')
        self.assertEqual(response.json()['data'], STATE)

    def test_stale_version_is_409_with_the_current_copy(self):
        created = self.create()
        url = f"/api/scenarios/{created['id']}"
        self.api('PATCH', url, {'version': 1, 'name': 'From the laptop'})
        response = self.api('PATCH', url, {'version': 1, 'name': 'From the phone'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['scenario']['name'], 'From the laptop')
        self.assertEqual(response.json()['scenario']['version'], 2)
        self.assertEqual(Scenario.objects.get().name, 'From the laptop')

    def test_patch_requires_a_version_and_a_change(self):
        created = self.create()
        url = f"/api/scenarios/{created['id']}"
        self.assertEqual(self.api('PATCH', url, {'name': 'x'}).status_code, 400)
        self.assertEqual(self.api('PATCH', url, {'version': True, 'name': 'x'}).status_code, 400)
        self.assertEqual(self.api('PATCH', url, {'version': 1}).status_code, 400)

    def test_delete(self):
        created = self.create()
        url = f"/api/scenarios/{created['id']}"
        self.assertEqual(self.api('DELETE', url).status_code, 204)
        self.assertEqual(self.api('GET', url).status_code, 404)
        self.assertEqual(self.api('DELETE', url).status_code, 404)

    def test_unknown_id_is_404(self):
        self.assertEqual(self.api('GET', f'/api/scenarios/{uuid.uuid4()}').status_code, 404)

    def test_validation(self):
        cases = [
            ({'name': '', 'data': STATE}, 400),
            ({'name': 'x' * 101, 'data': STATE}, 400),
            ({'name': 'ok', 'data': []}, 400),
            ({'name': 'ok', 'data': {'categories': 'nope'}}, 400),
            ({'name': 'ok', 'data': {'blob': 'x' * (256 * 1024)}}, 413),
        ]
        for body, status in cases:
            with self.subTest(body=str(body)[:60]):
                self.assertEqual(self.api('POST', '/api/scenarios', body).status_code, status)
        self.assertFalse(Scenario.objects.exists())

    def test_malformed_json_is_400(self):
        response = self.client.post('/api/scenarios', data='{not json', content_type='application/json',
                                    HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(response.status_code, 400)

    def test_write_without_csrf_token_is_refused(self):
        response = self.client.post('/api/scenarios', data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 403)


class IsolationTests(BudgetApiTestCase):
    def test_another_account_cannot_see_or_touch_a_scenario(self):
        created = self.create()
        url = f"/api/scenarios/{created['id']}"
        mallory, token = self.other_user()

        self.assertEqual(self.api('GET', url, client=mallory, token=token).status_code, 404)
        self.assertEqual(self.api('PATCH', url, {'version': 1, 'name': 'pwned'}, mallory, token).status_code, 404)
        self.assertEqual(self.api('DELETE', url, client=mallory, token=token).status_code, 404)
        self.assertEqual(self.api('GET', '/api/scenarios', client=mallory, token=token).json()['scenarios'], [])
        self.assertIsNone(self.api('GET', '/api/bootstrap', client=mallory, token=token).json()['activeScenario'])
        response = self.api('PATCH', '/api/prefs', {'activeScenarioId': created['id']}, mallory, token)
        self.assertEqual(response.status_code, 400)

        self.assertEqual(Scenario.objects.get().name, 'Main')


class BootstrapTests(BudgetApiTestCase):
    def test_empty_account(self):
        body = self.api('GET', '/api/bootstrap').json()
        self.assertEqual(body, {'scenarios': [], 'activeScenarioId': None, 'colorGroups': [], 'activeScenario': None})

    def test_defaults_to_the_first_scenario(self):
        first = self.create('First')
        self.create('Second')
        body = self.api('GET', '/api/bootstrap').json()
        self.assertEqual(len(body['scenarios']), 2)
        self.assertEqual(body['activeScenarioId'], first['id'])
        self.assertEqual(body['activeScenario']['data'], STATE)

    def test_uses_the_saved_active_scenario(self):
        self.create('First')
        second = self.create('Second')
        self.api('PATCH', '/api/prefs', {'activeScenarioId': second['id']})
        self.assertEqual(self.api('GET', '/api/bootstrap').json()['activeScenario']['name'], 'Second')

    def test_deleting_the_active_scenario_falls_back(self):
        first = self.create('First')
        second = self.create('Second')
        self.api('PATCH', '/api/prefs', {'activeScenarioId': second['id']})
        self.api('DELETE', f"/api/scenarios/{second['id']}")
        self.assertEqual(self.api('GET', '/api/bootstrap').json()['activeScenarioId'], first['id'])


class PrefsTests(BudgetApiTestCase):
    def test_color_groups_round_trip(self):
        response = self.api('PATCH', '/api/prefs', {'colorGroups': GROUPS})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.api('GET', '/api/prefs').json()['colorGroups'], GROUPS)

    def test_color_groups_that_could_break_out_of_an_attribute_are_rejected(self):
        bad = [
            [{'key': 'expense', 'name': 'x', 'color': 'red" onmouseover="alert(1)'}],
            [{'key': 'a" onclick="x', 'name': 'x', 'color': '#ffffff'}],
            [{'key': 'Expense', 'name': 'x', 'color': '#ffffff'}],
            [{'key': 'a', 'name': 'x', 'color': '#fff'}],
            [{'key': 'a', 'name': 'x', 'color': '#ffffff'}, {'key': 'a', 'name': 'y', 'color': '#000000'}],
            'not a list',
        ]
        for groups in bad:
            with self.subTest(groups=groups):
                self.assertEqual(self.api('PATCH', '/api/prefs', {'colorGroups': groups}).status_code, 400)
        self.assertFalse(Prefs.objects.exclude(color_groups=[]).exists())

    def test_active_scenario_id_validation(self):
        created = self.create()
        self.assertEqual(self.api('PATCH', '/api/prefs', {'activeScenarioId': 'garbage'}).status_code, 400)
        self.assertEqual(self.api('PATCH', '/api/prefs', {'activeScenarioId': 7}).status_code, 400)
        self.assertEqual(self.api('PATCH', '/api/prefs', {'activeScenarioId': created['id']}).status_code, 200)
        response = self.api('PATCH', '/api/prefs', {'activeScenarioId': None})
        self.assertIsNone(response.json()['activeScenarioId'])

    def test_empty_patch_is_400(self):
        self.assertEqual(self.api('PATCH', '/api/prefs', {}).status_code, 400)


class ImportTests(BudgetApiTestCase):
    PAYLOAD = {
        'scenarios': [{'name': 'Example Budget', 'data': STATE}, {'name': 'Lean', 'data': {**STATE, 'currency': 'EUR'}}],
        'colorGroups': GROUPS,
        'activeIndex': 1,
    }

    def test_imports_into_an_empty_account(self):
        response = self.api('POST', '/api/import', self.PAYLOAD)
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual([s['name'] for s in body['scenarios']], ['Example Budget', 'Lean'])
        self.assertEqual(body['activeScenario']['name'], 'Lean')
        self.assertEqual(body['colorGroups'], GROUPS)

    def test_refused_once_the_account_has_budgets(self):
        self.api('POST', '/api/import', self.PAYLOAD)
        response = self.api('POST', '/api/import', self.PAYLOAD)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Scenario.objects.count(), 2)

    def test_one_bad_scenario_imports_nothing(self):
        payload = {'scenarios': [{'name': 'Good', 'data': STATE}, {'name': '', 'data': STATE}]}
        self.assertEqual(self.api('POST', '/api/import', payload).status_code, 400)
        bad_groups = {**self.PAYLOAD, 'colorGroups': [{'key': 'x', 'name': 'x', 'color': 'red'}]}
        self.assertEqual(self.api('POST', '/api/import', bad_groups).status_code, 400)
        self.assertFalse(Scenario.objects.exists())

    def test_out_of_range_active_index_falls_back_to_the_first(self):
        response = self.api('POST', '/api/import', {**self.PAYLOAD, 'activeIndex': 9})
        self.assertEqual(response.json()['activeScenario']['name'], 'Example Budget')

    def test_requires_scenarios(self):
        self.assertEqual(self.api('POST', '/api/import', {'scenarios': []}).status_code, 400)
