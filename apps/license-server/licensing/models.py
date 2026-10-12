"""Who sells (Inno Source and its partners), to whom (customers), what (license keys for one
computer each), at what price, and the money between Inno Source and the partners."""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils import timezone

ALL = ['*']


class Partner(models.Model):
    """A distributor, agent or individual seller. Distributors can have their own agents under
    them; what a partner may sell is always within what its parent may sell."""

    KIND_DISTRIBUTOR = 'distributor'
    KIND_AGENT = 'agent'
    KIND_RESELLER = 'reseller'
    KINDS = [(KIND_DISTRIBUTOR, 'موزّع'), (KIND_AGENT, 'وكيل'), (KIND_RESELLER, 'مسوّق / بائع')]

    code = models.CharField('الكود', max_length=20, unique=True)
    name = models.CharField('الاسم', max_length=150)
    kind = models.CharField('النوع', max_length=20, choices=KINDS, default=KIND_AGENT)
    parent = models.ForeignKey('self', verbose_name='تابع لـ', null=True, blank=True, on_delete=models.PROTECT, related_name='children')
    phone = models.CharField('التليفون', max_length=40, blank=True, help_text='بيظهر للعميل جوه البرنامج كـ «اتباع عن طريق»')
    email = models.EmailField('الإيميل', blank=True)
    city = models.CharField('المدينة / المحافظة', max_length=80, blank=True)
    address = models.CharField('العنوان', max_length=250, blank=True)
    active = models.BooleanField('نشط', default=True)

    # What it may sell.
    allowed_editions = models.JSONField('الباقات المسموحة', default=list, blank=True, help_text='["*"] = كله')
    allowed_addons = models.JSONField('الإضافات المسموحة', default=list, blank=True, help_text='["*"] = كله')
    max_days = models.PositiveIntegerField('أقصى مدة للمفتاح (يوم)', default=365, help_text='0 = من غير حد (مسموح مدى الحياة)')
    max_limits = models.JSONField('أقصى حدود', default=dict, blank=True, help_text='{"users": 10, "devices": 3}')
    can_issue_directly = models.BooleanField('يطلّع مفاتيح على طول', default=True, help_text='لو لأ: طلباته بتستنى موافقة Inno Source')
    can_manage_children = models.BooleanField('يقدر يضيف وكلاء تحته', default=False)
    allow_trials = models.BooleanField('مسموح بمفاتيح تجربة مجانية', default=True)
    require_2fa = models.BooleanField('لازم التحقق بخطوتين لمستخدميه', default=False,
                                      help_text='كود من تطبيق Google Authenticator مع كلمة السر')

    # Money.
    discount_percent = models.DecimalField('الخصم من سعر القائمة %', max_digits=5, decimal_places=2, default=Decimal('0'))
    commission_percent = models.DecimalField('عمولة على العملاء اللي بيجيبهم %', max_digits=5, decimal_places=2, default=Decimal('0'),
                                             help_text='للمسوّقين: نسبة من سعر أي مفتاح Inno Source تبيعه لعميل جه عن طريقه — بتتضاف لرصيده')
    credit_limit = models.DecimalField('حد السحب على المكشوف', max_digits=12, decimal_places=2, default=Decimal('0'),
                                       help_text='يقدر يطلّع مفاتيح لحد ما رصيده يوصل للسالب ده')

    notes = models.TextField('ملاحظات', blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'شريك (موزّع / وكيل)'
        verbose_name_plural = 'الشركاء'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} — {self.name}'

    @property
    def balance(self):
        return self.transactions.aggregate(s=Sum('amount'))['s'] or Decimal('0')

    def ancestors(self):
        p, out = self.parent, []
        while p:
            out.append(p)
            p = p.parent
        return out

    def descendants(self):
        out = []
        for c in self.children.all():
            out.append(c)
            out.extend(c.descendants())
        return out

    def scope_ids(self):
        """This partner and everyone under it (what its users can see)."""
        return [self.id] + [p.id for p in self.descendants()]


class PartnerUser(models.Model):
    ROLE_OWNER = 'owner'
    ROLE_STAFF = 'staff'
    ROLES = [(ROLE_OWNER, 'صاحب الحساب'), (ROLE_STAFF, 'موظف')]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='partner_link')
    partner = models.ForeignKey(Partner, on_delete=models.CASCADE, related_name='users')
    role = models.CharField('الدور', max_length=10, choices=ROLES, default=ROLE_STAFF)

    class Meta:
        verbose_name = 'مستخدم شريك'
        verbose_name_plural = 'مستخدمين الشركاء'

    def __str__(self):
        return f'{self.user.username} @ {self.partner.code}'


class Customer(models.Model):
    """A business that uses InnoForge POS. partner = who sold it (empty = Inno Source directly)."""

    partner = models.ForeignKey(Partner, verbose_name='الشريك', null=True, blank=True, on_delete=models.PROTECT, related_name='customers')
    name = models.CharField('اسم العميل / النشاط', max_length=150)
    contact = models.CharField('المسؤول', max_length=100, blank=True)
    phone = models.CharField('التليفون', max_length=40, blank=True)
    email = models.EmailField('الإيميل', blank=True)
    city = models.CharField('المدينة', max_length=80, blank=True)
    activity = models.CharField('النشاط', max_length=80, blank=True, help_text='سوبر ماركت، مطعم، مكتبة…')
    tax_number = models.CharField('الرقم الضريبي', max_length=30, blank=True)
    special_discount_percent = models.DecimalField('خصم خاص للعميل ده %', max_digits=5, decimal_places=2, default=Decimal('0'),
                                                   help_text='Inno Source بس: بيتخصم من سعر أي مفتاح للعميل ده (حتى لو عن طريق شريك)')
    referred_by = models.ForeignKey(Partner, verbose_name='جه عن طريق (مسوّق)', null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='referred_customers')
    notes = models.TextField('ملاحظات', blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'عميل'
        verbose_name_plural = 'العملاء'
        ordering = ['name']

    def __str__(self):
        return self.name


class License(models.Model):
    """One signed key for one computer. Keys work offline and cannot be switched off remotely:
    'revoked' is a record for us (and stops renewals), not a kill switch."""

    KIND_NEW = 'new'
    KIND_RENEWAL = 'renewal'
    KIND_UPGRADE = 'upgrade'
    KIND_TRANSFER = 'transfer'
    KIND_TRIAL = 'trial'
    KINDS = [(KIND_NEW, 'جديد'), (KIND_RENEWAL, 'تجديد'), (KIND_UPGRADE, 'ترقية'), (KIND_TRANSFER, 'نقل لجهاز جديد'), (KIND_TRIAL, 'تجربة')]
    STATUS_ACTIVE = 'active'
    STATUS_REPLACED = 'replaced'
    STATUS_REVOKED = 'revoked'
    STATUSES = [(STATUS_ACTIVE, 'شغال'), (STATUS_REPLACED, 'اتستبدل بمفتاح أحدث'), (STATUS_REVOKED, 'ملغي')]

    customer = models.ForeignKey(Customer, verbose_name='العميل', on_delete=models.PROTECT, related_name='licenses')
    partner = models.ForeignKey(Partner, verbose_name='الشريك', null=True, blank=True, on_delete=models.PROTECT, related_name='licenses')
    machine = models.CharField('رقم الجهاز', max_length=24, db_index=True)
    kind = models.CharField('النوع', max_length=10, choices=KINDS, default=KIND_NEW)
    edition = models.CharField('الباقة', max_length=30)
    addons = models.JSONField('الإضافات', default=list, blank=True)
    limits = models.JSONField('الحدود', default=dict, blank=True)
    days = models.PositiveIntegerField('المدة (يوم)', default=365, help_text='0 = مدى الحياة')
    issued_at = models.DateTimeField('اتعمل في', default=timezone.now)
    expires_at = models.DateTimeField('ينتهي', null=True, blank=True)
    key = models.TextField('المفتاح')
    status = models.CharField('الحالة', max_length=10, choices=STATUSES, default=STATUS_ACTIVE)
    replaces = models.ForeignKey('self', verbose_name='بدل', null=True, blank=True, on_delete=models.SET_NULL, related_name='replaced_by')
    list_price = models.DecimalField('سعر القائمة', max_digits=12, decimal_places=2, default=Decimal('0'))
    price = models.DecimalField('السعر على الشريك', max_digits=12, decimal_places=2, default=Decimal('0'))
    extra_discount_percent = models.DecimalField('خصم خاص %', max_digits=5, decimal_places=2, default=Decimal('0'))
    customer_price = models.DecimalField('السعر اللي العميل دفعه', max_digits=12, decimal_places=2, null=True, blank=True)
    referred_by = models.ForeignKey(Partner, verbose_name='عن طريق مسوّق', null=True, blank=True, on_delete=models.SET_NULL, related_name='referred_licenses')
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    notes = models.TextField('ملاحظات', blank=True)

    class Meta:
        verbose_name = 'ترخيص'
        verbose_name_plural = 'التراخيص'
        ordering = ['-issued_at']

    def __str__(self):
        return f'{self.customer} — {self.machine}'

    @property
    def expired(self):
        return bool(self.expires_at) and self.expires_at < timezone.now()

    @property
    def days_left(self):
        if not self.expires_at:
            return None
        return (self.expires_at - timezone.now()).days


class LicenseRequest(models.Model):
    """A key a partner asked for but may not issue alone (or a renewal it asked Inno Source to do)."""

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUSES = [(STATUS_PENDING, 'مستني'), (STATUS_APPROVED, 'اتوافق عليه'), (STATUS_REJECTED, 'اترفض')]

    partner = models.ForeignKey(Partner, on_delete=models.CASCADE, related_name='requests')
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='requests')
    machine = models.CharField(max_length=24)
    kind = models.CharField(max_length=10, choices=License.KINDS, default=License.KIND_NEW)
    edition = models.CharField(max_length=30)
    addons = models.JSONField(default=list, blank=True)
    limits = models.JSONField(default=dict, blank=True)
    days = models.PositiveIntegerField(default=365)
    replaces = models.ForeignKey(License, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    extra_discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    customer_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default=STATUS_PENDING)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    decision_note = models.CharField(max_length=250, blank=True)
    license = models.ForeignKey(License, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'طلب ترخيص'
        verbose_name_plural = 'طلبات التراخيص'
        ordering = ['-created_at']


class Transaction(models.Model):
    """The partner's account with Inno Source: + money in, − keys issued."""

    KIND_TOPUP = 'topup'
    KIND_CHARGE = 'charge'
    KIND_REFUND = 'refund'
    KIND_TRANSFER_IN = 'transfer_in'
    KIND_TRANSFER_OUT = 'transfer_out'
    KIND_ADJUST = 'adjust'
    KIND_COMMISSION = 'commission'
    KIND_PAYOUT = 'payout'
    KINDS = [(KIND_TOPUP, 'شحن رصيد'), (KIND_CHARGE, 'مفتاح'), (KIND_REFUND, 'استرجاع'), (KIND_TRANSFER_IN, 'تحويل وارد'),
             (KIND_TRANSFER_OUT, 'تحويل لوكيل'), (KIND_ADJUST, 'تسوية'), (KIND_COMMISSION, 'عمولة'), (KIND_PAYOUT, 'صرف مستحقات')]

    partner = models.ForeignKey(Partner, on_delete=models.PROTECT, related_name='transactions')
    kind = models.CharField(max_length=15, choices=KINDS)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    license = models.ForeignKey(License, null=True, blank=True, on_delete=models.SET_NULL, related_name='transactions')
    reference = models.CharField('مرجع (رقم تحويل / إيصال)', max_length=100, blank=True)
    note = models.CharField(max_length=250, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'حركة رصيد'
        verbose_name_plural = 'حركات الرصيد'
        ordering = ['-created_at', '-id']


class Price(models.Model):
    """Inno Source's list prices. A key costs: its edition for the duration + each add-on +
    each user/warehouse/computer above the edition's own limit. Durations without a row are
    priced from the 365-day row (pro rata); lifetime needs its own row."""

    ITEM_EDITION = 'edition'
    ITEM_ADDON = 'addon'
    ITEM_LIMIT = 'limit'
    ITEMS = [(ITEM_EDITION, 'باقة'), (ITEM_ADDON, 'إضافة'), (ITEM_LIMIT, 'زيادة في الحدود (للوحدة)')]

    item = models.CharField('النوع', max_length=10, choices=ITEMS)
    code = models.CharField('الكود', max_length=30, help_text='اسم الباقة أو الإضافة أو users / warehouses / devices')
    days = models.PositiveIntegerField('المدة (يوم)', default=365, help_text='0 = مدى الحياة')
    amount = models.DecimalField('السعر', max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = 'سعر'
        verbose_name_plural = 'قائمة الأسعار'
        unique_together = [('item', 'code', 'days')]
        ordering = ['item', 'code', 'days']

    def __str__(self):
        return f'{self.get_item_display()} {self.code} / {self.days or "∞"}: {self.amount}'


class AuditLog(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    partner = models.ForeignKey(Partner, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=50)
    details = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'سجل'
        verbose_name_plural = 'سجل النشاط'
        ordering = ['-created_at']


class ApiKey(models.Model):
    """For a partner's own system to issue keys over HTTPS (Authorization: Bearer <key>)."""

    partner = models.ForeignKey(Partner, on_delete=models.CASCADE, related_name='api_keys')
    name = models.CharField(max_length=80)
    prefix = models.CharField(max_length=12, db_index=True)
    key_hash = models.CharField(max_length=64)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    last_used = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'مفتاح API'
        verbose_name_plural = 'مفاتيح API'


class Lead(models.Model):
    """Someone who filled in the contact form on the website (quote, trial, demo, partner…)."""

    KINDS = [('quote', 'عرض سعر'), ('trial', 'تجربة مجانية'), ('demo', 'شرح البرنامج'), ('partner', 'عايز يبقى شريك'), ('support', 'دعم فني')]
    STATUSES = [('new', 'جديد'), ('contacted', 'اتكلمنا معاه'), ('won', 'اشترى'), ('lost', 'مش مهتم')]

    name = models.CharField('الاسم', max_length=100)
    phone = models.CharField('الموبايل', max_length=30)
    business = models.CharField('النشاط', max_length=150, blank=True)
    city = models.CharField('المدينة', max_length=80, blank=True)
    kind = models.CharField('الطلب', max_length=10, choices=KINDS, default='quote')
    message = models.TextField('الرسالة', blank=True)
    status = models.CharField('الحالة', max_length=10, choices=STATUSES, default='new')
    notes = models.TextField('ملاحظات المتابعة', blank=True)
    assigned_to = models.ForeignKey(Partner, verbose_name='اتحوّل لشريك', null=True, blank=True, on_delete=models.SET_NULL, related_name='leads')
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'طلب من الموقع'
        verbose_name_plural = 'طلبات الموقع'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} — {self.phone}'


class UserSecurity(models.Model):
    """Two-step login (TOTP codes from an authenticator app) and its recovery codes."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='security')
    totp_secret = models.CharField(max_length=64, blank=True)
    totp_enabled = models.BooleanField(default=False)
    totp_last_step = models.BigIntegerField(default=0)  # a code is accepted once
    recovery_codes = models.JSONField(default=list, blank=True)  # sha256 hashes, each usable once
    enabled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'أمان الدخول'
        verbose_name_plural = 'أمان الدخول'


class LoginAttempt(models.Model):
    """Every login try (for lock-out after repeated failures and for the security page)."""

    username = models.CharField(max_length=150, db_index=True)
    ip = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    ok = models.BooleanField(default=False)
    stage = models.CharField(max_length=10, default='password')  # password | code
    at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-at']
