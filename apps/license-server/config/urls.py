from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'InnoForge — إدارة التراخيص'
admin.site.site_title = 'InnoForge Licenses'
admin.site.index_title = 'لوحة الإدارة (للتعديل المباشر)'

urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('', include('licensing.urls')),
]
