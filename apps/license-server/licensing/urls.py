from django.contrib.auth import views as auth_views
from django.urls import path

from . import api, views

urlpatterns = [
    path('login/', auth_views.LoginView.as_view(template_name='licensing/login.html'), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('password/', auth_views.PasswordChangeView.as_view(template_name='licensing/password.html', success_url='/'), name='password'),
    path('', views.dashboard, name='dashboard'),
    path('customers/', views.customers, name='customers'),
    path('customers/new/', views.customer_edit, name='customer_new'),
    path('customers/<int:pk>/', views.customer, name='customer'),
    path('customers/<int:pk>/edit/', views.customer_edit, name='customer_edit'),
    path('licenses/', views.licenses, name='licenses'),
    path('licenses/new/', views.license_new, name='license_new'),
    path('licenses/quote/', views.quote, name='quote'),
    path('licenses/<int:pk>/', views.license_detail, name='license'),
    path('licenses/<int:pk>/key.txt', views.license_key_txt, name='license_key'),
    path('licenses/<int:pk>/<str:action>/', views.license_action, name='license_action'),
    path('requests/', views.requests_list, name='requests'),
    path('requests/<int:pk>/<str:decision>/', views.request_decide, name='request_decide'),
    path('partners/', views.partners, name='partners'),
    path('partners/new/', views.partner_edit, name='partner_new'),
    path('partners/<int:pk>/', views.partner_detail, name='partner'),
    path('partners/<int:pk>/edit/', views.partner_edit, name='partner_edit'),
    path('partners/<int:pk>/users/', views.partner_user_add, name='partner_user_add'),
    path('partners/<int:pk>/users/<int:user_id>/toggle/', views.partner_user_toggle, name='partner_user_toggle'),
    path('partners/<int:pk>/topup/', views.partner_topup, name='partner_topup'),
    path('partners/<int:pk>/transfer/', views.partner_transfer, name='partner_transfer'),
    path('account/', views.my_account, name='account'),
    path('wallet/', views.wallet, name='wallet'),
    path('api-keys/', views.api_keys, name='api_keys'),
    path('signing/', views.signing_page, name='signing'),
    path('audit/', views.audit_log, name='audit'),
    # JSON API for partners' own systems.
    path('api/v1/me', api.me, name='api_me'),
    path('api/v1/quote', api.quote, name='api_quote'),
    path('api/v1/licenses', api.licenses, name='api_licenses'),
    path('api/v1/licenses/<int:pk>/renew', api.renew, name='api_renew'),
    path('healthz', api.health, name='health'),
]
