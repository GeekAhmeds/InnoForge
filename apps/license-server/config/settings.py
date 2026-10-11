"""InnoForge License Server — settings from environment variables (see .env.example)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
env = os.environ.get


def env_bool(name, default=False):
    return str(env(name, '1' if default else '0')).lower() in ('1', 'true', 'yes', 'on')


DEBUG = env_bool('DJANGO_DEBUG', False)
SECRET_KEY = env('DJANGO_SECRET_KEY') or ('dev-only-not-secret' if DEBUG or env('DJANGO_TESTING') else None)
if not SECRET_KEY:
    raise RuntimeError('Set DJANGO_SECRET_KEY (see .env.example)')
ALLOWED_HOSTS = [h.strip() for h in env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',') if o.strip()]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.humanize',
    'licensing',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
        'licensing.context.portal',
    ]},
}]
WSGI_APPLICATION = 'config.wsgi.application'

# PostgreSQL in production (docker-compose); SQLite for development and tests.
if env('POSTGRES_DB'):
    DATABASES = {'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('POSTGRES_DB'),
        'USER': env('POSTGRES_USER', 'postgres'),
        'PASSWORD': env('POSTGRES_PASSWORD', ''),
        'HOST': env('POSTGRES_HOST', 'db'),
        'PORT': env('POSTGRES_PORT', '5432'),
    }}
else:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': env('SQLITE_PATH', str(BASE_DIR / 'db.sqlite3'))}}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]
LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'dashboard'
LOGOUT_REDIRECT_URL = 'login'

LANGUAGE_CODE = 'ar'
LANGUAGES = [('ar', 'العربية'), ('en', 'English')]
TIME_ZONE = env('TIME_ZONE', 'Africa/Cairo')
USE_I18N = True
USE_TZ = True

STATIC_URL = env('STATIC_URL', '/static/')
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage' if not DEBUG and not env('DJANGO_TESTING') else 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}

# Behind nginx with HTTPS.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = env_bool('SECURE_COOKIES', True)
    CSRF_COOKIE_SECURE = env_bool('SECURE_COOKIES', True)
SESSION_COOKIE_AGE = 12 * 3600
X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True

# ---- Licensing ----
# The server signs keys with ITS OWN key, certified by Inno Source's offline vendor key
# (a reseller-style permit). The vendor key never lives on this server.
KEYS_DIR = Path(env('LICENSE_KEYS_DIR', str(BASE_DIR / 'keys')))
SIGNING_KEY_FILE = KEYS_DIR / 'server-private.pem'
SIGNING_PERMIT_FILE = KEYS_DIR / 'server.cert'
# The same editions.json the POS app ships (copied into the image at build time).
EDITIONS_FILE = Path(env('EDITIONS_FILE', str(BASE_DIR.parent / 'pos' / 'electron' / 'editions.json')))
CURRENCY = env('CURRENCY', 'ج.م')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', 'INFO')},
}
