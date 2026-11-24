"""соцсеть: роли, друзья, подписки, блокировки, посты, чаты, уведомления, жалобы, предупреждения, журналы, настройки, события

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

NOW = sa.Column
fk = lambda t, ondelete=None: sa.ForeignKey(t, ondelete=ondelete)


def upgrade() -> None:
    # --- существующие таблицы ---
    op.add_column("users", sa.Column("role", sa.String(12), nullable=False, server_default="user"))
    op.add_column("users", sa.Column("is_banned", sa.Boolean, nullable=False, server_default="0"))
    op.add_column("users", sa.Column("ban_reason", sa.String(300), nullable=False, server_default=""))
    op.add_column("users", sa.Column("deleted_at", sa.DateTime))
    op.add_column("users", sa.Column("taste_recs", sa.Boolean, nullable=False, server_default="0"))
    op.create_index("ix_users_role", "users", ["role"])
    op.add_column("tracks", sa.Column("removed_at", sa.DateTime))
    op.add_column("playlists", sa.Column("removed_at", sa.DateTime))
    op.add_column("comments", sa.Column("removed_at", sa.DateTime))
    op.add_column("playlist_items", sa.Column("added_by", sa.Integer))

    I = lambda name, nullable=False: sa.Column(name, sa.Integer, nullable=nullable)
    ts = lambda name="created_at", nullable=False: sa.Column(name, sa.DateTime, nullable=nullable)
    u = lambda cascade=True: fk("users.id", "CASCADE" if cascade else None)

    op.create_table("friendships", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("requester_id", sa.Integer, u(), nullable=False), sa.Column("addressee_id", sa.Integer, u(), nullable=False),
                    sa.Column("status", sa.String(10), nullable=False), ts(), sa.UniqueConstraint("requester_id", "addressee_id", name="uq_friend_pair"))
    op.create_index("ix_friendships_requester_id", "friendships", ["requester_id"]); op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"])
    op.create_table("follows", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("follower_id", sa.Integer, u(), nullable=False), sa.Column("followee_id", sa.Integer, u(), nullable=False), ts(),
                    sa.UniqueConstraint("follower_id", "followee_id", name="uq_follow_pair"))
    op.create_index("ix_follows_follower_id", "follows", ["follower_id"]); op.create_index("ix_follows_followee_id", "follows", ["followee_id"])
    op.create_table("blocks", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("blocker_id", sa.Integer, u(), nullable=False), sa.Column("blocked_id", sa.Integer, u(), nullable=False), ts(),
                    sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"))
    op.create_index("ix_blocks_blocker_id", "blocks", ["blocker_id"]); op.create_index("ix_blocks_blocked_id", "blocks", ["blocked_id"])

    op.create_table("posts", sa.Column("id", sa.Integer, primary_key=True), sa.Column("author_id", sa.Integer, u(), nullable=False),
                    sa.Column("text", sa.Text, nullable=False), sa.Column("visibility", sa.String(10), nullable=False), ts(), ts("removed_at", True))
    op.create_index("ix_posts_author_id", "posts", ["author_id"])
    op.create_table("post_images", sa.Column("id", sa.Integer, primary_key=True), sa.Column("post_id", sa.Integer, fk("posts.id", "CASCADE"), nullable=False),
                    sa.Column("file_name", sa.String(120), nullable=False, unique=True), sa.Column("position", sa.Integer, nullable=False))
    op.create_index("ix_post_images_post_id", "post_images", ["post_id"])
    op.create_table("post_tracks", sa.Column("id", sa.Integer, primary_key=True), sa.Column("post_id", sa.Integer, fk("posts.id", "CASCADE"), nullable=False),
                    sa.Column("track_id", sa.Integer, fk("tracks.id", "CASCADE"), nullable=False), sa.Column("position", sa.Integer, nullable=False))
    op.create_index("ix_post_tracks_post_id", "post_tracks", ["post_id"]); op.create_index("ix_post_tracks_track_id", "post_tracks", ["track_id"])

    op.create_table("playlist_members", sa.Column("id", sa.Integer, primary_key=True), sa.Column("playlist_id", sa.Integer, fk("playlists.id", "CASCADE"), nullable=False),
                    sa.Column("user_id", sa.Integer, u(), nullable=False), sa.Column("role", sa.String(10), nullable=False), sa.Column("status", sa.String(10), nullable=False),
                    sa.Column("invited_by", sa.Integer, fk("users.id"), nullable=False), ts(), sa.UniqueConstraint("playlist_id", "user_id", name="uq_playlist_member"))
    op.create_index("ix_playlist_members_playlist_id", "playlist_members", ["playlist_id"]); op.create_index("ix_playlist_members_user_id", "playlist_members", ["user_id"])

    op.create_table("chats", sa.Column("id", sa.Integer, primary_key=True), sa.Column("user_a_id", sa.Integer, u(), nullable=False), sa.Column("user_b_id", sa.Integer, u(), nullable=False),
                    sa.Column("kind", sa.String(10), nullable=False), sa.Column("pet_xp", sa.Integer, nullable=False), sa.Column("streak", sa.Integer, nullable=False),
                    sa.Column("streak_date", sa.String(10)), sa.Column("last_day_a", sa.String(10)), sa.Column("last_day_b", sa.String(10)), ts(),
                    sa.UniqueConstraint("user_a_id", "user_b_id", name="uq_chat_pair"))
    op.create_index("ix_chats_user_a_id", "chats", ["user_a_id"]); op.create_index("ix_chats_user_b_id", "chats", ["user_b_id"])
    op.create_table("messages", sa.Column("id", sa.Integer, primary_key=True), sa.Column("chat_id", sa.Integer, fk("chats.id", "CASCADE"), nullable=False),
                    sa.Column("sender_id", sa.Integer, u(), nullable=False), sa.Column("kind", sa.String(10), nullable=False), sa.Column("text", sa.Text, nullable=False),
                    sa.Column("ref_id", sa.Integer), ts(), ts("read_at", True))
    op.create_index("ix_messages_chat_id", "messages", ["chat_id"])

    op.create_table("notifications", sa.Column("id", sa.Integer, primary_key=True), sa.Column("user_id", sa.Integer, u(), nullable=False),
                    sa.Column("kind", sa.String(30), nullable=False), sa.Column("text", sa.String(500), nullable=False), sa.Column("ref_type", sa.String(20)),
                    sa.Column("ref_id", sa.Integer), sa.Column("from_staff", sa.Boolean, nullable=False), sa.Column("from_user_id", sa.Integer), ts(), ts("read_at", True))
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])

    op.create_table("reports", sa.Column("id", sa.Integer, primary_key=True), sa.Column("reporter_id", sa.Integer, u(), nullable=False),
                    sa.Column("content_type", sa.String(20), nullable=False), sa.Column("content_id", sa.Integer), sa.Column("target_user_id", sa.Integer),
                    sa.Column("category", sa.String(30), nullable=False), sa.Column("reason", sa.Text, nullable=False), sa.Column("status", sa.String(15), nullable=False),
                    sa.Column("priority", sa.String(10), nullable=False), sa.Column("assigned_to", sa.Integer), sa.Column("resolution", sa.Text, nullable=False), ts(), ts("closed_at", True))
    for c in ("reporter_id", "content_type", "status", "priority"): op.create_index(f"ix_reports_{c}", "reports", [c])
    op.create_table("report_replies", sa.Column("id", sa.Integer, primary_key=True), sa.Column("report_id", sa.Integer, fk("reports.id", "CASCADE"), nullable=False),
                    sa.Column("author_id", sa.Integer, fk("users.id"), nullable=False), sa.Column("text", sa.Text, nullable=False), ts())
    op.create_index("ix_report_replies_report_id", "report_replies", ["report_id"])
    op.create_table("warnings", sa.Column("id", sa.Integer, primary_key=True), sa.Column("user_id", sa.Integer, u(), nullable=False),
                    sa.Column("issued_by", sa.Integer, fk("users.id"), nullable=False), sa.Column("reason", sa.Text, nullable=False), sa.Column("report_id", sa.Integer),
                    ts(), ts("revoked_at", True), sa.Column("revoked_by", sa.Integer))
    op.create_index("ix_warnings_user_id", "warnings", ["user_id"])
    op.create_table("deletion_requests", sa.Column("id", sa.Integer, primary_key=True), sa.Column("user_id", sa.Integer, u(), nullable=False),
                    sa.Column("requested_by", sa.Integer, fk("users.id"), nullable=False), sa.Column("reason", sa.Text, nullable=False), sa.Column("report_id", sa.Integer),
                    sa.Column("status", sa.String(10), nullable=False), sa.Column("decided_by", sa.Integer), ts("decided_at", True), ts())
    op.create_index("ix_deletion_requests_user_id", "deletion_requests", ["user_id"]); op.create_index("ix_deletion_requests_status", "deletion_requests", ["status"])

    op.create_table("audit_log", sa.Column("id", sa.Integer, primary_key=True), sa.Column("actor_id", sa.Integer, fk("users.id"), nullable=False),
                    sa.Column("actor_role", sa.String(12), nullable=False), sa.Column("action", sa.String(40), nullable=False), sa.Column("target_type", sa.String(20), nullable=False),
                    sa.Column("target_id", sa.Integer), sa.Column("target_user_id", sa.Integer), sa.Column("details", sa.Text, nullable=False), ts())
    for c in ("actor_id", "actor_role", "action", "created_at"): op.create_index(f"ix_audit_log_{c}", "audit_log", [c])
    op.create_table("reply_templates", sa.Column("id", sa.Integer, primary_key=True), sa.Column("title", sa.String(100), nullable=False),
                    sa.Column("text", sa.Text, nullable=False), sa.Column("created_by", sa.Integer), ts())
    op.create_table("platform_settings", sa.Column("key", sa.String(60), primary_key=True), sa.Column("value", sa.String(200), nullable=False))
    op.create_table("events", sa.Column("id", sa.Integer, primary_key=True), sa.Column("kind", sa.String(20), nullable=False), sa.Column("user_id", sa.Integer),
                    sa.Column("visitor_id", sa.String(40)), ts())
    for c in ("kind", "user_id", "created_at"): op.create_index(f"ix_events_{c}", "events", [c])


def downgrade() -> None:
    for t in ("events", "platform_settings", "reply_templates", "audit_log", "deletion_requests", "warnings", "report_replies", "reports", "notifications",
              "messages", "chats", "playlist_members", "post_tracks", "post_images", "posts", "blocks", "follows", "friendships"):
        op.drop_table(t)
    with op.batch_alter_table("playlist_items") as b: b.drop_column("added_by")
    for t in ("comments", "playlists", "tracks"):
        with op.batch_alter_table(t) as b: b.drop_column("removed_at")
    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_role")
        for c in ("taste_recs", "deleted_at", "ban_reason", "is_banned", "role"): b.drop_column(c)
