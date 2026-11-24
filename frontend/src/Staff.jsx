import React, { useState, useEffect } from 'react'
import { Trash2, AlertTriangle, UserX, MessageSquareReply, Check, X, Plus, Eye, EyeOff } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { API, fileUrl, fmtDate, Avatar, RoleBadge, Seg, Pill, Modal } from './ui.jsx'

const TYPES = { post: 'Пост', comment: 'Комментарий', playlist: 'Плейлист', track: 'Трек', profile: 'Профиль', support: 'Поддержка' }
const STATUS = { open: 'Новая', in_progress: 'В работе', closed: 'Закрыта' }
const PRIO = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' }
const prioTone = { high: 'danger', normal: 'neutral', low: 'ok' }
const Empty = ({ children }) => <div className="empty"><Mascot state="idle" size={72} /><div className="mut">{children}</div></div>

const STAFF_TABS = [['staff-reports', 'Жалобы'], ['staff-warnings', 'Предупреждения'], ['staff-users', 'Профили'], ['staff-templates', 'Шаблоны'], ['staff-history', 'Моя история']]
const ADMIN_TABS = [['admin-deletions', 'Удаление профилей'], ['admin-stats', 'Статистика'], ['admin-users', 'Пользователи и роли'], ['admin-moderators', 'Модераторы'], ['admin-removed', 'Удалённое'], ['admin-logs', 'Журналы'], ['admin-settings', 'Настройки']]

/** Подменю модерации/администрирования. */
export function StaffNav({ view, go, me }) {
  const tabs = me.role === 'admin' ? [...STAFF_TABS, ...ADMIN_TABS] : STAFF_TABS
  const cur = view.name === 'staff-report' ? 'staff-reports' : view.name
  return <div className="subnav">{tabs.map(([k, l]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</div>
}

export function StatusPills({ s }) {
  return <span className="pills">
    <Pill tone={s.profile === 'public' ? 'ok' : 'neutral'}>{s.profile === 'public' ? <><Eye size={11} /> открытый</> : <><EyeOff size={11} /> закрытый</>}</Pill>
    {s.active_warnings > 0 && <Pill tone="warn"><AlertTriangle size={11} /> предупр. {s.active_warnings}</Pill>}
    {s.banned && <Pill tone="danger">бан</Pill>}{s.deleted && <Pill tone="danger">удалён</Pill>}{s.deletion_pending && <Pill tone="warn">запрос на удаление</Pill>}
    {s.blocked_by > 0 && <Pill>заблокировали: {s.blocked_by}</Pill>}{s.blocks_made > 0 && <Pill>блокирует: {s.blocks_made}</Pill>}
  </span>
}

/* ===== очередь жалоб ===== */
export function ReportQueue(c) {
  const [f, setF] = useState({ content_type: '', status: 'open', priority: '', q: '' }); const [d, setD] = useState(null)
  const load = () => c.run(async () => { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); setD(await c.api(`/staff/reports?${p}`)) })
  useEffect(() => { load() }, [f.content_type, f.status, f.priority])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <StaffNav {...c} /><h2>Очередь жалоб</h2>
      <div className="card filters-bar">
        <select value={f.content_type} onChange={set('content_type')}><option value="">Все типы</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.status} onChange={set('status')}><option value="">Все статусы</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.priority} onChange={set('priority')}><option value="">Любой приоритет</option>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input placeholder="Поиск по имени / №" value={f.q} onChange={set('q')} onKeyDown={(e) => e.key === 'Enter' && load()} />
      </div>
      {d && <div className="mut">Новых: {d.counts.open} · в работе: {d.counts.in_progress} · закрыто: {d.counts.closed}</div>}
      {d?.items.map(r => (
        <div key={r.id} className="card report-row" onClick={() => c.go('staff-report', { id: r.id })}>
          <b>№{r.id}</b><Pill>{TYPES[r.content_type]}</Pill><Pill tone={prioTone[r.priority]}>{PRIO[r.priority]}</Pill><Pill tone={r.status === 'closed' ? 'ok' : 'warn'}>{STATUS[r.status]}</Pill>
          <span className="mut grow">{r.reporter?.name} → {r.target?.name || '—'}</span><small className="mut">{fmtDate(r.created_at)}</small>
        </div>))}
      {d && !d.items.length && <Empty>Жалоб по фильтру нет.</Empty>}
    </>
  )
}

/* ===== карточка жалобы ===== */
export function ReportCard({ id, ...c }) {
  const [d, setD] = useState(null); const [tpls, setTpls] = useState([]); const [reply, setReply] = useState(''); const [close, setClose] = useState(true); const [reason, setReason] = useState('')
  const load = () => c.run(async () => { setD(await c.api(`/staff/reports/${id}`)); setTpls(await c.api('/staff/templates')) })
  useEffect(() => { load() }, [id])
  const post = (path, body = {}, msg) => c.run(async () => { await c.api(`/staff/reports/${id}/${path}`, { method: 'POST', body }); if (msg) alert(msg); await load() })
  if (!d) return null
  const r = d.report, ct = d.content, closed = r.status === 'closed'
  return (
    <>
      <StaffNav {...c} view={{ name: 'staff-report' }} /><button className="back-btn" onClick={() => c.go('staff-reports')}>← К очереди</button>
      <h2>Жалоба №{r.id} <Pill tone={prioTone[r.priority]}>{PRIO[r.priority]}</Pill> <Pill tone={closed ? 'ok' : 'warn'}>{STATUS[r.status]}</Pill></h2>
      <div className="card"><h3>Контент: {TYPES[r.content_type]}</h3>
        <div className="mut">Категория: {r.category}{d.reason && <> · «{d.reason}»</>}</div>
        {ct.hidden && <div className="field-warn">🔒 {ct.note}. Доступны только статусы автора, предупреждение, ответ и запрос на удаление профиля.</div>}
        {ct.gone && <div className="mut">Контент уже удалён.</div>}
        {!ct.hidden && !ct.gone && <div className="content-box">
          {ct.name && <b>{ct.name}</b>}{ct.title && <b>{ct.title} — {ct.artist}</b>}{ct.text && <p>{ct.text}</p>}
          {ct.images?.length > 0 && <div className="img-grid n2">{ct.images.map(n => <img key={n} src={fileUrl(`/files/${n}`)} alt="" />)}</div>}
          {ct.tracks?.map(t => <div key={t.id} className="mut">🎵 {t.title} — {t.artist}</div>)}</div>}
      </div>
      <div className="two-col">
        {d.author && <div className="card"><h3>Автор</h3><div className="row"><Avatar u={d.author} size={36} /><b>{d.author.name}</b><RoleBadge role={d.author.role} /></div><StatusPills s={d.author} /></div>}
        <div className="card"><h3>Жалобщик</h3><div className="row"><Avatar u={d.reporter} size={36} /><b>{d.reporter.name}</b></div><StatusPills s={d.reporter} /></div>
      </div>
      <div className="card"><h3>История</h3>
        {d.replies.map(x => <div key={x.id} className="hist"><b>{x.author}</b> <small className="mut">{fmtDate(x.created_at)}</small><div>{x.text}</div></div>)}
        {d.history.actions.map(a => <div key={a.id} className="hist mut">{fmtDate(a.created_at)} · {a.actor_role}: {a.action}</div>)}
        {d.history.other_reports.length > 0 && <div className="mut">Другие жалобы на этот объект: {d.history.other_reports.map(o => `№${o.id}`).join(', ')}</div>}
        {!d.replies.length && !d.history.actions.length && <span className="mut">Действий пока нет.</span>}
      </div>
      {!closed && <div className="card"><h3>Действия</h3>
        <div className="row wrap">
          <button onClick={() => c.run(async () => { await c.api(`/staff/reports/${id}`, { method: 'PATCH', body: { take: true } }); await load() })}>Взять в работу</button>
          <select value={r.priority} onChange={(e) => c.run(async () => { await c.api(`/staff/reports/${id}`, { method: 'PATCH', body: { priority: e.target.value } }); await load() })}>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>Приоритет: {v}</option>)}</select>
        </div>
        <div className="field"><label>Причина (для действий ниже)</label><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Например: оскорбления в тексте поста" /></div>
        <div className="row wrap">
          {d.can_delete_content && <button className="del" onClick={() => window.confirm('Удалить контент?') && post('delete-content', { reason })}><Trash2 size={14} /> Удалить контент</button>}
          {d.author && <button onClick={() => post('warn', { reason }, 'Предупреждение выдано')}><AlertTriangle size={14} /> Предупреждение автору</button>}
          {d.author && <button className="del" onClick={() => window.confirm('Создать запрос на удаление профиля? Он вступит в силу только после подтверждения администратором.') && post('request-deletion', { reason: reason || 'Нарушение правил' }, 'Запрос отправлен администратору')}><UserX size={14} /> Запросить удаление профиля</button>}
        </div>
        <div className="field" style={{ marginTop: 14 }}><label>Ответ автору жалобы</label>
          <select value="" onChange={(e) => { const t = tpls.find(x => String(x.id) === e.target.value); if (t) setReply(t.text) }}><option value="">— шаблон ответа —</option>{tpls.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          <textarea rows="3" maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} style={{ marginTop: 8 }} /></div>
        <label className="checkbox-row"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /><span>Закрыть жалобу после ответа</span></label>
        <button className="pri" disabled={!reply.trim()} onClick={() => post('reply', { text: reply, close, resolution: reason }, 'Ответ отправлен').then(() => setReply(''))}><MessageSquareReply size={14} /> Ответить</button>
        <button style={{ marginLeft: 8 }} onClick={() => post('close', { reason })}>Закрыть без ответа</button>
      </div>}
      {closed && <div className="card mut">Жалоба закрыта. Итог: {d.resolution || '—'}</div>}
    </>
  )
}

/* ===== предупреждения ===== */
export function Warnings(c) {
  const [list, setList] = useState([]); const [st, setSt] = useState('active'); const [nick, setNick] = useState(''); const [why, setWhy] = useState('')
  const load = () => c.run(async () => setList(await c.api(`/staff/warnings?status=${st}`)))
  useEffect(() => { load() }, [st])
  return (
    <>
      <StaffNav {...c} /><h2>Предупреждения</h2>
      <div className="card"><div className="row wrap"><input placeholder="@ник пользователя" value={nick} onChange={(e) => setNick(e.target.value)} style={{ maxWidth: 190 }} /><input placeholder="Причина" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} />
        <button className="pri" disabled={nick.trim().length < 4 || why.length < 3} onClick={() => c.run(async () => { await c.api('/staff/warnings', { method: 'POST', body: { nickname: nick.trim(), reason: why } }); setNick(''); setWhy(''); await load() })}><Plus size={14} /> Выдать</button></div>
        <small className="mut">Ник пользователя — в разделе «Профили».</small></div>
      <Seg value={st} onChange={setSt} options={[['active', 'Активные'], ['revoked', 'Отозванные'], ['all', 'Все']]} />
      {list.map(w => <div key={w.id} className="card row between"><div><b>{w.user.name}</b> <small className="mut">{w.user.nickname} · {fmtDate(w.created_at)}</small><div>{w.reason}</div></div>
        {w.revoked ? <Pill tone="ok">отозвано</Pill> : <button onClick={() => c.run(async () => { await c.api(`/staff/warnings/${w.id}/revoke`, { method: 'POST' }); await load() })}>Отозвать</button>}</div>)}
      {!list.length && <Empty>Нет предупреждений.</Empty>}
    </>
  )
}

/* ===== профили со статусами ===== */
export function StaffUsers(c) {
  const [q, setQ] = useState(''); const [profile, setProfile] = useState(''); const [flag, setFlag] = useState(''); const [list, setList] = useState([]); const [sel, setSel] = useState(null)
  const load = () => c.run(async () => setList(await c.api(`/staff/users?${new URLSearchParams(Object.entries({ q, profile, flag }).filter(([, v]) => v))}`)))
  useEffect(() => { load() }, [profile, flag])
  const open = (id) => c.run(async () => setSel(await c.api(`/staff/users/${id}`)))
  const reqDel = (u) => { const why = window.prompt(`Причина запроса на удаление профиля «${u.name}» (подтверждает администратор):`); if (why && why.length >= 3) c.run(async () => { await c.api('/staff/deletion-requests', { method: 'POST', body: { user_id: u.id, reason: why } }); alert('Запрос отправлен администратору'); await load() }) }
  const delNow = (u) => { const why = window.prompt(`Удалить профиль «${u.name}» (${u.nickname})? Причина:`); if (why !== null) c.run(async () => { await c.api(`/admin/users/${u.id}/delete`, { method: 'POST', body: { reason: why } }); setSel(null); await load() }) }
  return (
    <>
      <StaffNav {...c} /><h2>Профили и статусы</h2>
      <p className="mut">Закрытый контент пользователей и чаты вам недоступны — только статусы профилей.</p>
      <div className="card filters-bar"><input placeholder="Имя или @ник" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">Любой профиль</option><option value="public">Открытые</option><option value="private">Закрытые</option></select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)}><option value="">Любые статусы</option><option value="warned">С предупреждениями</option><option value="banned">Забаненные</option><option value="blocked">Блокируют другие</option></select></div>
      {list.map(u => <div key={u.id} className="card report-row" onClick={() => open(u.id)}><Avatar u={u} size={36} /><b>{u.name}</b> <small className="mut">{u.nickname}</small><RoleBadge role={u.role} /><StatusPills s={u} /></div>)}
      {sel && <Modal title={`${sel.name} · ${sel.nickname}`} onClose={() => setSel(null)} footer={sel.role === 'user' && !sel.deleted && (c.me?.role === 'admin' ? <button className="del" onClick={() => delNow(sel)}><Trash2 size={14} /> Удалить профиль</button> : <button className="del" onClick={() => reqDel(sel)}><UserX size={14} /> Запросить удаление</button>)}>
        <StatusPills s={sel} />
        {sel.public ? <div className="content-box">{sel.public.about && <p>{sel.public.about}</p>}<div className="mut">{sel.public.music_interests}</div></div> : <div className="field-warn">🔒 Профиль закрыт — содержимое недоступно.</div>}
        <h4>Предупреждения</h4>{sel.warnings.map(w => <div key={w.id} className="hist">{fmtDate(w.created_at)} · {w.reason} {w.revoked && <Pill tone="ok">отозвано</Pill>}</div>)}{!sel.warnings.length && <span className="mut">Нет</span>}
      </Modal>}
    </>
  )
}

/* ===== шаблоны ответов ===== */
export function Templates(c) {
  const [list, setList] = useState([]); const [t, setT] = useState({ title: '', text: '' })
  const load = () => c.run(async () => setList(await c.api('/staff/templates')))
  useEffect(() => { load() }, [])
  return (
    <>
      <StaffNav {...c} /><h2>Шаблоны ответов</h2>
      <div className="card"><div className="field"><input placeholder="Название" value={t.title} maxLength={100} onChange={(e) => setT({ ...t, title: e.target.value })} /></div>
        <div className="field"><textarea rows="3" placeholder="Текст ответа" value={t.text} maxLength={2000} onChange={(e) => setT({ ...t, text: e.target.value })} /></div>
        <button className="pri" disabled={!t.title.trim() || !t.text.trim()} onClick={() => c.run(async () => { await c.api('/staff/templates', { method: 'POST', body: t }); setT({ title: '', text: '' }); await load() })}><Plus size={14} /> Добавить</button></div>
      {list.map(x => <div key={x.id} className="card row between"><div><b>{x.title}</b><div className="mut">{x.text}</div></div><button className="icon-btn del" onClick={() => c.run(async () => { await c.api(`/staff/templates/${x.id}`, { method: 'DELETE' }); await load() })}><Trash2 size={14} /></button></div>)}
    </>
  )
}

/* ===== история действий модератора ===== */
export const ACTION_NAME = { delete_content: 'Удалил контент', warn: 'Выдал предупреждение', revoke_warning: 'Отозвал предупреждение', reply_report: 'Ответил на жалобу', close_report: 'Закрыл жалобу',
  request_deletion: 'Запросил удаление профиля', confirm_deletion: 'Подтвердил удаление профиля', reject_deletion: 'Отклонил удаление профиля', report_update: 'Изменил жалобу', restore: 'Восстановил', delete_profile: 'Удалил профиль', moderator_invite: 'Пригласил модератора', moderator_invite_cancel: 'Отменил приглашение модератора', moderator_invite_used: 'Приглашённый стал модератором', role_change: 'Сменил роль', ban: 'Заблокировал аккаунт', unban: 'Разблокировал аккаунт', settings_change: 'Изменил настройки' }

export function MyHistory(c) {
  const [list, setList] = useState([])
  useEffect(() => { c.run(async () => setList(await c.api('/staff/actions'))) }, [])
  return (
    <>
      <StaffNav {...c} /><h2>Моя история действий</h2>
      {list.map(a => <div key={a.id} className="card row between"><span><b>{ACTION_NAME[a.action] || a.action}</b> <span className="mut">{a.target_type} {a.target_user ? `· ${a.target_user.name}` : ''}</span></span><small className="mut">{fmtDate(a.created_at)}</small></div>)}
      {!list.length && <Empty>Пока нет действий.</Empty>}
    </>
  )
}
