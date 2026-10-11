"""Fills the price list with the suggestions in apps/pos/docs/PRICING-AR.md (only rows that do
not exist yet, unless --replace). Edit them afterwards in the admin → قائمة الأسعار."""
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
        made = 0
        for item, code, days, amount in rows:
            if replace:
                Price.objects.update_or_create(item=item, code=code, days=days, defaults={'amount': Decimal(amount)})
                made += 1
            else:
                _, created = Price.objects.get_or_create(item=item, code=code, days=days, defaults={'amount': Decimal(amount)})
                made += created
        self.stdout.write(self.style.SUCCESS(f'{made} prices written.'))
