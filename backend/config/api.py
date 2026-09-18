"""Small helpers shared by the JSON views. There are too few endpoints to need DRF."""
import json
from functools import wraps

from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse


class BadRequest(Exception):
    """Raised by a view (or a validator) to answer 400 with a message."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def error(message, status=400, **extra):
    return JsonResponse({'error': message, **extra}, status=status)


def json_body(request):
    """The request body as a dict, or BadRequest."""
    try:
        raw = request.body
    except RequestDataTooBig:
        raise BadRequest('Request body is too large.', status=413)
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise BadRequest('Request body is not valid JSON.')
    if not isinstance(body, dict):
        raise BadRequest('Request body must be a JSON object.')
    return body


def api_view(methods, login_required=True):
    """Restrict methods, require a session, and turn BadRequest into a JSON error.

    A missing session is a 401 with a JSON body, not the admin's redirect to a
    login page, since the only caller is the frontend's fetch().
    """

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if request.method not in methods:
                response = error('Method not allowed.', status=405)
                response['Allow'] = ', '.join(methods)
                return response
            if login_required and not request.user.is_authenticated:
                return error('Not signed in.', status=401)
            try:
                return view(request, *args, **kwargs)
            except BadRequest as exc:
                return error(exc.message, status=exc.status)

        return wrapper

    return decorator
