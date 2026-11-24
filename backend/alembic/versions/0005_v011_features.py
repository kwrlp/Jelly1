"""v0.11: удалённые профили освобождают email/ник; реакции и комментарии к постам; избранные сообщения в чатах

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- удалённые профили: исходные email/ник переезжают в deleted_*, а в unique-колонках остаются «заглушки» ---
    op.add_column("users", sa.Column("deleted_email", sa.String(255)))
    op.add_column("users", sa.Column("deleted_nickname", sa.String(32)))
    op.create_index("ix_users_deleted_email", "users", ["deleted_email"])
    # уже удалённые (до этой версии) профили освобождаем так же — их email и ники снова можно занять
    op.execute("UPDATE users SET deleted_email = email, deleted_nickname = nickname, "
               "email = 'deleted-' || id || '@deleted.invalid', nickname = '~deleted' || id "
               "WHERE deleted_at IS NOT NULL")

    # --- комментарии и реакции к постам ---
    op.create_table("post_comments", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("post_id", sa.Integer, sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("text", sa.Text, nullable=False), sa.Column("created_at", sa.DateTime, nullable=False), sa.Column("removed_at", sa.DateTime))
    op.create_index("ix_post_comments_post_id", "post_comments", ["post_id"]); op.create_index("ix_post_comments_author_id", "post_comments", ["author_id"])
    op.create_table("post_reactions", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("post_id", sa.Integer, sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("kind", sa.String(10), nullable=False), sa.Column("created_at", sa.DateTime, nullable=False),
                    sa.UniqueConstraint("post_id", "user_id", name="uq_post_reaction"))
    op.create_index("ix_post_reactions_post_id", "post_reactions", ["post_id"]); op.create_index("ix_post_reactions_user_id", "post_reactions", ["user_id"])

    # --- избранные сообщения ---
    op.create_table("message_favorites", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("message_id", sa.Integer, sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("created_at", sa.DateTime, nullable=False), sa.UniqueConstraint("user_id", "message_id", name="uq_message_fav"))
    op.create_index("ix_message_favorites_user_id", "message_favorites", ["user_id"]); op.create_index("ix_message_favorites_message_id", "message_favorites", ["message_id"])


def downgrade() -> None:
    op.drop_table("message_favorites")
    op.drop_table("post_reactions")
    op.drop_table("post_comments")
    op.drop_index("ix_users_deleted_email", table_name="users")
    with op.batch_alter_table("users") as b:
        b.drop_column("deleted_nickname"); b.drop_column("deleted_email")
