from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def normalize_email(self, email):
        # Lowercase the whole address, not just the domain, so "Sarah@…" and
        # "sarah@…" can't become two accounts or fail to sign in.
        return (email or '').strip().lower()

    def get_by_natural_key(self, email):
        return self.get(email=self.normalize_email(email))

    def _create_user(self, email, password, **extra_fields):
        email = self.normalize_email(email)
        if not email:
            raise ValueError('An email address is required.')
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """A person who signs in with an email address. There are no usernames."""

    username = None
    email = models.EmailField('email address', unique=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = UserManager()

    def clean(self):
        super().clean()
        self.email = self.__class__.objects.normalize_email(self.email)

    def __str__(self):
        return self.email
