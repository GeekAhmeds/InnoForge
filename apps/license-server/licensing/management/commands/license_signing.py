"""Server signing key:  init  → make the key, print the public half for Inno Source;
permit <file>  → install the permit Inno Source signed;  status."""
import sys

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from licensing import signing


class Command(BaseCommand):
    help = 'Set up the key this server signs licenses with (init / permit <file> / status)'

    def add_arguments(self, parser):
        parser.add_argument('action', choices=['init', 'permit', 'status', 'public'])
        parser.add_argument('file', nargs='?')
        parser.add_argument('--force', action='store_true')

    def handle(self, action, file=None, force=False, **_):
        settings.KEYS_DIR.mkdir(parents=True, exist_ok=True)
        if action == 'init':
            if settings.SIGNING_KEY_FILE.exists() and not force:
                raise CommandError(f'{settings.SIGNING_KEY_FILE} exists — keys already issued depend on its permit. Use --force to replace.')
            pem, pub = signing.generate_key()
            settings.SIGNING_KEY_FILE.write_bytes(pem)
            settings.SIGNING_KEY_FILE.chmod(0o600)
            settings.SIGNING_PERMIT_FILE.unlink(missing_ok=True)
            self.stdout.write(self.style.SUCCESS('Server key created.'))
            self._explain(pub)
        elif action == 'public':
            self.stdout.write(signing.public_of(settings.SIGNING_KEY_FILE.read_bytes()))
        elif action == 'permit':
            text = (sys.stdin.read() if file in (None, '-') else open(file, encoding='utf-8').read()).strip()
            permit = signing.parse_permit(text)
            if permit.get('pub') != signing.public_of(settings.SIGNING_KEY_FILE.read_bytes()):
                raise CommandError('This permit is for another key.')
            settings.SIGNING_PERMIT_FILE.write_text(text + '\n')
            self.stdout.write(self.style.SUCCESS(f'Permit installed: {permit["id"]} — {permit["name"]}, valid until {permit.get("expires")}'))
        st = signing.status()
        self.stdout.write(f'Ready: {st["ready"]} {st.get("reason", "")}')

    def _explain(self, pub):
        self.stdout.write('\nPublic key (give it to the vendor page → «تصاريح الموزّعين»):\n')
        self.stdout.write(pub + '\n')
        self.stdout.write('Make the permit with: code SERVER (any), name "Inno Source", ALL editions, ALL add-ons,\n'
                          'longest key "من غير حد", no limit caps, valid 2 years. Then:\n'
                          '  python manage.py license_signing permit reseller-SERVER.cert   (or paste it on the /signing/ page)\n')
