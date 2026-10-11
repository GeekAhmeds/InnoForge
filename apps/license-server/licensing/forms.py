from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

from . import editions as E
from . import services as S
from .models import Customer, Partner, PartnerUser


class CustomerForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = ['name', 'contact', 'phone', 'email', 'city', 'activity', 'tax_number', 'partner', 'notes']
        widgets = {'notes': forms.Textarea(attrs={'rows': 3})}

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['partner'].queryset = S.visible_partners(user)
        self.fields['partner'].required = False
        me = S.partner_of(user)
        if me is not None and not me.children.exists():
            del self.fields['partner']  # a partner without agents: always its own customer
        else:
            self.fields['partner'].empty_label = 'Inno Source مباشرة' if me is None else f'{me.code} (أنا)'


def _codes(post_value, universe):
    vals = [v for v in post_value if v]
    return ['*'] if '*' in vals else [v for v in vals if v in universe]


class PartnerForm(forms.ModelForm):
    """Editions / add-ons / limits come from checkboxes and number fields (see the template)."""

    class Meta:
        model = Partner
        fields = ['code', 'name', 'kind', 'parent', 'phone', 'email', 'city', 'address', 'active', 'max_days', 'can_issue_directly',
                  'can_manage_children', 'allow_trials', 'discount_percent', 'credit_limit', 'notes']
        widgets = {'notes': forms.Textarea(attrs={'rows': 3})}

    def __init__(self, *args, parent=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.parent_partner = parent
        if parent is not None:
            # A distributor manages its own agents: no money terms, no parent choice.
            for f in ('parent', 'discount_percent', 'credit_limit', 'can_manage_children'):
                self.fields.pop(f, None)
            self.fields['kind'].choices = [c for c in Partner.KINDS if c[0] != Partner.KIND_DISTRIBUTOR]
        else:
            self.fields['parent'].required = False
            if self.instance.pk:
                self.fields['parent'].queryset = Partner.objects.exclude(pk__in=self.instance.scope_ids())

    def clean(self):
        data = super().clean()
        post = self.data
        data['allowed_editions'] = _codes(post.getlist('allowed_editions'), E.editions())
        data['allowed_addons'] = _codes(post.getlist('allowed_addons'), E.features())
        if not data['allowed_editions']:
            raise forms.ValidationError('اختار باقة واحدة على الأقل')
        caps = {}
        for k in E.limit_kinds():
            v = (post.get(f'cap_{k}') or '').strip()
            if v:
                if not v.isdigit() or int(v) < 1:
                    raise forms.ValidationError('الحدود لازم تكون أرقام من 1 وطالع')
                caps[k] = int(v)
        data['max_limits'] = caps
        return data

    def save(self, commit=True):
        obj = super().save(commit=False)
        obj.allowed_editions = self.cleaned_data['allowed_editions']
        obj.allowed_addons = self.cleaned_data['allowed_addons']
        obj.max_limits = self.cleaned_data['max_limits']
        if commit:
            obj.save()
        return obj


class PartnerUserForm(forms.Form):
    full_name = forms.CharField(label='الاسم', max_length=100, required=False)
    username = forms.CharField(label='اسم الدخول', max_length=60)
    email = forms.EmailField(label='الإيميل', required=False)
    password = forms.CharField(label='كلمة السر', widget=forms.PasswordInput, min_length=10)
    role = forms.ChoiceField(label='الدور', choices=PartnerUser.ROLES, initial=PartnerUser.ROLE_STAFF)

    def clean_username(self):
        u = self.cleaned_data['username'].strip()
        if get_user_model().objects.filter(username__iexact=u).exists():
            raise forms.ValidationError('اسم الدخول ده موجود')
        return u

    def clean_password(self):
        pw = self.cleaned_data['password']
        validate_password(pw)
        return pw
