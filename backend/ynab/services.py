"""What the YNAB views actually do.

Two rules shape everything here:

* **Nothing is written to YNAB.** The worst a bug can do is show a wrong
  number; it cannot damage the person's real budget. Keep it that way.
* **HTTP happens outside the write transaction.** This is a single-writer
  SQLite database. Holding a write transaction open across a network call is
  how "database is locked" starts appearing. Each function below talks to YNAB
  first, then opens a short transaction to save what came back.
"""
import datetime
import logging
import re

from django.db import transaction
from django.utils import timezone

from config.api import BadRequest

from . import crypto
from .client import YnabClient, YnabError
from .models import AnchoredCategory, ScenarioAnchor, YnabConnection

logger = logging.getLogger(__name__)

MAX_ANCHORED_CATEGORIES = 100
MONTH_RE = re.compile(r'^(\d{4})-(\d{2})(?:-01)?$')


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def month_from_input(value):
    """"2026-09" or "2026-09-01" → date(2026, 9, 1)."""
    if not isinstance(value, str):
        raise BadRequest('month is required, as YYYY-MM.')
    match = MONTH_RE.match(value.strip())
    if not match:
        raise BadRequest('month must look like 2026-09.')
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise BadRequest('month must be a real month between 2000 and 2100.')
    return datetime.date(year, month, 1)


def category_ids_from_input(value):
    if not isinstance(value, list) or not value:
        raise BadRequest('categoryIds must be a non-empty list of YNAB category ids.')
    if len(value) > MAX_ANCHORED_CATEGORIES:
        raise BadRequest(f'At most {MAX_ANCHORED_CATEGORIES} categories can feed one scenario.')
    cleaned = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 64:
            raise BadRequest('Every categoryId must be a YNAB category id.')
        if item not in cleaned:
            cleaned.append(item.strip())
    return cleaned


# ---------------------------------------------------------------------------
# The connection
# ---------------------------------------------------------------------------

def connection_for(user):
    return YnabConnection.objects.filter(user=user).first()


def client_for(connection):
    """A client holding the decrypted token. Raises BadRequest if unusable."""
    try:
        return YnabClient(crypto.decrypt_token(connection.token_encrypted))
    except crypto.TokenKeyMissing as exc:
        raise BadRequest(str(exc), status=503) from exc
    except crypto.TokenUnreadable as exc:
        raise BadRequest(str(exc), status=502) from exc


def require_plan(connection):
    if not connection.plan_id:
        raise BadRequest('Choose which YNAB plan to use first.')
    return connection.plan_id


def save_connection(user, token):
    """Store a token, after proving YNAB accepts it. Returns (connection, plans).

    The token is checked before it is saved, so a typo can't be stored as a
    working connection. If the token can see exactly one plan, that plan is
    chosen here and there is nothing more to ask.
    """
    if not crypto.key_configured():
        raise BadRequest(
            'This server has no YNAB_TOKEN_ENCRYPTION_KEY set, so a token cannot be stored safely.',
            status=503,
        )
    if not isinstance(token, str) or not token.strip():
        raise BadRequest('Paste your YNAB personal access token.')
    plans = _call(YnabClient(token.strip()).plans)
    if not plans:
        raise BadRequest('That token works, but it can’t see any YNAB plans.')

    connection = connection_for(user) or YnabConnection(user=user)
    connection.token_encrypted = crypto.encrypt_token(token)
    connection.last_used_at = timezone.now()
    connection.last_error = ''
    chosen = plans[0] if len(plans) == 1 else _plan_by_id(plans, connection.plan_id)
    connection.plan_id = chosen['id'] if chosen else ''
    connection.plan_name = chosen.get('name', '') if chosen else ''
    connection.save()
    return connection, plans


def choose_plan(connection, plan_id):
    """Pick which plan the account reads, when the token can see several."""
    if not isinstance(plan_id, str) or not plan_id.strip():
        raise BadRequest('planId is required.')
    plans = _call(client_for(connection).plans)
    chosen = _plan_by_id(plans, plan_id.strip())
    if not chosen:
        raise BadRequest('That isn’t one of the plans this token can see.')
    connection.plan_id = chosen['id']
    connection.plan_name = chosen.get('name', '')
    connection.last_used_at = timezone.now()
    connection.last_error = ''
    connection.save(update_fields=['plan_id', 'plan_name', 'last_used_at', 'last_error'])
    return connection


def list_plans(connection):
    return _call(client_for(connection).plans)


def _plan_by_id(plans, plan_id):
    if not plan_id:
        return None
    return next((p for p in plans if p.get('id') == plan_id), None)


# ---------------------------------------------------------------------------
# The category picker
# ---------------------------------------------------------------------------

def category_picker(connection, month):
    """Category groups with each category's assigned amount for `month`.

    Two reads: the category list carries the names and groups, the month
    carries `budgeted`. Hidden and deleted categories are left out — they can't
    sensibly be anchored to.
    """
    plan_id = require_plan(connection)
    client = client_for(connection)
    groups = _call(client.categories, plan_id)
    budgeted = _budgeted_by_id(_call(client.month, plan_id, month.isoformat()))
    _mark_used(connection)

    out = []
    for group in groups:
        if group.get('deleted') or group.get('hidden'):
            continue
        categories = [
            {
                'id': category['id'],
                'name': category.get('name', ''),
                'budgetedMilli': int(budgeted.get(category['id'], 0)),
            }
            for category in group.get('categories') or []
            if not category.get('deleted') and not category.get('hidden')
        ]
        if categories:
            out.append({'name': group.get('name', ''), 'categories': categories})
    return out


def _budgeted_by_id(month_detail):
    return {
        category['id']: int(category.get('budgeted') or 0)
        for category in month_detail.get('categories') or []
        if not category.get('deleted')
    }


# ---------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------

def set_anchor(connection, scenario, month, category_ids):
    """Create the anchor, or change which categories feed an existing one.

    The month is pinned: an existing anchor keeps the month it was created
    with, and asking for a different one is refused rather than silently
    ignored. Names and amounts are filled from YNAB here, so the scenario is
    correct the moment it is anchored.
    """
    plan_id = require_plan(connection)
    existing = ScenarioAnchor.objects.filter(scenario=scenario).first()
    if existing:
        if month is not None and month != existing.month:
            raise BadRequest(
                f'This scenario is pinned to {existing.month:%B %Y}. A different month means a '
                'new scenario — duplicate this one and pick the month there.'
            )
        month = existing.month
    elif month is None:
        raise BadRequest('month is required when anchoring a scenario.')

    client = client_for(connection)
    groups = _call(client.categories, plan_id)
    month_detail = _call(client.month, plan_id, month.isoformat())
    budgeted = _budgeted_by_id(month_detail)
    known = {
        category['id']: (category.get('name', ''), group.get('name', ''))
        for group in groups
        for category in group.get('categories') or []
    }
    unknown = [cid for cid in category_ids if cid not in known]
    if unknown:
        raise BadRequest(f'{len(unknown)} of those categories are not in this YNAB plan.')

    now = timezone.now()
    with transaction.atomic():
        anchor, _ = ScenarioAnchor.objects.update_or_create(
            scenario=scenario, defaults={'month': month, 'last_pulled_at': now}
        )
        anchor.categories.exclude(ynab_category_id__in=category_ids).delete()
        for cid in category_ids:
            name, group_name = known[cid]
            AnchoredCategory.objects.update_or_create(
                anchor=anchor,
                ynab_category_id=cid,
                defaults={
                    'name_cache': name,
                    'group_name_cache': group_name,
                    'budgeted_milli': int(budgeted.get(cid, 0)),
                    'missing': cid not in budgeted,
                },
            )
        _record_sync(connection, now)
    return anchor


def refresh_anchor(connection, anchor):
    """Re-read the anchored month's assignments. One request.

    Only the month is read: it carries every category's `budgeted` in one
    response, and the names came from the picker when the anchor was made. A
    category that has stopped appearing keeps its last known amount and is
    flagged, so the income never changes without the reason being visible.
    """
    plan_id = require_plan(connection)
    stored = list(anchor.categories.all())
    if not stored:
        return anchor

    try:
        budgeted = _budgeted_by_id(_call(client_for(connection).month, plan_id, anchor.month.isoformat()))
    except BadRequest as exc:
        _record_error(connection, exc.message)
        raise

    now = timezone.now()
    with transaction.atomic():
        for category in stored:
            amount = budgeted.get(category.ynab_category_id)
            category.missing = amount is None
            if amount is not None:
                category.budgeted_milli = int(amount)
            category.save(update_fields=['budgeted_milli', 'missing'])
        ScenarioAnchor.objects.filter(pk=anchor.pk).update(last_pulled_at=now)
        _record_sync(connection, now)
    anchor.last_pulled_at = now
    return anchor


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------

def _ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def connection_payload(connection, plans=None):
    """What the frontend needs to describe the connection, minus the token."""
    payload = {
        'configured': crypto.key_configured(),
        'connected': bool(connection),
        'planId': connection.plan_id if connection else None,
        'planName': connection.plan_name if connection else None,
        'lastSyncedAt': _ms(connection.last_synced_at) if connection else None,
        'lastError': (connection.last_error or None) if connection else None,
    }
    if plans is not None:
        payload['plans'] = [{'id': p.get('id'), 'name': p.get('name', '')} for p in plans]
    return payload


def anchor_payload(anchor):
    """The anchor as the planner reads it. Amounts stay in milliunits."""
    if anchor is None:
        return None
    categories = list(anchor.categories.all())
    return {
        'month': anchor.month.isoformat(),
        'monthLabel': f'{anchor.month:%B %Y}',
        'incomeMilli': sum(c.budgeted_milli for c in categories),
        'lastPulledAt': _ms(anchor.last_pulled_at),
        'categories': [
            {
                'id': c.ynab_category_id,
                'name': c.name_cache,
                'groupName': c.group_name_cache,
                'budgetedMilli': c.budgeted_milli,
                'missing': c.missing,
            }
            for c in categories
        ],
    }


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------

def _call(fn, *args):
    """Run a YNAB call, turning its failures into API answers.

    A YnabError is the person's problem to see, not a 500: a revoked token, a
    rate limit, a plan that no longer exists. `reconnect` travels with it so the
    frontend can offer the one action that fixes it.
    """
    try:
        return fn(*args)
    except YnabError as exc:
        status = 429 if exc.rate_limited else 502
        # `reconnect` tells the frontend to offer the one thing that fixes a
        # refused token, rather than a generic "try again".
        extra = {'reconnect': True} if exc.reconnect else None
        raise BadRequest(exc.message, status=status, extra=extra) from exc


def _mark_used(connection):
    connection.last_used_at = timezone.now()
    connection.last_error = ''
    connection.save(update_fields=['last_used_at', 'last_error'])


def _record_sync(connection, when):
    connection.last_synced_at = when
    connection.last_used_at = when
    connection.last_error = ''
    connection.save(update_fields=['last_synced_at', 'last_used_at', 'last_error'])


def _record_error(connection, message):
    YnabConnection.objects.filter(pk=connection.pk).update(last_error=message[:500])
