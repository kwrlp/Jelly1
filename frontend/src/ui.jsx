import React, { useState, useRef, useEffect } from 'react'
import { X, Flag, Share2, Check, ChevronDown } from 'lucide-react'
import Mascot from './Mascot.jsx'

export const API = import.meta.env.VITE_API || 'http://localhost:8000'
export const fileUrl = (path) => { const t = localStorage.getItem('token'); return `${API}${path}${t ? `?token=${t}` : ''}` }
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
export const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : ''
export const fmtSize = (n) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1).replace('.0', '')} ГБ` : `${Math.max(0, Math.round(n / 1048576))} МБ`
export const REACTIONS = [['like', '👍', 'Нравится'], ['love', '❤️', 'Люблю'], ['fire', '🔥', 'Огонь'], ['laugh', '😂', 'Смешно'], ['wow', '😮', 'Ого'], ['sad', '😢', 'Грустно']]
export const ROLE_NAME = { admin: 'Админ', moderator: 'Модератор' }

export function Avatar({ u, size = 40 }) {
  const style = { width: size, height: size }
  return u?.avatar_url
    ? <img className="ava" style={style} src={`${API}${u.avatar_url}`} alt="" />
    : <span className="ava ava-ph" style={style}><Mascot state="icon" size={size * 0.56} /></span>   // заглушка — обычная медуза сайта
}

export const RoleBadge = ({ role }) => ROLE_NAME[role] ? <span className={`role-badge role-${role}`}>{ROLE_NAME[role]}</span> : null

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="toggle-text"><b>{label}</b>{hint && <span className="mut">{hint}</span>}</span>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i className="toggle-knob" />
    </label>
  )
}

export function Seg({ value, onChange, options }) {
  const ref = useRef(null)
  useEffect(() => {   // на телефоне вкладки прокручиваются: активную держим в видимой области
    const box = ref.current; const on = box?.querySelector('.on'); if (!box || !on) return
    if (box.scrollWidth > box.clientWidth) box.scrollTo({ left: on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
  }, [value])
  return <div className="seg" ref={ref}>{options.map(([k, l, n]) => (
    <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}{n ? <span className="seg-n">{n}</span> : null}</button>))}</div>
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={onClose}><X size={16} /></button></div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export const Pill = ({ tone = 'neutral', children }) => <span className={`pill pill-${tone}`}>{children}</span>

/** Кнопка «Пожаловаться»: жалоба уходит в очередь модерации. */
export function ReportButton({ api, run, type, id, label = 'Пожаловаться', className = 'icon-btn' }) {
  const [open, setOpen] = useState(false); const [cat, setCat] = useState('other'); const [reason, setReason] = useState('')
  const send = () => run(async () => { await api('/reports', { method: 'POST', body: { content_type: type, content_id: id, category: cat, reason } }); setOpen(false); setReason(''); alert('Жалоба отправлена модераторам') })
  return (
    <>
      <button className={className} title={label} onClick={() => setOpen(true)}><Flag size={15} />{className === 'icon-btn' ? null : label}</button>
      {open && (
        <Modal title="Пожаловаться" onClose={() => setOpen(false)} footer={<><button onClick={() => setOpen(false)}>Отмена</button><button className="pri" onClick={send}><Check size={14} /> Отправить</button></>}>
          <div className="field"><label>Причина</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="spam">Спам</option><option value="abuse">Оскорбления</option><option value="violence">Насилие</option>
              <option value="illegal">Незаконный контент</option><option value="copyright">Авторские права</option><option value="other">Другое</option></select></div>
          <div className="field"><label>Комментарий (необязательно)</label><textarea rows="3" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <p className="mut">Модераторы увидят только то, что и так доступно публично.</p>
        </Modal>
      )}
    </>
  )
}

/** Поделиться в чат: трек, плейлист или пост уходят карточкой в выбранный чат. */
export function ShareButton({ api, run, kind, refId, label = 'Поделиться' }) {
  const [open, setOpen] = useState(false); const [chats, setChats] = useState([])
  const show = () => run(async () => { setChats((await api('/chats')).filter(c => !c.with_staff)); setOpen(true) })
  const send = (cid) => run(async () => { await api(`/chats/${cid}/messages`, { method: 'POST', body: { kind, ref_id: refId } }); setOpen(false); alert('Отправлено в чат') })
  return (
    <>
      <button className="icon-btn" title={label} onClick={show}><Share2 size={15} /></button>
      {open && (
        <Modal title="Отправить в чат" onClose={() => setOpen(false)}>
          {!chats.length && <p className="mut">Пока нет чатов. Откройте профиль человека и нажмите «Написать».</p>}
          {chats.map(c => <button key={c.id} className="row-btn" onClick={() => send(c.id)}><Avatar u={c.other} size={32} /><span>{c.other.name}</span></button>)}
        </Modal>
      )}
    </>
  )
}

/** Скачивание трека: токен освежается через api(), затем браузер скачивает файл по ссылке с Content-Disposition: attachment
 *  (без fetch/blob — не зависит от CORS и не грузит весь файл в память; атрибут download на чужом origin браузеры игнорируют). */
export async function downloadTrack(api, t) {
  try { await api('/users/me') } catch { /* токен обновится сам, ошибку покажут запросы страницы */ }
  const a = document.createElement('a')
  a.href = `${API}/files/${encodeURIComponent(t.file)}?download=1&token=${localStorage.getItem('token') || ''}`
  a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
}

/** Поле с выпадающим списком и автодополнением: можно выбрать существующее значение или ввести новое. */
export function Combobox({ value, onChange, options = [], placeholder, maxLength = 100 }) {
  const [open, setOpen] = useState(false); const [idx, setIdx] = useState(-1)
  const q = (value || '').trim().toLowerCase()
  const list = options.filter(o => !q || o.toLowerCase().includes(q)).slice(0, 50)
  const isNew = q && !options.some(o => o.toLowerCase() === q)
  const pick = (v) => { onChange(v); setOpen(false); setIdx(-1) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx(i => Math.min(i + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open && idx >= 0) { e.preventDefault(); pick(list[idx]) }
    else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <div className="combo" onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <input value={value} maxLength={maxLength} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setIdx(-1) }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      <button type="button" className="combo-toggle" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o) }}><ChevronDown size={16} /></button>
      {open && (list.length > 0 || isNew) && (
        <ul className="combo-list" role="listbox">
          {isNew && <li className="combo-new" onMouseDown={(e) => { e.preventDefault(); pick(value.trim()) }}>＋ Новое значение: «{value.trim()}»</li>}
          {list.map((o, i) => <li key={o} role="option" className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(o) }}>{o}</li>)}
        </ul>)}
    </div>
  )
}
