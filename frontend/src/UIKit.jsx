import React, { useState } from 'react'
import { Play, Plus, Trash2, Search, Check, X, Music } from 'lucide-react'
import Mascot from './Mascot.jsx'

const STATES = [['idle', 'Idle (покой)'], ['active', 'Active (энергичная)'], ['thinking', 'Thinking / Loading'], ['error', 'Error'], ['icon', 'Icon']]
const THEMES = [['plasma', 'Plasma'], ['cognac', 'Cognac Leather'], ['neon', 'Neon Red'], ['forest', 'Forest Enchanted'], ['green', 'Glass Green'], ['y2k', 'Y2K Butterfly'], ['sepia', 'Sepia Vintage'], ['graphite', 'Graphite Glass']]
const TOKENS = [['--primary', 'Primary'], ['--secondary', 'Secondary'], ['--accent', 'Accent'], ['--surface', 'Surface'], ['--bg-stop-1', 'Фон (stop 1)'], ['--glow-1', 'Glow 1']]

/** Страница #/ui — библиотека компонентов, палитр и маскота (без авторизации). */
export default function UIKit() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'plasma')
  const pick = (t) => { document.documentElement.setAttribute('data-theme', t); setTheme(t) }
  return (
    <div className="kit">
      <button className="back-btn" onClick={() => { window.location.hash = '' }}>← В приложение</button>
      <h1>Liquid Glass UI</h1>
      <p className="mut">Токены: <code>src/tokens.css</code> · компоненты: <code>src/glass.css</code> · маскот: <code>src/Mascot.jsx</code></p>

      <h2>Палитры</h2>
      <div className="kit-row">{THEMES.map(([id, name]) => (
        <button key={id} className={theme === id ? 'chip active' : 'chip'} onClick={() => pick(id)}>{name}</button>))}
      </div>
      <div className="kit-grid" style={{ marginTop: 12 }}>{TOKENS.map(([v, n]) => (
        <div key={v} className="card kit-tile"><div className="kit-sw" style={{ background: `var(${v})` }} /><b>{n}</b><code>{v}</code></div>))}
      </div>

      <h2>Маскот</h2>
      <div className="kit-grid">{STATES.map(([st, label]) => (
        <div key={st} className="card kit-tile"><Mascot state={st} size={st === 'icon' ? 44 : 90} /><b>{label}</b></div>))}
      </div>
      <div className="kit-row" style={{ marginTop: 12 }}>
        {[16, 24, 32, 48].map(n => <Mascot key={n} state="icon" size={n} />)}
      </div>

      <h2>Кнопки</h2>
      <div className="card kit-row">
        <button className="pri big"><Play size={16} /> Primary</button>
        <button className="pri"><Plus size={16} /> Создать</button>
        <button>Glass</button>
        <button className="del"><Trash2 size={16} /> Удалить</button>
        <button className="chip active">Chip</button><button className="chip">Chip</button>
        <button className="icon-btn"><Search size={16} /></button>
        <button disabled>Disabled</button>
      </div>

      <h2>Поля ввода и ползунок</h2>
      <div className="card">
        <div className="field-row">
          <div className="field"><label>Название</label><input placeholder="Например: Night Drive" /></div>
          <div className="field"><label>Жанр</label><select><option>Electronic</option><option>Jazz</option></select></div>
        </div>
        <div className="field"><label>Описание</label><textarea rows="2" placeholder="Расскажите о треке…" /></div>
        <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>Публичный</span></label>
        <input type="range" min="0" max="100" defaultValue="40" style={{ '--p': '40%' }} />
      </div>

      <h2>Виджеты</h2>
      <div className="card track-card"><div className="track-row">
        <div className="playlist-icon"><Music size={22} /></div>
        <div className="track-info"><b>Midnight Dreams</b><span className="mut">Luna Wave • Electronic • 3:42</span></div>
        <div className="track-actions"><button className="pri"><Play size={16} /> Играть</button></div>
      </div></div>
      <div className="card"><div className="player-controls">
        <button className="icon-btn pri"><Play size={16} /></button>
        <input type="range" min="0" max="222" defaultValue="94" style={{ '--p': '42%' }} /><span className="player-time">1:34 / 3:42</span>
      </div></div>
      <h2>Уведомление от модерации</h2>
      <div className="card notif notif--staff is-unread"><span className="staff-tag">Модерация</span><div>Предупреждение: нарушение правил публикации.</div><small className="mut">сегодня</small></div>
      <div className="card notif"><div>Анна принял(а) вашу заявку в друзья</div><small className="mut">сегодня</small></div>
      <button className="pri" onClick={() => setOpen(true)}>Открыть модальное окно</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Модальное окно</h3><button className="modal-close" onClick={() => setOpen(false)}><X size={16} /></button></div>
            <div style={{ textAlign: 'center' }}><Mascot state="active" size={96} /><p className="mut">Стекло, размытие, кромка с хроматической аберрацией.</p></div>
            <div className="modal-footer"><button onClick={() => setOpen(false)}>Отмена</button><button className="pri" onClick={() => setOpen(false)}><Check size={14} /> Готово</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
