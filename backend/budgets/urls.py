from django.urls import path

from . import views

urlpatterns = [
    path('bootstrap', views.bootstrap, name='bootstrap'),
    path('scenarios', views.scenario_collection, name='scenario-collection'),
    path('scenarios/<uuid:scenario_id>', views.scenario_detail, name='scenario-detail'),
    path('prefs', views.prefs, name='prefs'),
    path('import', views.import_browser_data, name='import'),
]
