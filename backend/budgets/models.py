import uuid

from django.conf import settings
from django.db import models


class ScenarioQuerySet(models.QuerySet):
    def for_user(self, user):
        """Every scenario `user` may see. The one place access is decided.

        Today that is the scenarios they own. Sharing a scenario with another
        account extends this filter and nothing else.
        """
        return self.filter(owner=user)


class Scenario(models.Model):
    """One budget. `data` is the frontend's `state` object, stored as-is."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='scenarios'
    )
    name = models.CharField(max_length=100)
    data = models.JSONField()
    # Bumped on every write. A PATCH must send the version it read, so an edit
    # made from a stale copy (another tab, another device) is refused instead
    # of silently overwriting the newer one.
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ScenarioQuerySet.as_manager()

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.name


class Prefs(models.Model):
    """Per-account settings that span scenarios."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name='prefs'
    )
    # [{key, name, color}]. Shared by all of the account's scenarios, as in the
    # frontend's COLOR_GROUPS_KEY.
    color_groups = models.JSONField(default=list, blank=True)
    active_scenario = models.ForeignKey(
        Scenario, on_delete=models.SET_NULL, null=True, blank=True, related_name='+'
    )

    class Meta:
        verbose_name_plural = 'prefs'

    def __str__(self):
        return f'Prefs for {self.user}'
