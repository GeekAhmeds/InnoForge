from django import template

from .. import editions as E

register = template.Library()


@register.filter
def edition(code):
    return E.edition_name(code)


@register.filter
def features(codes):
    return '، '.join(E.feature_name(c) for c in (codes or []))


@register.filter
def limits(d):
    names = E.data()['limits']
    return '، '.join(f'{names[k]["ar"]}: {v or "∞"}' for k, v in (d or {}).items() if k in names)


@register.filter
def money(v):
    try:
        return f'{float(v):,.2f}'
    except (TypeError, ValueError):
        return v


@register.filter
def days_label(d):
    return 'مدى الحياة' if not d else f'{d} يوم'


@register.filter
def get(d, k):
    return (d or {}).get(k)
