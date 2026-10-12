"""Fills the price list with suggested prices — Egyptian pounds from apps/pos/docs/PRICING-AR.md,
plus starting Saudi riyal and UAE dirham prices (only rows that do not exist yet, unless
--replace). Edit them afterwards in the portal → قائمة الأسعار."""
from decimal import Decimal

from django.core.management.base import BaseCommand

from licensing import editions as E
from licensing.models import Price

EDITIONS = {  # yearly, monthly, lifetime
    'basic': (3000, 350, 8000), 'market': (6000, 650, 15000), 'restaurant': (7500, 800, 18000),
    'trading': (9000, 950, 22000), 'full': (14000, 1450, 35000),
}
ADDONS = {'warehouses': (1500, 4000), 'employees': (1500, 4000), 'treasury': (1500, 4000), 'installments': (1500, 4000)}
OTHER_ADDON = (1000, 2500)
LIMITS = {'users': (300, 800), 'warehouses': (500, 1200), 'devices': (1000, 2500)}
# Gulf starting prices (SAR and AED kept equal): yearly, monthly, lifetime.
GULF_EDITIONS = {
    'basic': (899, 99, 2299), 'market': (1499, 159, 3799), 'restaurant': (1799, 189, 4499),
    'trading': (2199, 229, 5499), 'full': (3499, 349, 8499),
}
GULF_ADDON = (399, 999)
GULF_LIMITS = {'users': (99, 249), 'warehouses': (149, 399), 'devices': (299, 749)}


class Command(BaseCommand):
    help = 'Fill the price list with the suggested prices'

    def add_arguments(self, parser):
        parser.add_argument('--replace', action='store_true', help='overwrite existing prices')

    def handle(self, replace=False, **_):
        rows = []
        for code, (year, month, life) in EDITIONS.items():
            rows += [('edition', code, 365, year), ('edition', code, 30, month), ('edition', code, 0, life)]
        for code in E.features():
            year, life = ADDONS.get(code, OTHER_ADDON)
            rows += [('addon', code, 365, year), ('addon', code, 0, life)]
        for code, (year, life) in LIMITS.items():
            rows += [('limit', code, 365, year), ('limit', code, 0, life)]
        rows = [(*r, 'EGP') for r in rows]
        for currency in ('SAR', 'AED'):
            for code, (year, month, life) in GULF_EDITIONS.items():
                rows += [('edition', code, 365, year, currency), ('edition', code, 30, month, currency), ('edition', code, 0, life, currency)]
            for code in E.features():
                rows += [('addon', code, 365, GULF_ADDON[0], currency), ('addon', code, 0, GULF_ADDON[1], currency)]
            for code, (year, life) in GULF_LIMITS.items():
                rows += [('limit', code, 365, year, currency), ('limit', code, 0, life, currency)]
        made = 0
        for item, code, days, amount, currency in rows:
            if replace:
                Price.objects.update_or_create(item=item, code=code, days=days, currency=currency, defaults={'amount': Decimal(amount)})
                made += 1
            else:
                _, created = Price.objects.get_or_create(item=item, code=code, days=days, currency=currency, defaults={'amount': Decimal(amount)})
                made += created
        self.stdout.write(self.style.SUCCESS(f'{made} prices written.'))
