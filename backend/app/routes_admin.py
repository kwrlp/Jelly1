"""Администрирование: подтверждение удаления профилей, статистика, пользователи и роли, восстановление, журналы, настройки.
Те же ограничения: закрытый контент и чаты недоступны и администратору — только профили со статусами."""
from fastapi import APIRouter
from app.main import *  # noqa: F401,F403
from app.routes_staff import status_of, staff_view, log_out

router = APIRouter(prefix="/admin")


# ---------- очередь подтверждения удаления профилей ----------
@router.get("/deletion-requests")
def deletion_queue(status: str = "pending", u: User = Depends(need_admin), db: Session = Depends(get_db)):
    s = select(DeletionRequest)
    if status != "all": s = s.where(DeletionRequest.status == status)
    out = []
    for d in db.scalars(s.order_by(DeletionRequest.id.desc()).limit(200)):
        x, by = db.get(User, d.user_id), db.get(User, d.requested_by)
        out.append(dict(id=d.id, status=d.status, reason=d.reason, report_id=d.report_id, created_at=iso(d.created_at), decided_at=iso(d.decided_at) if d.decided_at else None,
                        user=status_of(db, x) if x else None, requested_by=dict(id=by.id, name=by.name, role=by.role) if by else None))
    return out


class DecisionIn(Strip):
    note: str = Field("", max_length=500)


def decide(db: Session, d: DeletionRequest | None, u: User, ok: bool, note: str):
    if not d or d.status != "pending": raise HTTPException(404, "Запрос не найден или уже обработан")
    x = db.get(User, d.user_id)
    d.status, d.decided_by, d.decided_at = ("confirmed" if ok else "rejected"), u.id, now()
    if ok and x:
        soft_delete_user(db, x)                               # мягкое удаление: профиль и контент скрыты, вход закрыт, email и ник освобождены
    audit(db, u, "confirm_deletion" if ok else "reject_deletion", "user", d.user_id, d.user_id, request_id=d.id, note=note)
    if d.requested_by != u.id: notify(db, d.requested_by, "deletion_decision", f"Запрос на удаление профиля №{d.id} {'подтверждён' if ok else 'отклонён'}", u, "user", d.user_id)
    db.commit()


@router.post("/deletion-requests/{did}/confirm")
def confirm_deletion(did: int, a: DecisionIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    decide(db, db.get(DeletionRequest, did), u, True, a.note); return {"ok": True}


@router.post("/deletion-requests/{did}/reject")
def reject_deletion(did: int, a: DecisionIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    decide(db, db.get(DeletionRequest, did), u, False, a.note); return {"ok": True}


# ---------- пользователи и роли ----------
@router.get("/users")
def users(q: str = "", role: str | None = None, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    s = select(User).order_by(User.id.desc()).limit(500)
    if role: s = select(User).where(User.role == role).order_by(User.id.desc()).limit(500)
    rows = [dict(status_of(db, x), email=(x.deleted_email or x.email) if x.deleted_at else x.email, ban_reason=x.ban_reason) for x in db.scalars(s)]
    if q.strip(): rows = [r for r in rows if like(q.strip(), r["name"], r["email"], r["nickname"] or "")]
    return rows[:100]


class RoleIn(BaseModel):
    role: Literal["user", "moderator", "admin"]


@router.patch("/users/{uid}/role")
def set_role(uid: int, r: RoleIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x or x.deleted_at: raise HTTPException(404, "Пользователь не найден")
    if x.id == u.id: raise HTTPException(400, "Нельзя изменить собственную роль")
    old, x.role = x.role, r.role
    audit(db, u, "role_change", "user", uid, uid, old=old, new=r.role)
    notify(db, uid, "role", f"Ваша роль изменена: {r.role}", u, "user", uid)
    db.commit()
    return {"ok": True}


class BanIn(Strip):
    banned: bool
    reason: str = Field("", max_length=300)


@router.post("/users/{uid}/ban")
def ban_user(uid: int, b: BanIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x or x.deleted_at: raise HTTPException(404, "Пользователь не найден")
    if x.id == u.id or x.role == "admin": raise HTTPException(403, "Этого пользователя заблокировать нельзя")
    x.is_banned, x.ban_reason = b.banned, b.reason if b.banned else ""
    audit(db, u, "ban" if b.banned else "unban", "user", uid, uid, reason=b.reason)
    db.commit()
    return {"ok": True}


# ---------- вкладка «Модераторы» ----------
class ModIn(Strip):
    email: str = Field(min_length=3, max_length=255)


@router.get("/moderators")
def moderators(u: User = Depends(need_admin), db: Session = Depends(get_db)):
    mods = [dict(status_of(db, x), email=x.email) for x in db.scalars(select(User).where(User.role == "moderator", User.deleted_at.is_(None)).order_by(User.name))]
    inv = [dict(id=i.id, email=i.email, created_at=iso(i.created_at)) for i in db.scalars(select(ModeratorInvite).order_by(ModeratorInvite.id.desc()))]
    return dict(moderators=mods, invites=inv)


@router.post("/moderators", status_code=201)
def add_moderator(m: ModIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    """Аккаунт есть — роль обновляется сразу (интерфейс подхватит при следующем запросе/входе). Аккаунта нет — роль выдаётся при регистрации с этим email."""
    email = m.email.strip().lower()
    x = db.scalar(select(User).where(User.email == email))
    if x:
        if x.deleted_at: raise HTTPException(400, "Профиль удалён")
        if x.role == "admin": raise HTTPException(400, "Это администратор")
        if x.role == "moderator": raise HTTPException(400, "Уже модератор")
        x.role = "moderator"
        audit(db, u, "role_change", "user", x.id, x.id, old="user", new="moderator", via="moderators_tab")
        notify(db, x.id, "role", "Вам назначена роль модератора. Раздел «Модерация» появится в меню.", u, "user", x.id)
        db.commit()
        return {"status": "assigned", "user": status_of(db, x)}
    if db.scalar(select(ModeratorInvite.id).where(ModeratorInvite.email == email)): raise HTTPException(400, "Приглашение для этого email уже создано")
    db.add(ModeratorInvite(email=email, created_by=u.id))
    audit(db, u, "moderator_invite", "user", None, None, email=email)
    db.commit()
    return {"status": "invited"}


@router.delete("/moderators/invites/{iid}", status_code=204)
def cancel_invite(iid: int, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    i = db.get(ModeratorInvite, iid)
    if i:
        audit(db, u, "moderator_invite_cancel", "user", None, None, email=i.email); db.delete(i); db.commit()
    return Response(status_code=204)


@router.delete("/moderators/{uid}", status_code=204)
def revoke_moderator(uid: int, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    x = db.get(User, uid)
    if not x or x.role != "moderator": raise HTTPException(404, "Модератор не найден")
    x.role = "user"
    audit(db, u, "role_change", "user", uid, uid, old="moderator", new="user", via="moderators_tab")
    notify(db, uid, "role", "Роль модератора отозвана.", u, "user", uid)
    db.commit()
    return Response(status_code=204)


# ---------- прямое удаление профиля администратором ----------
class DeleteUserIn(Strip):
    reason: str = Field("", max_length=500)


@router.post("/users/{uid}/delete")
def delete_profile(uid: int, a: DeleteUserIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    """Администратор удаляет профиль сам (его решение и есть подтверждение). Мягкое удаление — восстановление в «Удалённом»."""
    x = db.get(User, uid)
    if not x or x.deleted_at: raise HTTPException(404, "Пользователь не найден")
    if x.id == u.id or x.role == "admin": raise HTTPException(403, "Этот профиль удалить нельзя")
    soft_delete_user(db, x)
    for d in db.scalars(select(DeletionRequest).where(DeletionRequest.user_id == uid, DeletionRequest.status == "pending")):
        d.status, d.decided_by, d.decided_at = "confirmed", u.id, now()
    audit(db, u, "delete_profile", "user", uid, uid, reason=a.reason)
    db.commit()
    return {"ok": True}


# ---------- контент и профили: удаление / восстановление ----------
MODELS = {"post": Post, "comment": Comment, "playlist": Playlist, "track": Track}


class ContentRef(Strip):
    type: Literal["post", "comment", "playlist", "track"]
    id: int
    reason: str = Field("", max_length=500)


@router.post("/content/delete")
def admin_delete_content(c: ContentRef, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    """Удалить можно только то, что публично видно (закрытый контент администратору недоступен)."""
    view = staff_view(db, Report(content_type=c.type, content_id=c.id))
    if view.get("hidden") or view.get("gone"): raise HTTPException(403, "Контент закрыт или удалён — недоступно")
    obj = db.get(MODELS[c.type], c.id); obj.removed_at = now()
    owner = getattr(obj, "author_id", None) or getattr(obj, "owner_id", None)
    audit(db, u, "delete_content", c.type, c.id, owner, reason=c.reason)
    if owner: notify(db, owner, "content_removed", f"Ваш контент удалён администрацией{': ' + c.reason if c.reason else ''}", u, c.type, c.id)
    db.commit()
    return {"ok": True}


@router.get("/removed")
def removed(u: User = Depends(need_admin), db: Session = Depends(get_db)):
    """Только метаданные: что удалено, чьё и когда. Тексты и файлы не показываются."""
    items = []
    for kind, M in MODELS.items():
        for o in db.scalars(select(M).where(M.removed_at.is_not(None)).order_by(M.id.desc()).limit(50)):
            owner = getattr(o, "author_id", None) or getattr(o, "owner_id", None)
            ou = db.get(User, owner) if owner else None
            items.append(dict(type=kind, id=o.id, owner=dict(id=ou.id, name=ou.name) if ou else None, removed_at=iso(o.removed_at)))
    users_ = [dict(type="user", id=x.id, owner=dict(id=x.id, name=x.name, nickname=x.deleted_nickname or x.nickname), removed_at=iso(x.deleted_at)) for x in db.scalars(select(User).where(User.deleted_at.is_not(None)).order_by(User.id.desc()).limit(50))]
    return sorted(items + users_, key=lambda r: r["removed_at"], reverse=True)


class RestoreIn(BaseModel):
    type: Literal["post", "comment", "playlist", "track", "user"]
    id: int


@router.post("/restore")
def restore(r: RestoreIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    if r.type == "user":
        x = db.get(User, r.id)
        if not x or not x.deleted_at: raise HTTPException(404, "Профиль не удалён")
        restore_user(db, x); owner = x.id
    else:
        o = db.get(MODELS[r.type], r.id)
        if not o or not o.removed_at: raise HTTPException(404, "Контент не удалён")
        o.removed_at = None; owner = getattr(o, "author_id", None) or getattr(o, "owner_id", None)
    audit(db, u, "restore", r.type, r.id, owner)
    db.commit()
    return {"ok": True}


# ---------- журналы ----------
@router.get("/logs")
def logs(scope: str = "all", actor_id: int | None = None, action: str | None = None, target_user_id: int | None = None,
         date_from: dt.date | None = None, date_to: dt.date | None = None, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
         u: User = Depends(need_admin), db: Session = Depends(get_db)):
    """scope: admin — журнал администраторов, moderator — журнал модераторов, all — всё."""
    s = select(AuditLog)
    if scope in ("admin", "moderator"): s = s.where(AuditLog.actor_role == scope)
    if actor_id: s = s.where(AuditLog.actor_id == actor_id)
    if action: s = s.where(AuditLog.action == action)
    if target_user_id: s = s.where(AuditLog.target_user_id == target_user_id)
    if date_from: s = s.where(AuditLog.created_at >= dt.datetime.combine(date_from, dt.time.min))
    if date_to: s = s.where(AuditLog.created_at < dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min))
    total = db.scalar(select(func.count()).select_from(s.subquery()))
    rows = db.scalars(s.order_by(AuditLog.id.desc()).offset(offset).limit(limit)).all()
    return dict(total=total, items=[log_out(db, a) for a in rows])


@router.get("/logs/meta")
def logs_meta(u: User = Depends(need_admin), db: Session = Depends(get_db)):
    actions = [r[0] for r in db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action))]
    staff = [dict(id=x.id, name=x.name, role=x.role) for x in db.scalars(select(User).where(User.role.in_(STAFF)).order_by(User.name))]
    return dict(actions=actions, staff=staff)


@router.get("/logs/{lid}")
def log_detail(lid: int, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    a = db.get(AuditLog, lid)
    if not a: raise HTTPException(404, "Запись не найдена")
    try: details = json.loads(a.details or "{}")
    except ValueError: details = {}
    return dict(log_out(db, a), details=details)


# ---------- настройки платформы ----------
class SettingsIn(BaseModel):
    recommendations_enabled: bool | None = None
    guest_listening_enabled: bool | None = None
    new_profiles_public_by_default: bool | None = None
    search_users_enabled: bool | None = None


@router.get("/settings")
def get_settings(u: User = Depends(need_admin), db: Session = Depends(get_db)):
    return {k: get_setting(db, k) for k in SETTINGS_DEFAULTS}


@router.put("/settings")
def put_settings(s: SettingsIn, u: User = Depends(need_admin), db: Session = Depends(get_db)):
    changed = {}
    for k, v in s.model_dump(exclude_none=True).items():
        row = db.get(PlatformSetting, k) or PlatformSetting(key=k, value="")
        row.value = "1" if v else "0"; db.add(row); changed[k] = v
    if changed: audit(db, u, "settings_change", "settings", None, None, **changed)
    db.commit()
    return {k: get_setting(db, k) for k in SETTINGS_DEFAULTS}


# ---------- статистика ----------
@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=365), date_from: dt.date | None = None, date_to: dt.date | None = None,
          u: User = Depends(need_admin), db: Session = Depends(get_db)):
    end = date_to or now().date()
    start = date_from or (end - dt.timedelta(days=days - 1))
    if start > end or (end - start).days > 400: raise HTTPException(400, "Некорректный период")
    rows = db.execute(select(Event.kind, Event.user_id, Event.visitor_id, Event.created_at)
                      .where(Event.created_at >= dt.datetime.combine(start - dt.timedelta(days=6), dt.time.min),
                             Event.created_at < dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min))).all()
    per_day: dict[dt.date, list] = {}
    for k, uid, vid, ts in rows: per_day.setdefault(ts.date(), []).append((k, uid, vid))
    series, day = [], start
    while day <= end:
        ev = per_day.get(day, [])
        active = lambda d: {uid for _, uid, _ in per_day.get(d, []) if uid}
        week = set().union(*[active(day - dt.timedelta(days=i)) for i in range(7)])
        cnt = lambda kind: sum(1 for k, _, _ in ev if k == kind)
        series.append(dict(date=day.isoformat(), visits=cnt("visit"), unique_visitors=len({(uid or vid) for k, uid, vid in ev if k == "visit" and (uid or vid)}),
                           registrations=cnt("register"), logins=cnt("login"), listens=cnt("listen"), posts=cnt("post"), messages=cnt("message"),
                           dau=len(active(day)), wau=len(week)))
        day += dt.timedelta(days=1)
    tot = lambda k: sum(r[k] for r in series)
    return dict(period=dict(from_=start.isoformat(), to=end.isoformat(), days=len(series)), series=series,
                totals=dict(visits=tot("visits"), registrations=tot("registrations"), listens=tot("listens"), posts=tot("posts"), messages=tot("messages"),
                            dau_avg=round(tot("dau") / max(len(series), 1), 1), wau_last=series[-1]["wau"],
                            users_total=db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None))),
                            tracks_total=db.scalar(select(func.count()).select_from(Track).where(Track.removed_at.is_(None)))))
