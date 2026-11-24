"""initial schema: users, tracks, playlists, playlist_items, comments, notes

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(120), nullable=False),
        sa.Column("avatar_url", sa.String(500), nullable=False),
        sa.Column("about", sa.Text, nullable=False),
        sa.Column("music_interests", sa.Text, nullable=False),
        sa.Column("favorite_artists", sa.Text, nullable=False),
        sa.Column("is_profile_public", sa.Boolean, nullable=False),
        sa.Column("theme", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "tracks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(300), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("artist", sa.String(200), nullable=False),
        sa.Column("genre", sa.String(100)),
        sa.Column("mood", sa.String(100)),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("cover_url", sa.String(500)),
        sa.Column("duration_seconds", sa.Integer),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_tracks_uuid", "tracks", ["uuid"], unique=True)
    op.create_index("ix_tracks_owner_id", "tracks", ["owner_id"])

    op.create_table(
        "playlists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("cover_url", sa.String(500)),
        sa.Column("is_public", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_playlists_uuid", "playlists", ["uuid"], unique=True)
    op.create_index("ix_playlists_owner_id", "playlists", ["owner_id"])

    op.create_table(
        "playlist_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("playlist_id", sa.Integer, sa.ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("track_id", sa.Integer, sa.ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.UniqueConstraint("playlist_id", "track_id", name="uq_playlist_track"),
    )
    op.create_index("ix_playlist_items_playlist_id", "playlist_items", ["playlist_id"])
    op.create_index("ix_playlist_items_track_id", "playlist_items", ["track_id"])

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("track_id", sa.Integer, sa.ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_comments_track_id", "comments", ["track_id"])

    op.create_table(
        "notes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("track_id", sa.Integer, sa.ForeignKey("tracks.id", ondelete="CASCADE")),
        sa.Column("playlist_id", sa.Integer, sa.ForeignKey("playlists.id", ondelete="CASCADE")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("(track_id IS NOT NULL) <> (playlist_id IS NOT NULL)", name="ck_note_one_target"),
    )
    op.create_index("ix_notes_owner_id", "notes", ["owner_id"])


def downgrade() -> None:
    for t in ("notes", "comments", "playlist_items", "playlists", "tracks", "users"):
        op.drop_table(t)
