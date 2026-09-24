"""The YNAB endpoints. Read-only: nothing here writes to YNAB.

The token is never returned to the browser, in any shape. The frontend only
ever learns whether a connection exists, which plan it points at, and when it
last synced.
"""
from django.http import HttpResponse, JsonResponse
from django.views.decorators.cache import never_cache

from budgets.models import Scenario
from config.api import BadRequest, api_view, error, json_body

from . import services
from .models import ScenarioAnchor


def _connection(request):
    connection = services.connection_for(request.user)
    if connection is None:
        raise BadRequest('Connect YNAB first.', status=409)
    return connection


def _scenario(request, scenario_id):
    scenario = Scenario.objects.for_user(request.user).filter(pk=scenario_id).first()
    if scenario is None:
        raise BadRequest('Scenario not found.', status=404)
    return scenario


def _anchor(request, scenario_id):
    anchor = ScenarioAnchor.objects.filter(
        scenario__in=Scenario.objects.for_user(request.user), scenario_id=scenario_id
    ).first()
    if anchor is None:
        raise BadRequest('That scenario is not anchored to YNAB.', status=404)
    return anchor


@never_cache
@api_view(['GET'])
def state(request):
    """Everything YNAB-related for this account, in one round trip.

    Touches only this database — no YNAB call — so startup never waits on
    YNAB. Anchors are keyed by scenario id, which is how the planner holds
    them.
    """
    connection = services.connection_for(request.user)
    anchors = ScenarioAnchor.objects.filter(
        scenario__in=Scenario.objects.for_user(request.user)
    ).prefetch_related('categories')
    return JsonResponse({
        'connection': services.connection_payload(connection),
        'anchors': {str(a.scenario_id): services.anchor_payload(a) for a in anchors},
    })


@never_cache
@api_view(['PUT', 'PATCH', 'DELETE'])
def connection(request):
    """PUT a token (checked against YNAB before it is stored), PATCH the plan.

    DELETE forgets the token but keeps the anchors: an anchored scenario goes
    on showing the last income it read, which is better than an income that
    vanishes. Reconnecting picks straight back up.
    """
    if request.method == 'DELETE':
        existing = services.connection_for(request.user)
        if existing:
            existing.delete()
        return HttpResponse(status=204)

    body = json_body(request)
    if request.method == 'PUT':
        conn, plans = services.save_connection(request.user, body.get('token'))
        return JsonResponse({'connection': services.connection_payload(conn, plans)})

    conn = services.choose_plan(_connection(request), body.get('planId'))
    return JsonResponse({'connection': services.connection_payload(conn)})


@never_cache
@api_view(['GET'])
def plans(request):
    return JsonResponse({'plans': [
        {'id': p.get('id'), 'name': p.get('name', '')}
        for p in services.list_plans(_connection(request))
    ]})


@never_cache
@api_view(['GET'])
def categories(request):
    """The picker: every category in the plan with what it was assigned that month."""
    month = services.month_from_input(request.GET.get('month'))
    groups = services.category_picker(_connection(request), month)
    return JsonResponse({
        'month': month.isoformat(),
        'monthLabel': f'{month:%B %Y}',
        'groups': groups,
    })


@never_cache
@api_view(['PUT', 'DELETE'])
def anchor(request, scenario_id):
    """PUT anchors a scenario (or changes its categories); DELETE unanchors it.

    A scenario's month is set once. PUT without a month keeps the one it has;
    PUT with a different one is refused, because a new month is a new scenario.
    """
    if request.method == 'DELETE':
        deleted, _ = ScenarioAnchor.objects.filter(
            scenario__in=Scenario.objects.for_user(request.user), scenario_id=scenario_id
        ).delete()
        return HttpResponse(status=204) if deleted else error('That scenario is not anchored to YNAB.', status=404)

    scenario = _scenario(request, scenario_id)
    body = json_body(request)
    month = services.month_from_input(body['month']) if body.get('month') is not None else None
    category_ids = services.category_ids_from_input(body.get('categoryIds'))
    saved = services.set_anchor(_connection(request), scenario, month, category_ids)
    return JsonResponse({'anchor': services.anchor_payload(saved)})


@never_cache
@api_view(['POST'])
def refresh(request, scenario_id):
    """Re-read the anchored month's assignments from YNAB, on demand."""
    # Whose scenario it is comes first: someone else's id is a 404 whether or
    # not this account has connected YNAB.
    target = _anchor(request, scenario_id)
    refreshed = services.refresh_anchor(_connection(request), target)
    return JsonResponse({'anchor': services.anchor_payload(refreshed)})
