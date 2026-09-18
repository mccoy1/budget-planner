from django.contrib import admin
from django.urls import include, path

# GET /health is answered by config.middleware.HealthCheckMiddleware, before routing.
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include('budgets.urls')),
]
