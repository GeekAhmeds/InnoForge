"""Login with lock-out and an optional/required second step (authenticator app code), and the
«أمان حسابي» page where a user turns two-step login on."""
import time

from django.contrib import messages
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme, urlencode

from . import security as SEC
from . import services as S
from .models import LoginAttempt

User = get_user_model()
PENDING_SECONDS = 300  # time to type the code after the password


def client_ip(request):
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR')


def _next(request, value):
    if value and url_has_allowed_host_and_scheme(value, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return value
    return reverse('dashboard')


LOCKED_MSG = 'محاولات غلط كتير — الدخول اتقفل ربع ساعة. لو نسيت كلمة السر كلّم Inno Source'


def login_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    nxt = request.POST.get('next') or request.GET.get('next') or ''
    error = ''
    if request.method == 'POST':
        username = (request.POST.get('username') or '').strip()
        ip = client_ip(request)
        if SEC.locked(username, ip):
            error = LOCKED_MSG
        else:
            user = authenticate(request, username=username, password=request.POST.get('password') or '')
            SEC.record(username, ip, ok=user is not None)
            if user is None:
                error = 'اسم الدخول أو كلمة السر غلط'
            elif SEC.enabled(user):
                request.session['pre2fa'] = {'uid': user.pk, 'backend': user.backend, 'next': nxt, 'at': time.time()}
                return redirect('login_verify')
            else:
                login(request, user)
                request.session['mfa'] = False
                S.audit(user, 'login', ip=ip)
                return redirect(_next(request, nxt))
    return render(request, 'licensing/login.html', {'next': nxt, 'error': error})


def verify_view(request):
    pending = request.session.get('pre2fa')
    if not pending or time.time() - pending.get('at', 0) > PENDING_SECONDS:
        request.session.pop('pre2fa', None)
        messages.error(request, 'الوقت خلص — ادخل تاني')
        return redirect('login')
    user = User.objects.filter(pk=pending['uid'], is_active=True).first()
    if user is None:
        request.session.pop('pre2fa', None)
        return redirect('login')
    error = ''
    if request.method == 'POST':
        ip = client_ip(request)
        if SEC.locked(user.username, ip):
            request.session.pop('pre2fa', None)
            messages.error(request, LOCKED_MSG)
            return redirect('login')
        if SEC.verify(user, request.POST.get('code')):
            SEC.record(user.username, ip, ok=True, stage='code')
            request.session.pop('pre2fa', None)
            login(request, user, backend=pending['backend'])
            request.session['mfa'] = True
            S.audit(user, 'login', ip=ip, two_step=True)
            return redirect(_next(request, pending.get('next')))
        SEC.record(user.username, ip, ok=False, stage='code')
        error = 'الكود غلط أو قديم — اكتب الكود اللي ظاهر دلوقتي في التطبيق'
    return render(request, 'licensing/login_verify.html', {'error': error})


class TwoStepMiddleware:
    """Signed-in users whose account has two-step on must have passed it in this session;
    users who are required to use it (staff, or a partner with require_2fa) are sent to set it up."""

    OPEN = ('/security/', '/logout/', '/static/', '/healthz', '/api/', '/login/')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated:
            if SEC.enabled(user) and not request.session.get('mfa'):
                logout(request)
                return redirect(f"{reverse('login')}?{urlencode({'next': request.path})}")
            if not request.path.startswith(self.OPEN) and SEC.required(user) and not SEC.enabled(user):
                messages.warning(request, 'لازم تشغّل التحقق بخطوتين الأول عشان تكمل')
                return redirect('security')
        return self.get_response(request)


@login_required
def security_page(request):
    user = request.user
    s = SEC.sec(user)
    codes = None
    action = request.POST.get('action') if request.method == 'POST' else None
    if action == 'enable' and not s.totp_enabled:
        secret = request.session.get('totp_setup')
        codes = SEC.enable(user, secret, request.POST.get('code')) if secret else None
        if codes:
            request.session.pop('totp_setup', None)
            request.session['mfa'] = True
            S.audit(user, 'two_step_on', ip=client_ip(request))
            messages.success(request, 'التحقق بخطوتين اشتغل ✓ — احفظ أكواد الطوارئ اللي تحت')
            s.refresh_from_db()
        else:
            messages.error(request, 'الكود غلط — تأكد إن وقت الموبايل مظبوط واكتب الكود اللي ظاهر دلوقتي')
    elif action in ('disable', 'recovery') and s.totp_enabled:
        if not SEC.verify(user, request.POST.get('code')):
            messages.error(request, 'الكود غلط')
        elif action == 'recovery':
            codes = SEC.new_recovery_codes(s)
            S.audit(user, 'two_step_recovery_codes', ip=client_ip(request))
            messages.success(request, 'اتعملت أكواد طوارئ جديدة — القديمة مبقتش شغالة')
        elif SEC.required(user):
            messages.error(request, 'حسابك لازم يفضل عليه التحقق بخطوتين')
        else:
            SEC.disable(user)
            request.session['mfa'] = False
            S.audit(user, 'two_step_off', ip=client_ip(request))
            messages.success(request, 'اتقفل التحقق بخطوتين')
            return redirect('security')
    ctx = {'s': s, 'codes': codes, 'required': SEC.required(user), 'remaining': len(s.recovery_codes or []),
           'attempts': LoginAttempt.objects.filter(username__iexact=user.username)[:15]}
    if not s.totp_enabled:
        secret = request.session.get('totp_setup') or SEC.new_secret()
        request.session['totp_setup'] = secret
        uri = SEC.provisioning_uri(secret, user.username)
        ctx.update({'secret': ' '.join(secret[i:i + 4] for i in range(0, len(secret), 4)), 'qr': SEC.qr_svg(uri)})
    if S.is_vendor(user):
        ctx['failed'] = LoginAttempt.objects.filter(ok=False)[:30]
    return render(request, 'licensing/security.html', ctx)


def admin_login(request, extra_context=None):
    """django-admin uses the portal login (with lock-out and two-step)."""
    if request.user.is_authenticated and not request.user.is_staff:
        return redirect('dashboard')
    return redirect(f"{reverse('login')}?{urlencode({'next': request.GET.get('next', '/django-admin/')})}")
