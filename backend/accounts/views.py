"""Session sign-in for the planner.

The frontend is a different origin (GitHub Pages), so it can't read this
domain's csrftoken cookie. Every response here includes the token in the JSON
body instead; the frontend keeps it in memory and sends it back as X-CSRFToken.
Signing in or out rotates the token, so those responses include the new one.
"""
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.cache import never_cache

from config.api import BadRequest, api_view, error, json_body


def _session_payload(request, **extra):
    user = request.user
    return {
        'user': {'email': user.email} if user.is_authenticated else None,
        'csrfToken': get_token(request),
        **extra,
    }


@never_cache
@api_view(['GET'], login_required=False)
def session(request):
    return JsonResponse(_session_payload(request))


@never_cache
@api_view(['POST'], login_required=False)
def login_view(request):
    body = json_body(request)
    email = body.get('email')
    password = body.get('password')
    if not isinstance(email, str) or not isinstance(password, str) or not email.strip() or not password:
        raise BadRequest('Email and password are required.')

    # django-axes counts failures on the `username` credential.
    user = authenticate(request, username=email, password=password)
    if getattr(request, 'axes_locked_out', False):
        return lockout_response(request)
    if user is None:
        return error('Email or password is incorrect.', status=401)
    login(request, user)
    return JsonResponse(_session_payload(request))


@never_cache
@api_view(['POST'], login_required=False)
def logout_view(request):
    logout(request)
    return JsonResponse(_session_payload(request))


@never_cache
@api_view(['POST'])
def change_password(request):
    body = json_body(request)
    current = body.get('currentPassword')
    new = body.get('newPassword')
    if not isinstance(current, str) or not isinstance(new, str):
        raise BadRequest('currentPassword and newPassword are required.')
    if not request.user.check_password(current):
        return error('Current password is incorrect.', status=400, field='currentPassword')
    try:
        validate_password(new, user=request.user)
    except ValidationError as exc:
        return error(' '.join(exc.messages), status=400, field='newPassword')
    request.user.set_password(new)
    request.user.save(update_fields=['password'])
    # Keeps this session signed in; every other session is signed out.
    update_session_auth_hash(request, request.user)
    return JsonResponse(_session_payload(request))


def axes_username(request, credentials=None):
    """django-axes' AXES_USERNAME_CALLABLE: the email as the account stores it.

    Axes calls this from two places with differently keyed credentials: the
    failure signal passes authenticate()'s own kwargs ('username'), while the
    lockout check in its backend re-keys them by USERNAME_FIELD ('email').
    Reading only one key made the check see a blank name and zero failures,
    so the lockout was recorded but never enforced.
    """
    credentials = credentials or {}
    raw = credentials.get('username') or credentials.get(get_user_model().USERNAME_FIELD)
    if raw is None:
        # The admin's login form posts `username` rather than calling authenticate() with it.
        raw = request.POST.get('username', '')
    return get_user_model().objects.normalize_email(raw)


def lockout_response(request, original_response=None, credentials=None):
    """django-axes' AXES_LOCKOUT_CALLABLE: a JSON 429 instead of its HTML page."""
    return error(
        'Too many failed sign-in attempts. Try again in 15 minutes.',
        status=429,
    )
