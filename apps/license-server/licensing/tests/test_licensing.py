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
        self.override = override_settings(REQUIRE_2FA_STAFF=False, KEYS_DIR=self.tmp, SIGNING_KEY_FILE=self.tmp / 'server-private.pem', SIGNING_PERMIT_FILE=self.tmp / 'server.cert')
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


class WebsiteLeadTests(Base):
    def test_contact_form_is_saved_and_shown_to_inno_source(self):
        from django.core.cache import cache
        from licensing.models import Lead
        cache.clear()
        post = lambda d: self.client.post('/api/v1/lead', json.dumps(d), content_type='application/json')  # noqa: E731
        self.assertEqual(post({'name': 'أحمد', 'phone': '12'}).status_code, 422)  # phone too short
        r = post({'name': 'أحمد', 'phone': '01000000000', 'business': 'ماركت', 'kind': 'trial', 'message': 'عايز أجرب'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(post({'name': 'bot', 'phone': '01000000000', 'website': 'spam'}).json(), {'ok': True})
        self.assertEqual(Lead.objects.count(), 1)  # the honeypot one is dropped
        lead = Lead.objects.get()
        self.assertEqual(lead.kind, 'trial')
        for _ in range(5):
            post({'name': 'x', 'phone': '01000000000'})
        self.assertEqual(post({'name': 'x', 'phone': '01000000000'}).status_code, 429)
        # Only Inno Source staff see the requests.
        self.client.force_login(self.staff)
        page = self.client.get(reverse('leads'))
        self.assertContains(page, 'عايز أجرب')
        self.client.post(reverse('leads'), {'id': lead.pk, 'status': 'contacted', 'assigned_to': self.agent.pk, 'notes': 'كلمته'})
        lead.refresh_from_db()
        self.assertEqual((lead.status, lead.assigned_to, lead.notes), ('contacted', self.agent, 'كلمته'))
        u = User.objects.create_user('p1', password='z' * 12)
        PartnerUser.objects.create(user=u, partner=self.agent, role=PartnerUser.ROLE_OWNER)
        self.client.force_login(u)
        self.assertEqual(self.client.get(reverse('leads')).status_code, 403)
        self.assertRedirects(self.client.get('/'), reverse('dashboard'), fetch_redirect_response=False)


class DiscountAndSettlementTests(Base):
    def test_special_discount_customer_and_key(self):
        # Customer special discount: applied automatically on top of the partner's discount; Inno Source bears it.
        self.cust.special_discount_percent = Decimal('50')
        self.cust.save()
        self.topup(self.agent, 10000)
        lic = S.issue(self.staff, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=365)
        self.assertEqual((lic.list_price, lic.price, lic.extra_discount_percent), (Decimal('3000'), Decimal('1200'), Decimal('50')))
        # A one-off 90% on a key, set by Inno Source.
        c2 = Customer.objects.create(name='صديق', partner=None)
        lic2 = S.issue(self.staff, partner=None, customer=c2, machine='1111-BBBB-CCCC-DDDD-1234', edition='market', days=365, extra_discount_percent='90')
        self.assertEqual(lic2.price, Decimal('300'))
        with self.assertRaises(S.LicenseError):
            S.issue(self.staff, partner=None, customer=c2, machine='1111-BBBB-CCCC-DDDD-1235', edition='market', days=365, extra_discount_percent='120')

    def test_partner_special_discount_needs_approval(self):
        self.topup(self.agent, 10000)
        u = User.objects.create_user('ag', password='y' * 12)
        PartnerUser.objects.create(user=u, partner=self.agent, role=PartnerUser.ROLE_OWNER)
        with self.assertRaises(S.LicenseError):  # a partner can't give itself a special discount
            S.issue(u, partner=self.agent, customer=self.cust, machine=MACHINE, edition='market', days=365, extra_discount_percent='90')
        self.client.force_login(u)
        q = self.client.get(reverse('quote'), {'edition': 'market', 'days': '365', 'customer': self.cust.pk, 'extra_discount': '90'}).json()
        self.assertTrue(q['needs_approval'])
        self.assertEqual(q['price'], '240.00')
        r = self.client.post(reverse('license_new'), {'customer': self.cust.pk, 'machine': MACHINE, 'edition': 'market', 'days': '365',
                                                      'extra_discount': '90', 'customer_price': '1500'})
        self.assertRedirects(r, reverse('requests'))
        req = LicenseRequest.objects.get()
        self.assertEqual((req.extra_discount_percent, req.customer_price), (Decimal('90'), Decimal('1500')))
        self.assertFalse(License.objects.exists())
        # Inno Source approves but gives 50% instead of 90%.
        self.client.force_login(self.staff)
        r = self.client.post(reverse('request_decide', args=[req.pk, 'approve']), {'extra_discount': '50'})
        lic = License.objects.get()
        self.assertEqual((lic.price, lic.extra_discount_percent, lic.customer_price), (Decimal('1200'), Decimal('50'), Decimal('1500')))
        self.assertEqual(self.agent.balance, Decimal('8800'))
        self.assertContains(self.client.get(reverse('license', args=[lic.pk])), 'خصم خاص 50')

    def test_marketer_commission_payout_and_statement(self):
        marketer = Partner.objects.create(code='M1', name='مسوّق', kind=Partner.KIND_RESELLER, commission_percent=Decimal('10'))
        c = Customer.objects.create(name='مطعم', referred_by=marketer)
        lic = S.issue(self.staff, partner=None, customer=c, machine=MACHINE, edition='market', days=365)
        self.assertEqual(lic.referred_by, marketer)
        self.assertEqual(marketer.balance, Decimal('300'))  # 10% of 3000
        S.payout(self.staff, marketer, Decimal('200'), reference='كاش')
        self.assertEqual(marketer.balance, Decimal('100'))
        with self.assertRaises(S.LicenseError):
            S.payout(self.staff, marketer, Decimal('101'))
        # Refunding the key takes the commission back.
        S.revoke(self.staff, lic, refund=True, note='رجع')
        self.assertEqual(marketer.balance, Decimal('-200'))
        st = S.statement(marketer)
        self.assertEqual((st['opening'], st['closing'], len(st['rows'])), (Decimal('0'), Decimal('-200'), 3))
        later = S.statement(marketer, start=timezone.localdate() + timedelta(days=1))
        self.assertEqual((later['opening'], later['rows']), (Decimal('-200'), []))
        # The seller's own chain never earns a commission on its own sale.
        self.cust.referred_by = self.dist
        self.cust.save()
        self.dist.commission_percent = Decimal('5')
        self.dist.save()
        self.topup(self.agent, 10000)
        S.issue(self.staff, partner=self.agent, customer=self.cust, machine='1111-BBBB-CCCC-DDDD-1234', edition='market', days=365)
        self.assertFalse(Transaction.objects.filter(partner=self.dist, kind=Transaction.KIND_COMMISSION).exists())

    def test_statement_page_and_csv(self):
        self.topup(self.agent, 1000)
        self.client.force_login(self.staff)
        r = self.client.get(reverse('partner_statement', args=[self.agent.pk]))
        self.assertContains(r, 'رصيد آخر المدة')
        csv = self.client.get(reverse('partner_statement', args=[self.agent.pk]), {'export': 'csv'})
        self.assertIn('closing', csv.content.decode())
        self.assertEqual(self.client.get(reverse('wallet')).status_code, 200)
        u = User.objects.create_user('other', password='y' * 12)
        PartnerUser.objects.create(user=u, partner=Partner.objects.create(code='B1', name='b'), role=PartnerUser.ROLE_OWNER)
        self.client.force_login(u)
        self.assertEqual(self.client.get(reverse('partner_statement', args=[self.agent.pk])).status_code, 404)


class LoginSecurityTests(Base):
    def login(self, username, password, **extra):
        return self.client.post(reverse('login'), {'username': username, 'password': password, **extra})

    def test_lockout_after_failed_tries(self):
        for _ in range(5):
            self.assertContains(self.login('admin', 'wrong-password'), 'غلط')
        r = self.login('admin', 'x' * 12)  # the right password, but locked now
        self.assertContains(r, 'اتقفل')
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_two_step_login(self):
        from licensing import security as SEC
        secret = SEC.new_secret()
        codes = SEC.enable(self.staff, secret, SEC.code_now(secret))
        self.assertEqual(len(codes), 8)
        r = self.login('admin', 'x' * 12, next='/licenses/')
        self.assertRedirects(r, reverse('login_verify'))
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertEqual(self.client.get(reverse('licenses')).status_code, 302)
        self.assertContains(self.client.post(reverse('login_verify'), {'code': '000000'}), 'الكود غلط')
        # The code used while enabling can't be used again; a recovery code works once.
        r = self.client.post(reverse('login_verify'), {'code': codes[0]})
        self.assertRedirects(r, '/licenses/')
        self.client.logout()
        self.login('admin', 'x' * 12)
        self.assertContains(self.client.post(reverse('login_verify'), {'code': codes[0]}), 'الكود غلط')
        # force_login (or any other way in) without the code is thrown out.
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('dashboard')).status_code, 302)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_totp_codes(self):
        from licensing import security as SEC
        secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'  # RFC 6238 test key "12345678901234567890"
        self.assertEqual(SEC.code_now(secret, at=59), '287082')
        self.assertEqual(SEC.match_step(secret, '287082', at=59), 1)
        self.assertEqual(SEC.match_step(secret, '287082', at=59 + 30), 1)  # one step of clock drift
        self.assertIsNone(SEC.match_step(secret, '287082', at=59 + 90))
        self.assertIsNone(SEC.match_step(secret, '287082', at=59, last_step=1))  # already used

    @override_settings(REQUIRE_2FA_STAFF=True)
    def test_staff_must_set_up_two_step(self):
        from licensing import security as SEC
        self.client.force_login(self.staff)
        self.assertRedirects(self.client.get(reverse('licenses')), reverse('security'))
        page = self.client.get(reverse('security'))
        self.assertContains(page, '<svg')
        secret = self.client.session['totp_setup']
        r = self.client.post(reverse('security'), {'action': 'enable', 'code': SEC.code_now(secret)})
        self.assertContains(r, 'أكواد الطوارئ')
        self.assertEqual(self.client.get(reverse('licenses')).status_code, 200)
        # Partner users only when their partner requires it.
        u = User.objects.create_user('ag', password='y' * 12)
        PartnerUser.objects.create(user=u, partner=self.agent, role=PartnerUser.ROLE_OWNER)
        self.client.force_login(u)
        self.assertEqual(self.client.get(reverse('licenses')).status_code, 200)
        self.agent.require_2fa = True
        self.agent.save()
        self.assertRedirects(self.client.get(reverse('licenses')), reverse('security'))

    def test_admin_login_goes_through_portal_login_and_reset(self):
        r = self.client.get('/django-admin/')
        self.assertEqual(r.status_code, 302)
        r = self.client.get(r['Location'])
        self.assertTrue(r['Location'].startswith(reverse('login')))
        from licensing import security as SEC
        u = User.objects.create_user('ag', password='y' * 12)
        PartnerUser.objects.create(user=u, partner=self.agent, role=PartnerUser.ROLE_OWNER)
        secret = SEC.new_secret()
        SEC.enable(u, secret, SEC.code_now(secret))
        self.client.force_login(self.staff)
        self.client.post(reverse('partner_user_reset', args=[self.agent.pk, u.pk]), {'what': '2fa'})
        self.assertFalse(SEC.enabled(User.objects.get(pk=u.pk)))
        r = self.client.post(reverse('partner_user_reset', args=[self.agent.pk, u.pk]), {'what': 'password'}, follow=True)
        self.assertContains(r, 'كلمة السر المؤقتة')
        self.assertFalse(User.objects.get(pk=u.pk).check_password('y' * 12))
