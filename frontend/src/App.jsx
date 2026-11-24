import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Music, ListMusic, User as UserIcon, LogOut, Search, Upload,
  Play, Pause, SkipBack, SkipForward, Download, Trash2, Plus, X,
  Link2, Lock, Unlock, Check, ChevronUp, ChevronDown, Copy, Image as ImageIcon, 
  StickyNote, Palette, Edit3, Clock, Filter, Tag, Mic2, Smile, Bell, MessageCircle, Menu as MenuIcon, Users, Newspaper, Settings as SettingsIcon, ShieldCheck, LifeBuoy
} from 'lucide-react'
import UploadTrack from './UploadTrack.jsx'
import Mascot from './Mascot.jsx'
import UIKit from './UIKit.jsx'
import { Feed, Composer, Friends, UserProfile, Search as SearchPage, Notifications, SettingsPage, MembersPanel, PostPage } from './Social.jsx'
import { EditProfileModal, StorageMeter } from './Account.jsx'
import { Chats } from './Chats.jsx'
import { ReportQueue, ReportCard, Warnings, StaffUsers, Templates, MyHistory } from './Staff.jsx'
import { DeletionQueue, Stats, UsersRoles, Removed, Logs, PlatformSettings, Moderators } from './Admin.jsx'
import { RoleBadge, ReportButton, ShareButton, Pill, Combobox, downloadTrack, fmtSize } from './ui.jsx'

const API = import.meta.env.VITE_API || 'http://localhost:8000'
// Тема хранится на сервере в профиле аккаунта (а не в браузере), поэтому не «переезжает» между аккаунтами.
const setThemeOnPage = (themeId) => { if (themeId === 'industrial') themeId = 'graphite'; if (!ALL_THEMES.some(t => t.id === themeId)) themeId = 'plasma'; document.documentElement.setAttribute('data-theme', themeId) }

const ALL_THEMES = [
  { id: 'plasma', name: 'Dark Lilac' }, { id: 'cognac', name: 'Dark Brown' }, { id: 'neon', name: 'Burgundy' },
  { id: 'forest', name: 'Forest Enchanted' }, { id: 'green', name: 'Dark Blue' },
  { id: 'y2k', name: 'Y2K Butterfly' }, { id: 'sepia', name: 'Sepia Vintage' }, { id: 'graphite', name: 'Graphite Glass' },
]
const QUICK_THEMES = { dark: 'plasma', light: 'sepia' }
const MORE_THEMES = ALL_THEMES
const DEFAULT_GENRES = ['Pop', 'Rock', 'Hip-Hop', 'Electronic', 'Jazz', 'Classical', 'R&B', 'Indie', 'Metal', 'Folk', 'Blues', 'Country', 'Latin', 'Reggae', 'Soul', 'Funk', 'Punk', 'Alternative', 'Ambient', 'Lo-Fi']
const DEFAULT_MOODS = ['Энергичное', 'Спокойное', 'Грустное', 'Весёлое', 'Романтичное', 'Мотивирующее', 'Меланхоличное', 'Агрессивное', 'Расслабляющее', 'Ностальгическое', 'Мистическое', 'Танцевальное']
const formatDuration = (sec) => { if (!sec) return '0:00'; const m = Math.floor(sec / 60); return `${m}:${String(sec % 60).padStart(2, '0')}` }

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refreshToken'))
  const [view, setView] = useState({ name: 'tracks' })
  const [me, setMe] = useState(null)
  const tab = view.name
  const go = (name, params = {}) => { setView({ name, ...params }); window.scrollTo(0, 0) }
  const [play, setPlay] = useState(null)
  const [playContext, setPlayContext] = useState({ tracks: [], index: 0 })
  const [err, setErr] = useState('')
  const audioRef = useRef(null)
  const [busy, setBusy] = useState(0)
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 7000); return () => clearTimeout(t) }, [err])

  useEffect(() => { localStorage.removeItem('theme'); localStorage.removeItem('player') }, [])   // старые общие ключи
  useEffect(() => { setThemeOnPage(me?.theme) }, [me?.id, me?.theme])                           // тема — настройка аккаунта; без входа — по умолчанию
  useEffect(() => {   // параллакс световых пятен фона
    let raf = 0
    const onMove = (e) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const r = document.documentElement.style
      r.setProperty('--px', (e.clientX / window.innerWidth - .5).toFixed(3)); r.setProperty('--py', (e.clientY / window.innerHeight - .5).toFixed(3)) }) }
    window.addEventListener('pointermove', onMove); return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf) }
  }, [])
  useEffect(() => { if (audioRef.current && play && play.id !== restoredId.current) audioRef.current.play().catch(() => {}) }, [play?.id])
  useEffect(() => { if (play && me) localStorage.setItem(`player:${me.id}`, JSON.stringify({ id: play.id, time: 0 })) }, [play?.id])

  const api = useCallback(async (path, opts = {}) => {
    const isForm = opts.body instanceof FormData
    const headers = { ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    let r = await fetch(API + path, { ...opts, headers, body: isForm ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) })
    if (r.status === 401 && refreshToken && !path.includes('/auth/')) {
      try {
        const rr = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) })
        if (rr.ok) {
          const nt = await rr.json()
          localStorage.setItem('token', nt.access_token); localStorage.setItem('refreshToken', nt.refresh_token)
          setToken(nt.access_token); setRefreshToken(nt.refresh_token)
          const h2 = { ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${nt.access_token}` }
          r = await fetch(API + path, { ...opts, headers: h2, body: isForm ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) })
        } else { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); setToken(null); setRefreshToken(null) }
      } catch { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); setToken(null); setRefreshToken(null) }
    }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(typeof d.detail === 'string' ? d.detail : (Array.isArray(d.detail) ? d.detail.map(e => e.msg).join(', ') : 'Ошибка запроса')) }
    return r.status === 204 ? null : r.json()
  }, [token, refreshToken])

  const run = async (fn) => {
    setBusy(b => b + 1)
    try { setErr(''); await fn() }
    catch (e) {
      setErr(e.message)
      if (e.message.includes('авториз') || e.message.includes('Unauthorized') || e.message.includes('заблокирован администрацией') || e.message.includes('Аккаунт удалён')) { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); setToken(null); setRefreshToken(null) }
    }
    finally { setBusy(b => b - 1) }
  }

  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => { const h = () => setHash(window.location.hash); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  const restoredId = useRef(null); const pendingSeek = useRef(0)
  const prev = () => { const { tracks, index } = playContext; if (index > 0) { setPlayContext({ tracks, index: index - 1 }); setPlay(tracks[index - 1]) } else if (audioRef.current) audioRef.current.currentTime = 0 }
  const saveTime = (t) => { if (play && me) localStorage.setItem(`player:${me.id}`, JSON.stringify({ id: play.id, time: Math.floor(t) })) }
  const restoreSeek = (a) => { if (pendingSeek.current > 0) { a.currentTime = pendingSeek.current; pendingSeek.current = 0 } }
  const next = () => { const { tracks, index } = playContext; if (index + 1 < tracks.length) { setPlayContext({ tracks, index: index + 1 }); setPlay(tracks[index + 1]) } }
  const publicId = (hash.match(/^#\/playlist\/(\d+)$/) || [])[1]

  useEffect(() => {   // после обновления страницы возвращаем последний трек и позицию
    if (!token || !me || play) return
    let saved = null; try { saved = JSON.parse(localStorage.getItem(`player:${me.id}`) || 'null') } catch { /* пусто */ }
    if (!saved?.id) return
    ;(async () => {
      try {
        let list = []; try { list = await api('/tracks') } catch { /* ниже запросим один трек */ }
        let idx = list.findIndex(t => t.id === saved.id), track = list[idx]
        if (!track) { track = await api(`/tracks/${saved.id}`); list = [track]; idx = 0 }
        restoredId.current = track.id; pendingSeek.current = saved.time || 0
        setPlayContext({ tracks: list, index: idx }); setPlay(track)
      } catch { localStorage.removeItem(`player:${me.id}`) }
    })()
  }, [token, me?.id])

  const listened = useRef(new Set())
  const recordListen = (t) => { if (listened.current.has(t.id)) return; listened.current.add(t.id); fetch(`${API}/tracks/${t.id}/listen`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {}) }
  useEffect(() => {   // статистика посещений (раз за сессию)
    if (sessionStorage.getItem('visited')) return; sessionStorage.setItem('visited', '1')
    let vid = localStorage.getItem('visitor'); if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('visitor', vid) }
    fetch(`${API}/stats/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ visitor_id: vid }) }).catch(() => {})
  }, [])
  const refreshMe = useCallback(async () => { if (!token) { setMe(null); return }; try { setMe(await api('/users/me')) } catch { /* ошибки покажут страницы */ } }, [api, token])
  useEffect(() => {   // выход/смена аккаунта: сбрасываем всё, что относится к прошлой сессии
    if (token) return
    setMe(null); setPlay(null); setPlayContext({ tracks: [], index: 0 }); setView({ name: 'tracks' })
    listened.current = new Set(); restoredId.current = null; pendingSeek.current = 0
  }, [token])
  const closePlayer = () => { audioRef.current?.pause(); setPlay(null); if (me) localStorage.removeItem(`player:${me.id}`) }
  useEffect(() => { refreshMe(); if (!token) return; const t = setInterval(refreshMe, 30000); return () => clearInterval(t) }, [token])

  const src = (t) => `${API}/files/${t.file}${token ? `?token=${token}` : ''}`
  const common = { api, run, src, setPlay, setPlayContext, playContext, audioRef, me, refreshMe, go, view, token }

  if (hash === '#/ui') return <Shell err={err} play={play} src={src} audioRef={audioRef} onEnded={next} onPrev={prev} onTime={saveTime} onReady={restoreSeek} onListen={recordListen} onClose={closePlayer} uid={me?.id} autoPlay={!play || play.id !== restoredId.current}><UIKit /></Shell>

  if (publicId) return <Shell busy={busy > 0} err={err} play={play} src={src} audioRef={audioRef} onEnded={next} onPrev={prev} onTime={saveTime} onReady={restoreSeek} onListen={recordListen} onClose={closePlayer} uid={me?.id} autoPlay={!play || play.id !== restoredId.current}><PublicPlaylist id={publicId} authed={!!token} {...common} /></Shell>

  if (!token) return <Shell busy={busy > 0} err={err} play={play} src={src} audioRef={audioRef} onEnded={next} onPrev={prev} onTime={saveTime} onReady={restoreSeek} onListen={recordListen} onClose={closePlayer} uid={me?.id} autoPlay={!play || play.id !== restoredId.current}><Auth api={api} run={run} onTokens={(a, r) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); setToken(a); setRefreshToken(r) }} /></Shell>

  const staff = me && (me.role === 'moderator' || me.role === 'admin'); const admin = me && me.role === 'admin'
  const guard = (ok, node) => ok ? node : <Empty state="error">Нет доступа к этому разделу.</Empty>
  const P = { ...common }
  return (
    <Shell busy={busy > 0} err={err} play={play} src={src} audioRef={audioRef} onEnded={next} onPrev={prev} onTime={saveTime} onReady={restoreSeek} onListen={recordListen} onClose={closePlayer} uid={me?.id} autoPlay={!play || play.id !== restoredId.current}>
      <TopBar me={me} go={go} />
      {tab === 'tracks' && <Tracks {...P} />}
      {tab === 'playlists' && <Playlists {...P} />}
      {tab === 'notes' && <Notes {...P} />}
      {tab === 'profile' && <Profile {...P} logout={() => { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); setToken(null); setRefreshToken(null); setMe(null) }} />}
      {tab === 'feed' && <Feed {...P} />}
      {tab === 'compose' && <Composer {...P} />}
      {tab === 'friends' && <Friends {...P} />}
      {tab === 'user' && <UserProfile id={view.id} {...P} />}
      {tab === 'post' && <PostPage id={view.id} {...P} />}
      {tab === 'search' && <SearchPage q={view.q} {...P} />}
      {tab === 'notifications' && <Notifications {...P} />}
      {tab === 'settings' && <SettingsPage {...P} />}
      {tab === 'chats' && <Chats key={view.open || 'list'} open={view.open} {...P} />}
      {tab === 'staff-reports' && guard(staff, <ReportQueue {...P} />)}
      {tab === 'staff-report' && guard(staff, <ReportCard id={view.id} {...P} />)}
      {tab === 'staff-warnings' && guard(staff, <Warnings {...P} />)}
      {tab === 'staff-users' && guard(staff, <StaffUsers {...P} />)}
      {tab === 'staff-templates' && guard(staff, <Templates {...P} />)}
      {tab === 'staff-history' && guard(staff, <MyHistory {...P} />)}
      {tab === 'admin-deletions' && guard(admin, <DeletionQueue {...P} />)}
      {tab === 'admin-stats' && guard(admin, <Stats {...P} />)}
      {tab === 'admin-users' && guard(admin, <UsersRoles {...P} />)}
      {tab === 'admin-moderators' && guard(admin, <Moderators {...P} />)}
      {tab === 'admin-removed' && guard(admin, <Removed {...P} />)}
      {tab === 'admin-logs' && guard(admin, <Logs {...P} />)}
      {tab === 'admin-settings' && guard(admin, <PlatformSettings {...P} />)}
      <nav>
        {[['tracks', 'Треки', Music, 0], ['feed', 'Лента', Newspaper, 0], ['chats', 'Чаты', MessageCircle, me?.unread_messages || 0], ['playlists', 'Плейлисты', ListMusic, 0], ['profile', 'Профиль', UserIcon, 0]].map(([k, l, Icon, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}><Icon size={18} />{n > 0 && <span className="badge">{n}</span>}<span>{l}</span></button>
        ))}
      </nav>
    </Shell>
  )
}

/** Верхняя панель: поиск, уведомления, меню разделов (по роли). */
function TopBar({ me, go }) {
  const [q, setQ] = useState(''); const [menu, setMenu] = useState(false)
  const submit = () => { if (q.trim().length >= 2) go('search', { q: q.trim() }) }
  const staff = me && (me.role === 'moderator' || me.role === 'admin')
  const items = [['friends', 'Друзья и подписки', Users, me?.friend_requests], ['compose', 'Новый пост', Plus], ['notes', 'Заметки', StickyNote], ['settings', 'Приватность и рекомендации', SettingsIcon]]
  return (
    <header className="topbar">
      <button className="topbar-brand" onClick={() => go('tracks')} title="Медуза"><Mascot state="icon" size={24} /></button>
      <div className="topbar-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Поиск людей, постов, треков…" /></div>
      <button className="icon-btn bell" onClick={() => go('notifications')} title="Уведомления"><Bell size={17} />{(me?.unread_notifications || 0) + (me?.inbox_count || 0) > 0 && <span className="badge">{(me.unread_notifications || 0) + (me.inbox_count || 0)}</span>}</button>
      <div className="menu-wrap">
        <button className="icon-btn" onClick={() => setMenu(!menu)} title="Разделы"><MenuIcon size={17} />{me?.friend_requests > 0 && <span className="badge">{me.friend_requests}</span>}</button>
        {menu && (
          <div className="menu" onClick={() => setMenu(false)}>
            {items.map(([k, l, Icon, n]) => <button key={k} onClick={() => go(k)}><Icon size={15} /> {l}{n > 0 && <span className="badge inline">{n}</span>}</button>)}
            {staff && <><hr /><button className="menu-staff" onClick={() => go('staff-reports')}><ShieldCheck size={15} /> Модерация</button></>}
            {me?.role === 'admin' && <button className="menu-staff" onClick={() => go('admin-stats')}><ShieldCheck size={15} /> Администрирование</button>}
          </div>)}
      </div>
    </header>
  )
}

function Empty({ children, state = 'idle' }) {
  return <div className="empty"><Mascot state={state} size={84} /><div className="mut">{children}</div></div>
}

const PLAYER_MIN = 56, PLAYER_MAX = 300, PLAYER_DEFAULT = 128

function PlayerBar({ play, src, audioRef, onEnded, onPrev, onNext, onTime, onReady, onListen, onClose, uid, autoPlay }) {
  // высота виджета — настройка аккаунта (хранится по ключу с id пользователя)
  const hKey = uid ? `playerH:${uid}` : null
  const [h, setH] = useState(() => { const v = hKey ? Number(localStorage.getItem(hKey)) : 0; return v >= PLAYER_MIN && v <= PLAYER_MAX ? v : PLAYER_DEFAULT })
  useEffect(() => { document.documentElement.style.setProperty('--player-h', `${h}px`); return () => document.documentElement.style.removeProperty('--player-h') }, [h])
  const saveH = (v) => { if (hKey) localStorage.setItem(hKey, String(v)) }
  const startResize = (e) => {
    e.preventDefault(); const y0 = e.clientY, h0 = h; let cur = h
    const move = (ev) => { cur = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, h0 + (y0 - ev.clientY))); setH(cur) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); saveH(cur) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const keyResize = (e) => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); const v = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, h + (e.key === 'ArrowUp' ? 12 : -12))); setH(v); saveH(v) }
  const [t, setT] = useState(0); const [d, setD] = useState(0); const [playing, setPlaying] = useState(false)
  useEffect(() => { setT(0); setD(0) }, [play.id])
  const toggle = () => { const a = audioRef.current; if (a) (a.paused ? a.play().catch(() => {}) : a.pause()) }
  const seek = (v) => { if (audioRef.current) audioRef.current.currentTime = v; setT(v) }
  const pct = d ? (t / d) * 100 : 0
  return (
    <div className={`player ${h < 96 ? 'player--compact' : ''} ${h < 76 ? 'player--tiny' : ''}`} style={{ height: h, '--ph': `${h}px` }}>
      <div className="player-resize" role="separator" aria-orientation="horizontal" aria-label="Высота плеера" tabIndex={0} title="Потяните, чтобы изменить высоту" onPointerDown={startResize} onKeyDown={keyResize}><i /></div>
      <button className="player-close icon-btn" onClick={onClose} title="Закрыть плеер"><X size={14} /></button>
      <div className="player-head">
        {h >= 96 && <div className="player-cover">{play.cover_url ? <img src={`${API}${play.cover_url}`} alt="" /> : <Music size={18} />}</div>}
        <div className="player-info">
          <div className="player-title">{play.title}</div>
          <div className="player-artist">{play.artist || 'Неизвестный исполнитель'}</div>
        </div>
      </div>
      <div className="player-controls">
        <button className="icon-btn" onClick={onPrev} title="Предыдущий"><SkipBack size={16} /></button>
        <button className="icon-btn pri" onClick={toggle} title={playing ? 'Пауза' : 'Играть'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn" onClick={onNext} title="Следующий"><SkipForward size={16} /></button>
        <input type="range" min="0" max={d || 0} step="0.1" value={t} style={{ '--p': pct + '%' }} onChange={(e) => seek(Number(e.target.value))} aria-label="Перемотка" />
        <span className="player-time">{formatDuration(Math.floor(t))} / {formatDuration(Math.floor(d))}</span>
      </div>
      <audio ref={audioRef} key={play.id} src={src(play)} autoPlay={autoPlay} onEnded={onEnded}
        onPlay={() => { setPlaying(true); onListen && onListen(play) }} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setT(e.currentTarget.currentTime); onTime && onTime(e.currentTarget.currentTime) }}
        onLoadedMetadata={(e) => { setD(e.currentTarget.duration || 0); onReady && onReady(e.currentTarget) }} />
    </div>
  )
}

function Shell({ children, err, play, src, audioRef, onEnded, onPrev, onTime, onReady, onListen, onClose, uid, autoPlay, busy }) {
  return (
    <>
    <div className="bg-blobs" aria-hidden="true"><i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" /></div>
    <div className="bg-noise" aria-hidden="true" />
    {busy && <div className="busy-badge" title="Загрузка…"><Mascot state="thinking" size={40} /></div>}
    <div className="wrap">
      {err && <div className="err"><Mascot state="error" size={34} /><span>{err}</span></div>}
      {children}
      {play && <PlayerBar play={play} src={src} audioRef={audioRef} onEnded={onEnded} onPrev={onPrev} onNext={onEnded} onTime={onTime} onReady={onReady} onListen={onListen} onClose={onClose} uid={uid} autoPlay={autoPlay} />}
    </div>
    </>
  )
}

const NICK_RE = /^@(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{3,30}$/

function Auth({ api, run, onTokens }) {
  const [mode, setMode] = useState('login'); const [f, setF] = useState({ email: '', password: '', name: '', nickname: '@' }); const [pwdError, setPwdError] = useState(''); const [nickMsg, setNickMsg] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const validatePassword = (pwd) => { if (pwd.length < 8) return 'Минимум 8 символов'; if (!/[A-Za-z]/.test(pwd)) return 'Нужна хотя бы одна буква'; if (!/\d/.test(pwd)) return 'Нужна хотя бы одна цифра'; return '' }
  const checkNick = async () => {
    if (mode !== 'register' || f.nickname === '@') return
    if (!NICK_RE.test(f.nickname)) { setNickMsg('Ник: «@» и 3–30 латинских букв, цифр или «_» (хотя бы одна буква)'); return }
    try { const d = await api(`/auth/nickname-available?nickname=${encodeURIComponent(f.nickname)}`); setNickMsg(d.valid && d.available ? '✓ Ник свободен' : (d.valid ? 'Этот ник уже занят' : 'Этот ник нельзя использовать')) } catch { /* проверит сервер */ }
  }
  const submit = (e) => {
    e.preventDefault(); const error = validatePassword(f.password)
    if (mode === 'register' && !NICK_RE.test(f.nickname)) { setNickMsg('Ник: «@» и 3–30 латинских букв, цифр или «_» (хотя бы одна буква)'); return }
    if (error && mode === 'register') { setPwdError(error); return }
    setPwdError('')
    run(async () => { const body = mode === 'login' ? { email: f.email, password: f.password } : { email: f.email, password: f.password, name: f.name, nickname: f.nickname }; const resp = await api(`/auth/${mode}`, { method: 'POST', body }); onTokens(resp.access_token, resp.refresh_token) })
  }
  return (
    <form onSubmit={submit} className="auth-form">
      <div className="auth-logo"><Mascot state="idle" size={96} /><h1>Музыкальное хранилище</h1><p className="mut">Ваша личная фонотека</p></div>
      <div className="tabs">
        <button type="button" className={mode === 'login' ? 'pri' : ''} onClick={() => setMode('login')}>Вход</button>
        <button type="button" className={mode === 'register' ? 'pri' : ''} onClick={() => setMode('register')}>Регистрация</button>
      </div>
      {mode === 'register' && <div className="field"><label>Имя</label><input placeholder="Как вас зовут?" value={f.name} onChange={set('name')} required /></div>}
      {mode === 'register' && <div className="field"><label>Ник (уникальный)</label>
        <input placeholder="@nickname" value={f.nickname} maxLength={31} required onBlur={checkNick}
          onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_@]/g, '').replace(/@/g, ''); setF({ ...f, nickname: '@' + v.toLowerCase() }); setNickMsg('') }} />
        <small className="mut">Латиница, цифры и «_»; начинается с «@»</small>
        {nickMsg && <div className={nickMsg.startsWith('✓') ? 'field-ok' : 'field-error'}>{nickMsg}</div>}</div>}
      <div className="field"><label>Email</label><input type="email" placeholder="you@example.com" value={f.email} onChange={set('email')} required /></div>
      <div className="field">
        <label>Пароль</label>
        <input type="password" placeholder="От 8 символов (буквы + цифры)" value={f.password} onChange={(e) => { set('password')(e); if (pwdError) setPwdError(validatePassword(e.target.value)) }} minLength={8} required />
        {pwdError && <div className="field-error">{pwdError}</div>}
      </div>
      <button className="pri full" style={{ marginTop: 8 }}>{mode === 'login' ? <><Check size={16} /> Войти</> : <><Plus size={16} /> Создать аккаунт</>}</button>
    </form>
  )
}

function TrackFilters({ filters, selected, onChange, onCustomAdd }) {
  const [customGenre, setCustomGenre] = useState(''); const [customMood, setCustomMood] = useState(''); const [customArtist, setCustomArtist] = useState('')
  const toggleItem = (type, value) => {
    const current = selected[type] || []; const updated = current.includes(value) ? current.filter(v => v !== value) : [...current, value]
    onChange({ ...selected, [type]: updated })
  }
  const addCustom = (type, value) => {
    if (!value.trim()) return
    toggleItem(type, value.trim()); onCustomAdd(type, value.trim())
    if (type === 'genres') setCustomGenre(''); if (type === 'moods') setCustomMood(''); if (type === 'artists') setCustomArtist('')
  }
  const allGenres = [...new Set([...(filters.genres || []), ...DEFAULT_GENRES])]; const allMoods = [...new Set([...(filters.moods || []), ...DEFAULT_MOODS])]; const allArtists = filters.artists || []
  return (
    <div className="filters-panel">
      <div className="filters-header"><Filter size={16} /><span>Фильтры</span>{(selected.genres?.length || selected.moods?.length || selected.artists?.length) > 0 && <button className="filters-clear" onClick={() => onChange({ genres: [], moods: [], artists: [] })}><X size={12} /> Сбросить</button>}</div>
      <div className="filter-section">
        <div className="filter-label"><Tag size={12} /> Жанры</div>
        <div className="filter-chips">{allGenres.map(g => <button key={g} className={`chip ${selected.genres?.includes(g) ? 'active' : ''}`} onClick={() => toggleItem('genres', g)}>{g}</button>)}</div>
        <div className="filter-custom"><input placeholder="Свой жанр..." value={customGenre} onChange={(e) => setCustomGenre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom('genres', customGenre)} /><button onClick={() => addCustom('genres', customGenre)}><Plus size={14} /></button></div>
      </div>
      <div className="filter-section">
        <div className="filter-label"><Smile size={12} /> Настроения</div>
        <div className="filter-chips">{allMoods.map(m => <button key={m} className={`chip ${selected.moods?.includes(m) ? 'active' : ''}`} onClick={() => toggleItem('moods', m)}>{m}</button>)}</div>
        <div className="filter-custom"><input placeholder="Своё настроение..." value={customMood} onChange={(e) => setCustomMood(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom('moods', customMood)} /><button onClick={() => addCustom('moods', customMood)}><Plus size={14} /></button></div>
      </div>
      <div className="filter-section">
        <div className="filter-label"><Mic2 size={12} /> Исполнители</div>
        <div className="filter-chips">{allArtists.map(a => <button key={a} className={`chip ${selected.artists?.includes(a) ? 'active' : ''}`} onClick={() => toggleItem('artists', a)}>{a}</button>)}</div>
        <div className="filter-custom"><input placeholder="Свой исполнитель..." value={customArtist} onChange={(e) => setCustomArtist(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom('artists', customArtist)} /><button onClick={() => addCustom('artists', customArtist)}><Plus size={14} /></button></div>
      </div>
    </div>
  )
}

function TrackEditModal({ track, onClose, onSave, options = {} }) {
  const [title, setTitle] = useState(track.title); const [artist, setArtist] = useState(track.artist); const [genre, setGenre] = useState(track.genre || ''); const [mood, setMood] = useState(track.mood || ''); const [description, setDescription] = useState(track.description || '')
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', handleEsc); return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal track-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3><Edit3 size={18} /> Редактировать трек</h3><button className="modal-close" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label>Исполнитель</label><Combobox value={artist} onChange={setArtist} options={options.artists || []} placeholder="Выберите или введите исполнителя" /></div>
          <div className="field-row">
            <div className="field"><label>Жанр</label><Combobox value={genre} onChange={setGenre} options={options.genres || []} placeholder="Выберите или введите жанр" /></div>
            <div className="field"><label>Настроение</label><Combobox value={mood} onChange={setMood} options={options.moods || []} placeholder="Выберите или введите настроение" /></div>
          </div>
          <div className="field"><label>Описание</label><textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <div className="modal-footer"><button className="del" onClick={onClose}>Отмена</button><button className="pri" onClick={() => onSave({ title, artist, genre: genre || null, mood: mood || null, description })}><Check size={14} /> Сохранить</button></div>
      </div>
    </div>
  )
}

function TrackPageModal({ track, onClose, setPlay, setPlayContext, playContext, api, run, src, audioRef }) {
  const [comments, setComments] = useState([]); const [txt, setTxt] = useState(''); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0)
  useEffect(() => { run(async () => setComments(await api(`/tracks/${track.id}/comments`))) }, [track.id])
  useEffect(() => {
    if (audioRef.current) {
      const update = () => { setCurrentTime(audioRef.current.currentTime); setDuration(audioRef.current.duration || 0) }
      audioRef.current.addEventListener('timeupdate', update)
      return () => audioRef.current.removeEventListener('timeupdate', update)
    }
  }, [audioRef, playContext.tracks])
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', handleEsc); return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])
  const startPlay = () => {
    const idx = playContext.tracks.findIndex(t => t.id === track.id)
    setPlayContext(idx >= 0 ? { ...playContext, index: idx } : { tracks: [track], index: 0 }); setPlay(track)
  }
  const handleSeek = (e) => { if (audioRef.current) audioRef.current.currentTime = e.target.value }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal track-page-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="track-page-cover">{track.cover_url ? <img src={`${API}${track.cover_url}`} alt={track.title} /> : <div className="track-page-cover-placeholder"><Music size={64} /></div>}</div>
        <div className="track-page-info">
          <h2>{track.title}</h2><div className="track-page-artist">{track.artist || 'Неизвестный исполнитель'}</div>
          <div className="track-page-meta">
            {track.genre && <span className="meta-tag"><Tag size={12} /> {track.genre}</span>}
            {track.mood && <span className="meta-tag"><Smile size={12} /> {track.mood}</span>}
            <span className="meta-tag"><Clock size={12} /> {formatDuration(track.duration)}</span>
            <span className="meta-tag">{(track.size / 1048576).toFixed(1)} МБ</span>
          </div>
          {track.description && <div className="track-page-desc">{track.description}</div>}
          {track.note && <div className="track-page-note"><StickyNote size={14} /><div><b>{track.note.title}</b><p>{track.note.text}</p></div></div>}
          <div className="track-page-actions">
            <button className="pri big" onClick={startPlay}><Play size={18} /> Слушать</button>
            <button className="big" onClick={() => run(async () => { await downloadTrack(api, track) })} title="Скачать"><Download size={18} /></button>
          </div>
          {playContext.tracks.some(t => t.id === track.id) && (
            <div className="seek-bar-container">
              <span className="mut">{formatDuration(currentTime)}</span>
              <input type="range" min="0" max={duration || 100} value={currentTime} onChange={handleSeek} className="seek-bar" />
              <span className="mut">{formatDuration(duration)}</span>
            </div>
          )}
        </div>
        <div className="track-page-comments">
          <h3>Комментарии</h3>
          <div className="comment-input-row">
            <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Написать комментарий…" />
            <button className="pri icon-btn" onClick={() => txt.trim() && run(async () => { await api(`/tracks/${track.id}/comments`, { method: 'POST', body: { text: txt } }); setTxt(''); setComments(await api(`/tracks/${track.id}/comments`)) })}><Plus size={16} /></button>
          </div>
          {comments.map((c) => <div key={c.id} className="comment"><b>{c.author}</b><div>{c.text}</div></div>)}
          {comments.length === 0 && <div className="mut">Пока нет комментариев</div>}
        </div>
      </div>
    </div>
  )
}

function Tracks({ api, run, src, setPlay, setPlayContext, playContext, audioRef, me }) {
  const [tracks, setTracks] = useState([]); const [q, setQ] = useState(''); const [filters, setFilters] = useState({ genres: [], moods: [], artists: [] })
  const [filterOptions, setFilterOptions] = useState({ genres: [], moods: [], artists: [] }); const [showFilters, setShowFilters] = useState(false)
  const [uploading, setUploading] = useState(false); const [editTrack, setEditTrack] = useState(null); const [viewTrack, setViewTrack] = useState(null)

  const load = useCallback(() => {
    run(async () => {
      const params = new URLSearchParams(); if (q) params.set('q', q)
      if (filters.genres.length) params.set('genres', JSON.stringify(filters.genres))
      if (filters.moods.length) params.set('moods', JSON.stringify(filters.moods))
      if (filters.artists.length) params.set('artists', JSON.stringify(filters.artists))
      setTracks(await api('/tracks?' + params.toString())); setFilterOptions(await api('/tracks/filters'))
    })
  }, [q, filters])
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  const handleDownload = (track) => run(async () => { await downloadTrack(api, track) })
  const deleteTrack = (t) => { if (window.confirm(`Удалить трек «${t.title}»? Файл, комментарии и заметки к нему тоже будут удалены.`)) run(async () => { await api(`/tracks/${t.id}`, { method: 'DELETE' }); load() }) }

  const playTrack = (track, list) => {
    const idx = list.findIndex(t => t.id === track.id); setPlayContext({ tracks: list, index: idx }); setPlay(track)
  }

  const handleCustomFilterAdd = (type, value) => {   // сохраняем на сервере, чтобы значение не пропадало после обновления
    setFilterOptions(prev => ({ ...prev, [type]: [...new Set([...(prev[type] || []), value])] }))
    run(async () => setFilterOptions(await api('/users/me/filters', { method: 'POST', body: { kind: type, value } })))
  }

  const optionLists = { genres: [...new Set([...(filterOptions.genres || []), ...DEFAULT_GENRES])], moods: [...new Set([...(filterOptions.moods || []), ...DEFAULT_MOODS])], artists: filterOptions.artists || [] }
  if (uploading) return <UploadTrack me={me} options={optionLists} api={api} run={run} onUploaded={() => { setUploading(false); load() }} onCancel={() => setUploading(false)} />

  return (
    <>
      <h2><Music size={22} /> Библиотека</h2>
      <div className="search-row">
        <Search size={16} /><input placeholder="Поиск по названию, исполнителю, описанию, заметкам..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`icon-btn ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)} title="Фильтры"><Filter size={16} /></button>
      </div>
      {showFilters && <TrackFilters filters={filterOptions} selected={filters} onChange={setFilters} onCustomAdd={handleCustomFilterAdd} />}
      <div className="card upload-card" onClick={() => setUploading(true)}><Upload size={20} /><div><b>Загрузить новый трек</b><div className="mut">MP3/WAV, до {Math.round((me?.limits?.track_max_seconds || 3600) / 60)} мин · всего до {fmtSize(me?.limits?.storage_limit || 7 * 1073741824)} на пользователя</div></div></div>
      {tracks.map((t) => (
        <div key={t.id} className="card track-card">
          <div className="track-row" onClick={() => playTrack(t, tracks)} style={{cursor: 'pointer'}}>
            {t.cover_url && <img src={`${API}${t.cover_url}`} alt="" className="track-cover" />}
            <div className="track-info">
              <b>{t.title}</b>
              <span className="mut">{t.artist || 'Неизвестный исполнитель'}{t.genre ? ` • ${t.genre}` : ''}{t.duration ? ` • ${formatDuration(t.duration)}` : ''}</span>
              {t.note && <div className="track-note-hint"><StickyNote size={10} /> {t.note.title}</div>}
            </div>
            <div className="track-actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn pri" onClick={() => playTrack(t, tracks)} title="Воспроизвести"><Play size={16} /></button>
              <button className="icon-btn" onClick={() => handleDownload(t)} title="Скачать"><Download size={16} /></button>
              <button className="icon-btn" onClick={() => setEditTrack(t)} title="Редактировать"><Edit3 size={16} /></button>
              <button className="icon-btn" onClick={() => setViewTrack(t)} title="Страница трека"><Music size={16} /></button>
              <button className="icon-btn del" onClick={() => deleteTrack(t)} title="Удалить"><Trash2 size={16} /></button>
            </div>
          </div>
        </div>
      ))}
      {!tracks.length && <Empty>Пока пусто — загрузите первый трек.</Empty>}
      {editTrack && <TrackEditModal options={optionLists} track={editTrack} onClose={() => setEditTrack(null)} onSave={async (data) => { await run(async () => { await api(`/tracks/${editTrack.id}`, { method: 'PATCH', body: data }); setEditTrack(null); load() }) }} />}
      {viewTrack && <TrackPageModal track={viewTrack} onClose={() => setViewTrack(null)} setPlay={setPlay} setPlayContext={setPlayContext} playContext={playContext} api={api} run={run} src={src} audioRef={audioRef} />}
    </>
  )
}

function Playlists({ api, run, setPlay, setPlayContext, playContext, me }) {
  const [list, setList] = useState([]); const [cur, setCur] = useState(null); const [f, setF] = useState({ name: '', is_public: false }); const [editPl, setEditPl] = useState(null)
  const load = () => run(async () => setList(await api('/playlists')))
  useEffect(() => { load() }, [])

  const refreshCur = () => cur && cur.id !== 'now-playing' && run(async () => setCur(await api(`/playlists/${cur.id}`)))
  const closeModal = () => { setEditPl(null); refreshCur(); load() }
  const modal = editPl && <PlaylistEditModal playlist={editPl} onClose={closeModal} onSaved={(upd) => setCur(upd)} onDeleted={() => { setEditPl(null); setCur(null); load() }} api={api} run={run} />

  if (cur) {
    return (
      <>
        <PlaylistPage me={me} playlist={cur} api={api} run={run} setPlay={setPlay} setPlayContext={setPlayContext}
          onBack={() => { setCur(null); load() }} onEdit={(pl) => setEditPl(pl)} />
        {modal}
      </>
    )
  }

  return (
    <>
      <h2><ListMusic size={22} /> Плейлисты</h2>
      {playContext.tracks.length > 0 && (
        <div className="card playlist-card now-playing-card" onClick={() => setCur({ id: 'now-playing', name: '🎧 Слушаете сейчас', tracks_count: playContext.tracks.length, total_duration: playContext.tracks.reduce((acc, t) => acc + (t.duration || 0), 0), items: playContext.tracks.map((t, i) => ({ item_id: `np-${i}`, track: t, position: i })) })}>
          <div className="playlist-row">
            <div className="playlist-icon"><Play size={20} /></div>
            <div className="playlist-info"><b>🎧 Слушаете сейчас</b><span className="mut">{playContext.tracks.length} треков • {formatDuration(playContext.tracks.reduce((acc, t) => acc + (t.duration || 0), 0))}</span></div>
          </div>
        </div>
      )}
      <div className="card">
        <div className="field"><label>Название нового плейлиста</label><input placeholder="Мой плейлист" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <label className="checkbox-row"><input type="checkbox" checked={f.is_public} onChange={(e) => setF({ ...f, is_public: e.target.checked })} /><span>Публичный</span></label>
        <button className="pri full" onClick={() => f.name.trim() && run(async () => {
          await api('/playlists', { method: 'POST', body: { name: f.name.trim(), is_public: f.is_public } }); setF({ name: '', is_public: false }); load()
        })}><Plus size={16} /> Создать</button>
      </div>
      {list.map((p) => (
        <div key={p.id} className="card playlist-card" onClick={() => run(async () => setCur(await api(`/playlists/${p.id}`)))}>
          <div className="playlist-row">
            {p.cover_url ? <img src={`${API}${p.cover_url}`} className="playlist-cover-small" /> : <div className="playlist-icon">{p.is_public ? <Link2 size={20} /> : <Lock size={20} />}</div>}
            <div className="playlist-info"><b>{p.name}</b><span className="mut">{p.tracks_count} треков • {formatDuration(p.total_duration)}</span>{p.my_role && p.my_role !== 'owner' && <span className="tag">совместный · {p.my_role === 'editor' ? 'соавтор' : 'слушатель'}</span>}{p.is_owner && p.members_count > 0 && <span className="tag">участников: {p.members_count}</span>}</div>
          </div>
        </div>
      ))}
      {!list.length && playContext.tracks.length === 0 && <Empty>Создайте первый плейлист.</Empty>}
      
      {modal}
    </>
  )
}

function PlaylistPage({ me, playlist, api, run, setPlay, setPlayContext, onBack, onEdit }) {
  const [membersOpen, setMembersOpen] = useState(false)
  const [currentPl, setCurrentPl] = useState(playlist)
  const [items, setItems] = useState(playlist.items || [])
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSearch, setShowSearch] = useState(false)

  useEffect(() => { 
    setCurrentPl(playlist)
    setItems(playlist.items || []) 
  }, [playlist])

  const playAll = () => { 
    const tracks = items.map(i => i.track)
    setPlayContext({ tracks, index: 0 })
    setPlay(tracks[0])
  }

  const removeItem = async (itemId) => {
    if (currentPl.id === 'now-playing') {
       const newItems = items.filter(i => i.item_id !== itemId)
       setPlayContext({ tracks: newItems.map(i => i.track), index: 0 })
       setItems(newItems)
       return
    }
    await run(async () => { 
      await api(`/playlists/${currentPl.id}/items/${itemId}`, { method: 'DELETE' })
      const updated = await api(`/playlists/${currentPl.id}`)
      setItems(updated.items || [])
    })
  }

  const searchTracks = useCallback(() => {
    if (!showSearch || currentPl.id === 'now-playing') return
    run(async () => {
      const all = await api(`/tracks?q=${encodeURIComponent(searchQ)}`)
      const addedIds = new Set(items.map(i => i.track.id))
      setSearchResults(all.filter(t => !addedIds.has(t.id)))
    })
  }, [searchQ, items, showSearch])

  useEffect(() => {
    const t = setTimeout(searchTracks, 300)
    return () => clearTimeout(t)
  }, [searchTracks])

  const addTrack = async (track) => {
    await run(async () => {
      await api(`/playlists/${currentPl.id}/items`, { method: 'POST', body: { track_id: track.id } })
      const updated = await api(`/playlists/${currentPl.id}`)
      setItems(updated.items || [])
      setSearchResults(prev => prev.filter(t => t.id !== track.id))
    })
  }

  const togglePublic = async () => {
    const newIsPublic = !currentPl.is_public
    const confirmed = window.confirm(`Сделать плейлист "${currentPl.name}" ${newIsPublic ? 'публичным' : 'приватным'}?`)
    if (!confirmed) return
    
    await run(async () => {
      const updated = await api(`/playlists/${currentPl.id}`, { method: 'PATCH', body: { is_public: newIsPublic } })
      setCurrentPl(updated); setItems(updated.items || [])
    })
  }

  const move = (idx, dir) => {
    const j = idx + dir; if (j < 0 || j >= items.length) return
    const next = [...items]; [next[idx], next[j]] = [next[j], next[idx]]; setItems(next)
    run(async () => { const upd = await api(`/playlists/${currentPl.id}/items/order`, { method: 'PUT', body: { item_ids: next.map(i => i.item_id) } }); setItems(upd.items || []) })
  }
  const shareLink = `${window.location.origin}${window.location.pathname}#/playlist/${currentPl.id}`
  const totalDur = items.reduce((a, i) => a + (i.track.duration || 0), 0)

  return (
    <>
      <button className="back-btn" onClick={onBack}>← Назад</button>
      {membersOpen && <MembersPanel playlist={currentPl} c={{ api, run, me }} onClose={() => setMembersOpen(false)} />}
      
      <div className="playlist-page-header">
        {currentPl.cover_url ? (
          <img src={`${API}${currentPl.cover_url}`} className="playlist-page-cover" />
        ) : (
          <div className="playlist-page-cover-placeholder"><ListMusic size={48} /></div>
        )}
        <div className="playlist-page-info">
          <h2>{currentPl.name}</h2>
          <div className="playlist-page-stats">
            <span>{items.length} треков</span>
            <span>•</span>
            <span>{formatDuration(totalDur)}</span>
          </div>
          {currentPl.description && <p className="mut">{currentPl.description}</p>}
          <div className="playlist-page-actions">
            <button className="pri" onClick={playAll}><Play size={16} /> Слушать всё</button>
            {currentPl.id !== 'now-playing' && currentPl.is_owner && (
              <>
                <button 
                  className="icon-btn" 
                  onClick={(e) => { e.stopPropagation(); togglePublic(); }} 
                  title={currentPl.is_public ? 'Сделать приватным' : 'Сделать публичным'}
                >
                  {currentPl.is_public ? <Unlock size={16} /> : <Lock size={16} />}
                </button>
                <button 
                  className="icon-btn" 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onEdit(currentPl); 
                  }} 
                  title="Редактировать плейлист"
                >
                  <Edit3 size={16} />
                </button>
              </>
            )}
            {currentPl.id !== 'now-playing' && <>
              <button className="icon-btn" title="Участники и соавторы" onClick={() => setMembersOpen(true)}><Users size={16} /></button>
              {(currentPl.is_owner || currentPl.is_public) && <ShareButton api={api} run={run} kind="playlist" refId={currentPl.id} />}
              {!currentPl.is_owner && <ReportButton api={api} run={run} type="playlist" id={currentPl.id} />}
            </>}
          </div>
          {currentPl.id !== 'now-playing' && currentPl.my_role && currentPl.my_role !== 'owner' && <Pill tone="accent">{currentPl.my_role === 'editor' ? 'вы соавтор' : 'вы слушатель'}</Pill>}
          {currentPl.id !== 'now-playing' && currentPl.is_public && (
            <div className="share-row"><Link2 size={14} /><input readOnly value={shareLink} onFocus={(e) => e.target.select()} />
              <button className="icon-btn" title="Копировать ссылку" onClick={() => navigator.clipboard?.writeText(shareLink)}><Copy size={14} /></button></div>
          )}
        </div>
      </div>

      {currentPl.id !== 'now-playing' && currentPl.can_edit && (
        <div className="playlist-add-search">
          <button className={`icon-btn ${showSearch ? 'active' : ''}`} onClick={() => setShowSearch(!showSearch)}><Search size={16} /></button>
          {showSearch && (
            <div className="playlist-search-panel">
              <input placeholder="Поиск треков для добавления..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map(t => (
                    <div key={t.id} className="search-result-item">
                      <div className="track-info"><b>{t.title}</b><span className="mut">{t.artist}</span></div>
                      <button className="icon-btn pri" onClick={() => addTrack(t)}><Plus size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {items.map((i, idx) => (
        <div key={i.item_id} className="card track-card">
          <div className="track-row" onClick={() => {
            const tracks = items.map(x => x.track)
            const idx = items.findIndex(x => x.item_id === i.item_id)
            setPlayContext({ tracks, index: idx })
            setPlay(i.track)
          }} style={{cursor: 'pointer'}}>
            {i.track.cover_url && <img src={`${API}${i.track.cover_url}`} className="track-cover" />}
            <div className="track-info">
              <b>{i.track.title}</b>
              <span className="mut">{i.track.artist} • {formatDuration(i.track.duration)}</span>
            </div>
            <div className="track-actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn pri" onClick={() => {
                const tracks = items.map(x => x.track)
                const idx = items.findIndex(x => x.item_id === i.item_id)
                setPlayContext({ tracks, index: idx })
                setPlay(i.track)
              }}><Play size={16} /></button>
              {currentPl.id !== 'now-playing' && currentPl.can_edit && <>
                <button className="icon-btn" disabled={idx === 0} onClick={() => move(idx, -1)} title="Выше"><ChevronUp size={16} /></button>
                <button className="icon-btn" disabled={idx === items.length - 1} onClick={() => move(idx, 1)} title="Ниже"><ChevronDown size={16} /></button>
              </>}
              {(currentPl.id === 'now-playing' || currentPl.is_owner || i.added_by === me?.id) && <button className="icon-btn del" onClick={() => removeItem(i.item_id)}><X size={16} /></button>}
            </div>
          </div>
        </div>
      ))}
      {!items.length && <Empty>Добавьте треки через поиск или редактирование.</Empty>}
    </>
  )
}

function PlaylistEditModal({ playlist, onClose, onSaved, onDeleted, api, run }) {
  const [name, setName] = useState(playlist.name)
  const [description, setDescription] = useState(playlist.description || '')
  const [cover, setCover] = useState(null)
  const [coverPreview, setCoverPreview] = useState(playlist.cover_url ? `${API}${playlist.cover_url}` : null)
  const [plItems, setPlItems] = useState([])
  const [allTracks, setAllTracks] = useState([])
  const [searchQ, setSearchQ] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())

  useEffect(() => {
    run(async () => {
      const pl = await api(`/playlists/${playlist.id}`)
      setPlItems(pl.items || [])
      setAllTracks(await api('/tracks'))
    })
  }, [playlist.id])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleCover = (e) => {
    const f = e.target.files[0]; if (!f) return; setCover(f)
    const reader = new FileReader()
    reader.onload = (ev) => setCoverPreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  const saveSettings = async () => {
    if (!name.trim()) return
    await run(async () => {
      let updated = await api(`/playlists/${playlist.id}`, { method: 'PATCH', body: { name, description } })
      if (cover) { const fd = new FormData(); fd.append('cover', cover); updated = await api(`/playlists/${playlist.id}/cover`, { method: 'POST', body: fd }); setCover(null) }
      onSaved(updated)
    })
  }
  const deletePlaylist = () => {
    if (!window.confirm(`Удалить плейлист «${playlist.name}»? Треки останутся в библиотеке.`)) return
    run(async () => { await api(`/playlists/${playlist.id}`, { method: 'DELETE' }); onDeleted() })
  }

  const removeTrack = async (itemId) => {
    await run(async () => {
      await api(`/playlists/${playlist.id}/items/${itemId}`, { method: 'DELETE' })
      const pl = await api(`/playlists/${playlist.id}`)
      setPlItems(pl.items || [])
    })
  }

  const toggleSelect = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const addSelected = async () => {
    await run(async () => {
      for (const id of [...selectedIds]) {
        await api(`/playlists/${playlist.id}/items`, { method: 'POST', body: { track_id: id } })
      }
      setSelectedIds(new Set())
      setSearchQ('')
      const pl = await api(`/playlists/${playlist.id}`)
      setPlItems(pl.items || [])
    })
  }

  const filteredTracks = allTracks.filter(t => t.title.toLowerCase().includes(searchQ.toLowerCase()) || (t.artist || '').toLowerCase().includes(searchQ.toLowerCase()))
  const addedIds = new Set(plItems.map(i => i.track.id))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal playlist-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Edit3 size={18} /> Редактировать плейлист</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Обложка</label>
            <label className="upload-zone cover-zone">
              <input type="file" accept="image/*" onChange={handleCover} hidden />
              {coverPreview ? <img src={coverPreview} className="cover-preview" /> : <><ImageIcon size={32} /><div><b>Загрузить обложку</b></div></>}
            </label>
          </div>
          <div className="field"><label>Название</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Описание</label><textarea rows="2" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <button className="pri full" onClick={saveSettings}><Check size={14} /> Сохранить настройки</button>
          <button className="del full" style={{ marginTop: 8 }} onClick={deletePlaylist}><Trash2 size={14} /> Удалить плейлист</button>
          
          <hr style={{borderColor: 'var(--brd)', margin: '16px 0'}} />
          
          <h4>Треки в плейлисте ({plItems.length})</h4>
          <div style={{maxHeight: '200px', overflowY: 'auto', marginBottom: '16px'}}>
            {plItems.map(i => (
              <div key={i.item_id} className="search-result-item">
                <div className="track-info"><b>{i.track.title}</b><span className="mut">{i.track.artist}</span></div>
                <button className="icon-btn del" onClick={() => removeTrack(i.item_id)}><X size={14} /></button>
              </div>
            ))}
          </div>

          <h4>Добавить треки</h4>
          <input placeholder="Поиск в медиатеке..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} style={{marginBottom: '8px'}} />
          <div style={{maxHeight: '200px', overflowY: 'auto', marginBottom: '16px'}}>
            {filteredTracks.filter(t => !addedIds.has(t.id)).map(t => (
              <div key={t.id} className="search-result-item" onClick={() => toggleSelect(t.id)} style={{cursor: 'pointer'}}>
                <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => {}} style={{width: 'auto', marginRight: '8px'}} />
                <div className="track-info"><b>{t.title}</b><span className="mut">{t.artist}</span></div>
              </div>
            ))}
          </div>
          <div className="add-actions">
            <button className="pri full" onClick={addSelected} disabled={selectedIds.size === 0}><Plus size={14} /> Добавить выбранные ({selectedIds.size})</button>
            <button className="link-btn" onClick={() => setSelectedIds(new Set(filteredTracks.filter(t => !addedIds.has(t.id)).map(t => t.id)))}>Выбрать все</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Profile({ api, run, logout, go, refreshMe }) {
  const [editing, setEditing] = useState(false); const [storageKey, setStorageKey] = useState(0)
  const [m, setM] = useState(null); const [about, setAbout] = useState(''); const [interests, setInterests] = useState(''); const [artists, setArtists] = useState('')
  const [theme, setTheme] = useState('plasma'); const [showMoreThemes, setShowMoreThemes] = useState(false); const popupRef = useRef(null)

  const load = () => run(async () => {
    const data = await api('/users/me'); setM(data); setAbout(data.about || ''); setInterests(data.music_interests || ''); setArtists(data.favorite_artists || ''); setTheme(data.theme || 'plasma')
  })
  useEffect(() => { load() }, [])
  useEffect(() => {
    const handleClickOutside = (event) => { if (popupRef.current && !popupRef.current.contains(event.target)) setShowMoreThemes(false) }
    if (showMoreThemes) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMoreThemes])

  if (!m) return null
  const patch = async (body) => { await api('/users/me', { method: 'PATCH', body }); load(); refreshMe && refreshMe() }
  const uploadAvatar = (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return
    const maxImg = m.limits?.image_max_bytes || 20 * 1048576
    if (file.size > maxImg) { run(async () => { throw new Error(`Фото больше ${Math.round(maxImg / 1048576)} МБ не загружаются`) }); return }
    const fd = new FormData(); fd.append('file', file)
    run(async () => { await api('/users/me/avatar', { method: 'POST', body: fd }); load() })
  }
  const changeTheme = (t) => { setTheme(t); setThemeOnPage(t); run(() => patch({ theme: t })) }
  const isDark = theme === QUICK_THEMES.dark, isLight = theme === QUICK_THEMES.light

  return (
    <>
      <div className="profile-header-row">
        <h2><UserIcon size={22} /> Профиль</h2>
        <div className="theme-switcher-wrapper">
          <div className="quick-themes-inline">
            <button className={`quick-theme-icon ${isDark ? 'active' : ''}`} onClick={() => changeTheme(QUICK_THEMES.dark)} title="Тёмная"><Mascot state="icon" size={20} theme={QUICK_THEMES.dark} /></button>
            <button className={`quick-theme-icon ${isLight ? 'active' : ''}`} onClick={() => changeTheme(QUICK_THEMES.light)} title="Светлая"><Mascot state="icon" size={20} theme={QUICK_THEMES.light} /></button>
          </div>
          <button className={`theme-more-btn ${showMoreThemes ? 'active' : ''}`} onClick={() => setShowMoreThemes(!showMoreThemes)}><Palette size={18} /><span>Темы</span></button>
          {showMoreThemes && (
            <div className="theme-popup" ref={popupRef}>
              <div className="theme-popup-header"><h3>Выберите тему</h3><button className="close-popup" onClick={() => setShowMoreThemes(false)}><X size={16} /></button></div>
              <div className="theme-popup-grid">{MORE_THEMES.map((t) => (<button key={t.id} className={`theme-popup-btn ${theme === t.id ? 'active' : ''}`} data-theme-btn={t.id} onClick={() => changeTheme(t.id)}>{t.name}</button>))}</div>
            </div>
          )}
        </div>
      </div>
      <div className="card profile-card">
        <div className="profile-head">
          <div className="avatar-wrap">
            {m.avatar_url ? <img src={API + m.avatar_url} className="avatar" alt="" /> : <div className="avatar avatar-ph"><Mascot state="idle" size={62} /></div>}
            <label className="avatar-edit"><ImageIcon size={14} /><input type="file" accept="image/*" onChange={uploadAvatar} hidden /></label>
          </div>
          <div className="profile-info">
            <b className="profile-name">{m.name}</b> <RoleBadge role={m.role} /><div className="nick">{m.nickname}</div><div className="mut">{m.email}</div>
            <div className="profile-stats"><span><Music size={14} /> {m.tracks} треков</span><span><ListMusic size={14} /> {m.playlists} плейлистов</span></div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="chip" onClick={() => setEditing(true)}><Edit3 size={13} /> Редактировать профиль</button>
              <button className="chip" onClick={() => go('settings')}>Приватность и рекомендации</button>
            </div>
          </div>
        </div>
      </div>
      <StorageMeter api={api} refreshKey={storageKey} />
      {editing && <EditProfileModal me={m} api={api} onClose={() => setEditing(false)} onSaved={() => { load(); refreshMe && refreshMe() }} />}
      <div className="card"><h3>О себе</h3><textarea rows="3" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== (m.about || '') && patch({ about })} /></div>
      <div className="card"><h3>Музыкальные интересы</h3><textarea rows="2" value={interests} onChange={(e) => setInterests(e.target.value)} onBlur={() => interests !== (m.music_interests || '') && patch({ music_interests: interests })} /></div>
      <div className="card"><h3>Любимые исполнители</h3><textarea rows="2" value={artists} onChange={(e) => setArtists(e.target.value)} onBlur={() => artists !== (m.favorite_artists || '') && patch({ favorite_artists: artists })} /></div>
      <div className="card"><label className="checkbox-row"><input type="checkbox" checked={m.is_profile_public} onChange={(e) => { const on = e.target.checked; if (window.confirm(`Сделать профиль ${on ? 'публичным' : 'закрытым'}? ${on ? 'Его смогут видеть другие пользователи.' : 'Другие пользователи больше не смогут его видеть.'}`)) patch({ is_profile_public: on }) }} /><span>Публичный профиль</span></label><div className="mut">Если включено — другие пользователи смогут видеть ваш профиль.</div></div>
      <button className="del full" onClick={logout}><LogOut size={16} /> Выйти</button>
    </>
  )
}

function PublicPlaylist({ id, authed, api, run, setPlay, setPlayContext }) {
  const [pl, setPl] = useState(null); const [failed, setFailed] = useState(false)
  useEffect(() => { run(async () => { try { setPl(await api(`/playlists/${id}`)) } catch (e) { setFailed(true); throw e } }) }, [id])
  const back = () => { window.location.hash = '' }
  const play = (idx) => { const tracks = pl.items.map(i => i.track); setPlayContext({ tracks, index: idx }); setPlay(tracks[idx]) }
  return (
    <>
      <button className="back-btn" onClick={back}>← {authed ? 'В приложение' : 'На главную'}</button>
      {!authed && <div className="card note-card">Гостевой режим: можно слушать плейлист. Скачивание и остальные разделы доступны после входа.</div>}
      {failed && <Empty state="error">Плейлист недоступен: он закрыт или не существует.</Empty>}
      {pl && (
        <>
          <div className="playlist-page-header">
            {pl.cover_url ? <img src={`${API}${pl.cover_url}`} className="playlist-page-cover" alt="" /> : <div className="playlist-page-cover-placeholder"><ListMusic size={48} /></div>}
            <div className="playlist-page-info">
              <h2>{pl.name}</h2>
              <div className="playlist-page-stats"><span>{pl.owner_name}</span><span>•</span><span>{pl.items.length} треков</span></div>
              {pl.description && <p className="mut">{pl.description}</p>}
              {pl.items.length > 0 && <div className="playlist-page-actions"><button className="pri" onClick={() => play(0)}><Play size={16} /> Слушать всё</button></div>}
            </div>
          </div>
          {pl.items.map((i, idx) => (
            <div key={i.item_id} className="card track-card">
              <div className="track-row" style={{ cursor: 'pointer' }} onClick={() => play(idx)}>
                {i.track.cover_url && <img src={`${API}${i.track.cover_url}`} className="track-cover" alt="" />}
                <div className="track-info"><b>{i.track.title}</b><span className="mut">{i.track.artist} • {formatDuration(i.track.duration)}</span></div>
                <div className="track-actions" onClick={(e) => e.stopPropagation()}><button className="icon-btn pri" onClick={() => play(idx)}><Play size={16} /></button></div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

function Notes({ api, run }) {
  const [notes, setNotes] = useState([]); const [tracks, setTracks] = useState([]); const [pls, setPls] = useState([])
  const [f, setF] = useState({ title: '', text: '', target: '' }); const [edit, setEdit] = useState(null)
  const load = () => run(async () => { setNotes(await api('/notes')); setTracks(await api('/tracks')); setPls(await api('/playlists')) })
  useEffect(() => { load() }, [])
  const targetName = (n) => n.track_id ? `Трек: ${tracks.find(t => t.id === n.track_id)?.title || '…'}` : `Плейлист: ${pls.find(p => p.id === n.playlist_id)?.name || '…'}`
  const create = () => {
    if (!f.title.trim() || !f.text.trim() || !f.target) return
    const [kind, id] = f.target.split(':')
    run(async () => { await api('/notes', { method: 'POST', body: { title: f.title, text: f.text, [kind === 't' ? 'track_id' : 'playlist_id']: Number(id) } }); setF({ title: '', text: '', target: '' }); load() })
  }
  const save = () => run(async () => { await api(`/notes/${edit.id}`, { method: 'PATCH', body: { title: edit.title, text: edit.text } }); setEdit(null); load() })
  const remove = (n) => window.confirm('Удалить заметку?') && run(async () => { await api(`/notes/${n.id}`, { method: 'DELETE' }); load() })
  return (
    <>
      <h2><StickyNote size={22} /> Заметки</h2>
      <div className="card">
        <div className="field"><label>Относится к</label>
          <select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
            <option value="">— выберите трек или плейлист —</option>
            <optgroup label="Треки">{tracks.map(t => <option key={'t' + t.id} value={`t:${t.id}`}>{t.title}</option>)}</optgroup>
            <optgroup label="Плейлисты">{pls.map(p => <option key={'p' + p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
          </select></div>
        <div className="field"><label>Заголовок</label><input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label>Текст</label><textarea rows="3" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
        <button className="pri full" onClick={create} disabled={!f.title.trim() || !f.text.trim() || !f.target}><Plus size={16} /> Добавить заметку</button>
      </div>
      {notes.map(n => (
        <div key={n.id} className="card">
          {edit?.id === n.id ? (
            <>
              <div className="field"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
              <div className="field"><textarea rows="3" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></div>
              <div className="row"><button className="del" onClick={() => setEdit(null)}>Отмена</button><button className="pri" onClick={save}><Check size={14} /> Сохранить</button></div>
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{n.title}</b>
                <span><button className="icon-btn" onClick={() => setEdit({ id: n.id, title: n.title, text: n.text })}><Edit3 size={14} /></button><button className="icon-btn del" onClick={() => remove(n)}><Trash2 size={14} /></button></span>
              </div>
              <div className="mut">{targetName(n)}</div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{n.text}</p>
            </>
          )}
        </div>
      ))}
      {!notes.length && <Empty>Заметок пока нет.</Empty>}
    </>
  )
}
