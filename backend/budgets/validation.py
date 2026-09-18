"""Checks on what the frontend sends.

Scenario data is otherwise opaque to the server: the frontend owns its shape.
The checks here bound its size and pin down the values that end up inside HTML
attributes (color-group keys and colors), which are not escaped on render.
"""
import json
import re

from config.api import BadRequest

MAX_NAME_LENGTH = 100
MAX_SCENARIO_BYTES = 256 * 1024
MAX_SCENARIOS_PER_USER = 100
MAX_COLOR_GROUPS = 50
MAX_COLOR_GROUP_NAME_LENGTH = 60

COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
COLOR_KEY_RE = re.compile(r'^[a-z0-9]{1,24}$')


def scenario_name(value):
    if not isinstance(value, str) or not value.strip():
        raise BadRequest('name is required.')
    value = value.strip()
    if len(value) > MAX_NAME_LENGTH:
        raise BadRequest(f'name must be at most {MAX_NAME_LENGTH} characters.')
    return value


def scenario_data(value):
    if not isinstance(value, dict):
        raise BadRequest('data must be a JSON object.')
    if 'categories' in value and not isinstance(value['categories'], list):
        raise BadRequest('data.categories must be a list.')
    size = len(json.dumps(value, separators=(',', ':')).encode())
    if size > MAX_SCENARIO_BYTES:
        raise BadRequest(f'data is too large ({size} bytes; the limit is {MAX_SCENARIO_BYTES}).', status=413)
    return value


def color_groups(value):
    if not isinstance(value, list):
        raise BadRequest('colorGroups must be a list.')
    if len(value) > MAX_COLOR_GROUPS:
        raise BadRequest(f'colorGroups may have at most {MAX_COLOR_GROUPS} entries.')
    seen = set()
    cleaned = []
    for i, group in enumerate(value):
        if not isinstance(group, dict):
            raise BadRequest(f'colorGroups[{i}] must be an object.')
        key, name, color = group.get('key'), group.get('name'), group.get('color')
        if not isinstance(key, str) or not COLOR_KEY_RE.match(key):
            raise BadRequest(f'colorGroups[{i}].key must be 1-24 lowercase letters or digits.')
        if key in seen:
            raise BadRequest(f'colorGroups[{i}].key "{key}" is repeated.')
        if not isinstance(name, str) or len(name) > MAX_COLOR_GROUP_NAME_LENGTH:
            raise BadRequest(f'colorGroups[{i}].name must be text of at most {MAX_COLOR_GROUP_NAME_LENGTH} characters.')
        if not isinstance(color, str) or not COLOR_RE.match(color):
            raise BadRequest(f'colorGroups[{i}].color must look like #1a2b3c.')
        seen.add(key)
        cleaned.append({'key': key, 'name': name, 'color': color})
    return cleaned


def version(value):
    # bool is an int subclass; True must not pass as version 1.
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise BadRequest('version is required: send the version you last read.')
    return value
