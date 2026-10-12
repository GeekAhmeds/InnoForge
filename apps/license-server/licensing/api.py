"""JSON API for a partner's own system: Authorization: Bearer ifk_…  (keys from /api-keys/)."""
import json
from functools import wraps

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import editions as E
from . import services as S
from . import signing
from django.core.cache import cache

from .models import Lead, License


def api_auth(view):
    @csrf_exempt
    @wraps(view)
    def wrapped(request, *a, **kw):
        auth = request.headers.get('Authorization', '')
        partner = S.api_key_partner(auth[7:] if auth.startswith('Bearer ') else '')
        if partner is None:
            return JsonResponse({'ok': False, 'error': 'unauthorized'}, status=401)
        if not partner.active:
            return JsonResponse({'ok': False, 'error': 'partner disabled'}, status=403)
        request.partner = partner
        try:
            request.json = json.loads(request.body or b'{}') if request.method == 'POST' else {}
        except ValueError:
            return JsonResponse({'ok': False, 'error': 'invalid JSON'}, status=400)
        try:
            return view(request, *a, **kw)
        except S.LicenseError as err:
            return JsonResponse({'ok': False, 'error': str(err)}, status=422)
    return wrapped


def license_json(lic):
    return {
        'id': lic.id, 'customer': lic.customer.name, 'machine': lic.machine, 'kind': lic.kind, 'edition': lic.edition,
        'addons': lic.addons, 'limits': lic.limits, 'issued': lic.issued_at.isoformat(), 'expires': lic.expires_at.isoformat() if lic.expires_at else None,
        'status': lic.status, 'price': str(lic.price), 'key': lic.key,
    }


@require_GET
def health(request):
    return JsonResponse({'ok': True, 'signing': signing.status().get('ready', False)})


@api_auth
@require_GET
def me(request):
    p = request.partner
    return JsonResponse({'ok': True, 'partner': {'code': p.code, 'name': p.name}, 'balance': str(p.balance),
                         'available': str(p.balance + p.credit_limit), 'rules': S.rules(p), 'editions': E.editions(), 'addons': E.features()})


@api_auth
@require_http_methods(['POST'])
def quote(request):
    d = request.json
    addons, limits, days = S._clean(d.get('edition', ''), d.get('addons'), d.get('limits'), d.get('days', 365))
    S.check_allowed(request.partner, d['edition'], addons, limits, days)
    kind = License.KIND_TRIAL if d.get('trial') else License.KIND_NEW
    offer = S.find_offer(d.get('offer_code', ''), d['edition'], request.partner.country, kind)
    lp, price = S.quote(d['edition'], addons, limits, days, request.partner, kind, currency=request.partner.currency, offer=offer)
    return JsonResponse({'ok': True, 'list_price': str(lp), 'price': str(price)})


@api_auth
@require_http_methods(['GET', 'POST'])
def licenses(request):
    p = request.partner
    if request.method == 'GET':
        qs = License.objects.filter(partner_id__in=p.scope_ids()).select_related('customer')
        if request.GET.get('machine'):
            qs = qs.filter(machine=signing.normalize_machine(request.GET['machine']))
        return JsonResponse({'ok': True, 'licenses': [license_json(l) for l in qs[:200]]})
    if not p.can_issue_directly:
        return JsonResponse({'ok': False, 'error': 'this account needs approval for every key — use the portal'}, status=403)
    d = request.json
    c = d.get('customer') or {}
    customer = S.find_or_create_customer(p, c.get('name'), (c.get('phone') or '').strip(), city=c.get('city', ''), country=p.country)
    lic = S.issue(None, partner=p, customer=customer, machine=d.get('machine', ''), edition=d.get('edition', ''), addons=d.get('addons'), offer_code=d.get('offer_code', ''),
                  limits=d.get('limits'), days=d.get('days', 365), kind=License.KIND_TRIAL if d.get('trial') else License.KIND_NEW,
                  notes=d.get('notes', ''), ip=request.META.get('REMOTE_ADDR'))
    return JsonResponse({'ok': True, 'license': license_json(lic)}, status=201)


@api_auth
@require_http_methods(['POST'])
def renew(request, pk):
    p = request.partner
    lic = License.objects.filter(partner_id__in=p.scope_ids(), pk=pk).first()
    if lic is None:
        return JsonResponse({'ok': False, 'error': 'not found'}, status=404)
    if not p.can_issue_directly:
        return JsonResponse({'ok': False, 'error': 'this account needs approval — use the portal'}, status=403)
    new = S.renew(None, lic, int(request.json.get('days') or 365), partner=p, ip=request.META.get('REMOTE_ADDR'))
    return JsonResponse({'ok': True, 'license': license_json(new)}, status=201)


@csrf_exempt
@require_http_methods(['POST'])
def lead(request):
    """The website's contact form. Public: small, rate-limited, with a honeypot field."""
    ip = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR')
    key = f'lead:{ip}'
    if cache.get(key, 0) >= 5:
        return JsonResponse({'ok': False, 'error': 'كتير — جرّب بعد شوية'}, status=429)
    try:
        d = json.loads(request.body or b'{}')
    except ValueError:
        return JsonResponse({'ok': False, 'error': 'invalid'}, status=400)
    if d.get('website'):  # bots fill the hidden field
        return JsonResponse({'ok': True})
    name, phone = str(d.get('name', '')).strip()[:100], str(d.get('phone', '')).strip()[:30]
    if not name or sum(c.isdigit() for c in phone) < 8:
        return JsonResponse({'ok': False, 'error': 'اكتب الاسم ورقم موبايل صحيح'}, status=422)
    kind = d.get('kind') if d.get('kind') in dict(Lead.KINDS) else 'quote'
    Lead.objects.create(name=name, phone=phone, business=str(d.get('business', '')).strip()[:150], city=str(d.get('city', '')).strip()[:80],
                        kind=kind, message=str(d.get('message', '')).strip()[:1000], ip=ip)
    cache.set(key, cache.get(key, 0) + 1, 3600)
    return JsonResponse({'ok': True}, status=201)


@require_GET
def public_prices(request):
    """Public price list for the website: yearly / monthly / lifetime per edition in the
    country's currency, after any running automatic offer, and the public offers."""
    from datetime import date
    from .models import CURRENCIES, CURRENCY_SYMBOLS, Offer, Price
    country = request.GET.get('country', 'EG').upper()
    if country not in CURRENCIES:
        country = 'EG'
    currency = CURRENCIES[country]
    key = f'public-prices:{country}'
    cached = cache.get(key)
    if cached:
        return JsonResponse(cached)
    rows = {(p.code, p.days): p.amount for p in Price.objects.filter(item=Price.ITEM_EDITION, currency=currency)}
    out = {'country': country, 'currency': currency, 'symbol': CURRENCY_SYMBOLS[currency], 'editions': [], 'offers': []}
    for code in E.editions():
        offer = S.find_offer('', code, country)
        item = {'code': code, 'ar': E.data()['editions'][code]['ar'], 'en': E.data()['editions'][code]['en']}
        for label, days in (('year', 365), ('month', 30), ('lifetime', 0)):
            if (code, days) in rows:
                item[label] = str(rows[(code, days)])
                if offer:
                    item[f'{label}_offer'] = str(S._money(rows[(code, days)] * (100 - offer.percent) / 100))
        if offer:
            item['offer'] = {'name': offer.name, 'percent': str(offer.percent), 'ends': offer.ends_at.isoformat() if offer.ends_at else None}
        out['editions'].append(item)
    today = date.today()
    for o in Offer.objects.filter(public=True, active=True):
        if o.running(today) and ('*' in (o.countries or ['*']) or country in o.countries):
            out['offers'].append({'name': o.name, 'percent': str(o.percent), 'code': o.code, 'ends': o.ends_at.isoformat() if o.ends_at else None,
                                  'editions': o.editions or ['*'], 'new_only': o.new_only})
    cache.set(key, out, 120)
    return JsonResponse(out)
