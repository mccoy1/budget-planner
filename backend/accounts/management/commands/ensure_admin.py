"""Create the first admin from environment variables, once.

Render's free plan has no shell, so `createsuperuser` can't be run against the
live database. start.sh runs this on every boot instead:

- DJANGO_ADMIN_EMAIL unset: does nothing.
- That account already exists: does nothing. It never resets a password, so
  a password changed in the admin stays changed across restarts.
- Otherwise: creates a superuser with DJANGO_ADMIN_PASSWORD, which must be set.

Once the admin exists you can delete DJANGO_ADMIN_PASSWORD from Render.
"""
import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Create the admin account from DJANGO_ADMIN_EMAIL / DJANGO_ADMIN_PASSWORD if it does not exist.'

    def handle(self, *args, **options):
        User = get_user_model()
        email = User.objects.normalize_email(os.environ.get('DJANGO_ADMIN_EMAIL', ''))
        if not email:
            self.stdout.write('ensure_admin: DJANGO_ADMIN_EMAIL not set; skipping.')
            return
        if User.objects.filter(email=email).exists():
            self.stdout.write(f'ensure_admin: {email} already exists; leaving it unchanged.')
            return
        password = os.environ.get('DJANGO_ADMIN_PASSWORD', '')
        if not password:
            raise CommandError(
                f'ensure_admin: {email} does not exist yet and DJANGO_ADMIN_PASSWORD is not set.'
            )
        User.objects.create_superuser(email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f'ensure_admin: created admin {email}.'))
