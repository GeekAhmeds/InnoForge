"""Django admin: direct editing for Inno Source staff (the portal is the everyday tool)."""
from django.contrib import admin

from .models import ApiKey, Lead, AuditLog, Customer, License, LicenseRequest, Partner, PartnerUser, Price, Transaction


class PartnerUserInline(admin.TabularInline):
    model = PartnerUser
    extra = 0


@admin.register(Partner)
class PartnerAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'kind', 'parent', 'phone', 'active', 'discount_percent', 'can_issue_directly')
    list_filter = ('kind', 'active', 'can_issue_directly')
    search_fields = ('code', 'name', 'phone')
    inlines = [PartnerUserInline]


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('name', 'phone', 'city', 'partner', 'created_at')
    search_fields = ('name', 'phone')
    list_filter = ('partner',)


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = ('customer', 'machine', 'edition', 'kind', 'partner', 'issued_at', 'expires_at', 'status', 'price')
    list_filter = ('status', 'kind', 'edition', 'partner')
    search_fields = ('machine', 'customer__name')
    readonly_fields = ('key', 'issued_at', 'issued_by')

    def has_add_permission(self, request):
        return False  # keys are signed through the portal only


@admin.register(Price)
class PriceAdmin(admin.ModelAdmin):
    list_display = ('item', 'code', 'days', 'amount')
    list_editable = ('amount',)
    list_filter = ('item',)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'partner', 'kind', 'amount', 'reference', 'note')
    list_filter = ('kind', 'partner')

    def has_change_permission(self, request, obj=None):
        return False  # the ledger is append-only

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(LicenseRequest)
admin.site.register(AuditLog)
admin.site.register(ApiKey)


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'name', 'phone', 'business', 'city', 'kind', 'status', 'assigned_to')
    list_filter = ('status', 'kind')
    search_fields = ('name', 'phone', 'business')
