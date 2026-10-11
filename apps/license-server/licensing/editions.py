"""Editions, add-on features and limits — read from the POS app's editions.json, with the
same rules as apps/pos/electron/editions.cjs (keep the two in step)."""
import json
from functools import lru_cache

from django.conf import settings


@lru_cache(maxsize=1)
def data():
    with open(settings.EDITIONS_FILE, encoding='utf-8') as f:
        return json.load(f)


def features():
    return list(data()['features'].keys())


def editions():
    return list(data()['editions'].keys())


def limit_kinds():
    return list(data()['limits'].keys())


def edition_features(edition):
    f = data()['editions'][edition]['features']
    return features() if f == '*' else list(f)


def edition_name(edition):
    e = data()['editions'].get(edition)
    return e['ar'] if e else edition


def feature_name(feature):
    f = data()['features'].get(feature)
    return f['ar'].split(':')[0] if f else feature


def effective_limits(edition, addons, limits):
    """What the app will allow (editions.cjs → entitlements): given limits, else the edition's."""
    ed = data()['editions'][edition]
    out = {}
    for k in limit_kinds():
        v = (limits or {}).get(k)
        out[k] = v if isinstance(v, int) and v >= 0 else ed['limits'].get(k, 0)
    if ('warehouses' in edition_features(edition) or 'warehouses' in (addons or [])) and out.get('warehouses') == 1 and (limits or {}).get('warehouses') is None:
        out['warehouses'] = 3
    return out


def allowed(rules, value):
    """rules: ['*'] or a list of allowed codes."""
    return '*' in (rules or []) or value in (rules or [])
