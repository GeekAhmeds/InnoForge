from django.contrib import admin
from django.urls import include, path

from licensing.auth import admin_login

admin.site.site_header = 'InnoForge — إدارة التراخيص'
admin.site.site_title = 'InnoForge Licenses'
admin.site.index_title = 'لوحة الإدارة (للتعديل المباشر)'
admin.site.login = admin_login  # one login page for everything (lock-out + two-step)

urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('', include('licensing.urls')),
]
