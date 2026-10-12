"""Web portal for Inno Source staff (everything) and partners (their own scope)."""
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import editions as E
from . import security as SEC
from . import services as S
from . import signing
from .forms import CustomerForm, PartnerForm, PartnerUserForm
from .models import CURRENCIES, CURRENCY_SYMBOLS, COUNTRIES, ApiKey, AuditLog, Lead, Customer, License, LicenseRequest, Offer, Partner, PartnerUser, Price, Transaction

User = get_user_model()


def client_ip(request):
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR')


def vendor_required(view):
    @wraps(view)
    @login_required
    def wrapped(request, *a, **kw):
        if not S.is_vendor(request.user):
            raise PermissionDenied
        return view(request, *a, **kw)
    return wrapped


def portal_required(view):
    """Inno Source staff or a user of an active partner."""
    @wraps(view)
    @login_required
    def wrapped(request, *a, **kw):
        p = S.partner_of(request.user)
        if p is None and not S.is_vendor(request.user):
            raise PermissionDenied
        if p is not None and not p.active:
            messages.error(request, 'حسابك موقوف — كلّم Inno Source')
            raise PermissionDenied
        return view(request, *a, **kw)
    return wrapped


def owner_required(request):
    link = getattr(request.user, 'partner_link', None)
    if link and link.role != PartnerUser.ROLE_OWNER:
        raise PermissionDenied


def scoped_licenses(user):
    p = S.partner_of(user)
    qs = License.objects.select_related('customer', 'partner')
    return qs if p is None else qs.filter(partner_id__in=p.scope_ids())


def scoped_customers(user):
    p = S.partner_of(user)
    return Customer.objects.all() if p is None else Customer.objects.filter(partner_id__in=p.scope_ids())


def get_license(request, pk):
    return get_object_or_404(scoped_licenses(request.user), pk=pk)


def run(request, fn, ok_message):
    """Runs a service call; a LicenseError becomes a message on the page."""
    try:
        result = fn()
    except S.LicenseError as err:
        messages.error(request, str(err))
        return None
    messages.success(request, ok_message)
    return result


def form_choices(partner):
    r = S.rules(partner) if partner else {'editions': ['*'], 'addons': ['*'], 'max_days': 0, 'max_limits': {}}
    eds = E.editions() if '*' in r['editions'] else r['editions']
    ads = E.features() if '*' in r['addons'] else r['addons']
    durations = [(d, label) for d, label in S.DURATIONS if not r['max_days'] or (d and d <= r['max_days'])]
    return {
        'editions': [(e, E.edition_name(e), E.data()['editions'][e]) for e in eds],
        'addons': [(f, E.data()['features'][f]['ar'], f in ads) for f in E.features()],
        'limit_kinds': [(k, E.data()['limits'][k]['ar'], r['max_limits'].get(k)) for k in E.limit_kinds()],
        'durations': durations,
        'rules': r,
        'edition_features': {e: E.edition_features(e) for e in E.editions()},
        'edition_limits': {e: E.data()['editions'][e]['limits'] for e in E.editions()},
    }


def read_license_form(post):
    limits = {k: post.get(f'lim_{k}') for k in E.limit_kinds() if post.get(f'lim_{k}', '').strip() != ''}
    days = post.get('days')
    if days == 'custom':
        days = post.get('custom_days') or 0
    return {
        'edition': post.get('edition', ''),
        'addons': post.getlist('addons'),
        'limits': {k: int(v) for k, v in limits.items()},
        'days': int(days or 0),
    }


# ------------------------------------------------------------------ dashboard
@portal_required
def dashboard(request):
    p = S.partner_of(request.user)
    lic = scoped_licenses(request.user).filter(status=License.STATUS_ACTIVE)
    now = timezone.now()
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    issued_month = scoped_licenses(request.user).filter(issued_at__gte=month).exclude(kind=License.KIND_TRIAL)
    ctx = {
        'active_count': lic.filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).count(),
        'expiring': lic.filter(expires_at__gt=now, expires_at__lte=now + timedelta(days=30)).order_by('expires_at')[:15],
        'expired_recent': lic.filter(expires_at__lte=now, expires_at__gt=now - timedelta(days=60)).order_by('-expires_at')[:10],
        'month_count': issued_month.count(),
        'month_sales': issued_month.aggregate(s=Sum('price'))['s'] or Decimal('0'),
        'month_by_currency': [(CURRENCY_SYMBOLS.get(r['currency'], r['currency']), r['s']) for r in issued_month.values('currency').annotate(s=Sum('price')).order_by('currency')],
        'recent': scoped_licenses(request.user)[:8],
        'customers_count': scoped_customers(request.user).count(),
    }
    if p is None:
        ctx.update({
            'pending_requests': LicenseRequest.objects.filter(status=LicenseRequest.STATUS_PENDING).count(),
            'partners_count': Partner.objects.filter(active=True).count(),
            'signing': signing.status(),
            'top_partners': Partner.objects.annotate(n=Count('licenses', filter=Q(licenses__issued_at__gte=month))).filter(n__gt=0).order_by('-n')[:8],
            'month_list': issued_month.aggregate(s=Sum('list_price'))['s'] or Decimal('0'),
        })
    else:
        ctx.update({'balance': p.balance, 'pending_requests': p.requests.filter(status=LicenseRequest.STATUS_PENDING).count()})
    return render(request, 'licensing/dashboard.html', ctx)


# ------------------------------------------------------------------ customers
@portal_required
def customers(request):
    q = request.GET.get('q', '').strip()
    qs = scoped_customers(request.user).select_related('partner').annotate(n=Count('licenses')).order_by('name')
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q) | Q(licenses__machine__icontains=q.upper())).distinct()
    page = Paginator(qs, 30).get_page(request.GET.get('page'))
    return render(request, 'licensing/customers.html', {'page': page, 'q': q})


@portal_required
def customer_edit(request, pk=None):
    obj = get_object_or_404(scoped_customers(request.user), pk=pk) if pk else None
    p = S.partner_of(request.user)
    form = CustomerForm(request.POST or None, instance=obj, user=request.user)
    if request.method == 'POST' and form.is_valid():
        c = form.save(commit=False)
        if p is not None and c.partner_id not in p.scope_ids():
            c.partner = p  # a partner's customers always stay in its own scope
        if p is not None:
            c.country = p.country
        c.save()
        S.audit(request.user, 'customer_save', partner=c.partner, ip=client_ip(request), customer=c.id, name=c.name)
        messages.success(request, 'اتحفظ')
        return redirect('customer', pk=c.pk)
    return render(request, 'licensing/customer_form.html', {'form': form, 'obj': obj})


@portal_required
def customer(request, pk):
    c = get_object_or_404(scoped_customers(request.user), pk=pk)
    return render(request, 'licensing/customer.html', {'c': c, 'licenses': c.licenses.select_related('partner').all()})


# ------------------------------------------------------------------ licenses
@portal_required
def licenses(request):
    qs = scoped_licenses(request.user)
    q = request.GET.get('q', '').strip()
    st = request.GET.get('status', 'active')
    now = timezone.now()
    if q:
        qs = qs.filter(Q(customer__name__icontains=q) | Q(machine__icontains=q.upper()) | Q(customer__phone__icontains=q))
    if st == 'active':
        qs = qs.filter(status=License.STATUS_ACTIVE)
    elif st == 'expiring':
        qs = qs.filter(status=License.STATUS_ACTIVE, expires_at__gt=now, expires_at__lte=now + timedelta(days=30))
    elif st == 'expired':
        qs = qs.filter(status=License.STATUS_ACTIVE, expires_at__lte=now)
    elif st in (License.STATUS_REPLACED, License.STATUS_REVOKED):
        qs = qs.filter(status=st)
    partner_id = request.GET.get('partner')
    if partner_id:
        qs = qs.filter(partner_id=partner_id) if partner_id != 'direct' else qs.filter(partner__isnull=True)
    if request.GET.get('export') == 'csv':
        return licenses_csv(qs)
    page = Paginator(qs, 30).get_page(request.GET.get('page'))
    return render(request, 'licensing/licenses.html', {'page': page, 'q': q, 'status': st, 'partners': S.visible_partners(request.user), 'partner_id': partner_id or ''})


def licenses_csv(qs):
    import csv
    resp = HttpResponse(content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="innoforge-licenses.csv"'
    resp.write('﻿')
    w = csv.writer(resp)
    w.writerow(['issued', 'customer', 'phone', 'partner', 'machine', 'kind', 'edition', 'addons', 'limits', 'expires', 'status', 'list_price', 'price'])
    for l in qs:
        w.writerow([l.issued_at.isoformat(), l.customer.name, l.customer.phone, l.partner.code if l.partner else 'Inno Source', l.machine,
                    l.kind, l.edition, ' '.join(l.addons), l.limits, l.expires_at.isoformat() if l.expires_at else 'lifetime', l.status, l.list_price, l.price])
    return resp


@portal_required
def license_new(request):
    p = S.partner_of(request.user)
    choices = form_choices(p)
    customer_id = request.GET.get('customer') or request.POST.get('customer')
    ctx = {'choices': choices, 'customers': scoped_customers(request.user).order_by('name'), 'selected_customer': customer_id, 'countries': COUNTRIES,
           'partners': S.visible_partners(request.user) if p is None else None, 'post': request.POST}
    if request.method == 'POST':
        data = read_license_form(request.POST)
        kind = License.KIND_TRIAL if request.POST.get('trial') else License.KIND_NEW
        try:
            if request.POST.get('customer') == 'new' or not request.POST.get('customer'):
                owner = p
                if p is None and request.POST.get('for_partner'):
                    owner = get_object_or_404(Partner, pk=request.POST['for_partner'])
                country = owner.country if owner is not None else (request.POST.get('new_country') or 'EG')
                cust = S.find_or_create_customer(owner, request.POST.get('new_name'), request.POST.get('new_phone', '').strip(),
                                                 city=request.POST.get('new_city', '').strip(), activity=request.POST.get('new_activity', '').strip(), country=country)
            else:
                cust = get_object_or_404(scoped_customers(request.user), pk=request.POST['customer'])
            seller = p if p is not None else cust.partner
            extra = (request.POST.get('extra_discount') or '').strip()
            customer_price = (request.POST.get('customer_price') or '').strip() or None
            wants_discount = p is not None and extra and Decimal(extra) != cust.special_discount_percent
            if p is not None and (not p.can_issue_directly or wants_discount):
                S.create_request(request.user, partner=p, customer=cust, machine=request.POST.get('machine', ''), kind=kind,
                                 notes=request.POST.get('notes', ''), extra_discount_percent=extra or 0, customer_price=customer_price,
                                 offer_code=request.POST.get('offer_code', ''), **data)
                messages.success(request, 'اتبعت الطلب لـ Inno Source' + (' (فيه خصم خاص محتاج موافقة)' if wants_discount else '') +
                                 ' — هيظهرلك المفتاح أول ما يتوافق عليه')
                return redirect('requests')
            lic = S.issue(request.user, partner=seller, customer=cust, machine=request.POST.get('machine', ''), kind=kind,
                          notes=request.POST.get('notes', ''), ip=client_ip(request), extra_discount_percent=extra or None,
                          customer_price=customer_price, offer_code=request.POST.get('offer_code', ''), **data)
        except (S.LicenseError, ValueError, InvalidOperation) as err:
            messages.error(request, str(err) if isinstance(err, S.LicenseError) else 'راجع الأرقام')
            return render(request, 'licensing/license_form.html', ctx)
        messages.success(request, 'المفتاح اتعمل ✓ — ابعته للعميل')
        return redirect('license', pk=lic.pk)
    return render(request, 'licensing/license_form.html', ctx)


@portal_required
def quote(request):
    """Live price on the issue form."""
    p = S.partner_of(request.user)
    try:
        data = read_license_form(request.GET)
        if p is None and request.GET.get('for_partner'):
            p = Partner.objects.filter(pk=request.GET['for_partner']).first()
        kind = License.KIND_TRIAL if request.GET.get('trial') else License.KIND_NEW
        addons, limits, days = S._clean(data['edition'], data['addons'], data['limits'], data['days'])
        S.check_allowed(p, data['edition'], addons, limits, days)
        cust = scoped_customers(request.user).filter(pk=request.GET.get('customer')).first() if (request.GET.get('customer') or '').isdigit() else None
        special = cust.special_discount_percent if cust else Decimal('0')
        extra = (request.GET.get('extra_discount') or '').strip()
        extra = Decimal(extra) if extra else special
        country = cust.country if cust else (p.country if p is not None else request.GET.get('new_country') or 'EG')
        currency = CURRENCIES.get(country, 'EGP')
        offer = S.find_offer(request.GET.get('offer_code', ''), data['edition'], country, kind)
        list_price, price = S.quote(data['edition'], addons, limits, days, p, kind, extra, currency, offer)
        out = {'ok': True, 'list_price': str(list_price), 'price': str(price), 'extra': str(extra), 'currency': CURRENCY_SYMBOLS.get(currency, currency)}
        if offer:
            out['offer'] = f'{offer.name} −{offer.percent}%'
        if S.partner_of(request.user) is not None and extra != special:
            out['needs_approval'] = True
        if p is not None:
            out['balance'] = str(p.balance)
            out['available'] = str(p.balance + p.credit_limit)
        return JsonResponse(out)
    except (S.LicenseError, ValueError, KeyError, InvalidOperation) as err:
        return JsonResponse({'ok': False, 'error': str(err) if isinstance(err, S.LicenseError) else 'بيانات ناقصة'})


@portal_required
def license_detail(request, pk):
    lic = get_license(request, pk)
    p = S.partner_of(request.user)
    seller = p if p is not None else lic.partner
    history = []
    cur = lic
    while cur.replaces_id:
        cur = cur.replaces
        history.append(cur)
    newer = lic.replaced_by.first()
    return render(request, 'licensing/license.html', {
        'lic': lic, 'history': history, 'newer': newer, 'choices': form_choices(seller),
        'can_issue': p is None or p.can_issue_directly,
        'addon_names': [E.feature_name(a) for a in lic.addons],
        'edition_name': E.edition_name(lic.edition),
    })


@portal_required
def license_key_txt(request, pk):
    lic = get_license(request, pk)
    resp = HttpResponse(lic.key + '\n', content_type='text/plain; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="innoforge-license-{lic.machine}.txt"'
    return resp


@require_POST
@portal_required
def license_action(request, pk, action):
    lic = get_license(request, pk)
    p = S.partner_of(request.user)
    seller = p if p is not None else lic.partner
    ip = client_ip(request)
    if p is not None and not p.can_issue_directly and action in ('renew', 'upgrade', 'transfer'):
        data = read_license_form(request.POST) if action == 'upgrade' else {}
        kind = {'renew': License.KIND_RENEWAL, 'upgrade': License.KIND_UPGRADE, 'transfer': License.KIND_TRANSFER}[action]
        fn = lambda: S.create_request(request.user, partner=p, customer=lic.customer, kind=kind, replaces=lic,  # noqa: E731
                                      machine=request.POST.get('machine') or lic.machine,
                                      edition=data.get('edition', lic.edition), addons=data.get('addons', lic.addons),
                                      limits=data.get('limits', lic.limits), days=int(request.POST.get('days') or lic.days or 0))
        run(request, fn, 'اتبعت الطلب لـ Inno Source')
        return redirect('license', pk=lic.pk)
    if action == 'renew':
        days = request.POST.get('days')
        new = run(request, lambda: S.renew(request.user, lic, int(days or 0), partner=seller, ip=ip), 'اتجدد ✓ — ابعت المفتاح الجديد للعميل')
    elif action == 'upgrade':
        data = read_license_form(request.POST)
        new = run(request, lambda: S.upgrade(request.user, lic, partner=seller, edition=data['edition'], addons=data['addons'], limits=data['limits'], ip=ip),
                  'اتطور ✓ — ابعت المفتاح الجديد للعميل')
    elif action == 'transfer':
        fee = Decimal(request.POST.get('fee') or '0') if p is None else Decimal('0')
        new = run(request, lambda: S.transfer(request.user, lic, request.POST.get('machine', ''), partner=seller, ip=ip, fee=fee),
                  'اتنقل للجهاز الجديد ✓ — ابعت المفتاح الجديد للعميل')
    elif action == 'revoke':
        if p is not None:
            raise PermissionDenied
        new = None
        run(request, lambda: S.revoke(request.user, lic, refund=bool(request.POST.get('refund')), note=request.POST.get('note', ''), ip=ip), 'اتلغى')
    else:
        raise PermissionDenied
    return redirect('license', pk=new.pk if new else lic.pk)


# ------------------------------------------------------------------ requests
@portal_required
def requests_list(request):
    p = S.partner_of(request.user)
    qs = LicenseRequest.objects.select_related('partner', 'customer', 'license')
    if p is not None:
        qs = qs.filter(partner_id__in=p.scope_ids())
    st = request.GET.get('status', 'pending')
    if st:
        qs = qs.filter(status=st)
    rows = []
    for r in qs[:200]:
        try:
            offer = S.find_offer(r.offer_code, r.edition, r.customer.country, r.kind)
            lp, price = S.quote(r.edition, r.addons, r.limits, r.days, r.partner, r.kind,
                                r.extra_discount_percent or r.customer.special_discount_percent, S.currency_of(r.customer), offer)
        except S.LicenseError:
            price = None
        rows.append((r, price, E.edition_name(r.edition), [E.feature_name(a) for a in r.addons]))
    return render(request, 'licensing/requests.html', {'rows': rows, 'status': st})


@require_POST
@vendor_required
def request_decide(request, pk, decision):
    req = get_object_or_404(LicenseRequest, pk=pk)
    if decision == 'approve':
        lic = run(request, lambda: S.approve_request(request.user, req, ip=client_ip(request),
                                                     extra_discount_percent=request.POST.get('extra_discount')), 'اتوافق ✓ واتعمل المفتاح')
        if lic:
            return redirect('license', pk=lic.pk)
    else:
        run(request, lambda: S.reject_request(request.user, req, request.POST.get('note', '')), 'اترفض')
    return redirect('requests')


# ------------------------------------------------------------------ partners
@portal_required
def partners(request):
    qs = S.visible_partners(request.user).select_related('parent')
    me = S.partner_of(request.user)
    if me is not None:
        qs = qs.exclude(pk=me.pk)
    q = request.GET.get('q', '').strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q) | Q(phone__icontains=q))
    rows = [(x, x.balance, x.licenses.filter(issued_at__gte=timezone.now() - timedelta(days=30)).count()) for x in qs]
    return render(request, 'licensing/partners.html', {'rows': rows, 'q': q, 'can_add': me is None or (me.can_manage_children and request.user.partner_link.role == PartnerUser.ROLE_OWNER)})


@portal_required
def partner_edit(request, pk=None):
    me = S.partner_of(request.user)
    if me is not None:
        owner_required(request)
        if not me.can_manage_children:
            raise PermissionDenied
    obj = get_object_or_404(S.visible_partners(request.user), pk=pk) if pk else None
    if obj is not None and me is not None and obj.pk == me.pk:
        raise PermissionDenied  # nobody edits their own rules
    form = PartnerForm(request.POST or None, instance=obj, parent=me)
    if request.method == 'POST' and form.is_valid():
        partner = form.save(commit=False)
        if me is not None:
            partner.parent = me
            partner.country = me.country
            partner.discount_percent = min(partner.discount_percent, me.discount_percent)
            partner.can_issue_directly = partner.can_issue_directly and me.can_issue_directly
        try:
            if partner.parent:
                S.check_subpartner_rules(partner.parent, {'allowed_editions': partner.allowed_editions, 'allowed_addons': partner.allowed_addons,
                                                          'max_days': partner.max_days, 'max_limits': partner.max_limits})
        except S.LicenseError as err:
            messages.error(request, str(err))
        else:
            partner.save()
            S.audit(request.user, 'partner_save', partner=partner, ip=client_ip(request), code=partner.code)
            messages.success(request, 'اتحفظ')
            return redirect('partner', pk=partner.pk)
    return render(request, 'licensing/partner_form.html', {'form': form, 'obj': obj, 'choices': form_choices(me)})


@portal_required
def partner_detail(request, pk):
    partner = get_object_or_404(S.visible_partners(request.user), pk=pk)
    me = S.partner_of(request.user)
    try:
        r = S.rules(partner)
    except S.LicenseError as err:
        r = {'error': str(err)}
    return render(request, 'licensing/partner.html', {
        'p': partner, 'balance': partner.balance, 'rules': r, 'users': partner.users.select_related('user'),
        'transactions': partner.transactions.select_related('license', 'created_by')[:50],
        'licenses': partner.licenses.select_related('customer')[:20],
        'is_me': me is not None and me.pk == partner.pk,
        'can_transfer': me is not None and partner.parent_id == me.pk,
        'edition_names': [E.edition_name(e) for e in (E.editions() if '*' in r.get('editions', []) else r.get('editions', []))],
        'addon_names': 'كل الإضافات' if '*' in r.get('addons', []) else '، '.join(E.feature_name(a) for a in r.get('addons', [])) or '—',
        'user_form': PartnerUserForm(),
        'two_step': {u.user_id for u in partner.users.all() if SEC.enabled(u.user)},
        'referred_count': partner.referred_customers.count(),
    })


@require_POST
@portal_required
def partner_user_add(request, pk):
    partner = get_object_or_404(S.visible_partners(request.user), pk=pk)
    me = S.partner_of(request.user)
    if me is not None:
        owner_required(request)
    form = PartnerUserForm(request.POST)
    if form.is_valid():
        with transaction.atomic():
            u = User.objects.create_user(form.cleaned_data['username'], email=form.cleaned_data.get('email') or '', password=form.cleaned_data['password'],
                                         first_name=form.cleaned_data.get('full_name') or '')
            PartnerUser.objects.create(user=u, partner=partner, role=form.cleaned_data['role'])
        S.audit(request.user, 'partner_user_add', partner=partner, username=u.username)
        messages.success(request, f'اتعمل حساب الدخول «{u.username}»')
    else:
        for errs in form.errors.values():
            for e in errs:
                messages.error(request, e)
    return redirect('partner', pk=partner.pk)


@require_POST
@portal_required
def partner_user_toggle(request, pk, user_id):
    partner = get_object_or_404(S.visible_partners(request.user), pk=pk)
    if S.partner_of(request.user) is not None:
        owner_required(request)
    link = get_object_or_404(PartnerUser, partner=partner, user_id=user_id)
    if link.user_id == request.user.id:
        raise PermissionDenied
    link.user.is_active = not link.user.is_active
    link.user.save(update_fields=['is_active'])
    S.audit(request.user, 'partner_user_toggle', partner=partner, username=link.user.username, active=link.user.is_active)
    return redirect('partner', pk=partner.pk)


@require_POST
@portal_required
def partner_user_reset(request, pk, user_id):
    """Inno Source (or the partner's owner) resets a user's password or two-step login (lost phone)."""
    partner = get_object_or_404(S.visible_partners(request.user), pk=pk)
    if S.partner_of(request.user) is not None:
        owner_required(request)
    link = get_object_or_404(PartnerUser, partner=partner, user_id=user_id)
    if link.user_id == request.user.id:
        raise PermissionDenied
    what = request.POST.get('what')
    if what == 'password':
        import secrets
        temp = secrets.token_urlsafe(9)
        link.user.set_password(temp)
        link.user.save(update_fields=['password'])
        messages.success(request, f'كلمة السر المؤقتة لـ «{link.user.username}»: {temp} — ابعتهاله وخليه يغيرها أول ما يدخل (مش هتظهر تاني)')
    elif what == '2fa':
        SEC.disable(link.user)
        messages.success(request, f'اتشال التحقق بخطوتين من «{link.user.username}» — هيشغّله تاني من موبايله الجديد')
    else:
        raise PermissionDenied
    S.audit(request.user, f'partner_user_reset_{what}', partner=partner, ip=client_ip(request), username=link.user.username)
    return redirect('partner', pk=partner.pk)


def _amount(request):
    try:
        return Decimal(request.POST.get('amount') or '0')
    except InvalidOperation:
        return Decimal('0')


@require_POST
@vendor_required
def partner_payout(request, pk):
    partner = get_object_or_404(Partner, pk=pk)
    run(request, lambda: S.payout(request.user, partner, _amount(request), reference=request.POST.get('reference', ''),
                                  note=request.POST.get('note', ''), ip=client_ip(request)), 'اتسجل الصرف ✓')
    return redirect('partner', pk=partner.pk)


def _date(value):
    from datetime import date
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


@portal_required
def partner_statement(request, pk):
    """Account statement for a period (opening balance, movements, closing balance) — print or CSV."""
    partner = get_object_or_404(S.visible_partners(request.user), pk=pk)
    today = timezone.localdate()
    start = _date(request.GET.get('from')) or today.replace(day=1)
    end = _date(request.GET.get('to')) or today
    st = S.statement(partner, start, end)
    if request.GET.get('export') == 'csv':
        import csv
        resp = HttpResponse(content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="statement-{partner.code}-{start}-{end}.csv"'
        resp.write('\ufeff')
        w = csv.writer(resp)
        w.writerow(['date', 'kind', 'note', 'reference', 'amount', 'balance'])
        w.writerow([start.isoformat(), 'opening', '', '', '', st['opening']])
        for t, bal in st['rows']:
            w.writerow([timezone.localtime(t.created_at).strftime('%Y-%m-%d %H:%M'), t.get_kind_display(), t.note, t.reference, t.amount, bal])
        w.writerow([end.isoformat(), 'closing', '', '', '', st['closing']])
        return resp
    return render(request, 'licensing/statement.html', {'p': partner, 'st': st, 'start': start, 'end': end})


@require_POST
@vendor_required
def partner_topup(request, pk):
    partner = get_object_or_404(Partner, pk=pk)
    try:
        amount = Decimal(request.POST.get('amount') or '0')
    except InvalidOperation:
        amount = Decimal('0')
    run(request, lambda: S.topup(request.user, partner, amount, reference=request.POST.get('reference', ''), note=request.POST.get('note', ''), ip=client_ip(request)),
        'اتسجل في الرصيد')
    return redirect('partner', pk=partner.pk)


@require_POST
@portal_required
def partner_transfer(request, pk):
    me = S.partner_of(request.user)
    if me is None:
        raise PermissionDenied
    owner_required(request)
    target = get_object_or_404(Partner, pk=pk, parent=me)
    try:
        amount = Decimal(request.POST.get('amount') or '0')
    except InvalidOperation:
        amount = Decimal('0')
    run(request, lambda: S.transfer_balance(request.user, me, target, amount, note=request.POST.get('note', ''), ip=client_ip(request)), 'اتحوّل ✓')
    return redirect('partner', pk=target.pk)


@portal_required
def my_account(request):
    me = S.partner_of(request.user)
    if me is None:
        return redirect('dashboard')
    return partner_detail(request, me.pk)


# ------------------------------------------------------------------ API keys
@portal_required
def api_keys(request):
    me = S.partner_of(request.user)
    if me is None:
        messages.info(request, 'مفاتيح الـ API للشركاء: افتح صفحة الشريك واعمله مفتاح من حسابه')
        return redirect('partners')
    owner_required(request)
    new_key = None
    if request.method == 'POST':
        if request.POST.get('revoke'):
            ApiKey.objects.filter(partner=me, pk=request.POST['revoke']).update(active=False)
            S.audit(request.user, 'api_key_revoke', partner=me, key=request.POST['revoke'])
        else:
            new_key = S.create_api_key(request.user, me, request.POST.get('name') or 'API')
    return render(request, 'licensing/api_keys.html', {'keys': me.api_keys.all(), 'new_key': new_key})


# ------------------------------------------------------------------ vendor: signing, audit
@vendor_required
def signing_page(request):
    if request.method == 'POST' and request.POST.get('permit'):
        text = request.POST['permit'].strip()
        try:
            permit = signing.parse_permit(text)
            pub = signing.public_of(signing.settings.SIGNING_KEY_FILE.read_bytes())
            if permit.get('pub') != pub:
                raise ValueError('التصريح ده مش لمفتاح السيرفر ده — اعمله من المفتاح العام اللي ظاهر هنا')
            signing.settings.SIGNING_PERMIT_FILE.write_text(text + '\n')
            S.audit(request.user, 'signing_permit', ip=client_ip(request), id=permit.get('id'), expires=permit.get('expires'))
            messages.success(request, 'اتحفظ التصريح ✓ — السيرفر جاهز يوقّع مفاتيح')
        except FileNotFoundError:
            messages.error(request, 'لسه مفيش مفتاح للسيرفر — شغّل: python manage.py license_signing init')
        except Exception as err:  # bad text
            messages.error(request, f'التصريح مش صالح: {err}')
        return redirect('signing')
    pub = None
    if signing.settings.SIGNING_KEY_FILE.exists():
        pub = signing.public_of(signing.settings.SIGNING_KEY_FILE.read_bytes())
    return render(request, 'licensing/signing.html', {'status': signing.status(), 'pub': pub})


@vendor_required
def audit_log(request):
    qs = AuditLog.objects.select_related('user', 'partner')
    if request.GET.get('partner'):
        qs = qs.filter(partner_id=request.GET['partner'])
    page = Paginator(qs, 50).get_page(request.GET.get('page'))
    return render(request, 'licensing/audit.html', {'page': page})


@portal_required
def wallet(request):
    me = S.partner_of(request.user)
    if me is None:
        qs = Transaction.objects.select_related('partner', 'license', 'created_by')
        totals = Transaction.objects.values('kind').annotate(s=Sum('amount'))
    else:
        qs = me.transactions.select_related('license', 'created_by')
        totals = me.transactions.values('kind').annotate(s=Sum('amount'))
    page = Paginator(qs, 50).get_page(request.GET.get('page'))
    kinds = dict(Transaction.KINDS)
    ctx = {'page': page, 'me': me, 'balance': me.balance if me else None,
           'totals': [(kinds.get(t['kind'], t['kind']), t['s']) for t in totals]}
    if me is None:
        bal = Partner.objects.annotate(b=Sum('transactions__amount')).exclude(b=None).exclude(b=0).order_by('b')
        ctx['owe_us'] = [x for x in bal if x.b < 0]       # used credit: they owe Inno Source
        ctx['we_owe'] = [x for x in bal if x.b > 0]       # prepaid balance or earned commissions
    return render(request, 'licensing/wallet.html', ctx)


@vendor_required
def leads(request):
    """Website contact requests: follow up, mark, or hand to a partner."""
    if request.method == 'POST':
        lead = get_object_or_404(Lead, pk=request.POST.get('id'))
        if request.POST.get('status') in dict(Lead.STATUSES):
            lead.status = request.POST['status']
        if 'notes' in request.POST:
            lead.notes = request.POST['notes'][:2000]
        partner_id = request.POST.get('assigned_to')
        if partner_id is not None:
            lead.assigned_to = Partner.objects.filter(pk=partner_id).first() if partner_id else None
        lead.save()
        S.audit(request.user, 'lead_update', ip=client_ip(request), lead=lead.id, status=lead.status)
        messages.success(request, 'اتحفظ')
        return redirect(f"{request.path}?status={request.GET.get('status', '')}")
    st = request.GET.get('status', 'new')
    qs = Lead.objects.select_related('assigned_to')
    if st:
        qs = qs.filter(status=st)
    counts = {k: Lead.objects.filter(status=k).count() for k, _ in Lead.STATUSES}
    page = Paginator(qs, 40).get_page(request.GET.get('page'))
    return render(request, 'licensing/leads.html', {'page': page, 'status': st, 'statuses': Lead.STATUSES, 'counts': counts,
                                                    'partners': Partner.objects.filter(active=True)})


# ------------------------------------------------------------------ vendor: prices and offers
PRICE_DAYS = {Price.ITEM_EDITION: [(365, 'سنة'), (30, 'شهر'), (0, 'مدى الحياة')], Price.ITEM_ADDON: [(365, 'سنة'), (0, 'مدى الحياة')],
              Price.ITEM_LIMIT: [(365, 'سنة'), (0, 'مدى الحياة')]}


def price_rows(currency):
    have = {(p.item, p.code, p.days): p.amount for p in Price.objects.filter(currency=currency)}
    groups = [
        (Price.ITEM_EDITION, 'الباقات', [(e, E.edition_name(e)) for e in E.editions()]),
        (Price.ITEM_ADDON, 'الإضافات (فوق الباقة)', [(f, E.feature_name(f)) for f in E.features()]),
        (Price.ITEM_LIMIT, 'زيادة في الحدود (للوحدة)', [(k, E.data()['limits'][k]['ar']) for k in E.limit_kinds()]),
    ]
    return [(item, title, PRICE_DAYS[item], [(code, name, [(d, have.get((item, code, d))) for d, _ in PRICE_DAYS[item]]) for code, name in rows])
            for item, title, rows in groups]


@vendor_required
def prices(request):
    """The list prices in each currency (a key is priced in its customer's country currency)."""
    currency = request.GET.get('currency') if request.GET.get('currency') in CURRENCY_SYMBOLS else 'EGP'
    if request.method == 'POST':
        changed = 0
        with transaction.atomic():
            for key, value in request.POST.items():
                if not key.startswith('p__'):
                    continue
                _, item, code, days = key.split('__')
                value = value.strip()
                if value == '':
                    changed += Price.objects.filter(item=item, code=code, days=int(days), currency=currency).delete()[0]
                    continue
                try:
                    amount = Decimal(value)
                except InvalidOperation:
                    continue
                obj, created = Price.objects.get_or_create(item=item, code=code, days=int(days), currency=currency, defaults={'amount': amount})
                if not created and obj.amount != amount:
                    obj.amount = amount
                    obj.save(update_fields=['amount'])
                    changed += 1
                changed += created
        S.audit(request.user, 'prices_save', ip=client_ip(request), currency=currency, changed=changed)
        messages.success(request, f'اتحفظت الأسعار ({changed} تغيير)')
        return redirect(f"{request.path}?currency={currency}")
    return render(request, 'licensing/prices.html', {'groups': price_rows(currency), 'currency_code': currency, 'currencies': list(CURRENCY_SYMBOLS.items())})


@vendor_required
def offers(request, pk=None):
    from .forms import OfferForm
    obj = get_object_or_404(Offer, pk=pk) if pk else None
    form = OfferForm(request.POST or None, instance=obj)
    if request.method == 'POST' and form.is_valid():
        o = form.save()
        S.audit(request.user, 'offer_save', ip=client_ip(request), offer=o.id, name=o.name, percent=str(o.percent), code=o.code)
        messages.success(request, 'اتحفظ العرض')
        return redirect('offers')
    rows = Offer.objects.annotate(n=Count('licenses'))
    return render(request, 'licensing/offers.html', {'form': form, 'obj': obj, 'rows': rows, 'choices': form_choices(None), 'countries': COUNTRIES})
