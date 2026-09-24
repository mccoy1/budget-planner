"""Read-only-ish admin. The token is never shown, only whether one is stored."""
from django.contrib import admin

from .models import AnchoredCategory, ScenarioAnchor, YnabConnection


@admin.register(YnabConnection)
class YnabConnectionAdmin(admin.ModelAdmin):
    list_display = ('user', 'plan_name', 'last_synced_at', 'last_used_at', 'has_error')
    readonly_fields = ('user', 'token_encrypted', 'created_at')
    exclude = ()

    @admin.display(boolean=True, description='error')
    def has_error(self, obj):
        return bool(obj.last_error)


class AnchoredCategoryInline(admin.TabularInline):
    model = AnchoredCategory
    extra = 0


@admin.register(ScenarioAnchor)
class ScenarioAnchorAdmin(admin.ModelAdmin):
    list_display = ('scenario', 'month', 'last_pulled_at')
    list_filter = ('month',)
    search_fields = ('scenario__name', 'scenario__owner__email')
    inlines = [AnchoredCategoryInline]
