"""The admin is how accounts get created: signup is invite-only.

Create a user here with a temporary password, send it to them, and they change
it from the planner's menu.
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import AdminUserCreationForm, UserChangeForm

from .models import User


class UserCreationForm(AdminUserCreationForm):
    class Meta:
        model = User
        fields = ('email',)


class UserEditForm(UserChangeForm):
    class Meta:
        model = User
        fields = '__all__'


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserEditForm
    add_form = UserCreationForm

    ordering = ('email',)
    list_display = ('email', 'first_name', 'last_name', 'is_active', 'is_staff', 'last_login')
    search_fields = ('email', 'first_name', 'last_name')

    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Name', {'fields': ('first_name', 'last_name')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'usable_password', 'password1', 'password2'),
        }),
    )
