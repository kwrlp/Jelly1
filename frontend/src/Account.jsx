import React, { useState, useEffect } from 'react'
import { Check, HardDrive } from 'lucide-react'
import { Modal, Seg, fmtSize } from './ui.jsx'

const NICK_RE = /^@(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{3,30}$/
const pwdError = (p) => p.length < 8 ? 'Минимум 8 символов' : !/[A-Za-z]/.test(p) ? 'Нужна хотя бы одна буква' : !/\d/.test(p) ? 'Нужна хотя бы одна цифра' : ''

/** Сколько места занято треками (лимит приходит с сервера). */
export function StorageMeter({ api, refreshKey }) {
  const [s, setS] = useState(null)
  useEffect(() => { api('/users/me/storage').then(setS).catch(() => {}) }, [refreshKey])
  if (!s) return null
  const pct = Math.min(100, (s.used / s.limit) * 100)
  return (
    <div className="card">
      <h3><HardDrive size={18} /> Хранилище треков</h3>
      <div className={`meter ${pct >= 100 ? 'full' : pct >= 85 ? 'warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      <span className="mut">Занято {fmtSize(s.used)} из {fmtSize(s.limit)} · один трек — до {Math.round(s.track_max_seconds / 60)} мин</span>
    </div>
  )
}

/** Редактирование имени, ника, email и пароля. Ошибки показываются прямо в окне (глобальная плашка под окном не видна). */
export function EditProfileModal({ me, api, onClose, onSaved }) {
  const [tab, setTab] = useState('data'); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: me.name, nickname: me.nickname || '@', email: me.email, current: '' })
  const [pw, setPw] = useState({ current: '', next: '', again: '' }); const [nickMsg, setNickMsg] = useState('')
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(''); setOk('') }
  const emailChanged = f.email.trim().toLowerCase() !== me.email

  useEffect(() => {   // проверка ника с задержкой; свой текущий ник всегда «свободен»
    setNickMsg(''); if (f.nickname === me.nickname) return
    if (!NICK_RE.test(f.nickname)) { setNickMsg('Ник: «@» и 3–30 латинских букв, цифр или «_» (хотя бы одна буква)'); return }
    const t = setTimeout(() => api(`/auth/nickname-available?nickname=${encodeURIComponent(f.nickname)}`).then(d => setNickMsg(d.valid && d.available ? '✓ Ник свободен' : d.valid ? 'Этот ник уже занят' : 'Этот ник нельзя использовать')).catch(() => {}), 350)
    return () => clearTimeout(t)
  }, [f.nickname])

  const act = async (fn) => { setBusy(true); setErr(''); setOk(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const saveData = () => act(async () => {
    if (!f.name.trim()) throw new Error('Имя не может быть пустым')
    if (nickMsg && !nickMsg.startsWith('✓')) throw new Error(nickMsg)
    const body = {}
    if (f.name.trim() !== me.name) body.name = f.name.trim()
    if (f.nickname !== me.nickname) body.nickname = f.nickname
    if (emailChanged) { body.email = f.email.trim(); body.current_password = f.current }
    if (!Object.keys(body).length) { setOk('Изменений нет'); return }
    await api('/users/me/account', { method: 'PATCH', body }); setF(x => ({ ...x, current: '' })); setOk('Сохранено'); onSaved()
  })
  const savePassword = () => act(async () => {
    const e = pwdError(pw.next); if (e) throw new Error(`Новый пароль: ${e.toLowerCase()}`)
    if (pw.next !== pw.again) throw new Error('Пароли не совпадают')
    await api('/users/me/password', { method: 'POST', body: { current_password: pw.current, new_password: pw.next } })
    setPw({ current: '', next: '', again: '' }); setOk('Пароль изменён')
  })

  return (
    <Modal title="Редактировать профиль" onClose={onClose}>
      <div className="edit-profile">
        <Seg value={tab} onChange={(v) => { setTab(v); setErr(''); setOk('') }} options={[['data', 'Данные'], ['password', 'Пароль']]} />
        {tab === 'data' ? <>
          <div className="field"><label>Имя</label><input value={f.name} maxLength={100} onChange={set('name')} /></div>
          <div className="field"><label>Ник</label><input value={f.nickname} maxLength={31} autoCapitalize="none"
            onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_@]/g, '').replace(/@/g, ''); setF({ ...f, nickname: '@' + v.toLowerCase() }); setErr(''); setOk('') }} />
            {nickMsg && <div className={nickMsg.startsWith('✓') ? 'field-ok' : 'field-error'}>{nickMsg}</div>}</div>
          <div className="field"><label>Email</label><input type="email" value={f.email} onChange={set('email')} /></div>
          {emailChanged && <div className="field"><label>Текущий пароль (нужен для смены email)</label><input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} /></div>}
        </> : <>
          <div className="field"><label>Текущий пароль</label><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => { setPw({ ...pw, current: e.target.value }); setErr(''); setOk('') }} /></div>
          <div className="field"><label>Новый пароль</label><input type="password" autoComplete="new-password" placeholder="От 8 символов (буквы + цифры)" value={pw.next} onChange={(e) => { setPw({ ...pw, next: e.target.value }); setErr(''); setOk('') }} /></div>
          <div className="field"><label>Повторите новый пароль</label><input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => { setPw({ ...pw, again: e.target.value }); setErr(''); setOk('') }} /></div>
        </>}
        {err && <div className="field-error">{err}</div>}{ok && <div className="form-msg-ok">{ok}</div>}
        <div className="modal-footer">
          <button onClick={onClose}>Закрыть</button>
          {tab === 'data'
            ? <button className="pri" disabled={busy || !f.name.trim() || (emailChanged && !f.current)} onClick={saveData}><Check size={14} /> Сохранить</button>
            : <button className="pri" disabled={busy || !pw.current || !pw.next} onClick={savePassword}><Check size={14} /> Сменить пароль</button>}
        </div>
      </div>
    </Modal>
  )
}
