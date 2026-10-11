"""Signing license keys in the exact format the POS app verifies (apps/pos/electron/license.cjs).

A key is  base64url(json) . base64url(ed25519 signature) . <permit>
where <permit> is the server's certificate signed by Inno Source's offline vendor key
(a "reseller" permit with id/name, the server's public key and what it may issue).
The app checks the vendor signature on the permit, then the server's signature on the key.
"""
import base64
import json
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.conf import settings


class SigningNotReady(Exception):
    pass


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def js_json(obj) -> bytes:
    """JSON.stringify(obj) byte for byte (no spaces, non-ASCII kept as is)."""
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def js_iso(dt: datetime) -> str:
    """Date.prototype.toISOString(): 2026-10-11T17:31:04.123Z"""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{dt.microsecond // 1000:03d}Z'


def normalize_machine(machine: str) -> str:
    hexes = ''.join(c for c in str(machine or '').upper() if c in '0123456789ABCDEF')
    return '-'.join(hexes[i:i + 4] for i in range(0, len(hexes), 4)) if len(hexes) == 20 else ''


def generate_key():
    """New server key pair → (private PEM, public SPKI DER base64 — what the vendor certifies)."""
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return pem, base64.b64encode(pub).decode()


def public_of(private_pem: bytes) -> str:
    key = serialization.load_pem_private_key(private_pem, password=None)
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(pub).decode()


def parse_permit(text: str) -> dict:
    text = text.strip()
    parts = text.split('.')
    if len(parts) != 2:
        raise ValueError('not a permit')
    payload = json.loads(unb64url(parts[0]))
    if payload.get('type') != 'reseller':
        raise ValueError('not a permit')
    return payload


def load():
    """(private key, permit text, permit payload) — raises SigningNotReady with the reason."""
    if not settings.SIGNING_KEY_FILE.exists():
        raise SigningNotReady('no-key')
    if not settings.SIGNING_PERMIT_FILE.exists():
        raise SigningNotReady('no-permit')
    pem = settings.SIGNING_KEY_FILE.read_bytes()
    permit_text = settings.SIGNING_PERMIT_FILE.read_text().strip()
    permit = parse_permit(permit_text)
    if permit.get('pub') != public_of(pem):
        raise SigningNotReady('permit-mismatch')
    return serialization.load_pem_private_key(pem, password=None), permit_text, permit


def status():
    try:
        _, _, permit = load()
    except SigningNotReady as err:
        return {'ready': False, 'reason': str(err)}
    except Exception as err:  # unreadable files
        return {'ready': False, 'reason': f'error: {err}'}
    expired = bool(permit.get('expires')) and datetime.fromisoformat(permit['expires'].replace('Z', '+00:00')) < datetime.now(timezone.utc)
    return {'ready': not expired, 'reason': 'permit-expired' if expired else '', 'permit': permit}


def sign_license(payload: dict) -> str:
    """payload already has product, machine, customer, issued, expires, edition, … reseller."""
    key, permit_text, permit = load()
    if payload.get('reseller') != permit['id']:
        raise ValueError('payload.reseller must be the permit id')
    body = js_json(payload)
    return f'{b64url(body)}.{b64url(key.sign(body))}.{permit_text}'
