"""users.nickname (уникальный @ник) и moderator_invites

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname", sa.String(32)))
    op.execute("UPDATE users SET nickname = '@user' || id WHERE nickname IS NULL")      # ники для уже существующих аккаунтов
    op.create_index("ix_users_nickname", "users", ["nickname"], unique=True)
    op.create_table("moderator_invites", sa.Column("id", sa.Integer, primary_key=True), sa.Column("email", sa.String(255), nullable=False),
                    sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False), sa.Column("created_at", sa.DateTime, nullable=False))
    op.create_index("ix_moderator_invites_email", "moderator_invites", ["email"], unique=True)


def downgrade() -> None:
    op.drop_table("moderator_invites")
    op.drop_index("ix_users_nickname", table_name="users")
    with op.batch_alter_table("users") as b: b.drop_column("nickname")
