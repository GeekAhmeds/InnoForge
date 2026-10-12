"""Business rules: what a partner may sell, prices, issuing / renewing / upgrading / moving
keys, the partner wallet and approval requests. Views and the API only call these."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import ROUND_HALF_UP, Decimal

from django.db import models, transaction
from django.utils import timezone

from . import editions as E
from . import signing
from .models import ALL, CURRENCIES, ApiKey, AuditLog, Customer, License, LicenseRequest, Offer, Partner, Price, Transaction

TRIAL_MAX_DAYS = 14
DURATIONS = [(14, 'تجربة — 14 يوم'), (30, 'شهر'), (90, '3 شهور'), (180, '6 شهور'), (365, 'سنة'), (730, 'سنتين'), (0, 'مدى الحياة')]


class LicenseError(Exception):
    """A rule was broken; the message is shown to the user as is."""


# ---------------------------------------------------------------- who is who
def partner_of(user):
    """The partner a user works for; None = Inno Source staff (sees everything)."""
    link = getattr(user, 'partner_link', None)
    return link.partner if link else None


def is_vendor(user):
    return user.is_authenticated and user.is_staff and partner_of(user) is None


def visible_partners(user):
    p = partner_of(user)
    if p is None:
        return Partner.objects.all() if is_vendor(user) else Partner.objects.none()
    return Partner.objects.filter(id__in=p.scope_ids())


def audit(user, action, partner=None, ip=None, **details):
    AuditLog.objects.create(user=user if user and user.is_authenticated else None, partner=partner, action=action, details=details, ip=ip)


# ---------------------------------------------------------------- partner rules
def _narrow(current, allowed_list, universe):
    """current ∩ allowed_list, where either may be ['*'] (everything)."""
    if '*' in (allowed_list or []):
        return current
    allowed_set = set(allowed_list or [])
    return [x for x in (universe if current == ALL else current) if x in allowed_set]


def rules(partner):
    """What a partner may sell: its own rules narrowed by every partner above it."""
    eds, ads, max_days, caps = list(ALL), list(ALL), 0, {}
    for p in [partner] + partner.ancestors():
        if not p.active:
            raise LicenseError(f'الحساب {p.code} موقوف — كلّم Inno Source')
        eds = _narrow(eds, p.allowed_editions, E.editions())
        ads = _narrow(ads, p.allowed_addons, E.features())
        if p.max_days:
            max_days = p.max_days if not max_days else min(max_days, p.max_days)
        for k, v in (p.max_limits or {}).items():
            if v:
                caps[k] = int(v) if k not in caps else min(caps[k], int(v))
    return {'editions': eds, 'addons': ads, 'max_days': max_days, 'max_limits': caps}


def check_allowed(partner, edition, addons, limits, days):
    if partner is None:
        return
    r = rules(partner)
    if not E.allowed(r['editions'], edition):
        raise LicenseError(f'باقة «{E.edition_name(edition)}» مش مسموحة لحسابك')
    for a in addons:
        if not E.allowed(r['addons'], a):
            raise LicenseError(f'إضافة «{E.feature_name(a)}» مش مسموحة لحسابك')
    if r['max_days'] and days is not None and (not days or days > r['max_days']):
        raise LicenseError(f'أقصى مدة مسموحة لحسابك {r["max_days"]} يوم')
    eff = E.effective_limits(edition, addons, limits)
    for k, cap in r['max_limits'].items():
        if eff.get(k) == 0 or eff.get(k, 0) > cap:
            raise LicenseError(f'{E.data()["limits"][k]["ar"]}: أقصى حاجة مسموحة لحسابك {cap}')


def check_subpartner_rules(parent, child_rules):
    """A partner never gives its agents more than it has."""
    r = rules(parent)

    def within(mine, theirs):
        if '*' in mine:
            return True
        return '*' not in theirs and all(x in mine for x in theirs)

    if not within(r['editions'], child_rules.get('allowed_editions') or []):
        raise LicenseError('مينفعش تدّي وكيلك باقة إنت مش مسموحلك بيها')
    if not within(r['addons'], child_rules.get('allowed_addons') or []):
        raise LicenseError('مينفعش تدّي وكيلك إضافة إنت مش مسموحلك بيها')
    for k, cap in r['max_limits'].items():
        mine = (child_rules.get('max_limits') or {}).get(k)
        if not mine or int(mine) > cap:
            raise LicenseError(f'{E.data()["limits"][k]["ar"]}: أقصى حاجة لوكيلك {cap}')
    if r['max_days'] and (not child_rules.get('max_days') or child_rules['max_days'] > r['max_days']):
        raise LicenseError(f'أقصى مدة لوكيلك {r["max_days"]} يوم')


# ---------------------------------------------------------------- prices
def _money(x):
    return Decimal(x).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _price(item, code, days, currency='EGP'):
    rows = {p.days: p.amount for p in Price.objects.filter(item=item, code=code, currency=currency)}
    if days in rows:
        return rows[days]
    if days == 0:
        if not rows:
            return Decimal('0')
        raise LicenseError('مفيش سعر «مدى الحياة» للبند ده في قائمة الأسعار')
    base = rows.get(365)
    if base is None:
        return Decimal('0')
    return _money(base * Decimal(days) / Decimal(365))


def _percent(x):
    try:
        x = _money(x or 0)
    except Exception as err:
        raise LicenseError('نسبة الخصم لازم تكون رقم') from err
    if x < 0 or x > 100:
        raise LicenseError('نسبة الخصم لازم تكون من 0 لـ 100')
    return x


def quote(edition, addons, limits, days, partner=None, kind=License.KIND_NEW, extra_discount=0, currency='EGP', offer=None):
    """(list price, what the partner pays), in `currency`. An offer comes off the list price first;
    then the partner's discount; then extra_discount = a special discount Inno Source gives on this
    key (or this customer). Inno Source bears the offer and the special discount."""
    if kind == License.KIND_TRIAL:
        return Decimal('0'), Decimal('0')
    total = _price(Price.ITEM_EDITION, edition, days, currency)
    for a in addons:
        total += _price(Price.ITEM_ADDON, a, days, currency)
    base = E.effective_limits(edition, [], {})
    eff = E.effective_limits(edition, addons, limits)
    for k, v in eff.items():
        if base.get(k) and (v == 0 or v > base[k]):
            extra = 0 if v == 0 else v - base[k]
            unit = _price(Price.ITEM_LIMIT, k, days, currency)
            if v == 0 and unit:
                raise LicenseError(f'{E.data()["limits"][k]["ar"]} «بدون حد» محتاج باقة أعلى (أو حدد رقم)')
            total += unit * extra
    total = _money(total)
    discount = partner.discount_percent if partner else Decimal('0')
    price = total * (Decimal('100') - (offer.percent if offer else Decimal('0'))) / Decimal('100')
    price = price * (Decimal('100') - discount) / Decimal('100')
    price = price * (Decimal('100') - _percent(extra_discount)) / Decimal('100')
    return total, _money(price)


def find_offer(code, edition, country, kind=License.KIND_NEW):
    """The offer a key gets: the one its promo code names, else the best automatic one."""
    if kind in (License.KIND_TRIAL, License.KIND_TRANSFER, License.KIND_UPGRADE):
        if code:
            raise LicenseError('كود الخصم للمفاتيح الجديدة بس')
        return None

    def fits(o):
        return (o.running() and E.allowed(o.editions or ['*'], edition) and ('*' in (o.countries or ['*']) or country in o.countries)
                and (kind == License.KIND_NEW or not o.new_only))
    code = (code or '').strip()
    if code:
        offer = Offer.objects.filter(code__iexact=code).first()
        if offer is None or not fits(offer):
            raise LicenseError('كود الخصم مش صالح أو خلص')
        return offer
    best = None
    for o in Offer.objects.filter(code='', active=True):
        if fits(o) and (best is None or o.percent > best.percent):
            best = o
    return best


def currency_of(customer):
    return CURRENCIES.get(getattr(customer, 'country', '') or 'EG', 'EGP')


# ---------------------------------------------------------------- issuing
def _clean(edition, addons, limits, days):
    if edition not in E.editions():
        raise LicenseError('باقة مش معروفة')
    included = set(E.edition_features(edition))
    addons = sorted({a for a in (addons or []) if a in E.features() and a not in included})
    clean_limits = {}
    for k, v in (limits or {}).items():
        if k in E.limit_kinds() and v not in (None, ''):
            v = int(v)
            if v < 0:
                raise LicenseError('الحدود لازم تكون أرقام موجبة')
            clean_limits[k] = v
    days = int(days or 0)
    if days < 0 or days > 3650:
        raise LicenseError('مدة غير صحيحة')
    return addons, clean_limits, days


def permit_allows(permit, payload):
    """Python copy of resellerAllows() in apps/pos/electron/editions.cjs, so a key the app
    would refuse is never handed out."""
    if permit.get('countries') and permit['countries'] != '*' and payload.get('country') not in permit['countries']:
        return 'تصريح السيرفر مش بيسمح بالدولة دي'
    if permit.get('editions') != '*' and payload['edition'] not in (permit.get('editions') or []):
        return 'تصريح السيرفر مش بيسمح بالباقة دي'
    if permit.get('addons') != '*' and any(a not in (permit.get('addons') or []) for a in payload.get('addons', [])):
        return 'تصريح السيرفر مش بيسمح بالإضافة دي'
    if permit.get('max_days'):
        if not payload.get('expires'):
            return 'تصريح السيرفر مش بيسمح بمدى الحياة'
        span = (datetime.fromisoformat(payload['expires'][:-1]) - datetime.fromisoformat(payload['issued'][:-1])).total_seconds() / 86400
        if span > permit['max_days'] + 1:
            return 'المدة أطول من المسموح في تصريح السيرفر'
    eff = E.effective_limits(payload['edition'], payload.get('addons', []), payload.get('limits', {}))
    for k, cap in (permit.get('max_limits') or {}).items():
        if cap and (eff.get(k) == 0 or eff.get(k, 0) > cap):
            return 'الحدود أكبر من المسموح في تصريح السيرفر'
    issued = payload['issued']
    if issued < permit['issued'] or (permit.get('expires') and issued > permit['expires']):
        return 'تصريح السيرفر منتهي — Inno Source لازم تجدده'
    return ''


def _sign(customer, partner, machine, edition, addons, limits, issued, expires):
    try:
        _, _, permit = signing.load()
    except signing.SigningNotReady as err:
        raise LicenseError(f'السيرفر لسه مش جاهز يوقّع مفاتيح ({err}) — Inno Source لازم تكمل الإعداد') from err
    payload = {
        'product': 'innoforge-pos',
        'machine': machine,
        'customer': customer.name,
        'issued': signing.js_iso(issued),
        'expires': signing.js_iso(expires) if expires else None,
        'edition': edition,
    }
    if addons:
        payload['addons'] = addons
    if limits:
        payload['limits'] = limits
    if getattr(customer, 'country', ''):
        payload['country'] = customer.country  # the copy only works as a business in this country
    payload['reseller'] = permit['id']
    if partner:
        payload['seller'] = {'code': partner.code, 'name': partner.name, 'phone': partner.phone}
    why = permit_allows(permit, payload)
    if why:
        raise LicenseError(why)
    return signing.sign_license(payload)


@transaction.atomic
def issue(user, *, partner, customer, machine, edition, addons=(), limits=None, days=365, kind=License.KIND_NEW,
          replaces=None, expires_at=None, notes='', ip=None, charge=None, extra_discount_percent=None, customer_price=None,
          referred_by=None, offer_code=''):
    """Signs a key, records it and charges the partner. Everything or nothing.

    extra_discount_percent: a special discount on this key (default: the customer's special discount).
    Only Inno Source sets one; a partner asks for it through a request (approve_request).
    customer_price: what the partner charged its customer (for its own records and profit).
    referred_by: the marketer who brought the customer (default: customer.referred_by) — earns a commission."""
    machine_n = signing.normalize_machine(machine)
    if not machine_n:
        raise LicenseError('رقم الجهاز لازم يكون 20 حرف/رقم زي 7F3A-91C2-04BE-D5E8-2A6F')
    addons, limits, days = _clean(edition, addons, limits, days)
    if partner is not None and customer.partner_id not in partner.scope_ids():
        raise LicenseError('العميل ده مش تبعك')
    if partner is not None and customer.country != partner.country:
        raise LicenseError('حسابك للبيع في دولته بس — العميل ده في دولة تانية')
    currency = currency_of(customer)
    if kind == License.KIND_TRIAL:
        if not days or days > TRIAL_MAX_DAYS:
            raise LicenseError(f'التجربة أقصاها {TRIAL_MAX_DAYS} يوم')
        if partner is not None and not partner.allow_trials:
            raise LicenseError('مفاتيح التجربة مش مسموحة لحسابك')
        if License.objects.filter(machine=machine_n, kind=License.KIND_TRIAL).exists():
            raise LicenseError('الجهاز ده خد تجربة قبل كده')
    special = _percent(customer.special_discount_percent)
    extra = special if extra_discount_percent in (None, '') else _percent(extra_discount_percent)
    if extra != special and not is_vendor(user):
        raise LicenseError('الخصم الخاص محتاج موافقة Inno Source — ابعته كطلب')
    if customer_price not in (None, ''):
        customer_price = _money(customer_price)
        if customer_price < 0:
            raise LicenseError('سعر العميل مينفعش يكون بالسالب')
    else:
        customer_price = None
    referrer = referred_by if referred_by is not None else customer.referred_by
    # Moving or upgrading keeps the end date the key already had.
    check_allowed(partner, edition, addons, limits, None if kind in (License.KIND_TRANSFER, License.KIND_UPGRADE) else days)
    offer = find_offer(offer_code, edition, customer.country, kind) if charge is None else None
    list_price, price = quote(edition, addons, limits, days, partner, kind, extra, currency, offer) if charge is None else (charge, charge)
    if partner is not None:
        locked = Partner.objects.select_for_update().get(pk=partner.pk)
        if price and locked.balance - price < -locked.credit_limit:
            raise LicenseError(f'رصيدك مش كفاية: المطلوب {price} والمتاح {locked.balance + locked.credit_limit} — اشحن رصيدك من Inno Source')
    issued = timezone.now()
    if expires_at is None and days:
        expires_at = issued + timedelta(days=days)
    key = _sign(customer, partner, machine_n, edition, addons, limits, issued, expires_at)
    lic = License.objects.create(customer=customer, partner=partner, machine=machine_n, kind=kind, edition=edition, addons=addons,
                                 limits=limits, days=days, issued_at=issued, expires_at=expires_at, key=key, replaces=replaces,
                                 list_price=list_price, price=price, issued_by=user, notes=notes, extra_discount_percent=extra,
                                 customer_price=customer_price, referred_by=referrer, currency=currency, offer=offer)
    if offer is not None:
        Offer.objects.filter(pk=offer.pk).update(used=models.F('used') + 1)
    if replaces is not None:
        License.objects.filter(pk=replaces.pk).update(status=License.STATUS_REPLACED)
    if partner is not None and price:
        Transaction.objects.create(partner=partner, kind=Transaction.KIND_CHARGE, amount=-price, license=lic,
                                   note=f'{lic.get_kind_display()} — {customer.name} — {E.edition_name(edition)}', created_by=user)
    commission = _commission(user, lic, referrer, partner, price)
    audit(user, f'license_{kind}', partner=partner, ip=ip, license=lic.id, customer=customer.name, machine=machine_n, edition=edition,
          addons=addons, limits=limits, days=days, price=str(price), currency=currency, extra_discount=str(extra),
          **({'offer': offer.name} if offer else {}),
          **({'commission': str(commission), 'referred_by': referrer.code} if commission else {}))
    return lic


def _commission(user, lic, referrer, seller, price):
    """A marketer earns its percent of what Inno Source got for a key sold to a customer it
    brought. It is added to the marketer's balance; Inno Source pays it out (payout)."""
    if referrer is None or not price or not referrer.commission_percent or not referrer.active:
        return Decimal('0')
    if seller is not None and referrer.id in [seller.id] + [a.id for a in seller.ancestors()]:
        return Decimal('0')  # the seller's own chain already earns through its discount
    amount = _money(price * referrer.commission_percent / Decimal('100'))
    if amount:
        Transaction.objects.create(partner=referrer, kind=Transaction.KIND_COMMISSION, amount=amount, license=lic,
                                   note=f'عمولة {referrer.commission_percent}% — {lic.customer.name}', created_by=user)
    return amount


def renew(user, lic, days, *, partner, ip=None, extra_discount_percent=None, customer_price=None):
    """Same computer, same contents, longer: starts when the current key ends (or today)."""
    lic.refresh_from_db()  # never act on a stale copy (it may have been replaced meanwhile)
    if lic.status == License.STATUS_REVOKED:
        raise LicenseError('المفتاح ده ملغي')
    if not lic.expires_at:
        raise LicenseError('المفتاح ده مدى الحياة — مش محتاج تجديد')
    days = int(days)
    if not days:
        raise LicenseError('اختار مدة التجديد')
    start = max(lic.expires_at, timezone.now())
    return issue(user, partner=partner, customer=lic.customer, machine=lic.machine, edition=lic.edition, addons=lic.addons,
                 limits=lic.limits, days=days, kind=License.KIND_RENEWAL, replaces=lic, expires_at=start + timedelta(days=days), ip=ip,
                 extra_discount_percent=extra_discount_percent, customer_price=customer_price)


def upgrade(user, lic, *, partner, edition, addons, limits, ip=None):
    """Same computer and end date, more features: pays the difference for the time left."""
    lic.refresh_from_db()  # never act on a stale copy (it may have been replaced meanwhile)
    if lic.status != License.STATUS_ACTIVE:
        raise LicenseError('لازم تطوّر المفتاح الشغال (آخر نسخة)')
    left = 0 if not lic.expires_at else max(1, (lic.expires_at - timezone.now()).days)
    if lic.expires_at and lic.expired:
        raise LicenseError('المفتاح منتهي — جدده الأول')
    addons, limits, _ = _clean(edition, addons, limits, left)
    special = lic.customer.special_discount_percent
    cur = currency_of(lic.customer)
    new_list, new_price = quote(edition, addons, limits, left, partner, extra_discount=special, currency=cur)
    old_list, old_price = quote(lic.edition, lic.addons, lic.limits, left, partner, extra_discount=special, currency=cur)
    charge = max(Decimal('0'), new_price - old_price)
    check_allowed(partner, edition, addons, limits, None)
    return issue(user, partner=partner, customer=lic.customer, machine=lic.machine, edition=edition, addons=addons, limits=limits,
                 days=left, kind=License.KIND_UPGRADE, replaces=lic, expires_at=lic.expires_at, ip=ip, charge=charge)


def transfer(user, lic, new_machine, *, partner, ip=None, fee=Decimal('0')):
    """The customer changed computers: same key contents for the new Machine ID."""
    lic.refresh_from_db()  # never act on a stale copy (it may have been replaced meanwhile)
    if lic.status != License.STATUS_ACTIVE:
        raise LicenseError('لازم تنقل المفتاح الشغال (آخر نسخة)')
    if lic.expired:
        raise LicenseError('المفتاح منتهي — جدده الأول')
    if signing.normalize_machine(new_machine) == lic.machine:
        raise LicenseError('ده نفس الجهاز')
    left = 0 if not lic.expires_at else max(1, (lic.expires_at - timezone.now()).days)
    return issue(user, partner=partner, customer=lic.customer, machine=new_machine, edition=lic.edition, addons=lic.addons,
                 limits=lic.limits, days=left, kind=License.KIND_TRANSFER, replaces=lic, expires_at=lic.expires_at, ip=ip, charge=fee)


@transaction.atomic
def revoke(user, lic, *, refund=False, note='', ip=None):
    """Marks a key cancelled (no more renewals or transfers) and optionally refunds the partner.
    The key itself keeps working offline until it expires — keys cannot be switched off."""
    if lic.status == License.STATUS_REVOKED:
        return lic
    lic.status = License.STATUS_REVOKED
    lic.notes = (lic.notes + '\n' if lic.notes else '') + f'ملغي: {note}'
    lic.save(update_fields=['status', 'notes'])
    if refund and lic.partner_id and lic.price:
        Transaction.objects.create(partner=lic.partner, kind=Transaction.KIND_REFUND, amount=lic.price, license=lic, note=note, created_by=user)
    if refund:  # the money went back, so does the marketer's commission
        for t in Transaction.objects.filter(license=lic, kind=Transaction.KIND_COMMISSION):
            Transaction.objects.create(partner=t.partner, kind=Transaction.KIND_ADJUST, amount=-t.amount, license=lic,
                                       note=f'إلغاء عمولة — {note}'.strip(' —'), created_by=user)
    audit(user, 'license_revoke', partner=lic.partner, ip=ip, license=lic.id, refund=bool(refund), note=note)
    return lic


# ---------------------------------------------------------------- wallet
@transaction.atomic
def topup(user, partner, amount, *, reference='', note='', ip=None):
    amount = _money(amount)
    if amount == 0:
        raise LicenseError('اكتب المبلغ')
    kind = Transaction.KIND_TOPUP if amount > 0 else Transaction.KIND_ADJUST
    Transaction.objects.create(partner=partner, kind=kind, amount=amount, reference=reference, note=note, created_by=user)
    audit(user, 'wallet_topup', partner=partner, ip=ip, amount=str(amount), reference=reference)


@transaction.atomic
def transfer_balance(user, source, target, amount, *, note='', ip=None):
    """A distributor moves part of its balance to one of its agents."""
    amount = _money(amount)
    if amount <= 0:
        raise LicenseError('اكتب مبلغ أكبر من صفر')
    if target.parent_id != source.id:
        raise LicenseError('تقدر تحوّل لوكلائك المباشرين بس')
    locked = Partner.objects.select_for_update().get(pk=source.pk)
    if locked.balance < amount:
        raise LicenseError(f'رصيدك {locked.balance} — مش كفاية')
    Transaction.objects.create(partner=source, kind=Transaction.KIND_TRANSFER_OUT, amount=-amount, note=f'إلى {target.code} {note}'.strip(), created_by=user)
    Transaction.objects.create(partner=target, kind=Transaction.KIND_TRANSFER_IN, amount=amount, note=f'من {source.code} {note}'.strip(), created_by=user)
    audit(user, 'wallet_transfer', partner=source, ip=ip, to=target.code, amount=str(amount))


@transaction.atomic
def payout(user, partner, amount, *, reference='', note='', ip=None):
    """Inno Source paid a partner what it is owed (commissions, or a balance refund)."""
    amount = _money(amount)
    if amount <= 0:
        raise LicenseError('اكتب مبلغ أكبر من صفر')
    locked = Partner.objects.select_for_update().get(pk=partner.pk)
    if locked.balance < amount:
        raise LicenseError(f'المستحق له {locked.balance} بس')
    Transaction.objects.create(partner=partner, kind=Transaction.KIND_PAYOUT, amount=-amount, reference=reference, note=note, created_by=user)
    audit(user, 'wallet_payout', partner=partner, ip=ip, amount=str(amount), reference=reference)


def statement(partner, start=None, end=None):
    """Account statement: opening balance, every movement with a running balance, totals per kind,
    closing balance. start/end are dates (end inclusive)."""
    qs = partner.transactions.select_related('license', 'license__customer', 'created_by').order_by('created_at', 'id')
    before = Decimal('0')
    if start:
        before = qs.filter(created_at__date__lt=start).aggregate(s=models.Sum('amount'))['s'] or Decimal('0')
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    running, rows, totals = before, [], {}
    kinds = dict(Transaction.KINDS)
    for t in qs:
        running += t.amount
        rows.append((t, running))
        totals[t.kind] = totals.get(t.kind, Decimal('0')) + t.amount
    sales = License.objects.filter(partner=partner).exclude(customer_price=None)
    if start:
        sales = sales.filter(issued_at__date__gte=start)
    if end:
        sales = sales.filter(issued_at__date__lte=end)
    agg = sales.aggregate(c=models.Sum('customer_price'), p=models.Sum('price'))
    return {'opening': before, 'closing': running, 'rows': rows,
            'totals': [(kinds.get(k, k), v) for k, v in totals.items()],
            'debit': sum((t.amount for t, _ in rows if t.amount < 0), Decimal('0')),
            'credit': sum((t.amount for t, _ in rows if t.amount > 0), Decimal('0')),
            'customer_sales': agg['c'] or Decimal('0'), 'customer_cost': agg['p'] or Decimal('0')}


# ---------------------------------------------------------------- requests
def create_request(user, *, partner, customer, machine, edition, addons, limits, days, kind=License.KIND_NEW, replaces=None, notes='',
                   extra_discount_percent=0, customer_price=None, offer_code=''):
    machine_n = signing.normalize_machine(machine)
    if not machine_n:
        raise LicenseError('رقم الجهاز لازم يكون 20 حرف/رقم')
    addons, limits, days = _clean(edition, addons, limits, days)
    check_allowed(partner, edition, addons, limits, days)
    extra = _percent(extra_discount_percent)
    customer_price = _money(customer_price) if customer_price not in (None, '') else None
    req = LicenseRequest.objects.create(partner=partner, customer=customer, machine=machine_n, kind=kind, edition=edition, addons=addons,
                                        limits=limits, days=days, replaces=replaces, notes=notes, requested_by=user,
                                        extra_discount_percent=extra, customer_price=customer_price, offer_code=(offer_code or '').strip())
    audit(user, 'request_create', partner=partner, request=req.id, customer=customer.name)
    return req


def approve_request(user, req, *, ip=None, extra_discount_percent=None):
    """Inno Source approves (it may change the asked-for special discount, e.g. 90% → 50%)."""
    if req.status != LicenseRequest.STATUS_PENDING:
        raise LicenseError('الطلب ده اتحسم قبل كده')
    if not is_vendor(user):
        raise LicenseError('الموافقة لـ Inno Source بس')
    extra = req.extra_discount_percent if extra_discount_percent in (None, '') else _percent(extra_discount_percent)
    if req.kind == License.KIND_RENEWAL and req.replaces:
        lic = renew(user, req.replaces, req.days, partner=req.partner, ip=ip, extra_discount_percent=extra or None,
                    customer_price=req.customer_price)
    else:
        lic = issue(user, partner=req.partner, customer=req.customer, machine=req.machine, edition=req.edition, addons=req.addons,
                    limits=req.limits, days=req.days, kind=req.kind, replaces=req.replaces, notes=req.notes, ip=ip,
                    extra_discount_percent=extra or None, customer_price=req.customer_price, offer_code=req.offer_code)
    req.extra_discount_percent = extra
    req.status, req.license, req.decided_by, req.decided_at = LicenseRequest.STATUS_APPROVED, lic, user, timezone.now()
    req.save()
    return lic


def reject_request(user, req, note=''):
    if req.status != LicenseRequest.STATUS_PENDING:
        raise LicenseError('الطلب ده اتحسم قبل كده')
    req.status, req.decided_by, req.decided_at, req.decision_note = LicenseRequest.STATUS_REJECTED, user, timezone.now(), note[:250]
    req.save()
    audit(user, 'request_reject', partner=req.partner, request=req.id, note=note)


# ---------------------------------------------------------------- API keys
def create_api_key(user, partner, name):
    raw = 'ifk_' + secrets.token_urlsafe(32)
    ApiKey.objects.create(partner=partner, name=name[:80], prefix=raw[:12], key_hash=hashlib.sha256(raw.encode()).hexdigest(), created_by=user)
    audit(user, 'api_key_create', partner=partner, name=name)
    return raw


def api_key_partner(raw):
    raw = str(raw or '')
    if not raw.startswith('ifk_'):
        return None
    digest = hashlib.sha256(raw.encode()).hexdigest()
    for k in ApiKey.objects.filter(prefix=raw[:12], active=True).select_related('partner'):
        if secrets.compare_digest(k.key_hash, digest):
            ApiKey.objects.filter(pk=k.pk).update(last_used=timezone.now())
            return k.partner
    return None


def find_or_create_customer(partner, name, phone='', **extra):
    name = (name or '').strip()
    if not name:
        raise LicenseError('اكتب اسم العميل')
    qs = Customer.objects.filter(partner=partner, name=name)
    if phone:
        qs = qs.filter(phone=phone)
    c = qs.first()
    return c or Customer.objects.create(partner=partner, name=name, phone=phone, **extra)


def utc(dt):
    return dt.astimezone(dt_timezone.utc)
