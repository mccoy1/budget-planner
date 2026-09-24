"""Read-only YNAB anchoring.

The planner is unchanged except for one thing: an *anchored* scenario takes its
income from YNAB instead of a typed number. Income is the sum of `budgeted`
(what was assigned this month) across the YNAB categories the scenario points
at. Nothing is ever written to YNAB.

An anchor's month is pinned when it is created and never edited, so a September
scenario keeps reading September's assignments forever — a record of what was
decided, not a number that rewrites itself on the 1st. A new month is a new
scenario (duplicate carries the categories and asks for the new month).
"""
from django.conf import settings
from django.db import models

from budgets.models import Scenario


class YnabConnection(models.Model):
    """One account's YNAB link: a personal access token and the chosen plan.

    The token never reaches the browser. It is encrypted at rest with a key
    from the environment — see crypto.py for why that matters here.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name='ynab'
    )
    token_encrypted = models.TextField()
    # YNAB's id for the plan (its word for a budget). Null until one is chosen,
    # which only happens when the token can see more than one.
    plan_id = models.CharField(max_length=64, blank=True, default='')
    plan_name = models.CharField(max_length=200, blank=True, default='')
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # When the token was last used against YNAB, so a stale one is obvious.
    last_used_at = models.DateTimeField(null=True, blank=True)
    # The last failure, kept so the app can say what went wrong instead of
    # showing a number that silently stopped updating.
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'YNAB connection'
        verbose_name_plural = 'YNAB connections'

    def __str__(self):
        return f'YNAB for {self.user}'


class ScenarioAnchor(models.Model):
    """The optional link from one scenario to a month's YNAB assignments.

    No anchor means the scenario keeps its typed income and behaves exactly as
    it always has.
    """

    scenario = models.OneToOneField(Scenario, on_delete=models.CASCADE, related_name='ynab_anchor')
    # The first of the month, e.g. 2026-09-01. Set once; never edited.
    month = models.DateField()
    last_pulled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'scenario anchor'

    def __str__(self):
        return f'{self.scenario.name} → YNAB {self.month:%b %Y}'

    @property
    def income_milli(self):
        """Income for the scenario: Σ budgeted over the anchored categories.

        Integers throughout. A category that has vanished from YNAB keeps
        counting its last known amount, which the UI says out loud.
        """
        return sum(c.budgeted_milli for c in self.categories.all())


class AnchoredCategory(models.Model):
    """One YNAB category feeding an anchored scenario's income."""

    anchor = models.ForeignKey(ScenarioAnchor, on_delete=models.CASCADE, related_name='categories')
    ynab_category_id = models.CharField(max_length=64)
    # Names are cached so the scenario still reads sensibly without a pull, and
    # still names a category that has since disappeared from YNAB.
    name_cache = models.CharField(max_length=200, blank=True, default='')
    group_name_cache = models.CharField(max_length=200, blank=True, default='')
    budgeted_milli = models.BigIntegerField(default=0)
    # Set when the category stops appearing in YNAB's response. Its last known
    # amount keeps counting, and the UI explains that rather than quietly
    # changing the income.
    missing = models.BooleanField(default=False)

    class Meta:
        verbose_name_plural = 'anchored categories'
        ordering = ['group_name_cache', 'name_cache']
        constraints = [
            models.UniqueConstraint(
                fields=['anchor', 'ynab_category_id'], name='unique_category_per_anchor'
            )
        ]

    def __str__(self):
        return self.name_cache or self.ynab_category_id
