import React, { useState, useEffect } from 'react'
import { Check, X, RotateCcw, Trash2, Plus } from 'lucide-react'
import Mascot from './Mascot.jsx'
import LineChart from './Charts.jsx'
import { fmtDate, Avatar, RoleBadge, Seg, Pill, Modal, Toggle } from './ui.jsx'
import { StaffNav, StatusPills, ACTION_NAME } from './Staff.jsx'

const Empty = ({ children }) => <div className="empty"><Mascot state="idle" size={72} /><div className="mut">{children}</div></div>

/* ===== подтверждение удаления профилей ===== */
export function DeletionQueue(c) {
  const [st, setSt] = useState('pending'); const [list, setList] = useState([])
  const load = () => c.run(async () => setList(await c.api(`/admin/deletion-requests?status=${st}`)))
  useEffect(() => { load() }, [st])
  const decide = (id, ok) => { const note = window.prompt(ok ? 'Подтвердить удаление профиля? Комментарий (необязательно):' : 'Причина отказа:'); if (note !== null) c.run(async () => { await c.api(`/admin/deletion-requests/${id}/${ok ? 'confirm' : 'reject'}`, { method: 'POST', body: { note } }); await load(); c.refreshMe() }) }
  return (
    <>
      <StaffNav {...c} /><h2>Подтверждение удаления профилей</h2>
      <p className="mut">Модераторы лишь инициируют удаление — оно вступает в силу после вашего подтверждения.</p>
      <Seg value={st} onChange={setSt} options={[['pending', 'Ожидают'], ['all', 'Все']]} />
      {list.map(d => (
        <div key={d.id} className="card"><div className="row between"><div className="row"><Avatar u={d.user} size={40} /><b>{d.user?.name}</b><RoleBadge role={d.user?.role} /></div><Pill tone={d.status === 'pending' ? 'warn' : d.status === 'confirmed' ? 'danger' : 'ok'}>{{ pending: 'ждёт решения', confirmed: 'подтверждено', rejected: 'отклонено' }[d.status]}</Pill></div>
          {d.user && <StatusPills s={d.user} />}
          <p>Причина: {d.reason}</p><small className="mut">Запросил: {d.requested_by?.name} ({d.requested_by?.role}) · {fmtDate(d.created_at)}{d.report_id ? ` · жалоба №${d.report_id}` : ''}</small>
          {d.status === 'pending' && <div className="row" style={{ marginTop: 10 }}><button className="del" onClick={() => decide(d.id, true)}><Check size={14} /> Подтвердить удаление</button><button onClick={() => decide(d.id, false)}><X size={14} /> Отклонить</button></div>}
        </div>))}
      {!list.length && <Empty>Запросов нет.</Empty>}
    </>
  )
}

/* ===== статистика ===== */
const KEYS = {
  traffic: [{ key: 'visits', label: 'Визиты', color: 'var(--primary)' }, { key: 'unique_visitors', label: 'Уникальные', color: 'var(--accent)' }, { key: 'registrations', label: 'Регистрации', color: 'var(--secondary)' }],
  active: [{ key: 'dau', label: 'DAU', color: 'var(--primary)' }, { key: 'wau', label: 'WAU', color: 'var(--accent)' }],
  content: [{ key: 'posts', label: 'Посты', color: 'var(--primary)' }, { key: 'listens', label: 'Прослушивания', color: 'var(--accent)' }, { key: 'messages', label: 'Сообщения', color: 'var(--secondary)' }],
}
export function Stats(c) {
  const [days, setDays] = useState(30); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [d, setD] = useState(null)
  const load = () => c.run(async () => setD(await c.api(`/admin/stats?${from && to ? `date_from=${from}&date_to=${to}` : `days=${days}`}`)))
  useEffect(() => { load() }, [days])
  const t = d?.totals
  return (
    <>
      <StaffNav {...c} /><h2>Статистика</h2>
      <div className="card filters-bar"><Seg value={from && to ? 'custom' : String(days)} onChange={(v) => { setFrom(''); setTo(''); setDays(Number(v)) }} options={[['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']]} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button disabled={!from || !to} onClick={load}>Применить</button></div>
      {t && <div className="kpis">{[['Визиты', t.visits], ['Регистрации', t.registrations], ['DAU (сред.)', t.dau_avg], ['WAU (сейчас)', t.wau_last], ['Посты', t.posts], ['Прослушивания', t.listens], ['Сообщения', t.messages], ['Пользователей', t.users_total]].map(([l, v]) => <div key={l} className="card kpi"><b>{v}</b><span className="mut">{l}</span></div>)}</div>}
      {d && <>
        <div className="card"><h3>Трафик и регистрации</h3><LineChart series={d.series} keys={KEYS.traffic} /></div>
        <div className="card"><h3>Активность (DAU / WAU)</h3><LineChart series={d.series} keys={KEYS.active} /></div>
        <div className="card"><h3>Контент и общение</h3><LineChart series={d.series} keys={KEYS.content} /></div></>}
    </>
  )
}

/* ===== пользователи и роли ===== */
export function UsersRoles(c) {
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [list, setList] = useState([])
  const load = () => c.run(async () => setList(await c.api(`/admin/users?${new URLSearchParams(Object.entries({ q, role }).filter(([, v]) => v))}`)))
  useEffect(() => { load() }, [role])
  const setR = (u, r) => window.confirm(`Назначить ${u.name} роль «${r}»?`) && c.run(async () => { await c.api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role: r } }); await load() })
  const ban = (u) => { const on = !u.banned; const why = on ? window.prompt(`Причина блокировки аккаунта ${u.name}:`) : ''; if (why !== null) c.run(async () => { await c.api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { banned: on, reason: why || '' } }); await load() }) }
  const delProfile = (u) => { const why = window.prompt(`Удалить профиль «${u.name}» (${u.nickname})? Он будет скрыт, вход закрыт; восстановить можно во вкладке «Удалённое». Причина:`); if (why !== null) c.run(async () => { await c.api(`/admin/users/${u.id}/delete`, { method: 'POST', body: { reason: why } }); await load() }) }
  return (
    <>
      <StaffNav {...c} /><h2>Пользователи и роли</h2>
      <div className="card filters-bar"><input placeholder="Имя, @ник или email" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="">Все роли</option><option value="user">Пользователи</option><option value="moderator">Модераторы</option><option value="admin">Админы</option></select></div>
      {list.map(u => (
        <div key={u.id} className="card"><div className="row between wrap"><div className="row"><Avatar u={u} size={38} /><div><b>{u.name}</b> <small className="mut">{u.nickname} · {u.email}</small><div><StatusPills s={u} /></div></div></div>
          <div className="row">{u.id !== c.me.id && <>
            <select value={u.role} onChange={(e) => setR(u, e.target.value)}><option value="user">Пользователь</option><option value="moderator">Модератор</option><option value="admin">Администратор</option></select>
            {u.role !== 'admin' && !u.deleted && <button className={u.banned ? '' : 'del'} onClick={() => ban(u)}>{u.banned ? 'Разблокировать' : 'Заблокировать'}</button>}
            {u.role !== 'admin' && !u.deleted && <button className="del" onClick={() => delProfile(u)}><Trash2 size={14} /> Удалить профиль</button>}</>}</div></div></div>))}
    </>
  )
}

/* ===== удалённое: восстановление и удаление ===== */
export function Removed(c) {
  const [list, setList] = useState([]); const [f, setF] = useState({ type: 'post', id: '', reason: '' })
  const load = () => c.run(async () => setList(await c.api('/admin/removed')))
  useEffect(() => { load() }, [])
  const NAME = { post: 'Пост', comment: 'Комментарий', playlist: 'Плейлист', track: 'Трек', user: 'Профиль' }
  return (
    <>
      <StaffNav {...c} /><h2>Контент и профили</h2>
      <p className="mut">Здесь только метаданные удалённого. Закрытый контент администратору недоступен, тексты не показываются.</p>
      <div className="card"><h3>Удалить публичный контент</h3><div className="row wrap"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(NAME).filter(([k]) => k !== 'user').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="number" placeholder="ID" value={f.id} style={{ maxWidth: 110 }} onChange={(e) => setF({ ...f, id: e.target.value })} /><input placeholder="Причина" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <button className="del" disabled={!f.id} onClick={() => c.run(async () => { await c.api('/admin/content/delete', { method: 'POST', body: { type: f.type, id: Number(f.id), reason: f.reason } }); setF({ ...f, id: '', reason: '' }); await load() })}><Trash2 size={14} /> Удалить</button></div></div>
      <h3>Удалённое</h3>
      {list.map(r => <div key={`${r.type}${r.id}`} className="card row between"><span><Pill>{NAME[r.type]}</Pill> #{r.id} <span className="mut">· {r.owner?.name} · {fmtDate(r.removed_at)}</span></span>
        <button onClick={() => c.run(async () => { await c.api('/admin/restore', { method: 'POST', body: { type: r.type, id: r.id } }); await load() })}><RotateCcw size={14} /> Восстановить</button></div>)}
      {!list.length && <Empty>Удалённого нет.</Empty>}
    </>
  )
}

/* ===== журналы ===== */
export function Logs(c) {
  const [f, setF] = useState({ scope: 'all', actor_id: '', action: '', date_from: '', date_to: '' }); const [meta, setMeta] = useState({ actions: [], staff: [] })
  const [d, setD] = useState({ total: 0, items: [] }); const [offset, setOffset] = useState(0); const [rec, setRec] = useState(null)
  const load = () => c.run(async () => setD(await c.api(`/admin/logs?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), offset })}`)))
  useEffect(() => { c.run(async () => setMeta(await c.api('/admin/logs/meta'))) }, [])
  useEffect(() => { load() }, [f.scope, f.actor_id, f.action, f.date_from, f.date_to, offset])
  const set = (k) => (e) => { setOffset(0); setF({ ...f, [k]: e.target.value }) }
  const open = (id) => c.run(async () => setRec(await c.api(`/admin/logs/${id}`)))
  return (
    <>
      <StaffNav {...c} /><h2>Журналы действий</h2>
      <Seg value={f.scope} onChange={(v) => { setOffset(0); setF({ ...f, scope: v }) }} options={[['all', 'Все'], ['moderator', 'Модераторы'], ['admin', 'Администраторы']]} />
      <div className="card filters-bar">
        <select value={f.actor_id} onChange={set('actor_id')}><option value="">Все сотрудники</option>{meta.staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}</select>
        <select value={f.action} onChange={set('action')}><option value="">Все действия</option>{meta.actions.map(a => <option key={a} value={a}>{ACTION_NAME[a] || a}</option>)}</select>
        <input type="date" value={f.date_from} onChange={set('date_from')} /><input type="date" value={f.date_to} onChange={set('date_to')} /></div>
      <div className="mut">Записей: {d.total}</div>
      {d.items.map(a => <div key={a.id} className="card report-row" onClick={() => open(a.id)}><Pill tone={a.actor_role === 'admin' ? 'accent' : 'neutral'}>{a.actor_role}</Pill><b>{a.actor.name}</b><span>{ACTION_NAME[a.action] || a.action}</span><span className="mut grow">{a.target_type}{a.target_user ? ` · ${a.target_user.name}` : ''}</span><small className="mut">{fmtDate(a.created_at)}</small></div>)}
      <div className="row"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>← Назад</button><button disabled={offset + 50 >= d.total} onClick={() => setOffset(offset + 50)}>Далее →</button></div>
      {rec && <Modal title={`Запись №${rec.id}`} onClose={() => setRec(null)}>
        <p><b>{rec.actor.name}</b> ({rec.actor_role}) — {ACTION_NAME[rec.action] || rec.action}</p><p className="mut">{fmtDate(rec.created_at)} · объект: {rec.target_type} {rec.target_id ?? ''} {rec.target_user ? `· ${rec.target_user.name}` : ''}</p>
        <pre className="json">{JSON.stringify(rec.details, null, 2)}</pre></Modal>}
    </>
  )
}

/* ===== настройки платформы ===== */
export function PlatformSettings(c) {
  const [s, setS] = useState(null)
  useEffect(() => { c.run(async () => setS(await c.api('/admin/settings'))) }, [])
  const put = (k, v) => c.run(async () => setS(await c.api('/admin/settings', { method: 'PUT', body: { [k]: v } })))
  if (!s) return null
  return (
    <>
      <StaffNav {...c} /><h2>Настройки платформы</h2>
      <div className="card">
        <Toggle checked={s.recommendations_enabled} onChange={(v) => put('recommendations_enabled', v)} label="Рекомендации по вкусу" hint="Если выключить, ни у кого не будет показываться подборка людей и постов со схожим вкусом." /><hr />
        <Toggle checked={s.guest_listening_enabled} onChange={(v) => put('guest_listening_enabled', v)} label="Гостевое прослушивание" hint="Публичные плейлисты по ссылке открываются без входа (только слушать, скачивать нельзя)." /><hr />
        <Toggle checked={s.new_profiles_public_by_default} onChange={(v) => put('new_profiles_public_by_default', v)} label="Новые профили открыты по умолчанию" hint="По умолчанию профиль новых пользователей закрытый." /><hr />
        <Toggle checked={s.search_users_enabled} onChange={(v) => put('search_users_enabled', v)} label="Поиск людей" hint="Открытые профили находятся через глобальный поиск." />
      </div>
    </>
  )
}

/* ===== вкладка «Модераторы» ===== */
export function Moderators(c) {
  const [d, setD] = useState({ moderators: [], invites: [] }); const [email, setEmail] = useState('')
  const load = () => c.run(async () => setD(await c.api('/admin/moderators')))
  useEffect(() => { load() }, [])
  const add = () => c.run(async () => {
    const r = await c.api('/admin/moderators', { method: 'POST', body: { email } })
    alert(r.status === 'assigned' ? 'Аккаунт найден — роль модератора назначена.' : 'Аккаунта с таким email ещё нет. Роль модератора будет выдана автоматически при регистрации.')
    setEmail(''); await load()
  })
  const revoke = (m) => window.confirm(`Отозвать роль модератора у ${m.name} (${m.nickname})?`) && c.run(async () => { await c.api(`/admin/moderators/${m.id}`, { method: 'DELETE' }); await load() })
  return (
    <>
      <StaffNav {...c} /><h2>Модераторы</h2>
      <div className="card">
        <div className="field"><label>Назначить по email</label>
          <input type="text" placeholder="moderator@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && add()} /></div>
        <p className="mut">Если аккаунт уже есть — роль и разделы модерации обновятся сразу (в крайнем случае при следующем входе). Если нет — при регистрации с этим email роль модератора выдаётся автоматически.</p>
        <button className="pri" disabled={!email.includes('@')} onClick={add}><Plus size={14} /> Назначить</button>
      </div>
      <h3>Модераторы ({d.moderators.length})</h3>
      {d.moderators.map(m => (
        <div key={m.id} className="card row between wrap"><div className="row"><Avatar u={m} size={38} /><div><b>{m.name}</b> <small className="nick">{m.nickname}</small><div className="mut">{m.email}</div><StatusPills s={m} /></div></div>
          <button className="del" onClick={() => revoke(m)}><X size={14} /> Отозвать роль</button></div>))}
      {!d.moderators.length && <Empty>Модераторов пока нет.</Empty>}
      {d.invites.length > 0 && <><h3>Ожидают регистрации</h3>
        {d.invites.map(i => <div key={i.id} className="card row between"><span><b>{i.email}</b> <small className="mut">приглашён {fmtDate(i.created_at)}</small></span>
          <button className="icon-btn del" title="Отменить приглашение" onClick={() => c.run(async () => { await c.api(`/admin/moderators/invites/${i.id}`, { method: 'DELETE' }); await load() })}><X size={14} /></button></div>)}</>}
    </>
  )
}
