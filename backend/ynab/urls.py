from django.urls import path

from . import views

urlpatterns = [
    path('state', views.state, name='ynab-state'),
    path('connection', views.connection, name='ynab-connection'),
    path('plans', views.plans, name='ynab-plans'),
    path('categories', views.categories, name='ynab-categories'),
    path('scenarios/<uuid:scenario_id>/anchor', views.anchor, name='ynab-anchor'),
    path('scenarios/<uuid:scenario_id>/refresh', views.refresh, name='ynab-refresh'),
]
