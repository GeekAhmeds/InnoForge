"""License server: keys the POS app accepts, partner rules, prices and wallet, renew/upgrade/
transfer, requests, the API and who can see what."""
import json
import shutil
import subprocess
import tempfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from licensing import services as S
from licensing import signing
from licensing.models import Customer, License, LicenseRequest, Partner, PartnerUser, Price, Transaction

POS = Path(settings.BASE_DIR).parent / 'pos'
NODE = shutil.which('node')
MACHINE = 'AAAA-BBBB-CCCC-DDDD-1234'
User = get_user_model()


def vendor_permit(vendor_key, server_pub, **over):
    """What the vendor page «تصاريح الموزّعين» produces, signed with a test vendor key."""
    now = timezone.now()
    payload = {'type': 'reseller', 'id': 'SERVER', 'name': 'Inno Source', 'phone': '', 'pub': server_pub, 'editions': '*', 'addons': '*',
               'max_days': 0, 'max_limits': {}, 'issued': signing.js_iso(now - timedelta(minutes=1)), 'expires': signing.js_iso(now + timedelta(days=730))}
    payload.update(over)
    body = signing.js_json(payload)
    return f'{signing.b64url(body)}.{signing.b64url(vendor_key.sign(body))}'


def node_verify(key, vendor_pub_pem, machine=MACHINE):
    """Runs the POS app's own verifyLicense() on the key."""
    script = ("const {verifyLicense}=require(process.argv[1]);const r=verifyLicense(process.argv[2],{machine:process.argv[3],publicKeyPem:process.argv[4]});"
              "console.log(JSON.stringify({valid:r.valid,reason:r.reason||null,edition:r.payload&&r.payload.edition,addons:r.payload&&r.payload.addons,"
              "seller:r.payload&&r.payload.seller,reseller:r.reseller&&r.reseller.name}))")
    out = subprocess.run([NODE, '-e', script, str(POS / 'electron' / 'license.cjs'), key, machine, vendor_pub_pem], capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


class Base(TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.override = override_settings(KEYS_DIR=self.tmp, SIGNING_KEY_FILE=self.tmp / 'server-private.pem', SIGNING_PERMIT_FILE=self.tmp / 'server.cert')
        self.override.enable()
        self.vendor_key = Ed25519PrivateKey.generate()
        self.vendor_pub_pem = self.vendor_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        pem, pub = signing.generate_key()
        settings.SIGNING_KEY_FILE.write_bytes(pem)
        settings.SIGNING_PERMIT_FILE.write_text(vendor_permit(self.vendor_key, pub))
        self.server_pub = pub
        self.staff = User.objects.create_user('admin', password='x' * 12, is_staff=True)
        self.dist = Partner.objects.create(code='D1', name='موزّع القاهرة', kind=Partner.KIND_DISTRIBUTOR, allowed_editions=['basic', 'market', 'restaurant'],
                                           allowed_addons=['eta', 'warehouses'], max_days=365, max_limits={'devices': 5}, discount_percent=Decimal('30'),
                                           can_manage_children=True)
        self.agent = Partner.objects.create(code='A1', name='وكيل مدينة نصر', parent=self.dist, allowed_editions=['market'], allowed_addons=['eta'],
                                            max_days=365, max_limits={'devices': 3}, discount_percent=Decimal('20'))
        Price.objects.create(item='edition', code='market', days=365, amount=Decimal('3000'))
        Price.objects.create(item='edition', code='basic', days=365, amount=Decimal('1500'))
        Price.objects.create(item='addon', code='eta', days=365, amount=Decimal('1000'))
        Price.objects.create(item='limit', code='devices', days=365, amount=Decimal('500'))
        self.cust = Customer.objects.create(name='سوبر ماركت النور', phone='0100', partner=self.agent)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def topup(self, partner, amount):
        S.topup(self.staff, partner, Decimal(amount))


class SigningTests(Base):
    def test_server_key_is_accepted_by_the_pos_app(self):
        self.topup(self.agent, 10000)
        lic = S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE.lower().replace('-', ''), edition='market', addons=['eta'], days=365)
        self.assertEqual(lic.machine, MACHINE)
        payload = json.loads(signing.unb64url(lic.key.split('.')[0]))
        self.assertEqual(payload['reseller'], 'SERVER')
        self.assertEqual(payload['seller'], {'code': 'A1', 'name': 'وكيل مدينة نصر', 'phone': ''})
        self.assertRegex(payload['issued'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        if NODE:
            r = node_verify(lic.key, self.vendor_pub_pem)
            self.assertTrue(r['valid'], r)
            self.assertEqual(r['edition'], 'market')
            self.assertEqual(r['addons'], ['eta'])
            self.assertEqual(r['reseller'], 'Inno Source')
            self.assertEqual(r['seller']['code'], 'A1')
            self.assertEqual(node_verify(lic.key, self.vendor_pub_pem, machine='FFFF-BBBB-CCCC-DDDD-1234')['reason'], 'WRONG_MACHINE')
            # Another vendor's key does not accept it.
            other = Ed25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
            self.assertEqual(node_verify(lic.key, other)['reason'], 'BAD_SIGNATURE')

    def test_not_ready_without_permit_or_with_a_foreign_permit(self):
        settings.SIGNING_PERMIT_FILE.unlink()
        self.assertEqual(signing.status()['reason'], 'no-permit')
        with self.assertRaisesMessage(S.LicenseError, 'مش جاهز'):
            S.issue(self.staff, partner=None, customer=self.cust, machine=MACHINE, edition='market', days=30)
        _, other_pub = signing.generate_key()
        settings.SIGNING_PERMIT_FILE.write_text(vendor_permit(self.vendor_key, other_pub))
        self.assertEqual(signing.status()['reason'], 'permit-mismatch')

    def test_a_narrow_server_permit_is_respected(self):
        settings.SIGNING_PERMIT_FILE.write_text(vendor_permit(self.vendor_key, self.server_pub, max_days=365))
        with self.assertRaisesMessage(S.LicenseError, 'مدى الحياة'):
            S.issue(self.staff, partner=None, customer=self.cust, machine=MACHINE, edition='full', days=0)
        lic = S.issue(self.staff, partner=None, customer=self.cust, machine=MACHINE, edition='full', days=365)
        if NODE:
            self.assertTrue(node_verify(lic.key, self.vendor_pub_pem)['valid'])
        payload = json.loads(signing.unb64url(lic.key.split('.')[0]))
        self.assertNotIn('seller', payload)  # sold by Inno Source directly


class RulesAndMoneyTests(Base):
    def test_partner_rules_are_narrowed_by_the_parent(self):
        r = S.rules(self.agent)
        self.assertEqual(r['editions'], ['market'])
        self.assertEqual(r['addons'], ['eta'])
        self.assertEqual(r['max_limits'], {'devices': 3})
        self.topup(self.agent, 100000)
        for kwargs, msg in [
            ({'edition': 'restaurant'}, 'مش مسموحة'),
            ({'edition': 'market', 'addons': ['warehouses']}, 'مش مسموحة'),
            ({'edition': 'market', 'days': 0}, 'أقصى مدة'),
            ({'edition': 'market', 'limits': {'devices': 4}}, 'أقصى حاجة'),
        ]:
            with self.subTest(kwargs=kwargs), self.assertRaisesMessage(S.LicenseError, msg):
                S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, **{'days': 365, **kwargs})
        self.dist.active = False
        self.dist.save()
        with self.assertRaisesMessage(S.LicenseError, 'موقوف'):
            S.rules(self.agent)
        # A distributor cannot give an agent more than it has.
        with self.assertRaises(S.LicenseError):
            S.check_subpartner_rules(self.agent, {'allowed_editions': ['full'], 'allowed_addons': [], 'max_days': 30, 'max_limits': {'devices': 2}})

    def test_prices_discounts_balance_and_credit(self):
        list_price, price = S.quote('market', ['eta'], {'devices': 4}, 365, self.dist)
        self.assertEqual(list_price, Decimal('4500.00'))  # 3000 + 1000 + 1 extra computer × 500
        self.assertEqual(price, Decimal('3150.00'))  # −30%
        self.assertEqual(S.quote('market', [], {}, 30, self.agent), (Decimal('246.58'), Decimal('197.26')))  # pro rata
        with self.assertRaisesMessage(S.LicenseError, 'رصيدك مش كفاية'):
            S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=365)
        self.agent.credit_limit = Decimal('2400')
        self.agent.save()
        lic = S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=365)
        self.assertEqual(lic.price, Decimal('2400.00'))
        self.assertEqual(self.agent.balance, Decimal('-2400.00'))
        self.assertEqual(Transaction.objects.get(license=lic).amount, Decimal('-2400.00'))
        S.revoke(self.staff, lic, refund=True, note='test')
        self.assertEqual(self.agent.balance, Decimal('0'))
        self.assertEqual(License.objects.get(pk=lic.pk).status, License.STATUS_REVOKED)

    def test_trial_once_per_machine_and_free(self):
        lic = S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=14, kind=License.KIND_TRIAL)
        self.assertEqual(lic.price, 0)
        with self.assertRaisesMessage(S.LicenseError, 'تجربة قبل كده'):
            S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=14, kind=License.KIND_TRIAL)
        with self.assertRaisesMessage(S.LicenseError, '14'):
            S.issue(None, partner=self.agent, customer=self.cust, machine='1111-BBBB-CCCC-DDDD-1234', edition='market', days=30, kind=License.KIND_TRIAL)

    def test_renew_upgrade_transfer(self):
        self.topup(self.agent, 100000)
        lic = S.issue(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=90)
        renewed = S.renew(None, lic, 365, partner=self.agent)
        self.assertEqual(renewed.kind, License.KIND_RENEWAL)
        self.assertAlmostEqual((renewed.expires_at - lic.expires_at).total_seconds(), 365 * 86400, delta=5)
        self.assertEqual(License.objects.get(pk=lic.pk).status, License.STATUS_REPLACED)
        before = self.agent.balance
        up = S.upgrade(None, renewed, partner=self.agent, edition='market', addons=['eta'], limits={})
        self.assertEqual(up.expires_at, renewed.expires_at)
        self.assertEqual(up.addons, ['eta'])
        self.assertGreater(up.price, 0)
        self.assertEqual(self.agent.balance, before - up.price)
        moved = S.transfer(None, up, '9999-BBBB-CCCC-DDDD-1234', partner=self.agent)
        self.assertEqual(moved.machine, '9999-BBBB-CCCC-DDDD-1234')
        self.assertEqual(moved.price, 0)
        self.assertEqual(moved.expires_at, up.expires_at)
        with self.assertRaisesMessage(S.LicenseError, 'الشغال'):
            S.transfer(None, up, '8888-BBBB-CCCC-DDDD-1234', partner=self.agent)
        if NODE:
            self.assertTrue(node_verify(moved.key, self.vendor_pub_pem, machine='9999-BBBB-CCCC-DDDD-1234')['valid'])

    def test_balance_transfer_to_own_agents_only(self):
        self.topup(self.dist, 1000)
        S.transfer_balance(None, self.dist, self.agent, Decimal('400'))
        self.assertEqual(self.dist.balance, Decimal('600'))
        self.assertEqual(self.agent.balance, Decimal('400'))
        other = Partner.objects.create(code='X', name='x')
        with self.assertRaisesMessage(S.LicenseError, 'لوكلائك'):
            S.transfer_balance(None, self.dist, other, Decimal('1'))
        with self.assertRaisesMessage(S.LicenseError, 'مش كفاية'):
            S.transfer_balance(None, self.dist, self.agent, Decimal('601'))

    def test_requests_need_approval(self):
        self.agent.can_issue_directly = False
        self.agent.save()
        self.topup(self.agent, 10000)
        req = S.create_request(None, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', addons=[], limits={}, days=365)
        self.assertEqual(req.status, LicenseRequest.STATUS_PENDING)
        lic = S.approve_request(self.staff, req)
        self.assertEqual(lic.partner, self.agent)
        self.assertEqual(LicenseRequest.objects.get(pk=req.pk).status, LicenseRequest.STATUS_APPROVED)
        with self.assertRaises(S.LicenseError):
            S.approve_request(self.staff, req)


class PortalAndApiTests(Base):
    def login_partner(self, partner, username='agent1'):
        u = User.objects.create_user(username, password='y' * 12)
        PartnerUser.objects.create(user=u, partner=partner, role=PartnerUser.ROLE_OWNER)
        self.client.force_login(u)
        return u

    def test_portal_issue_and_scopes(self):
        self.topup(self.agent, 10000)
        self.login_partner(self.agent)
        r = self.client.get(reverse('license_new'))
        self.assertContains(r, 'مفتاح تفعيل جديد')
        self.assertNotContains(r, '<option value="restaurant"')  # only what the agent may sell
        q = self.client.get(reverse('quote'), {'edition': 'market', 'days': '365'}).json()
        self.assertEqual(q['price'], '2400.00')
        r = self.client.post(reverse('license_new'), {'customer': 'new', 'new_name': 'مكتبة الأمل', 'new_phone': '0111', 'machine': MACHINE,
                                                      'edition': 'market', 'days': '365', 'addons': ['eta']})
        lic = License.objects.get(customer__name='مكتبة الأمل')
        self.assertRedirects(r, reverse('license', args=[lic.pk]))
        self.assertEqual(lic.customer.partner, self.agent)
        self.assertContains(self.client.get(reverse('license', args=[lic.pk])), lic.key)
        # Another partner's license is invisible.
        other = Partner.objects.create(code='B1', name='b')
        oc = Customer.objects.create(name='c', partner=other)
        olic = S.issue(self.staff, partner=None, customer=oc, machine='1111-BBBB-CCCC-DDDD-1234', edition='basic', days=30)
        self.assertEqual(self.client.get(reverse('license', args=[olic.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse('signing')).status_code, 403)
        self.assertEqual(self.client.post(reverse('partner_topup', args=[self.agent.pk]), {'amount': '99999'}).status_code, 403)

    def test_vendor_pages(self):
        self.client.force_login(self.staff)
        for name in ('dashboard', 'licenses', 'customers', 'partners', 'requests', 'wallet', 'signing', 'audit', 'license_new'):
            self.assertEqual(self.client.get(reverse(name)).status_code, 200, name)
        self.assertContains(self.client.get(reverse('signing')), 'جاهز يوقّع')
        r = self.client.post(reverse('partner_topup', args=[self.agent.pk]), {'amount': '500', 'reference': 'TRX-1'})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.agent.balance, Decimal('500'))
        self.assertEqual(self.client.get(reverse('partner', args=[self.agent.pk])).status_code, 200)

    def test_api(self):
        self.topup(self.agent, 10000)
        raw = S.create_api_key(None, self.agent, 'site')
        h = {'HTTP_AUTHORIZATION': f'Bearer {raw}'}
        self.assertEqual(self.client.get('/api/v1/me').status_code, 401)
        me = self.client.get('/api/v1/me', **h).json()
        self.assertEqual(me['partner']['code'], 'A1')
        r = self.client.post('/api/v1/licenses', json.dumps({'customer': {'name': 'API Shop', 'phone': '012'}, 'machine': MACHINE, 'edition': 'market', 'days': 365}),
                             content_type='application/json', **h)
        self.assertEqual(r.status_code, 201, r.content)
        key = r.json()['license']['key']
        if NODE:
            self.assertTrue(node_verify(key, self.vendor_pub_pem)['valid'])
        r = self.client.post('/api/v1/licenses', json.dumps({'customer': {'name': 'x'}, 'machine': MACHINE, 'edition': 'restaurant', 'days': 365}),
                             content_type='application/json', **h)
        self.assertEqual(r.status_code, 422)
        self.assertEqual(len(self.client.get(f'/api/v1/licenses?machine={MACHINE}', **h).json()['licenses']), 1)
