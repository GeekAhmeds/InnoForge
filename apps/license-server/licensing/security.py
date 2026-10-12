"""Login protection: two-step codes (TOTP, RFC 6238 — Google Authenticator / Microsoft
Authenticator / Authy), recovery codes, and lock-out after repeated failed tries."""
import base64
import hashlib
import hmac
import io
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone

from .models import LoginAttempt, UserSecurity

STEP = 30
DIGITS = 6
ISSUER = 'InnoForge (Inno Source)'


# ---------------------------------------------------------------- TOTP
def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def _code_at(secret, step):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    n = struct.unpack('>I', digest[off:off + 4])[0] & 0x7FFFFFFF
    return str(n % 10 ** DIGITS).zfill(DIGITS)


def code_now(secret, at=None):
    return _code_at(secret, int((at or time.time()) // STEP))


def match_step(secret, code, at=None, last_step=0):
    """The time step the code belongs to (now ±1 step for clock drift), or None. A step at or
    before last_step was already used and is refused (a code works once)."""
    code = ''.join(ch for ch in str(code or '') if ch.isdigit())
    if len(code) != DIGITS or not secret:
        return None
    now = int((at or time.time()) // STEP)
    for step in (now, now - 1, now + 1):
        if step > last_step and hmac.compare_digest(_code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret, username):
    label = quote(f'{ISSUER}:{username}')
    return f'otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&digits={DIGITS}&period={STEP}'


def qr_svg(text):
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


# ---------------------------------------------------------------- per user
def sec(user):
    obj, _ = UserSecurity.objects.get_or_create(user=user)
    return obj


def enabled(user):
    s = getattr(user, 'security', None) if user and user.pk else None
    try:
        return bool(s and s.totp_enabled)
    except UserSecurity.DoesNotExist:
        return False


def required(user):
    """Inno Source staff always (unless switched off in settings); partner users when their
    partner has require_2fa on."""
    if not user or not user.is_authenticated:
        return False
    link = getattr(user, 'partner_link', None)
    if link is not None:
        return bool(link.partner.require_2fa)
    return user.is_staff and getattr(settings, 'REQUIRE_2FA_STAFF', True)


def _hash(code):
    return hashlib.sha256(code.replace('-', '').replace(' ', '').lower().encode()).hexdigest()


def new_recovery_codes(s, count=8):
    codes = [f'{secrets.token_hex(3)}-{secrets.token_hex(3)}' for _ in range(count)]
    s.recovery_codes = [_hash(c) for c in codes]
    s.save(update_fields=['recovery_codes'])
    return codes


def enable(user, secret, code):
    """Turns two-step on once the user typed a right code from the app. Returns the recovery codes."""
    step = match_step(secret, code)
    if step is None:
        return None
    s = sec(user)
    s.totp_secret, s.totp_enabled, s.totp_last_step, s.enabled_at = secret, True, step, timezone.now()
    s.save()
    return new_recovery_codes(s)


def disable(user):
    UserSecurity.objects.filter(user=user).update(totp_enabled=False, totp_secret='', recovery_codes=[], totp_last_step=0, enabled_at=None)


def verify(user, code):
    """An app code or a recovery code (each recovery code works once)."""
    s = sec(user)
    if not s.totp_enabled:
        return False
    step = match_step(s.totp_secret, code, last_step=s.totp_last_step)
    if step is not None:
        UserSecurity.objects.filter(pk=s.pk).update(totp_last_step=step)
        return True
    h = _hash(str(code or ''))
    if h in (s.recovery_codes or []):
        s.recovery_codes = [x for x in s.recovery_codes if x != h]
        s.save(update_fields=['recovery_codes'])
        return True
    return False


# ---------------------------------------------------------------- lock-out
MAX_FAILS_USER = 5     # per user name in the window
MAX_FAILS_IP = 20      # per address in the window (many user names)
WINDOW = timedelta(minutes=15)


def locked(username, ip):
    since = timezone.now() - WINDOW
    fails = LoginAttempt.objects.filter(ok=False, at__gte=since)
    return (fails.filter(username__iexact=username).count() >= MAX_FAILS_USER
            or (ip and fails.filter(ip=ip).count() >= MAX_FAILS_IP))


def record(username, ip, ok, stage='password'):
    LoginAttempt.objects.create(username=(username or '')[:150], ip=ip or None, ok=ok, stage=stage)
    # keep the table small: 90 days are enough to look back
    if secrets.randbelow(200) == 0:
        LoginAttempt.objects.filter(at__lt=timezone.now() - timedelta(days=90)).delete()
