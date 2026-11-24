"""Музыкальное хранилище — backend (FastAPI + SQLAlchemy + SQLite + Alembic + JWT)."""
import os, re, json, uuid, logging, datetime as dt
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import bcrypt, jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import (case, 
    create_engine, event, ForeignKey, String, Text, DateTime, Boolean, Integer,
    CheckConstraint, UniqueConstraint, select, func, delete, or_, and_,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, Session

VERSION = "0.11.0"

# ---------- конфиг ----------
BASE = Path(__file__).resolve().parent.parent          # .../backend
load_dotenv(BASE / ".env")

SECRET = os.getenv("SECRET_KEY", "dev-secret-change-me")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()   # этот аккаунт получает роль admin
TOKEN_TTL_MIN = int(os.getenv("TOKEN_TTL_MIN", "120"))
REFRESH_TTL_DAYS = int(os.getenv("REFRESH_TTL_DAYS", "7"))
# Лимиты загрузки (v0.11). Главное ограничение трека — длительность; размер — только «потолок безопасности»
# (час WAV 16 бит / 44,1 кГц ≈ 635 МБ, 24 бит / 96 кГц ≈ 2 ГБ).
MAX_TRACK_SECONDS = int(os.getenv("MAX_TRACK_SECONDS", "3600"))             # трек — до 1 часа
MAX_BYTES = int(os.getenv("MAX_TRACK_MB", "2048")) * 1024 * 1024            # потолок размера одного файла
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_MB", "20")) * 1024 * 1024        # фото (аватар, обложка, картинка поста) — до 20 МБ
USER_QUOTA_BYTES = int(float(os.getenv("USER_QUOTA_GB", "7")) * 1024 ** 3)  # суммарный объём треков одного пользователя — до 7 ГБ
UNKNOWN_DURATION_MAX_BYTES = 50 * 1024 * 1024                               # если длительность не прочиталась — принимаем только небольшие файлы
ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BASE / 'music.db').as_posix()}")

UPLOADS = Path(os.getenv("UPLOADS_DIR") or (BASE / "uploads")).resolve()   # аудио хранится в файловой системе, не в БД
UPLOADS.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("uvicorn.error")
ALLOWED = {
    ".mp3": {"audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"},
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "application/octet-stream"},
}
AUDIO_MEDIA = {".mp3": "audio/mpeg", ".wav": "audio/wav"}
IMAGE_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
IMAGE_PREFIXES = ("avatar-", "cover-", "playlist-cover-")
UNKNOWN_ARTIST = "Неизвестный исполнитель"

# ---------- БД ----------
is_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if is_sqlite else {})

if is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragma(dbapi_conn, _):          # без этого SQLite не проверяет внешние ключи и ON DELETE
        cur = dbapi_conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.close()

Session_ = sessionmaker(engine, expire_on_commit=False)
now = lambda: dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)   # UTC без tzinfo (так хранит SQLite)
iso = lambda d: d.isoformat() + "Z"


class Base(DeclarativeBase): pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(120))
    avatar_url: Mapped[str] = mapped_column(String(500), default="")
    about: Mapped[str] = mapped_column(Text, default="")
    music_interests: Mapped[str] = mapped_column(Text, default="")
    favorite_artists: Mapped[str] = mapped_column(Text, default="")
    is_profile_public: Mapped[bool] = mapped_column(Boolean, default=False)
    theme: Mapped[str] = mapped_column(String(50), default="plasma")
    filter_options: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    role: Mapped[str] = mapped_column(String(12), default="user", server_default="user", index=True)   # user | moderator | admin
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    ban_reason: Mapped[str] = mapped_column(String(300), default="", server_default="")
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)   # «@ник», уникальный, латиница
    taste_recs: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")        # показывать людей со схожим вкусом   # свои жанры/настроения/исполнители (JSON)
    deleted_email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)   # исходные email и ник удалённого профиля (в email/nickname — «заглушки»)
    deleted_nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Track(Base):
    __tablename__ = "tracks"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    file_path: Mapped[str] = mapped_column(String(500))
    original_filename: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(200))
    artist: Mapped[str] = mapped_column(String(200), default="")
    genre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mood: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    removed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Playlist(Base):
    __tablename__ = "playlists"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    removed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class PlaylistItem(Base):
    __tablename__ = "playlist_items"
    __table_args__ = (UniqueConstraint("playlist_id", "track_id", name="uq_playlist_track"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(default=0)
    added_by: Mapped[int | None] = mapped_column(nullable=True)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    removed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (CheckConstraint("(track_id IS NOT NULL) <> (playlist_id IS NOT NULL)", name="ck_note_one_target"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    track_id: Mapped[int | None] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), nullable=True)
    playlist_id: Mapped[int | None] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now, onupdate=now)


# ---------- Социальные модели ----------
class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friend_pair"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")          # pending | accepted
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id", name="uq_follow_pair"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    visibility: Mapped[str] = mapped_column(String(10), default="friends")      # friends | public
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    removed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class PostImage(Base):
    __tablename__ = "post_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    file_name: Mapped[str] = mapped_column(String(120), unique=True)
    position: Mapped[int] = mapped_column(default=0)


class PostTrack(Base):
    __tablename__ = "post_tracks"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(default=0)


class PostComment(Base):
    __tablename__ = "post_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    removed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class PostReaction(Base):
    """Одна реакция пользователя на пост (повторный выбор другой меняет её, тот же — снимает)."""
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_reaction"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))                               # like | love | fire | laugh | wow | sad
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class PlaylistMember(Base):
    __tablename__ = "playlist_members"
    __table_args__ = (UniqueConstraint("playlist_id", "user_id", name="uq_playlist_member"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="editor")            # editor | viewer
    status: Mapped[str] = mapped_column(String(10), default="pending")         # pending | accepted
    invited_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Chat(Base):
    __tablename__ = "chats"
    __table_args__ = (UniqueConstraint("user_a_id", "user_b_id", name="uq_chat_pair"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)   # a < b
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="dm")                 # dm | support (участвует модератор/админ)
    pet_xp: Mapped[int] = mapped_column(default=0)
    streak: Mapped[int] = mapped_column(default=0)
    streak_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_day_a: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_day_b: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10), default="text")               # text | track | playlist | post
    text: Mapped[str] = mapped_column(Text, default="")
    ref_id: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class MessageFavorite(Base):
    """«Избранное» в чатах: личная закладка пользователя на сообщение (собеседник её не видит)."""
    __tablename__ = "message_favorites"
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_message_fav"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(String(500))
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_id: Mapped[int | None] = mapped_column(nullable=True)
    from_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    from_user_id: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content_type: Mapped[str] = mapped_column(String(20), index=True)         # post | comment | playlist | track | profile | support
    content_id: Mapped[int | None] = mapped_column(nullable=True)
    target_user_id: Mapped[int | None] = mapped_column(nullable=True)
    category: Mapped[str] = mapped_column(String(30), default="other")
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(15), default="open", index=True)   # open | in_progress | closed
    priority: Mapped[str] = mapped_column(String(10), default="normal", index=True)
    assigned_to: Mapped[int | None] = mapped_column(nullable=True)
    resolution: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class ReportReply(Base):
    __tablename__ = "report_replies"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class ModWarning(Base):
    __tablename__ = "warnings"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    issued_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    report_id: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by: Mapped[int | None] = mapped_column(nullable=True)


class DeletionRequest(Base):
    __tablename__ = "deletion_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    report_id: Mapped[int | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)   # pending | confirmed | rejected
    decided_by: Mapped[int | None] = mapped_column(nullable=True)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    actor_role: Mapped[str] = mapped_column(String(12), index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)
    target_type: Mapped[str] = mapped_column(String(20), default="")
    target_id: Mapped[int | None] = mapped_column(nullable=True)
    target_user_id: Mapped[int | None] = mapped_column(nullable=True)
    details: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now, index=True)


class ReplyTemplate(Base):
    __tablename__ = "reply_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)      # visit | register | login | listen | post | message
    user_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    visitor_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now, index=True)


class ModeratorInvite(Base):
    """Email, которому при регистрации автоматически выдаётся роль модератора."""
    __tablename__ = "moderator_invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=now)


# ---------- Pydantic-схемы ----------
def validate_password(password: str) -> str:
    if len(password) < 8: raise ValueError("Пароль должен содержать минимум 8 символов")
    if len(password.encode()) > 72: raise ValueError("Пароль слишком длинный (максимум 72 байта)")
    if not re.search(r"[A-Za-z]", password): raise ValueError("Пароль должен содержать хотя бы одну букву")
    if not re.search(r"\d", password): raise ValueError("Пароль должен содержать хотя бы одну цифру")
    return password


class Strip(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


NICK_RE = re.compile(r"^@(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{3,30}$")
RESERVED_NICKS = {"@admin", "@moder", "@moderator", "@support", "@system"}


def norm_nick(v: str) -> str:
    v = v.strip().lower()
    if not NICK_RE.match(v): raise ValueError("Ник: «@» и 3–30 латинских букв, цифр или «_» (хотя бы одна буква)")
    if v in RESERVED_NICKS: raise ValueError("Этот ник зарезервирован")
    return v


class RegisterIn(Strip):
    email: EmailStr
    password: str
    name: str = Field(min_length=1, max_length=100)
    nickname: str = Field(max_length=40)

    @field_validator("nickname")
    @classmethod
    def _nick(cls, v): return norm_nick(v)

    @field_validator("password")
    @classmethod
    def _pwd(cls, v): return validate_password(v)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(max_length=200)


class RefreshIn(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TrackPatch(Strip):
    title: str | None = Field(None, min_length=1, max_length=200)
    artist: str | None = Field(None, max_length=200)
    genre: str | None = Field(None, max_length=100)
    mood: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=2000)


class PlaylistIn(Strip):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    is_public: bool = False


class PlaylistPatch(Strip):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    is_public: bool | None = None


class ItemIn(BaseModel):
    track_id: int


class OrderIn(BaseModel):
    item_ids: list[int]


class CommentIn(Strip):
    text: str = Field(min_length=1, max_length=2000)


class NoteIn(Strip):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=10000)
    track_id: int | None = None
    playlist_id: int | None = None

    @model_validator(mode="after")
    def _one_target(self):
        if (self.track_id is None) == (self.playlist_id is None):
            raise ValueError("Заметка должна быть привязана ровно к одному объекту: треку ИЛИ плейлисту")
        return self


class NotePatch(Strip):
    title: str | None = Field(None, min_length=1, max_length=200)
    text: str | None = Field(None, min_length=1, max_length=10000)


class FilterAddIn(Strip):
    kind: Literal["genres", "moods", "artists"]
    value: str = Field(min_length=1, max_length=100)


class ProfilePatch(Strip):
    name: str | None = Field(None, min_length=1, max_length=100)
    about: str | None = Field(None, max_length=2000)
    music_interests: str | None = Field(None, max_length=2000)
    favorite_artists: str | None = Field(None, max_length=2000)
    is_profile_public: bool | None = None
    taste_recs: bool | None = None
    theme: str | None = Field(None, pattern=r"^[a-z0-9-]{1,50}$")


class AccountPatch(Strip):
    """Редактирование учётных данных. Смена email требует текущий пароль (чтобы украденная сессия не уводила аккаунт)."""
    name: str | None = Field(None, min_length=1, max_length=100)
    nickname: str | None = Field(None, max_length=40)
    email: EmailStr | None = None
    current_password: str | None = Field(None, max_length=200)

    @field_validator("nickname")
    @classmethod
    def _nick(cls, v): return None if v is None else norm_nick(v)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _pwd(cls, v): return validate_password(v)


# ---------- Авторизация и зависимости ----------
def get_db():
    with Session_() as s:
        yield s


def _make_token(uid: int, kind: str, delta: dt.timedelta) -> str:
    return jwt.encode({"sub": str(uid), "type": kind, "exp": dt.datetime.now(dt.timezone.utc) + delta}, SECRET, algorithm="HS256")


make_access_token = lambda uid: _make_token(uid, "access", dt.timedelta(minutes=TOKEN_TTL_MIN))
make_refresh_token = lambda uid: _make_token(uid, "refresh", dt.timedelta(days=REFRESH_TTL_DAYS))
tokens_for = lambda uid: TokenPair(access_token=make_access_token(uid), refresh_token=make_refresh_token(uid))


def decode_token(token: str, token_type: str = "access") -> int:
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
        if payload.get("type") != token_type: raise HTTPException(401, "Неверный тип токена")
        return int(payload["sub"])
    except jwt.ExpiredSignatureError: raise HTTPException(401, "Токен истёк")
    except (jwt.InvalidTokenError, KeyError, ValueError): raise HTTPException(401, "Недействительный токен")


def opt_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    h = request.headers.get("authorization", "")
    token = h[7:] if h.lower().startswith("bearer ") else None
    if not token and request.url.path.startswith("/files/"):    # <audio>/<img> не умеют слать заголовки
        token = request.query_params.get("token")
    if not token: return None
    try: uid = decode_token(token, "access")
    except HTTPException: return None
    u = db.get(User, uid)
    if u is not None and u.deleted_at: raise HTTPException(403, "Аккаунт удалён")
    if u is not None and u.is_banned: raise HTTPException(403, "Аккаунт заблокирован администрацией")
    return u


def need_user(u: User | None = Depends(opt_user)) -> User:
    if not u: raise HTTPException(401, "Требуется авторизация")
    return u


# ---------- Роли, связи, настройки ----------
STAFF = ("moderator", "admin")
is_staff = lambda u: bool(u and u.role in STAFF)
is_active_user = lambda u: bool(u and u.deleted_at is None and not u.is_banned)
SETTINGS_DEFAULTS = {"recommendations_enabled": "1", "guest_listening_enabled": "1",
                     "new_profiles_public_by_default": "0", "search_users_enabled": "1"}


def get_setting(db: Session, key: str) -> bool:
    row = db.get(PlatformSetting, key)
    return (row.value if row else SETTINGS_DEFAULTS[key]) == "1"


def need_staff(u: User = Depends(need_user)) -> User:
    if u.role not in STAFF: raise HTTPException(403, "Только для модераторов и администраторов")
    return u


def need_admin(u: User = Depends(need_user)) -> User:
    if u.role != "admin": raise HTTPException(403, "Только для администраторов")
    return u


def blocked_between(db: Session, a: int, b: int) -> bool:
    """Взаимная невидимость: блокировка в любую сторону."""
    if a == b: return False
    q = select(Block.id).where(or_(and_(Block.blocker_id == a, Block.blocked_id == b), and_(Block.blocker_id == b, Block.blocked_id == a)))
    return db.scalar(q.limit(1)) is not None


def blocked_ids(db: Session, uid: int) -> set[int]:
    rows = db.execute(select(Block.blocker_id, Block.blocked_id).where(or_(Block.blocker_id == uid, Block.blocked_id == uid))).all()
    return {(b if a == uid else a) for a, b in rows}


def are_friends(db: Session, a: int, b: int) -> bool:
    q = select(Friendship.id).where(Friendship.status == "accepted", or_(
        and_(Friendship.requester_id == a, Friendship.addressee_id == b), and_(Friendship.requester_id == b, Friendship.addressee_id == a)))
    return db.scalar(q.limit(1)) is not None


def friend_ids(db: Session, uid: int) -> set[int]:
    rows = db.execute(select(Friendship.requester_id, Friendship.addressee_id).where(
        Friendship.status == "accepted", or_(Friendship.requester_id == uid, Friendship.addressee_id == uid))).all()
    return {(b if a == uid else a) for a, b in rows}


def fmt_size(n: int) -> str:
    return f"{n / 1024 ** 3:.1f} ГБ".replace(".0 ", " ") if n >= 1024 ** 3 else f"{max(n, 0) // 1048576} МБ"


def used_storage(db: Session, uid: int) -> int:
    """Сколько байт занимают треки пользователя (учитываются только его видимые, не снятые модерацией)."""
    return db.scalar(select(func.coalesce(func.sum(Track.size_bytes), 0)).where(Track.owner_id == uid, Track.removed_at.is_(None))) or 0


TOMBSTONE_DOMAIN = "@deleted.invalid"        # адреса с этим доменом не проходят валидацию EmailStr — зарегистрировать их нельзя


def soft_delete_user(db: Session, x: User):
    """Мягкое удаление: профиль остаётся в списке удалённых (восстановление), но email и ник освобождаются для новой регистрации.
    Исходные значения хранятся в deleted_email / deleted_nickname, а в unique-колонках email / nickname остаются уникальные «заглушки»."""
    x.deleted_at = now()
    if not (x.email or "").endswith(TOMBSTONE_DOMAIN):
        x.deleted_email, x.deleted_nickname = x.email, x.nickname
        x.email, x.nickname = f"deleted-{x.id}{TOMBSTONE_DOMAIN}", f"~deleted{x.id}"       # «~» не проходит NICK_RE → занять такой ник нельзя


def restore_user(db: Session, x: User):
    """Возвращает профиль. Email должен быть свободен; если ник уже заняли — выдаём @user<id>."""
    if x.deleted_email:
        if db.scalar(select(User.id).where(User.email == x.deleted_email, User.id != x.id)):
            raise HTTPException(409, f"Email {x.deleted_email} уже занят новым аккаунтом — восстановить профиль нельзя")
        x.email = x.deleted_email
    elif (x.email or "").endswith(TOMBSTONE_DOMAIN):
        raise HTTPException(409, "У профиля не сохранён исходный email — восстановить нельзя")
    taken = lambda n: db.scalar(select(User.id).where(User.nickname == n, User.id != x.id)) is not None
    nick = x.deleted_nickname
    if not nick or taken(nick):
        nick = f"@user{x.id}"
        while taken(nick): nick += "_"
    x.nickname, x.deleted_email, x.deleted_nickname, x.deleted_at = nick, None, None, None


def notify(db: Session, to_id: int, kind: str, text: str, by: User | None = None, ref_type: str | None = None, ref_id: int | None = None):
    if by and blocked_between(db, by.id, to_id): return
    db.add(Notification(user_id=to_id, kind=kind, text=text[:500], ref_type=ref_type, ref_id=ref_id,
                        from_staff=is_staff(by), from_user_id=by.id if by else None))


def audit(db: Session, actor: User, action: str, target_type: str = "", target_id: int | None = None, target_user_id: int | None = None, **details):
    db.add(AuditLog(actor_id=actor.id, actor_role=actor.role, action=action, target_type=target_type, target_id=target_id,
                    target_user_id=target_user_id, details=json.dumps(details, ensure_ascii=False, default=str)))


def log_event(db: Session, kind: str, user_id: int | None = None, visitor_id: str | None = None):
    db.add(Event(kind=kind, user_id=user_id, visitor_id=(visitor_id or None) and visitor_id[:40])); db.commit()


# ---------- Проверки доступа (всегда на сервере) ----------
def can_view_post(db: Session, viewer: User | None, p: Post) -> bool:
    if p.removed_at: return False
    author = db.get(User, p.author_id)
    if not is_active_user(author) or viewer is None: return False
    if viewer.id == author.id: return True
    if blocked_between(db, viewer.id, author.id): return False
    if are_friends(db, viewer.id, author.id): return True
    return p.visibility == "public" and author.is_profile_public


def track_in_public_playlist(db: Session, tid: int) -> bool:
    q = (select(Playlist.id).join(PlaylistItem, PlaylistItem.playlist_id == Playlist.id).join(User, User.id == Playlist.owner_id)
         .where(PlaylistItem.track_id == tid, Playlist.is_public.is_(True), Playlist.removed_at.is_(None),
                User.deleted_at.is_(None), User.is_banned.is_(False)))
    return db.scalar(q.limit(1)) is not None


def track_in_member_playlist(db: Session, tid: int, uid: int) -> bool:
    q = (select(PlaylistItem.id).join(Playlist, Playlist.id == PlaylistItem.playlist_id)
         .outerjoin(PlaylistMember, and_(PlaylistMember.playlist_id == Playlist.id, PlaylistMember.user_id == uid, PlaylistMember.status == "accepted"))
         .where(PlaylistItem.track_id == tid, Playlist.removed_at.is_(None), or_(Playlist.owner_id == uid, PlaylistMember.id.is_not(None))))
    return db.scalar(q.limit(1)) is not None


def shared_in_chat(db: Session, kind: str, ref_id: int, uid: int) -> bool:
    q = (select(Message.id).join(Chat, Chat.id == Message.chat_id)
         .where(Message.kind == kind, Message.ref_id == ref_id, or_(Chat.user_a_id == uid, Chat.user_b_id == uid)))
    return db.scalar(q.limit(1)) is not None


def track_accessible(db: Session, t: Track, u: User | None) -> bool:
    if track_in_public_playlist(db, t.id):
        return bool(u) or get_setting(db, "guest_listening_enabled")
    if not u: return False
    if track_in_member_playlist(db, t.id, u.id) or shared_in_chat(db, "track", t.id, u.id): return True
    posts = db.scalars(select(Post).join(PostTrack, PostTrack.post_id == Post.id).where(PostTrack.track_id == t.id, Post.removed_at.is_(None)).limit(40)).all()
    return any(can_view_post(db, u, p) for p in posts)


def get_track(db: Session, tid: int, u: User | None, write: bool = False) -> Track:
    t = db.get(Track, tid)
    if not t or t.removed_at: raise HTTPException(404, "Трек не найден")
    if u is not None and t.owner_id == u.id: return t
    if write: raise HTTPException(403, "Только владелец может изменять трек")
    if not is_active_user(db.get(User, t.owner_id)): raise HTTPException(404, "Трек не найден")
    if u is not None and blocked_between(db, u.id, t.owner_id): raise HTTPException(404, "Трек не найден")
    if not track_accessible(db, t, u): raise HTTPException(403, "Нет доступа к треку")
    return t


def playlist_role(db: Session, p: Playlist, u: User | None) -> str | None:
    if u is None: return None
    if p.owner_id == u.id: return "owner"
    m = db.scalar(select(PlaylistMember).where(PlaylistMember.playlist_id == p.id, PlaylistMember.user_id == u.id, PlaylistMember.status == "accepted"))
    return m.role if m else None


def get_playlist(db: Session, pid: int, u: User | None, write: bool = False, perm: str | None = None) -> Playlist:
    """perm: view | edit (владелец и соавторы-editor) | owner."""
    perm = perm or ("owner" if write else "view")
    p = db.get(Playlist, pid)
    if not p or p.removed_at: raise HTTPException(404, "Плейлист не найден")
    if not is_active_user(db.get(User, p.owner_id)): raise HTTPException(404, "Плейлист не найден")
    if u is not None and p.owner_id == u.id: return p
    if u is not None and blocked_between(db, u.id, p.owner_id): raise HTTPException(404, "Плейлист не найден")
    role = playlist_role(db, p, u)
    if perm == "owner": raise HTTPException(403, "Только владелец может изменять плейлист")
    if perm == "edit":
        if role == "editor": return p
        raise HTTPException(403, "Нет прав редактировать плейлист")
    if role: return p
    if p.is_public:
        if u is None and not get_setting(db, "guest_listening_enabled"): raise HTTPException(403, "Гостевой доступ отключён")
        return p
    if u is not None and shared_in_chat(db, "playlist", p.id, u.id): return p
    raise HTTPException(403, "Плейлист закрыт")


# ---------- Сериализация ----------
def t_out(t: Track, note: Note | None = None) -> dict:
    d = dict(id=t.id, uuid=t.uuid, owner_id=t.owner_id, title=t.title, artist=t.artist, genre=t.genre, mood=t.mood,
             description=t.description, cover_url=t.cover_url, size=t.size_bytes, duration=t.duration_seconds,
             mime_type=t.mime_type, original_filename=t.original_filename, file=os.path.basename(t.file_path),
             created_at=iso(t.created_at))
    if note: d["note"] = dict(id=note.id, title=note.title, text=note.text)
    return d


def p_out(db: Session, p: Playlist, with_items: bool = False, viewer: User | None = None) -> dict:
    rows = db.execute(select(PlaylistItem, Track).join(Track, Track.id == PlaylistItem.track_id)
                      .where(PlaylistItem.playlist_id == p.id, Track.removed_at.is_(None)).order_by(PlaylistItem.position, PlaylistItem.id)).all()
    owner = db.get(User, p.owner_id)
    role = playlist_role(db, p, viewer)
    d = dict(id=p.id, uuid=p.uuid, name=p.name, description=p.description, cover_url=p.cover_url, is_public=p.is_public,
             owner_id=p.owner_id, owner_name=owner.name if owner else "", is_owner=role == "owner", my_role=role,
             can_edit=role in ("owner", "editor"), tracks_count=len(rows), total_duration=sum(t.duration_seconds or 0 for _, t in rows),
             members_count=db.scalar(select(func.count()).select_from(PlaylistMember).where(PlaylistMember.playlist_id == p.id, PlaylistMember.status == "accepted")),
             created_at=iso(p.created_at))
    if with_items:
        d["items"] = [dict(item_id=i.id, position=i.position, added_by=i.added_by or p.owner_id, track=t_out(t)) for i, t in rows]
    return d


def renumber(db: Session, pid: int):
    items = db.scalars(select(PlaylistItem).where(PlaylistItem.playlist_id == pid).order_by(PlaylistItem.position, PlaylistItem.id)).all()
    for n, it in enumerate(items): it.position = n


# ---------- Работа с файлами ----------
async def save_upload(file: UploadFile, dest: Path, limit: int, too_big_msg: str | None = None) -> int:
    """Пишет файл частями; имя dest формирует приложение (имя от клиента в путь не попадает)."""
    dest = dest.resolve()
    if dest.parent != UPLOADS: raise HTTPException(400, "Недопустимый путь")
    size, too_big = 0, False
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit: too_big = True; break
            f.write(chunk)
    if too_big:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, too_big_msg or f"Файл слишком большой (максимум {fmt_size(limit)})")
    return size


async def save_image(file: UploadFile | None, stored_base: str) -> str | None:
    """Сохраняет обложку/аватар, возвращает /files/<имя> или None, если файла нет."""
    if not file or not file.filename: return None
    ext = Path(file.filename).suffix.lower()
    if ext not in IMAGE_MEDIA: raise HTTPException(400, "Допустимы только PNG/JPG/WEBP")
    stored = f"{stored_base}{ext}"
    await save_upload(file, UPLOADS / stored, MAX_IMAGE_BYTES)
    return f"/files/{stored}"


def remove_file(url_or_path: str | None):
    if url_or_path: (UPLOADS / os.path.basename(url_or_path)).unlink(missing_ok=True)


def looks_like_audio(path: Path, ext: str) -> bool:
    with open(path, "rb") as f: head = f.read(8192)
    if ext == ".wav": return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    return head[:3] == b"ID3" or any(head[i] == 0xFF and head[i + 1] & 0xE0 == 0xE0 for i in range(len(head) - 1))


def read_audio_meta(path: Path):
    """(duration, tag_title, tag_artist) — всё необязательно."""
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(str(path), easy=True)
        if audio is None: return None, "", ""
        length = getattr(getattr(audio, "info", None), "length", None)
        tags = audio.tags or {}
        first = lambda k: (tags.get(k) or [""])[0].strip() if hasattr(tags, "get") else ""
        return (int(length) if length else None), first("title"), first("artist")
    except Exception:
        return None, "", ""


def guess_from_filename(filename: str) -> tuple[str, str]:
    """«Исполнитель - Название.mp3» → (исполнитель, название)."""
    stem = Path(filename or "").stem.replace("_", " ").strip()
    artist, sep, title = stem.partition(" - ")
    if sep and artist.strip() and title.strip(): return artist.strip(), title.strip()
    return "", stem


def is_unknown(artist: str) -> bool:
    return artist.strip().lower() in {"", "unknown", "unknown artist", UNKNOWN_ARTIST.lower()}


def like(q: str, *values) -> bool:   # регистронезависимый поиск, работает и для кириллицы (SQLite LIKE — нет)
    q = q.casefold()
    return any(q in (v or "").casefold() for v in values)


def media_response(path: Path, request: Request, media_type: str, filename: str | None = None):
    """Отдача файла с поддержкой Range (перемотка в <audio>)."""
    if filename: return FileResponse(path, media_type=media_type, filename=filename)
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes"}
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("range", "").strip())
    if not m or not (m.group(1) or m.group(2)):
        return FileResponse(path, media_type=media_type, headers=headers)
    if m.group(1) == "":
        start, end = max(size - int(m.group(2)), 0), size - 1
    else:
        start, end = int(m.group(1)), min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
    if start >= size or start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    def body():
        with open(path, "rb") as f:
            f.seek(start); left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk: break
                left -= len(chunk); yield chunk

    headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
    return StreamingResponse(body(), status_code=206, media_type=media_type, headers=headers)


# ---------- Приложение ----------
def run_migrations():
    """Применяет Alembic-миграции при старте (то же, что `alembic upgrade head`)."""
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(BASE / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE / "alembic"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


TEMPLATES = [
    ("Спасибо за обращение", "Здравствуйте! Спасибо за обращение — мы проверили сообщение и приняли меры."),
    ("Нарушений не найдено", "Здравствуйте! Мы проверили материал и не нашли нарушений правил платформы."),
    ("Контент удалён", "Здравствуйте! Материал нарушал правила платформы и был удалён. Спасибо, что сообщили."),
    ("Предупреждение выдано", "Здравствуйте! По вашему обращению автору выдано предупреждение. Спасибо за бдительность."),
    ("Нужны подробности", "Здравствуйте! Уточните, пожалуйста, детали обращения, чтобы мы могли разобраться."),
]


SEED_ACCOUNTS = [   # (email, пароль, имя, ник, роль) — создаются один раз, если ещё нет
    ("admin@mail.test", "admin6130", "Администратор", "@admin", "admin"),
    ("moder@mail.test", "moder6130", "Модератор", "@moder", "moderator"),
]


def seed_defaults():
    with Session_() as db:
        for x in db.scalars(select(User).where(User.nickname.is_(None))): x.nickname = f"@user{x.id}"      # ники для старых аккаунтов
        db.flush()
        if ADMIN_EMAIL:
            u = db.scalar(select(User).where(User.email == ADMIN_EMAIL))
            if u and u.role != "admin": u.role = "admin"
        for email, password, name, nick, role in SEED_ACCOUNTS:
            u = db.scalar(select(User).where(User.email == email))
            if u is None:                                       # роль у существующего аккаунта НЕ трогаем: админ мог её отозвать
                db.add(User(email=email, name=name, nickname=nick, role=role, password_hash=bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()))
            elif (u.nickname or "").startswith("@user") and not db.scalar(select(User.id).where(User.nickname == nick)):
                u.nickname = nick
        if not db.scalar(select(ReplyTemplate.id).limit(1)):
            for title, text in TEMPLATES: db.add(ReplyTemplate(title=title, text=text))
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_migrations()
    seed_defaults()
    log.info("Музыкальное хранилище: БД = %s | загрузки = %s", engine.url.render_as_string(hide_password=True), UPLOADS)
    yield


app = FastAPI(title="Музыкальное хранилище", version=VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])


# --- авторизация ---
@app.post("/auth/register", status_code=201, response_model=TokenPair)
def register(c: RegisterIn, db: Session = Depends(get_db)):
    email = c.email.lower()
    if db.scalar(select(User).where(User.email == email)): raise HTTPException(400, "Email уже занят")
    if db.scalar(select(User.id).where(User.nickname == c.nickname)): raise HTTPException(400, "Этот ник уже занят")
    role = "admin" if ADMIN_EMAIL and email == ADMIN_EMAIL else "user"
    invite = db.scalar(select(ModeratorInvite).where(ModeratorInvite.email == email))
    if invite and role == "user": role = "moderator"           # приглашённый админом email получает роль модератора автоматически
    u = User(email=email, name=c.name, nickname=c.nickname, password_hash=bcrypt.hashpw(c.password.encode(), bcrypt.gensalt()).decode(),
             role=role, is_profile_public=get_setting(db, "new_profiles_public_by_default"))
    db.add(u); db.flush()
    if invite:
        db.add(AuditLog(actor_id=invite.created_by, actor_role="admin", action="moderator_invite_used", target_type="user", target_id=u.id, target_user_id=u.id, details=json.dumps({"email": email})))
        db.delete(invite)
    db.commit()
    log_event(db, "register", u.id)
    return tokens_for(u.id)


@app.get("/auth/nickname-available")
def nickname_available(nickname: str = Query("", max_length=40), db: Session = Depends(get_db)):
    n = nickname.strip().lower()
    return {"valid": bool(NICK_RE.match(n)) and n not in RESERVED_NICKS, "available": not db.scalar(select(User.id).where(User.nickname == n))}


@app.post("/auth/login", response_model=TokenPair)
def login(c: LoginIn, db: Session = Depends(get_db)):
    email = c.email.lower()
    u = db.scalar(select(User).where(User.email == email))
    if not u:                                           # email удалённого профиля освобождён; по паролю всё же скажем, что аккаунт удалён
        gone = db.scalar(select(User).where(User.deleted_email == email, User.deleted_at.is_not(None)).order_by(User.id.desc()))
        if gone and bcrypt.checkpw(c.password.encode()[:72], gone.password_hash.encode()): raise HTTPException(403, "Аккаунт удалён")
        raise HTTPException(401, "Неверный email или пароль")
    if not bcrypt.checkpw(c.password.encode()[:72], u.password_hash.encode()):
        raise HTTPException(401, "Неверный email или пароль")
    if u.deleted_at: raise HTTPException(403, "Аккаунт удалён")
    if u.is_banned: raise HTTPException(403, "Аккаунт заблокирован администрацией")
    log_event(db, "login", u.id)
    return tokens_for(u.id)


@app.post("/auth/refresh", response_model=TokenPair)
def refresh(c: RefreshIn, db: Session = Depends(get_db)):
    uid = decode_token(c.refresh_token, "refresh")
    if not is_active_user(db.get(User, uid)): raise HTTPException(401, "Пользователь не найден")
    return tokens_for(uid)


# --- профиль ---
@app.get("/users/me")
def me(u: User = Depends(need_user), db: Session = Depends(get_db)):
    n_tracks = db.scalar(select(func.count()).select_from(Track).where(Track.owner_id == u.id, Track.removed_at.is_(None)))
    n_pls = db.scalar(select(func.count()).select_from(Playlist).where(Playlist.owner_id == u.id, Playlist.removed_at.is_(None)))
    warns = db.scalar(select(func.count()).select_from(ModWarning).where(ModWarning.user_id == u.id, ModWarning.revoked_at.is_(None)))
    inbox = 0
    if u.role in STAFF:
        inbox = db.scalar(select(func.count()).select_from(Report).where(Report.status != "closed")) or 0
        if u.role == "admin": inbox += db.scalar(select(func.count()).select_from(DeletionRequest).where(DeletionRequest.status == "pending")) or 0
    return dict(id=u.id, nickname=u.nickname, inbox_count=inbox, email=u.email, name=u.name, about=u.about, avatar_url=u.avatar_url, music_interests=u.music_interests,
                favorite_artists=u.favorite_artists, is_profile_public=u.is_profile_public, theme=u.theme, role=u.role,
                taste_recs=u.taste_recs, tracks=n_tracks, playlists=n_pls, active_warnings=warns, created_at=iso(u.created_at),
                unread_notifications=db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == u.id, Notification.read_at.is_(None))),
                unread_messages=db.scalar(select(func.count()).select_from(Message).join(Chat, Chat.id == Message.chat_id).where(or_(Chat.user_a_id == u.id, Chat.user_b_id == u.id), Message.sender_id != u.id, Message.read_at.is_(None))),
                friend_requests=db.scalar(select(func.count()).select_from(Friendship).where(Friendship.addressee_id == u.id, Friendship.status == "pending")),
                platform=dict(recommendations_enabled=get_setting(db, "recommendations_enabled"), guest_listening_enabled=get_setting(db, "guest_listening_enabled")),
                limits=dict(track_max_seconds=MAX_TRACK_SECONDS, track_max_bytes=MAX_BYTES, image_max_bytes=MAX_IMAGE_BYTES, storage_limit=USER_QUOTA_BYTES))


@app.patch("/users/me")
def patch_me(p: ProfilePatch, u: User = Depends(need_user), db: Session = Depends(get_db)):
    for k, v in p.model_dump(exclude_none=True).items(): setattr(u, k, v)
    db.commit()
    return {"ok": True}


@app.get("/users/me/storage")
def my_storage(u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Занятое место и действующие лимиты загрузки (клиент берёт значения отсюда, а не из констант)."""
    return dict(used=used_storage(db, u.id), limit=USER_QUOTA_BYTES, track_max_seconds=MAX_TRACK_SECONDS,
                track_max_bytes=MAX_BYTES, image_max_bytes=MAX_IMAGE_BYTES)


@app.patch("/users/me/account")
def patch_account(p: AccountPatch, u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Имя, ник, email. Ник и email уникальны; для смены email нужен текущий пароль."""
    if p.nickname is not None and p.nickname != u.nickname:
        if db.scalar(select(User.id).where(User.nickname == p.nickname, User.id != u.id)): raise HTTPException(400, "Этот ник уже занят")
    if p.email is not None and p.email.lower() != u.email:
        email = p.email.lower()
        if ADMIN_EMAIL and u.email == ADMIN_EMAIL:
            raise HTTPException(403, "Email главного администратора меняется только через ADMIN_EMAIL в backend/.env")
        if not p.current_password or not bcrypt.checkpw(p.current_password.encode()[:72], u.password_hash.encode()):
            raise HTTPException(403, "Для смены email введите верный текущий пароль")
        if db.scalar(select(User.id).where(User.email == email, User.id != u.id)): raise HTTPException(400, "Email уже занят")
        u.email = email
    if p.name is not None: u.name = p.name
    if p.nickname is not None: u.nickname = p.nickname
    db.commit()
    return {"ok": True, "name": u.name, "nickname": u.nickname, "email": u.email}


@app.post("/users/me/password")
def change_password(p: PasswordChange, u: User = Depends(need_user), db: Session = Depends(get_db)):
    if not bcrypt.checkpw(p.current_password.encode()[:72], u.password_hash.encode()): raise HTTPException(403, "Неверный текущий пароль")
    if p.new_password == p.current_password: raise HTTPException(400, "Новый пароль совпадает с текущим")
    u.password_hash = bcrypt.hashpw(p.new_password.encode(), bcrypt.gensalt()).decode()
    db.commit()
    return {"ok": True}


@app.post("/users/me/filters", status_code=201)
def add_filter_value(f: FilterAddIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Сохраняет значение, добавленное в панели фильтров (а не при загрузке трека)."""
    saved = saved_filters(u)
    if f.value.casefold() not in {v.casefold() for v in saved[f.kind]}:
        if len(saved[f.kind]) >= 200: raise HTTPException(400, "Слишком много сохранённых значений")
        saved[f.kind].append(f.value)
        u.filter_options = json.dumps(saved, ensure_ascii=False)
        db.commit()
    return merged_filters(db, u)


@app.post("/users/me/avatar", status_code=201)
async def upload_avatar(file: UploadFile = File(...), u: User = Depends(need_user), db: Session = Depends(get_db)):
    old = u.avatar_url
    u.avatar_url = await save_image(file, f"avatar-{uuid.uuid4().hex}")
    db.commit()
    remove_file(old)
    return {"ok": True, "avatar_url": u.avatar_url}


# --- треки (основная сущность) ---
def saved_filters(u: User) -> dict:
    try: data = json.loads(u.filter_options or "{}")
    except ValueError: data = {}
    return {k: [str(v) for v in data.get(k, []) if isinstance(v, str)] for k in ("genres", "moods", "artists")}


def merged_filters(db: Session, u: User) -> dict:
    """Значения из треков пользователя + добавленные вручную в панели фильтров."""
    col = lambda c: {r[0] for r in db.execute(select(c).where(Track.owner_id == u.id)) if r[0]}
    own = {"genres": col(Track.genre), "moods": col(Track.mood), "artists": col(Track.artist)}
    saved = saved_filters(u)
    return {k: sorted(own[k] | set(saved[k]), key=str.casefold) for k in own}


@app.get("/tracks/filters")
def get_filters(u: User = Depends(need_user), db: Session = Depends(get_db)):
    return merged_filters(db, u)


def _json_list(raw: str | None) -> list[str]:
    if not raw: return []
    try: v = json.loads(raw)
    except ValueError: raise HTTPException(400, "Фильтры должны быть JSON-массивом")
    if not isinstance(v, list): raise HTTPException(400, "Фильтры должны быть JSON-массивом")
    return [str(x) for x in v]


@app.get("/tracks")
def list_tracks(q: str | None = None, genres: str | None = None, moods: str | None = None, artists: str | None = None,
                sort: str = Query("new", pattern="^(new|title|artist)$"),
                u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Поиск и фильтрация — query-параметры этого же эндпоинта. genres/moods/artists — JSON-массивы."""
    s = select(Track).where(Track.owner_id == u.id, Track.removed_at.is_(None))
    for col, raw in ((Track.genre, genres), (Track.mood, moods), (Track.artist, artists)):
        vals = _json_list(raw)
        if vals: s = s.where(col.in_(vals))
    tracks = db.scalars(s).all()
    notes = {n.track_id: n for n in db.scalars(select(Note).where(Note.owner_id == u.id, Note.track_id.is_not(None))).all()}
    if q and q.strip():
        tracks = [t for t in tracks if like(q.strip(), t.title, t.artist, t.description, t.genre, t.mood,
                                            notes[t.id].title if t.id in notes else "", notes[t.id].text if t.id in notes else "")]
    keys = {"new": lambda t: -t.id, "title": lambda t: t.title.casefold(), "artist": lambda t: (t.artist or "").casefold()}
    tracks.sort(key=keys[sort])
    return [t_out(t, notes.get(t.id)) for t in tracks]


@app.post("/tracks", status_code=201)
async def upload_track(file: UploadFile = File(...), title: str = Form("", max_length=200), artist: str = Form("", max_length=200),
                       genre: str | None = Form(None, max_length=100), mood: str | None = Form(None, max_length=100),
                       description: str = Form("", max_length=2000), cover: UploadFile | None = File(None),
                       u: User = Depends(need_user), db: Session = Depends(get_db)):
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED or (file.content_type or "application/octet-stream") not in ALLOWED[ext]:
        raise HTTPException(400, "Допустимы только MP3 и WAV")
    left = USER_QUOTA_BYTES - used_storage(db, u.id)      # суммарный объём треков пользователя ограничен (по умолчанию 7 ГБ)
    if left <= 0: raise HTTPException(400, f"Достигнут лимит хранилища: {fmt_size(USER_QUOTA_BYTES)}. Удалите ненужные треки, чтобы загрузить новые")
    quota_msg = f"Не хватает места: свободно {fmt_size(left)} из {fmt_size(USER_QUOTA_BYTES)}" if left < MAX_BYTES else None
    track_uuid = str(uuid.uuid4())
    stored = f"{track_uuid}{ext}"                       # имя файла формирует приложение, а не клиент
    dest = UPLOADS / stored
    size = await save_upload(file, dest, min(MAX_BYTES, left), quota_msg)
    cover_url = None
    try:
        if size == 0 or not looks_like_audio(dest, ext): raise HTTPException(400, "Файл не похож на корректный MP3/WAV")
        duration, tag_title, tag_artist = read_audio_meta(dest)
        if duration is not None and duration > MAX_TRACK_SECONDS:
            raise HTTPException(400, f"Трек слишком длинный: максимум {MAX_TRACK_SECONDS // 3600} ч" if MAX_TRACK_SECONDS % 3600 == 0 else f"Трек слишком длинный: максимум {MAX_TRACK_SECONDS // 60} мин")
        if duration is None and size > UNKNOWN_DURATION_MAX_BYTES:
            raise HTTPException(400, "Не удалось определить длительность файла, а он больше 50 МБ — проверьте, что файл не повреждён")
        guess_artist, guess_title = guess_from_filename(filename)
        final_title = (title.strip() or tag_title or guess_title or "Без названия")[:200]
        final_artist = next((a for a in (artist.strip(), tag_artist, guess_artist) if not is_unknown(a)), UNKNOWN_ARTIST)[:200]
        cover_url = await save_image(cover, f"cover-{track_uuid}")
        t = Track(owner_id=u.id, uuid=track_uuid, title=final_title, artist=final_artist,
                  genre=(genre or "").strip() or None, mood=(mood or "").strip() or None, description=description.strip(),
                  cover_url=cover_url, file_path=f"uploads/{stored}", original_filename=os.path.basename(filename)[:300],
                  size_bytes=size, duration_seconds=duration, mime_type=AUDIO_MEDIA[ext])
        db.add(t); db.commit()
    except Exception:
        dest.unlink(missing_ok=True); remove_file(cover_url)
        raise
    return t_out(t)


@app.get("/tracks/{tid}")
def one_track(tid: int, u: User | None = Depends(opt_user), db: Session = Depends(get_db)):
    t = get_track(db, tid, u)
    note = db.scalar(select(Note).where(Note.owner_id == u.id, Note.track_id == tid)) if u else None
    return t_out(t, note)


@app.patch("/tracks/{tid}")
def patch_track(tid: int, p: TrackPatch, u: User = Depends(need_user), db: Session = Depends(get_db)):
    t = get_track(db, tid, u, write=True)               # владелец проверяется до изменения
    for k in p.model_fields_set:
        v = getattr(p, k)
        if k == "title" and v is None: continue         # название обязательно
        setattr(t, k, (v or None) if k in ("genre", "mood") else (v if v is not None else ""))
    if is_unknown(t.artist): t.artist = UNKNOWN_ARTIST
    db.commit()
    return t_out(t)


@app.delete("/tracks/{tid}", status_code=204)
def del_track(tid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    t = get_track(db, tid, u, write=True)
    files = [t.file_path, t.cover_url]
    db.execute(delete(PlaylistItem).where(PlaylistItem.track_id == tid))
    db.execute(delete(Comment).where(Comment.track_id == tid))
    db.execute(delete(Note).where(Note.track_id == tid))
    db.delete(t); db.commit()
    for f in files: remove_file(f)
    return Response(status_code=204)


# --- файлы ---
@app.get("/files/{name}")
def get_file(name: str, request: Request, download: bool = False, u: User | None = Depends(opt_user), db: Session = Depends(get_db)):
    safe = Path(name).name
    path = (UPLOADS / safe).resolve()
    if path.parent != UPLOADS or not path.is_file(): raise HTTPException(404, "Файл не найден")
    if safe.startswith("post-"):                        # картинки постов: только тем, кто видит пост
        img = db.scalar(select(PostImage).where(PostImage.file_name == safe))
        post = db.get(Post, img.post_id) if img else None
        if not post or not can_view_post(db, u, post): raise HTTPException(404, "Файл не найден")
        return FileResponse(path, media_type=IMAGE_MEDIA.get(path.suffix.lower(), "application/octet-stream"))
    if safe.startswith(IMAGE_PREFIXES):                 # аватары и обложки: имена непредсказуемы (uuid)
        return FileResponse(path, media_type=IMAGE_MEDIA.get(path.suffix.lower(), "application/octet-stream"))
    t = db.scalar(select(Track).where(Track.file_path == f"uploads/{safe}"))
    if not t: raise HTTPException(404, "Файл не найден")
    if download and not u: raise HTTPException(401, "Гостям скачивание недоступно")
    get_track(db, t.id, u)                              # владелец / участник / публичный плейлист / пост / чат
    fname = (t.original_filename or f"{t.title}{path.suffix}") if download else None
    return media_response(path, request, AUDIO_MEDIA.get(path.suffix.lower(), "application/octet-stream"), fname)


# --- плейлисты ---
@app.get("/playlists")
def list_playlists(u: User = Depends(need_user), db: Session = Depends(get_db)):
    own = db.scalars(select(Playlist).where(Playlist.owner_id == u.id, Playlist.removed_at.is_(None))).all()
    shared = db.scalars(select(Playlist).join(PlaylistMember, PlaylistMember.playlist_id == Playlist.id)
                        .where(PlaylistMember.user_id == u.id, PlaylistMember.status == "accepted", Playlist.removed_at.is_(None))).all()
    pls = sorted({p.id: p for p in [*own, *shared]}.values(), key=lambda p: -p.id)
    return [p_out(db, p, viewer=u) for p in pls if is_active_user(db.get(User, p.owner_id))]


@app.post("/playlists", status_code=201)
def create_playlist(p: PlaylistIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    pl = Playlist(owner_id=u.id, uuid=str(uuid.uuid4()), name=p.name, description=p.description, is_public=p.is_public)
    db.add(pl); db.commit()
    return p_out(db, pl, with_items=True, viewer=u)


@app.get("/playlists/{pid}")
def one_playlist(pid: int, u: User | None = Depends(opt_user), db: Session = Depends(get_db)):
    """Публичный плейлист доступен по ссылке без авторизации (гость: только слушать)."""
    return p_out(db, get_playlist(db, pid, u), with_items=True, viewer=u)


@app.patch("/playlists/{pid}")
def patch_playlist(pid: int, p: PlaylistPatch, u: User = Depends(need_user), db: Session = Depends(get_db)):
    pl = get_playlist(db, pid, u, write=True)
    if p.name is not None: pl.name = p.name
    if p.description is not None: pl.description = p.description
    if p.is_public is not None: pl.is_public = p.is_public
    db.commit()
    return p_out(db, pl, with_items=True, viewer=u)


@app.post("/playlists/{pid}/cover")
async def playlist_cover(pid: int, cover: UploadFile = File(...), u: User = Depends(need_user), db: Session = Depends(get_db)):
    pl = get_playlist(db, pid, u, write=True)
    old = pl.cover_url
    pl.cover_url = await save_image(cover, f"playlist-cover-{pl.uuid}-{uuid.uuid4().hex[:8]}")
    db.commit()
    if old != pl.cover_url: remove_file(old)
    return p_out(db, pl, with_items=True, viewer=u)


@app.delete("/playlists/{pid}", status_code=204)
def del_playlist(pid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    pl = get_playlist(db, pid, u, write=True)
    cover = pl.cover_url
    db.execute(delete(PlaylistItem).where(PlaylistItem.playlist_id == pid))
    db.execute(delete(PlaylistMember).where(PlaylistMember.playlist_id == pid))
    db.execute(delete(Note).where(Note.playlist_id == pid))
    db.delete(pl); db.commit()
    remove_file(cover)
    return Response(status_code=204)


@app.post("/playlists/{pid}/items", status_code=201)
def add_item(pid: int, i: ItemIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    get_playlist(db, pid, u, perm="edit")                # владелец или соавтор-editor
    get_track(db, i.track_id, u, write=True)             # добавлять можно только свои треки
    if db.scalar(select(PlaylistItem.id).where(PlaylistItem.playlist_id == pid, PlaylistItem.track_id == i.track_id)):
        raise HTTPException(400, "Трек уже есть в плейлисте")
    pos = db.scalar(select(func.coalesce(func.max(PlaylistItem.position), -1)).where(PlaylistItem.playlist_id == pid)) + 1
    it = PlaylistItem(playlist_id=pid, track_id=i.track_id, position=pos, added_by=u.id)
    db.add(it); db.commit()
    return {"item_id": it.id, "position": it.position}


@app.put("/playlists/{pid}/items/order")
def reorder_items(pid: int, o: OrderIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Задаёт порядок треков: item_ids — все элементы плейлиста в новом порядке."""
    get_playlist(db, pid, u, perm="edit")
    items = {it.id: it for it in db.scalars(select(PlaylistItem).where(PlaylistItem.playlist_id == pid))}
    if len(o.item_ids) != len(set(o.item_ids)) or set(o.item_ids) != set(items):
        raise HTTPException(400, "item_ids должен содержать все элементы плейлиста ровно по одному разу")
    for pos, iid in enumerate(o.item_ids): items[iid].position = pos
    db.commit()
    return p_out(db, db.get(Playlist, pid), with_items=True, viewer=u)


@app.delete("/playlists/{pid}/items/{item_id}", status_code=204)
def del_item(pid: int, item_id: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    pl = get_playlist(db, pid, u, perm="edit")
    it = db.get(PlaylistItem, item_id)
    if not it or it.playlist_id != pid: raise HTTPException(404, "Элемент не найден")
    if pl.owner_id != u.id and (it.added_by or pl.owner_id) != u.id: raise HTTPException(403, "Соавтор может убирать только свои треки")
    db.delete(it); db.flush(); renumber(db, pid); db.commit()
    return Response(status_code=204)


# --- комментарии ---
@app.get("/tracks/{tid}/comments")
def comments(tid: int, u: User | None = Depends(opt_user), db: Session = Depends(get_db)):
    get_track(db, tid, u)
    hidden = blocked_ids(db, u.id) if u else set()
    rows = db.execute(select(Comment, User.name).join(User, User.id == Comment.author_id)
                      .where(Comment.track_id == tid, Comment.removed_at.is_(None)).order_by(Comment.id.desc())).all()
    return [dict(id=c.id, author=n, author_id=c.author_id, text=c.text, created_at=iso(c.created_at)) for c, n in rows if c.author_id not in hidden]


@app.post("/tracks/{tid}/comments", status_code=201)
def add_comment(tid: int, c: CommentIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    t = get_track(db, tid, u)
    db.add(Comment(track_id=tid, author_id=u.id, text=c.text))
    if t.owner_id != u.id: notify(db, t.owner_id, "comment", f"{u.name} прокомментировал(а) ваш трек «{t.title}»", u, "track", t.id)
    db.commit()
    return {"ok": True}


@app.delete("/comments/{cid}", status_code=204)
def del_comment(cid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    c = db.get(Comment, cid)
    if not c or c.removed_at: raise HTTPException(404, "Комментарий не найден")
    track = db.get(Track, c.track_id)
    if c.author_id != u.id and track.owner_id != u.id: raise HTTPException(403, "Нет прав")
    db.delete(c); db.commit()
    return Response(status_code=204)


# --- заметки ---
def n_out(n: Note) -> dict:
    return dict(id=n.id, title=n.title, text=n.text, track_id=n.track_id, playlist_id=n.playlist_id,
                created_at=iso(n.created_at), updated_at=iso(n.updated_at))


@app.get("/notes")
def notes(u: User = Depends(need_user), db: Session = Depends(get_db)):
    return [n_out(n) for n in db.scalars(select(Note).where(Note.owner_id == u.id).order_by(Note.id.desc()))]


@app.post("/notes", status_code=201)
def add_note(n: NoteIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    if n.track_id is not None: get_track(db, n.track_id, u)            # к доступному треку
    if n.playlist_id is not None: get_playlist(db, n.playlist_id, u)   # к доступному плейлисту
    note = Note(owner_id=u.id, **n.model_dump())
    db.add(note); db.commit()
    return n_out(note)


@app.patch("/notes/{nid}")
def patch_note(nid: int, p: NotePatch, u: User = Depends(need_user), db: Session = Depends(get_db)):
    n = db.get(Note, nid)
    if not n: raise HTTPException(404, "Заметка не найдена")
    if n.owner_id != u.id: raise HTTPException(403, "Нет прав")
    for k, v in p.model_dump(exclude_none=True).items(): setattr(n, k, v)
    db.commit()
    return n_out(n)


@app.delete("/notes/{nid}", status_code=204)
def del_note(nid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    n = db.get(Note, nid)
    if not n: raise HTTPException(404, "Заметка не найдена")
    if n.owner_id != u.id: raise HTTPException(403, "Нет прав")
    db.delete(n); db.commit()
    return Response(status_code=204)


# --- социальные разделы, чаты, модерация, администрирование ---
from app import routes_social, routes_chat, routes_staff, routes_admin  # noqa: E402
for _r in (routes_social.router, routes_chat.router, routes_staff.router, routes_admin.router):
    app.include_router(_r)
