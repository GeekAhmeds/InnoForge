"""JSON API for a partner's own system: Authorization: Bearer ifk_…  (keys from /api-keys/)."""
import json
from functools import wraps

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import editions as E
from . import services as S
from . import signing
from .models import License


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
    lp, price = S.quote(d['edition'], addons, limits, days, request.partner, License.KIND_TRIAL if d.get('trial') else License.KIND_NEW)
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
    customer = S.find_or_create_customer(p, c.get('name'), (c.get('phone') or '').strip(), city=c.get('city', ''))
    lic = S.issue(None, partner=p, customer=customer, machine=d.get('machine', ''), edition=d.get('edition', ''), addons=d.get('addons'),
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
