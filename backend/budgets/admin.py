from django.contrib import admin

from .models import Prefs, Scenario


@admin.register(Scenario)
class ScenarioAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'version', 'updated_at')
    list_filter = ('owner',)
    search_fields = ('name', 'owner__email')
    readonly_fields = ('id', 'version', 'created_at', 'updated_at')


@admin.register(Prefs)
class PrefsAdmin(admin.ModelAdmin):
    list_display = ('user', 'active_scenario')
