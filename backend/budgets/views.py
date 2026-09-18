"""The budget API. Every query goes through Scenario.objects.for_user().

Scenario data is the frontend's `state` object, stored and returned verbatim.
Timestamps are epoch milliseconds, the frontend's Date.now() format.
"""
import uuid

from django.db import transaction
from django.db.models import F
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache

from config.api import BadRequest, api_view, error, json_body

from . import validation
from .models import Prefs, Scenario


def _ms(dt):
    return int(dt.timestamp() * 1000)


def _summary(scenario):
    return {
        'id': str(scenario.id),
        'name': scenario.name,
        'version': scenario.version,
        'updatedAt': _ms(scenario.updated_at),
    }


def _full(scenario):
    return {**_summary(scenario), 'data': scenario.data}


def _prefs(user):
    prefs, _ = Prefs.objects.get_or_create(user=user)
    return prefs


def _find(user, scenario_id):
    try:
        scenario_id = uuid.UUID(str(scenario_id))
    except ValueError:
        return None
    return Scenario.objects.for_user(user).filter(pk=scenario_id).first()


def _not_found():
    return error('Scenario not found.', status=404)


def _bootstrap_payload(user):
    scenarios = list(Scenario.objects.for_user(user).defer('data'))
    prefs = _prefs(user)
    ids = {s.id for s in scenarios}
    if prefs.active_scenario_id in ids:
        active_id = prefs.active_scenario_id
    else:
        active_id = scenarios[0].id if scenarios else None
    active = _find(user, active_id) if active_id else None
    return {
        'scenarios': [_summary(s) for s in scenarios],
        'activeScenarioId': str(active_id) if active_id else None,
        'colorGroups': prefs.color_groups,
        'activeScenario': _full(active) if active else None,
    }


@never_cache
@api_view(['GET'])
def bootstrap(request):
    """Everything the planner needs to draw its first screen, in one round trip."""
    return JsonResponse(_bootstrap_payload(request.user))


@never_cache
@api_view(['GET', 'POST'])
def scenario_collection(request):
    user = request.user
    if request.method == 'GET':
        scenarios = Scenario.objects.for_user(user).defer('data')
        return JsonResponse({'scenarios': [_summary(s) for s in scenarios]})

    body = json_body(request)
    name = validation.scenario_name(body.get('name'))
    data = validation.scenario_data(body.get('data'))
    with transaction.atomic():
        if Scenario.objects.filter(owner=user).count() >= validation.MAX_SCENARIOS_PER_USER:
            raise BadRequest(f'An account can have at most {validation.MAX_SCENARIOS_PER_USER} scenarios.')
        scenario = Scenario.objects.create(owner=user, name=name, data=data)
    return JsonResponse(_full(scenario), status=201)


@never_cache
@api_view(['GET', 'PATCH', 'DELETE'])
def scenario_detail(request, scenario_id):
    user = request.user
    if request.method == 'GET':
        scenario = _find(user, scenario_id)
        return JsonResponse(_full(scenario)) if scenario else _not_found()

    if request.method == 'DELETE':
        deleted, _ = Scenario.objects.for_user(user).filter(pk=scenario_id).delete()
        return HttpResponse(status=204) if deleted else _not_found()

    body = json_body(request)
    expected = validation.version(body.get('version'))
    changes = {}
    if 'name' in body:
        changes['name'] = validation.scenario_name(body['name'])
    if 'data' in body:
        changes['data'] = validation.scenario_data(body['data'])
    if not changes:
        raise BadRequest('Send name, data, or both.')

    # A conditional UPDATE, so the version check and the write are one step:
    # of two saves made from the same version, exactly one succeeds.
    updated = Scenario.objects.for_user(user).filter(pk=scenario_id, version=expected).update(
        **changes, version=F('version') + 1, updated_at=timezone.now(),
    )
    current = _find(user, scenario_id)
    if current is None:
        return _not_found()
    if not updated:
        return error(
            'This scenario was changed somewhere else since you loaded it.',
            status=409,
            scenario=_full(current),
        )
    return JsonResponse(_full(current))


@never_cache
@api_view(['GET', 'PATCH'])
def prefs(request):
    user = request.user
    prefs = _prefs(user)
    if request.method == 'PATCH':
        body = json_body(request)
        fields = []
        if 'colorGroups' in body:
            prefs.color_groups = validation.color_groups(body['colorGroups'])
            fields.append('color_groups')
        if 'activeScenarioId' in body:
            active_id = body['activeScenarioId']
            if active_id is None:
                prefs.active_scenario = None
            else:
                scenario = _find(user, active_id) if isinstance(active_id, str) else None
                if scenario is None:
                    raise BadRequest('activeScenarioId is not one of your scenarios.')
                prefs.active_scenario = scenario
            fields.append('active_scenario')
        if not fields:
            raise BadRequest('Send colorGroups, activeScenarioId, or both.')
        prefs.save(update_fields=fields)
    return JsonResponse({
        'colorGroups': prefs.color_groups,
        'activeScenarioId': str(prefs.active_scenario_id) if prefs.active_scenario_id else None,
    })


@never_cache
@api_view(['POST'])
def import_browser_data(request):
    """Move a browser's budgets into an account that has none yet.

    Allowed only while the account is empty, so a retried or repeated upload
    can't duplicate every scenario. All-or-nothing.
    """
    user = request.user
    body = json_body(request)
    incoming = body.get('scenarios')
    if not isinstance(incoming, list) or not incoming:
        raise BadRequest('scenarios must be a non-empty list.')
    if len(incoming) > validation.MAX_SCENARIOS_PER_USER:
        raise BadRequest(f'An account can have at most {validation.MAX_SCENARIOS_PER_USER} scenarios.')
    cleaned = []
    for i, item in enumerate(incoming):
        if not isinstance(item, dict):
            raise BadRequest(f'scenarios[{i}] must be an object.')
        cleaned.append((validation.scenario_name(item.get('name')), validation.scenario_data(item.get('data'))))
    groups = validation.color_groups(body['colorGroups']) if 'colorGroups' in body else None
    active_index = body.get('activeIndex', 0)
    if not isinstance(active_index, int) or isinstance(active_index, bool) or not 0 <= active_index < len(cleaned):
        active_index = 0

    with transaction.atomic():
        if Scenario.objects.filter(owner=user).exists():
            return error('This account already has budgets; import is only for an empty account.', status=409)
        created = [Scenario.objects.create(owner=user, name=name, data=data) for name, data in cleaned]
        prefs = _prefs(user)
        prefs.active_scenario = created[active_index]
        if groups is not None:
            prefs.color_groups = groups
        prefs.save()
    return JsonResponse(_bootstrap_payload(user), status=201)
