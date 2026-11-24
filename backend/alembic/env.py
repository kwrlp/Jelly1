import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.main import Base, engine  # noqa: E402  (модели и тот же engine, что у приложения)

config = context.config
if config.attributes.get("configure_logger", True) and config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=str(engine.url), target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
