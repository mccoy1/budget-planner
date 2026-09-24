"""A read-only YNAB API client.

Nothing here writes to YNAB, by design (see README). Three GETs are all the
integration needs, so this uses urllib rather than adding an HTTP dependency.

YNAB's top-level resource is `/plans`, not `/budgets`; most examples online are
stale on that. Money is in milliunits: $1.00 is 1000, always integers.
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

# A YNAB token allows 200 requests an hour. A refresh spends two of them, so
# the ceiling is ~100 refreshes an hour: far more than a person does by hand.
RATE_LIMIT_PER_HOUR = 200


class YnabError(Exception):
    """A call to YNAB failed.

    `reconnect` marks the case the person has to fix by pasting a new token:
    YNAB refused the one we hold. `status` is the HTTP status YNAB answered
    with, or 0 when it never answered.
    """

    def __init__(self, message, status=0, reconnect=False, rate_limited=False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.reconnect = reconnect
        self.rate_limited = rate_limited


def _api_base():
    return getattr(settings, 'YNAB_API_BASE', 'https://api.ynab.com/v1').rstrip('/')


class YnabClient:
    def __init__(self, token, timeout=None):
        self._token = token
        self._timeout = timeout or getattr(settings, 'YNAB_TIMEOUT', 15)

    # ---------- the three reads ----------

    def plans(self):
        """Every plan (YNAB's word for a budget) this token can see."""
        return self._get('/plans')['plans']

    def categories(self, plan_id):
        """Category groups with their categories: names, for the picker."""
        return self._get(f'/plans/{_seg(plan_id)}/categories')['category_groups']

    def month(self, plan_id, month):
        """One month, including every category's `budgeted` for it."""
        return self._get(f'/plans/{_seg(plan_id)}/months/{_seg(month)}')['month']

    def month_transactions(self, plan_id, month):
        """Transactions from `month` onward. Used from phase 2 (spending)."""
        return self._get(f'/plans/{_seg(plan_id)}/months/{_seg(month)}/transactions')['transactions']

    # ---------- plumbing ----------

    def _get(self, path):
        request = urllib.request.Request(
            _api_base() + path,
            headers={
                'Authorization': f'Bearer {self._token}',
                'Accept': 'application/json',
            },
            method='GET',
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            raise _http_error(exc, path) from exc
        except urllib.error.URLError as exc:
            # No response at all: DNS, TLS, connection refused, timeout.
            logger.warning('YNAB %s unreachable: %s', path, exc.reason)
            raise YnabError("YNAB didn't answer. Check your connection and try again.") from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise YnabError('YNAB sent a response this app could not read.', status=502) from exc
        data = body.get('data') if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise YnabError('YNAB sent a response this app could not read.', status=502)
        return data


def _seg(value):
    """One path segment, so an id can never widen the path it is put into."""
    return urllib.parse.quote(str(value), safe='')


def _http_error(exc, path):
    detail = ''
    try:
        body = json.loads(exc.read().decode())
        detail = (body.get('error') or {}).get('detail') or ''
    except Exception:  # noqa: BLE001 — an error body is a nicety, never required
        pass
    status = exc.code
    # The token itself is never logged; the path and status are enough to debug.
    logger.warning('YNAB %s answered %s: %s', path, status, detail)
    if status in (401, 403):
        return YnabError(
            'YNAB refused the saved token. It may have been revoked or expired.',
            status=status,
            reconnect=True,
        )
    if status == 404:
        return YnabError(
            detail or 'YNAB has nothing at that address. The plan or month may no longer exist.',
            status=status,
        )
    if status == 429:
        return YnabError(
            f'YNAB is rate-limiting this token ({RATE_LIMIT_PER_HOUR} requests an hour). '
            'Wait a few minutes and refresh again.',
            status=status,
            rate_limited=True,
        )
    return YnabError(detail or f'YNAB answered with an error ({status}).', status=status)
