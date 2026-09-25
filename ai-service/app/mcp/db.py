from psycopg_pool import ConnectionPool

from app.core.config import settings


db_pool = ConnectionPool(
    conninfo=(
        f"host={settings.db_host} "
        f"port={settings.db_port} "
        f"dbname={settings.db_name} "
        f"user={settings.db_user} "
        f"password={settings.db_password}"
    ),
    min_size=1,
    max_size=5,
    open=True,
)