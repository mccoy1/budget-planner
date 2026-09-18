import logging

from django.db import connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)


class HealthCheckMiddleware:
    """Answer GET /health before anything else runs.

    It sits first in MIDDLEWARE so the platform's health checker gets a real
    answer whatever Host header it sends and whether or not it comes in over
    HTTPS; otherwise ALLOWED_HOSTS or SECURE_SSL_REDIRECT would answer for it
    with a 400 or a redirect.

    The query is the point: it proves the restored database opened and is
    readable, not just that gunicorn is up.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path != '/health':
            return self.get_response(request)
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except Exception:
            # Detail goes to the log only; this endpoint is public.
            logger.exception('Health check failed: database unavailable')
            return JsonResponse({'status': 'error'}, status=503)
        return JsonResponse({'status': 'ok'})
