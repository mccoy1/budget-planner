from django.urls import path

from . import views

urlpatterns = [
    path('session', views.session, name='auth-session'),
    path('login', views.login_view, name='auth-login'),
    path('logout', views.logout_view, name='auth-logout'),
    path('password', views.change_password, name='auth-password'),
]
