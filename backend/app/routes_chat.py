"""Чаты «как в TikTok»: текст и пересылка контента (треки, плейлисты, посты), без голосовых/видео.
Писать друг другу могут любые пользователи (не только друзья), если нет блокировки; чат с модерацией открывает модератор.
Содержимое чатов недоступно никому, кроме двух участников, — модераторы и администраторы тоже не читают чужие чаты.
«Избранное» — личные закладки на сообщения: видны только тому, кто их поставил."""
from fastapi import APIRouter
from sqlalchemy.exc import IntegrityError
from app.main import *  # noqa: F401,F403
from app.routes_social import card, post_out

router = APIRouter(prefix="/chats")

PET_STAGES = [(0, "Икринка"), (10, "Планула"), (50, "Эфира"), (150, "Медуза"), (400, "Сияющая медуза")]


class ChatIn(BaseModel):
    user_id: int


class MessageIn(Strip):
    kind: Literal["text", "track", "playlist", "post"] = "text"
    text: str = Field("", max_length=1000)
    ref_id: int | None = None


def pet_out(c: Chat) -> dict | None:
    """Медуза-питомец: растёт от активности в чате; серия (streak) — дни подряд, когда писали оба."""
    if c.kind != "dm": return None
    stage = max(i for i, (th, _) in enumerate(PET_STAGES) if c.pet_xp >= th)
    nxt = PET_STAGES[stage + 1][0] if stage + 1 < len(PET_STAGES) else None
    base = PET_STAGES[stage][0]
    today = now().date()
    alive = c.streak_date and (today - dt.date.fromisoformat(c.streak_date)).days <= 1
    return dict(xp=c.pet_xp, stage=stage, stage_name=PET_STAGES[stage][1], next_at=nxt,
                progress=100 if nxt is None else int((c.pet_xp - base) * 100 / (nxt - base)),
                streak=c.streak if alive else 0, streak_today=c.streak_date == today.isoformat(),
                needs_reply=bool(alive and c.streak_date != today.isoformat()))


def get_chat(db: Session, cid: int, u: User) -> Chat:
    """Строго участник: никакого доступа «по роли» — для администраторов тоже 404."""
    c = db.get(Chat, cid)
    if not c or u.id not in (c.user_a_id, c.user_b_id): raise HTTPException(404, "Чат не найден")
    other = c.user_b_id if c.user_a_id == u.id else c.user_a_id
    if not is_active_user(db.get(User, other)) or blocked_between(db, u.id, other): raise HTTPException(404, "Чат не найден")
    return c


def chat_out(db: Session, c: Chat, u: User) -> dict:
    oid = c.user_b_id if c.user_a_id == u.id else c.user_a_id
    other = db.get(User, oid)
    last = db.scalar(select(Message).where(Message.chat_id == c.id).order_by(Message.id.desc()).limit(1))
    unread = db.scalar(select(func.count()).select_from(Message).where(Message.chat_id == c.id, Message.sender_id != u.id, Message.read_at.is_(None)))
    preview = {"track": "🎵 Трек", "playlist": "📃 Плейлист", "post": "📝 Пост"}.get(last.kind, "") if last else ""
    return dict(id=c.id, kind=c.kind, with_staff=is_staff(other), other=card(other), unread=unread, pet=pet_out(c),
                last=dict(text=(last.text or preview)[:80], mine=last.sender_id == u.id, created_at=iso(last.created_at)) if last else None)


def msg_out(m: Message, u: User, favs: set[int] | frozenset = frozenset()) -> dict:
    return dict(id=m.id, mine=m.sender_id == u.id, sender_id=m.sender_id, kind=m.kind, text=m.text, ref_id=m.ref_id, created_at=iso(m.created_at),
                read=m.read_at is not None, fav=m.id in favs)


def open_chat(db: Session, a: User, b: User, kind: str) -> Chat:
    lo, hi = sorted((a.id, b.id))
    c = db.scalar(select(Chat).where(Chat.user_a_id == lo, Chat.user_b_id == hi))
    if not c:
        c = Chat(user_a_id=lo, user_b_id=hi, kind=kind); db.add(c); db.flush()
    return c


@router.get("")
def my_chats(u: User = Depends(need_user), db: Session = Depends(get_db)):
    hid = blocked_ids(db, u.id)
    rows = db.scalars(select(Chat).where(or_(Chat.user_a_id == u.id, Chat.user_b_id == u.id))).all()
    out = []
    for c in rows:
        oid = c.user_b_id if c.user_a_id == u.id else c.user_a_id
        if oid in hid or not is_active_user(db.get(User, oid)): continue
        out.append(chat_out(db, c, u))
    return sorted(out, key=lambda x: (x["last"]["created_at"] if x["last"] else ""), reverse=True)


@router.get("/favorites")
def favorite_messages(u: User = Depends(need_user), db: Session = Depends(get_db)):
    """Все сохранённые сообщения пользователя (новые закладки сверху). Чаты с заблокированными/удалёнными не показываются."""
    hid = blocked_ids(db, u.id)
    rows = db.execute(select(MessageFavorite, Message, Chat).join(Message, Message.id == MessageFavorite.message_id).join(Chat, Chat.id == Message.chat_id)
                      .where(MessageFavorite.user_id == u.id).order_by(MessageFavorite.id.desc()).limit(200)).all()
    out = []
    for f, m, c in rows:
        if u.id not in (c.user_a_id, c.user_b_id): continue
        oid = c.user_b_id if c.user_a_id == u.id else c.user_a_id
        other = db.get(User, oid)
        if oid in hid or not is_active_user(other): continue
        out.append(dict(msg_out(m, u, {m.id}), chat_id=c.id, other=card(other), with_staff=is_staff(other), saved_at=iso(f.created_at)))
    return out


@router.post("", status_code=201)
def start_chat(r: ChatIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    if r.user_id == u.id: raise HTTPException(400, "Нельзя написать самому себе")
    x = db.get(User, r.user_id)
    if not is_active_user(x) or blocked_between(db, u.id, x.id): raise HTTPException(404, "Пользователь не найден")
    if is_staff(x) or is_staff(u):
        c = db.scalar(select(Chat).where(Chat.user_a_id == min(u.id, x.id), Chat.user_b_id == max(u.id, x.id)))
        if not c: raise HTTPException(403, "Чат с модератором создаёт сам модератор. Нужна помощь — отправьте обращение в поддержку.")
    else:
        c = open_chat(db, u, x, "dm")                      # любой пользователь может написать любому (блокировка проверена выше)
    db.commit()
    return chat_out(db, c, u)


@router.get("/{cid}")
def read_chat(cid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    c = get_chat(db, cid, u)
    for m in db.scalars(select(Message).where(Message.chat_id == cid, Message.sender_id != u.id, Message.read_at.is_(None))): m.read_at = now()
    db.commit()
    msgs = db.scalars(select(Message).where(Message.chat_id == cid).order_by(Message.id.desc()).limit(200)).all()[::-1]
    favs = {r[0] for r in db.execute(select(MessageFavorite.message_id).where(MessageFavorite.user_id == u.id, MessageFavorite.message_id.in_([m.id for m in msgs])))} if msgs else set()
    return dict(chat=chat_out(db, c, u), messages=[msg_out(m, u, favs) for m in msgs])


@router.post("/{cid}/messages", status_code=201)
def send_message(cid: int, m: MessageIn, u: User = Depends(need_user), db: Session = Depends(get_db)):
    c = get_chat(db, cid, u)
    if m.kind == "text":
        if not m.text.strip(): raise HTTPException(422, "Пустое сообщение")
    else:
        if m.ref_id is None: raise HTTPException(422, "Не указан объект")
        if m.kind == "track": get_track(db, m.ref_id, u, write=True)                     # делиться можно своими треками
        elif m.kind == "playlist":
            p = get_playlist(db, m.ref_id, u)
            if p.owner_id != u.id and not p.is_public: raise HTTPException(403, "Этим плейлистом делиться нельзя")
        else:
            p = db.get(Post, m.ref_id)
            if not p or not can_view_post(db, u, p) or (p.author_id != u.id and p.visibility != "public"): raise HTTPException(403, "Этим постом делиться нельзя")
    db.add(Message(chat_id=cid, sender_id=u.id, kind=m.kind, text=m.text.strip(), ref_id=m.ref_id))
    if c.kind == "dm":                                     # питомец и серия
        today = now().date(); iso_today = today.isoformat()
        if u.id == c.user_a_id: c.last_day_a = iso_today
        else: c.last_day_b = iso_today
        c.pet_xp += 1 if m.kind == "text" else 3
        if c.last_day_a == iso_today and c.last_day_b == iso_today and c.streak_date != iso_today:
            c.streak = c.streak + 1 if c.streak_date == (today - dt.timedelta(days=1)).isoformat() else 1
            c.streak_date = iso_today
    elif is_staff(u):
        other = c.user_b_id if c.user_a_id == u.id else c.user_a_id
        notify(db, other, "support_message", "Новое сообщение от модерации", u, "chat", c.id)
    db.commit()
    log_event(db, "message", u.id)
    return read_chat(cid, u, db)


def _own_message(db: Session, cid: int, mid: int, u: User) -> Message:
    get_chat(db, cid, u)                                   # только участник чата (и без блокировки)
    m = db.get(Message, mid)
    if not m or m.chat_id != cid: raise HTTPException(404, "Сообщение не найдено")
    return m


@router.put("/{cid}/messages/{mid}/favorite")
def add_favorite(cid: int, mid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    _own_message(db, cid, mid, u)
    if not db.scalar(select(MessageFavorite.id).where(MessageFavorite.user_id == u.id, MessageFavorite.message_id == mid)):
        db.add(MessageFavorite(user_id=u.id, message_id=mid))
        try: db.commit()
        except IntegrityError: db.rollback()               # двойной тап — закладка уже есть
    return {"ok": True, "fav": True}


@router.delete("/{cid}/messages/{mid}/favorite")
def remove_favorite(cid: int, mid: int, u: User = Depends(need_user), db: Session = Depends(get_db)):
    _own_message(db, cid, mid, u)
    db.execute(delete(MessageFavorite).where(MessageFavorite.user_id == u.id, MessageFavorite.message_id == mid)); db.commit()
    return {"ok": True, "fav": False}
