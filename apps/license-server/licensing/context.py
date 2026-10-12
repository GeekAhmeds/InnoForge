from django.conf import settings

from . import services as S
from .models import Lead, LicenseRequest


def portal(request):
    user = getattr(request, 'user', None)
    if not user or not user.is_authenticated:
        return {}
    me = S.partner_of(user)
    vendor = S.is_vendor(user)
    pending = new_leads = 0
    if vendor:
        pending = LicenseRequest.objects.filter(status=LicenseRequest.STATUS_PENDING).count()
        new_leads = Lead.objects.filter(status='new').count()
    link = getattr(user, 'partner_link', None)
    return {'me': me, 'is_vendor': vendor, 'pending_requests_nav': pending, 'new_leads_nav': new_leads, 'currency': settings.CURRENCY,
            'is_owner': vendor or (link is not None and link.role == 'owner')}
