import React, { useState, useEffect } from 'react'
import { Play, Plus, X, Check, Trash2, Search as SearchIcon, UserPlus, UserCheck, UserMinus, MessageCircle, Ban, Image as ImageIcon, Music, Send, Users, Bell, Heart, ShieldAlert, LifeBuoy, ListMusic, MessageSquare } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { API, fileUrl, fmtDate, Avatar, RoleBadge, Toggle, Seg, Modal, Pill, ReportButton, ShareButton, REACTIONS } from './ui.jsx'

const Empty = ({ children, state = 'idle' }) => <div className="empty"><Mascot state={state} size={84} /><div className="mut">{children}</div></div>
const fmtDur = (s) => { if (!s) return '0:00'; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const playList = (c, tracks, i) => { c.setPlayContext({ tracks, index: i }); c.setPlay(tracks[i]) }
export const openChat = (c, id) => c.run(async () => { const ch = await c.api('/chats', { method: 'POST', body: { user_id: id } }); c.go('chats', { open: ch.id }) })
const canWrite = (c, u) => c.me?.role === 'user' && u.role === 'user' && u.id !== c.me.id   // с модерацией чат открывает модератор
const REASON = { friend: 'Друг', follow: 'Подписка', similar: 'Похожий вкус', mine: 'Вы' }

/* ===================== Пост ===================== */
function Reactions({ post, c }) {
  const [r, setR] = useState({ reactions: post.reactions || {}, mine: post.my_reaction || null })
  useEffect(() => setR({ reactions: post.reactions || {}, mine: post.my_reaction || null }), [post.id, post.my_reaction, JSON.stringify(post.reactions)])
  const react = (k) => {
    const prev = r; const same = prev.mine === k; const counts = { ...prev.reactions }
    if (prev.mine) counts[prev.mine] = Math.max(0, (counts[prev.mine] || 0) - 1)
    if (!same) counts[k] = (counts[k] || 0) + 1
    setR({ reactions: counts, mine: same ? null : k })        // сразу показываем результат, сервер подтвердит
    c.run(async () => {
      try { const d = await c.api(`/posts/${post.id}/reaction`, same ? { method: 'DELETE' } : { method: 'PUT', body: { kind: k } }); setR({ reactions: d.reactions, mine: d.my_reaction }) }
      catch (e) { setR(prev); throw e }
    })
  }
  return <div className="reactions">{REACTIONS.map(([k, e, l]) => (
    <button key={k} className={`react-btn ${r.mine === k ? 'on' : ''}`} title={l} aria-pressed={r.mine === k} onClick={() => react(k)}>{e}{r.reactions[k] > 0 && <span className="n">{r.reactions[k]}</span>}</button>))}</div>
}

function PostComments({ post, c, onCount }) {
  const [items, setItems] = useState(null); const [more, setMore] = useState(false); const [text, setText] = useState('')
  const load = (offset = 0) => c.run(async () => { const d = await c.api(`/posts/${post.id}/comments?offset=${offset}&limit=30`); setItems(p => offset ? [...(p || []), ...d.items] : d.items); setMore(d.has_more) })
  useEffect(() => { load() }, [post.id])
  const send = () => { const t = text.trim(); if (!t) return; c.run(async () => { const d = await c.api(`/posts/${post.id}/comments`, { method: 'POST', body: { text: t } }); setItems(p => [...(p || []), d]); setText(''); onCount(1) }) }
  const del = (cm) => window.confirm('Удалить комментарий?') && c.run(async () => { await c.api(`/posts/${post.id}/comments/${cm.id}`, { method: 'DELETE' }); setItems(p => p.filter(x => x.id !== cm.id)); onCount(-1) })
  return (
    <div className="comments">
      {items === null && <span className="mut">Загрузка…</span>}
      {items?.map(cm => (
        <div key={cm.id} className="pcomment">
          <Avatar u={cm.author} size={30} />
          <div className="pcomment-body">
            <div className="pcomment-head"><button className="link-user" onClick={() => c.go('user', { id: cm.author.id })}><b>{cm.author.name}</b></button><small className="mut">{fmtDate(cm.created_at)}</small></div>
            <p className="pcomment-text">{cm.text}</p>
          </div>
          {cm.can_delete && <button className="icon-btn del" style={{ width: 30, height: 30 }} title="Удалить" onClick={() => del(cm)}><Trash2 size={13} /></button>}
        </div>))}
      {items?.length === 0 && <span className="mut">Комментариев пока нет — напишите первый.</span>}
      {more && <button className="link-btn" onClick={() => load(items.length)}>Показать ещё</button>}
      <div className="comment-form">
        <input value={text} maxLength={1000} placeholder="Написать комментарий…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="icon-btn pri" onClick={send} disabled={!text.trim()} title="Отправить"><Send size={15} /></button>
      </div>
    </div>
  )
}

export function PostCard({ post, c, onDeleted, openComments = false }) {
  const [open, setOpen] = useState(openComments); const [count, setCount] = useState(post.comments_count || 0)
  useEffect(() => setCount(post.comments_count || 0), [post.id, post.comments_count])
  const del = () => window.confirm('Удалить пост?') && c.run(async () => { await c.api(`/posts/${post.id}`, { method: 'DELETE' }); onDeleted?.(post.id) })
  return (
    <article className="card post">
      <header className="post-head">
        <button className="link-user" onClick={() => c.go('user', { id: post.author.id })}><Avatar u={post.author} size={40} /><span><b>{post.author.name}</b> <RoleBadge role={post.author.role} /><small className="mut">{post.author.nickname} · {fmtDate(post.created_at)} · {post.visibility === 'public' ? 'публично' : 'для друзей'}</small></span></button>
        {post.reason && post.reason !== 'mine' && <Pill tone={post.reason === 'similar' ? 'accent' : 'neutral'}>{REASON[post.reason]}</Pill>}
      </header>
      {post.text && <p className="post-text">{post.text}</p>}
      {post.images.length > 0 && <div className={`img-grid n${Math.min(post.images.length, 4)}`}>{post.images.map(n => <img key={n} src={fileUrl(`/files/${n}`)} alt="" loading="lazy" />)}</div>}
      {post.tracks.map((t, i) => (
        <div key={t.id} className="post-track">
          <button className="icon-btn pri" onClick={() => playList(c, post.tracks, i)}><Play size={15} /></button>
          <div className="track-info"><b>{t.title}</b><span className="mut">{t.artist} • {fmtDur(t.duration)}</span></div>
        </div>))}
      <Reactions post={post} c={c} />
      <footer className="post-bar">
        <button className={`chip ${open ? 'active' : ''}`} onClick={() => setOpen(o => !o)}><MessageSquare size={14} /> Комментарии{count > 0 ? ` · ${count}` : ''}</button>
        <div className="post-actions">
          {(post.is_mine || post.visibility === 'public') && <ShareButton api={c.api} run={c.run} kind="post" refId={post.id} />}
          {!post.is_mine && <ReportButton api={c.api} run={c.run} type="post" id={post.id} />}
          {post.is_mine && <button className="icon-btn del" onClick={del} title="Удалить"><Trash2 size={15} /></button>}
        </div>
      </footer>
      {open && <PostComments post={post} c={c} onCount={(d) => setCount(n => Math.max(0, n + d))} />}
    </article>
  )
}

/** Отдельная страница поста (переход из уведомления о комментарии). */
export function PostPage({ id, ...c }) {
  const [p, setP] = useState(null); const [gone, setGone] = useState(false)
  useEffect(() => { setP(null); setGone(false); c.api(`/posts/${id}`).then(setP).catch(() => setGone(true)) }, [id])
  return (
    <>
      <button className="back-btn" onClick={() => c.go('feed')}>← Назад</button>
      {gone ? <Empty state="error">Пост недоступен или удалён.</Empty> : p && <PostCard post={p} c={c} openComments onDeleted={() => c.go('feed')} />}
    </>
  )
}

/* ===================== Лента ===================== */
export function Feed(c) {
  const [items, setItems] = useState([]); const [more, setMore] = useState(false); const [loaded, setLoaded] = useState(false); const [recs, setRecs] = useState(null)
  const load = (offset = 0) => c.run(async () => {
    const d = await c.api(`/feed?offset=${offset}&limit=20`); setItems(p => offset ? [...p, ...d.items] : d.items); setMore(d.has_more); setLoaded(true)
  })
  useEffect(() => { load(); c.run(async () => setRecs(await c.api('/recommendations/users'))) }, [])
  const addFriend = (id) => c.run(async () => { await c.api('/friends/requests', { method: 'POST', body: { user_id: id } }); setRecs(r => ({ ...r, items: r.items.filter(x => x.user.id !== id) })) })
  return (
    <>
      <div className="row between"><h2><Users size={22} /> Лента</h2><button className="pri" onClick={() => c.go('compose')}><Plus size={16} /> Новый пост</button></div>
      {recs && recs.platform_enabled && !recs.enabled && <div className="card note-card"><Heart size={16} /> Включите «Люди со схожим вкусом» в <button className="link-btn" onClick={() => c.go('settings')}>настройках рекомендаций</button>, чтобы видеть новые профили и посты.</div>}
      {recs?.enabled && recs.items.length > 0 && (
        <section className="card"><h3>Люди со схожим вкусом</h3>
          <div className="recs">{recs.items.slice(0, 6).map(r => (
            <div key={r.user.id} className="rec">
              <button className="link-user" onClick={() => c.go('user', { id: r.user.id })}><Avatar u={r.user} size={36} /><b>{r.user.name}</b></button>
              <div className="tags">{[...r.shared.genres, ...r.shared.moods, ...r.shared.artists].slice(0, 4).map(t => <span key={t} className="tag">{t}</span>)}<span className="tag tag-score">{Math.round(r.score * 100)}%</span></div>
              <button className="chip" onClick={() => addFriend(r.user.id)}><UserPlus size={13} /> В друзья</button>
            </div>))}</div></section>)}
      {items.map(p => <PostCard key={p.id} post={p} c={c} onDeleted={(id) => setItems(a => a.filter(x => x.id !== id))} />)}
      {loaded && !items.length && <Empty>В ленте пока пусто. Добавьте друзей или подпишитесь на людей — их посты появятся здесь.</Empty>}
      {more && <button className="full" onClick={() => load(items.length)}>Показать ещё</button>}
    </>
  )
}

/* ===================== Создание поста ===================== */
export function Composer(c) {
  const [text, setText] = useState(''); const [files, setFiles] = useState([]); const [tracks, setTracks] = useState([]); const [picked, setPicked] = useState([])
  const [vis, setVis] = useState(c.me?.is_profile_public ? 'public' : 'friends')
  useEffect(() => { c.run(async () => setTracks(await c.api('/tracks'))) }, [])
  const maxImg = c.me?.limits?.image_max_bytes || 20 * 1048576
  const addFiles = (e) => {
    const all = [...e.target.files].filter(x => /^image\//.test(x.type)); const f = all.filter(x => x.size <= maxImg)
    if (f.length < all.length) c.run(async () => { throw new Error(`Фото больше ${Math.round(maxImg / 1048576)} МБ не загружаются`) })
    setFiles(p => [...p, ...f].slice(0, 8)); e.target.value = ''
  }
  const togglePick = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const publish = () => c.run(async () => {
    const fd = new FormData(); fd.append('text', text); fd.append('visibility', vis); fd.append('track_ids', picked.join(','))
    files.forEach(f => fd.append('images', f)); await c.api('/posts', { method: 'POST', body: fd }); c.go('feed')
  })
  const empty = !text.trim() && !files.length && !picked.length
  return (
    <>
      <div className="row between"><h2>Новый пост</h2><button className="icon-btn" onClick={() => c.go('feed')}><X size={18} /></button></div>
      <div className="card">
        <div className="field"><textarea rows="5" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="О чём хотите рассказать?" /><div className="mut counter">{text.length}/2000</div></div>
        <div className="field"><label>Изображения ({files.length}/8)</label>
          <div className="thumbs">
            {files.map((f, i) => <div key={i} className="thumb"><img src={URL.createObjectURL(f)} alt="" /><button className="icon-btn del" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}><X size={12} /></button></div>)}
            {files.length < 8 && <label className="thumb thumb-add"><ImageIcon size={22} /><input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={addFiles} /></label>}
          </div></div>
        <div className="field"><label>Треки ({picked.length})</label>
          <div className="pick-list">{tracks.map(t => <button key={t.id} className={`chip ${picked.includes(t.id) ? 'active' : ''}`} onClick={() => togglePick(t.id)}><Music size={12} /> {t.title}</button>)}
            {!tracks.length && <span className="mut">В вашей библиотеке пока нет треков.</span>}</div></div>
        <div className="field"><label>Кто увидит</label>
          <Seg value={vis} onChange={(v) => setVis(v)} options={[['friends', 'Друзья'], ['public', 'Все (публично)']]} />
          {!c.me?.is_profile_public && <div className="field-warn">Профиль закрытый — публичные посты недоступны, пост увидят только друзья.</div>}</div>
        <button className="pri full" disabled={empty || (vis === 'public' && !c.me?.is_profile_public)} onClick={publish}><Send size={16} /> Опубликовать</button>
      </div>
    </>
  )
}

/* ===================== Друзья и подписки ===================== */
function UserRow({ u, children, c }) {
  return <div className="card user-row"><button className="link-user" onClick={() => c.go('user', { id: u.id })}><Avatar u={u} size={44} /><span><b>{u.name}</b> <small className="nick">{u.nickname}</small> <RoleBadge role={u.role} />{u.mutual && <Pill tone="accent">взаимно</Pill>}{u.mutual_follow && <Pill tone="accent">взаимная подписка</Pill>}</span></button><div className="row">{canWrite(c, u) && <button className="icon-btn" title="Написать" onClick={() => openChat(c, u.id)}><MessageCircle size={16} /></button>}{children}</div></div>
}

export function Friends(c) {
  const [d, setD] = useState(null); const [tab, setTab] = useState('friends'); const [recs, setRecs] = useState(null)
  const load = () => c.run(async () => { setD(await c.api('/friends')); setRecs(await c.api('/recommendations/users')); c.refreshMe() })
  useEffect(() => { load() }, [])
  const act = (fn) => c.run(async () => { await fn(); await load() })
  if (!d) return null
  const reqN = d.incoming.length
  return (
    <>
      <h2><Users size={22} /> Друзья и подписки</h2>
      <Seg value={tab} onChange={setTab} options={[['friends', 'Друзья', d.friends.length], ['requests', 'Заявки', reqN], ['following', 'Подписки', d.following.length], ['followers', 'Подписчики', d.followers.length], ['recs', 'Похожие']]} />
      {tab === 'friends' && <>{d.friends.map(u => <UserRow key={u.id} u={u} c={c}>
        <button className="icon-btn del" title="Удалить из друзей" onClick={() => window.confirm(`Удалить ${u.name} из друзей?`) && act(() => c.api(`/friends/${u.id}`, { method: 'DELETE' }))}><UserMinus size={16} /></button></UserRow>)}
        {!d.friends.length && <Empty>Друзей пока нет. Найдите людей через поиск вверху.</Empty>}</>}
      {tab === 'requests' && <>
        {d.incoming.length > 0 && <h3>Входящие</h3>}
        {d.incoming.map(u => <UserRow key={u.request_id} u={u} c={c}>
          <button className="pri" onClick={() => act(() => c.api(`/friends/requests/${u.request_id}/accept`, { method: 'POST' }))}><Check size={14} /> Принять</button>
          <button onClick={() => act(() => c.api(`/friends/requests/${u.request_id}/decline`, { method: 'POST' }))}>Отклонить</button></UserRow>)}
        {d.outgoing.length > 0 && <h3>Исходящие</h3>}
        {d.outgoing.map(u => <UserRow key={u.request_id} u={u} c={c}><button onClick={() => act(() => c.api(`/friends/requests/${u.request_id}/decline`, { method: 'POST' }))}>Отменить</button></UserRow>)}
        {!d.incoming.length && !d.outgoing.length && <Empty>Заявок нет.</Empty>}</>}
      {tab === 'following' && <>{d.following.map(u => <UserRow key={u.id} u={u} c={c}><button onClick={() => act(() => c.api(`/follows/${u.id}`, { method: 'DELETE' }))}>Отписаться</button></UserRow>)}{!d.following.length && <Empty>Вы ни на кого не подписаны. Подписаться можно на публичные профили.</Empty>}</>}
      {tab === 'followers' && <>{d.followers.map(u => <UserRow key={u.id} u={u} c={c} />)}{!d.followers.length && <Empty>Подписчиков пока нет.</Empty>}</>}
      {tab === 'recs' && (!recs?.enabled
        ? <Empty>Рекомендации выключены. Включите их в <button className="link-btn" onClick={() => c.go('settings')}>настройках</button>{recs && !recs.platform_enabled ? ' (сейчас отключены на платформе)' : ''}.</Empty>
        : <>{recs.items.map(r => <UserRow key={r.user.id} u={r.user} c={c}><span className="tag tag-score">{Math.round(r.score * 100)}%</span><button className="chip" onClick={() => act(() => c.api('/friends/requests', { method: 'POST', body: { user_id: r.user.id } }))}><UserPlus size={13} /> В друзья</button></UserRow>)}{!recs.items.length && <Empty>Пока нет людей со схожим вкусом.</Empty>}</>)}
    </>
  )
}

/* ===================== Профиль другого пользователя ===================== */
export function UserProfile({ id, ...c }) {
  const [p, setP] = useState(null); const [posts, setPosts] = useState([]); const [mutual, setMutual] = useState([]); const [tab, setTab] = useState('posts'); const [gone, setGone] = useState(false)
  const load = () => c.run(async () => {
    try {
      const d = await c.api(`/users/${id}`); setP(d)
      if (!d.restricted) { setPosts(await c.api(`/users/${id}/posts`)); if (!d.is_me) setMutual(await c.api(`/friends/mutual/${id}`)) }
    } catch (e) { setGone(true); throw e }
  })
  useEffect(() => { setP(null); setGone(false); load() }, [id])
  const act = (fn) => c.run(async () => { await fn(); await load() })
  if (gone) return <><button className="back-btn" onClick={() => c.go('feed')}>← Назад</button><Empty state="error">Профиль недоступен.</Empty></>
  if (!p) return null
  const rel = p.relation
  return (
    <>
      <button className="back-btn" onClick={() => c.go('feed')}>← Назад</button>
      <div className="card profile-card"><div className="profile-head">
        <Avatar u={p} size={96} />
        <div className="profile-info"><b className="profile-name">{p.name}</b> <RoleBadge role={p.role} /><div className="nick">{p.nickname}</div>
          <div className="profile-stats">{!p.restricted && <><span><Users size={14} /> {p.friends_count} друзей</span><span><Heart size={14} /> {p.followers_count} подписчиков</span></>}{p.restricted && <Pill>закрытый профиль</Pill>}</div>
          {mutual.length > 0 && <div className="mut">Общие друзья: {mutual.slice(0, 3).map(m => m.name).join(', ')}{mutual.length > 3 ? ` и ещё ${mutual.length - 3}` : ''}</div>}</div></div>
        {!p.is_me && (
          <div className="row wrap" style={{ marginTop: 12 }}>
            {rel.friend ? <button onClick={() => act(() => c.api(`/friends/${p.id}`, { method: 'DELETE' }))}><UserCheck size={15} /> Друзья</button>
              : rel.request === 'incoming' ? <button className="pri" onClick={() => act(() => c.api(`/friends/requests/${rel.request_id}/accept`, { method: 'POST' }))}><Check size={15} /> Принять заявку</button>
              : rel.request === 'outgoing' ? <button onClick={() => act(() => c.api(`/friends/requests/${rel.request_id}/decline`, { method: 'POST' }))}>Заявка отправлена · отменить</button>
              : <button className="pri" onClick={() => act(() => c.api('/friends/requests', { method: 'POST', body: { user_id: p.id } }))}><UserPlus size={15} /> В друзья</button>}
            {p.is_profile_public && (rel.following ? <button onClick={() => act(() => c.api(`/follows/${p.id}`, { method: 'DELETE' }))}>Отписаться</button> : <button onClick={() => act(() => c.api('/follows', { method: 'POST', body: { user_id: p.id } }))}>Подписаться</button>)}
            {canWrite(c, p) && <button onClick={() => openChat(c, p.id)}><MessageCircle size={15} /> Написать</button>}
            <ReportButton api={c.api} run={c.run} type="profile" id={p.id} className="" label="Пожаловаться" />
            <button className="del" onClick={() => window.confirm(`Заблокировать ${p.name}? Вы перестанете видеть друг друга.`) && c.run(async () => { await c.api('/blocks', { method: 'POST', body: { user_id: p.id } }); c.go('feed') })}><Ban size={15} /> Заблокировать</button>
          </div>)}
      </div>
      {p.restricted ? <Empty>Профиль закрыт. Отправьте заявку в друзья, чтобы увидеть его содержимое.</Empty> : <>
        {(p.about || p.music_interests || p.favorite_artists) && <div className="card">{p.about && <p>{p.about}</p>}{p.music_interests && <p className="mut">Интересы: {p.music_interests}</p>}{p.favorite_artists && <p className="mut">Любимые исполнители: {p.favorite_artists}</p>}</div>}
        <Seg value={tab} onChange={setTab} options={[['posts', 'Посты', posts.length], ['playlists', 'Плейлисты', p.playlists.length]]} />
        {tab === 'posts' && <>{posts.map(x => <PostCard key={x.id} post={x} c={c} onDeleted={() => load()} />)}{!posts.length && <Empty>Постов нет.</Empty>}</>}
        {tab === 'playlists' && <>{p.playlists.map(pl => <div key={pl.id} className="card playlist-card" onClick={() => { window.location.hash = `#/playlist/${pl.id}` }}><div className="playlist-row"><div className="playlist-icon"><ListMusic size={22} /></div><div className="playlist-info"><b>{pl.name}</b><span className="mut">{pl.tracks_count} треков</span></div></div></div>)}{!p.playlists.length && <Empty>Публичных плейлистов нет.</Empty>}</>}
      </>}
    </>
  )
}

/* ===================== Глобальный поиск ===================== */
export function Search({ q: q0, ...c }) {
  const [q, setQ] = useState(q0 || ''); const [type, setType] = useState('all'); const [r, setR] = useState(null)
  const go = () => q.trim().length >= 2 && c.run(async () => setR(await c.api(`/search?q=${encodeURIComponent(q.trim())}&type=${type}`)))
  useEffect(() => { go() }, [type, q0])
  const none = r && !r.users.length && !r.posts.length && !r.playlists.length && !r.tracks.length
  return (
    <>
      <h2><SearchIcon size={22} /> Поиск</h2>
      <div className="search-row"><SearchIcon size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="Люди, посты, плейлисты, треки…" /><button className="pri" onClick={go}>Найти</button></div>
      <Seg value={type} onChange={setType} options={[['all', 'Всё'], ['users', 'Люди'], ['posts', 'Посты'], ['playlists', 'Плейлисты'], ['tracks', 'Треки']]} />
      <p className="mut">В поиск попадают только открытые профили и публичный контент.</p>
      {r?.users.length > 0 && <><h3>Люди</h3>{r.users.map(u => <UserRow key={u.id} u={u} c={c} />)}</>}
      {r?.posts.length > 0 && <><h3>Посты</h3>{r.posts.map(p => <PostCard key={p.id} post={p} c={c} />)}</>}
      {r?.playlists.length > 0 && <><h3>Плейлисты</h3>{r.playlists.map(pl => <div key={pl.id} className="card playlist-card" onClick={() => { window.location.hash = `#/playlist/${pl.id}` }}><div className="playlist-row"><div className="playlist-icon"><ListMusic size={22} /></div><div className="playlist-info"><b>{pl.name}</b><span className="mut">{pl.owner_name} • {pl.tracks_count} треков</span></div></div></div>)}</>}
      {r?.tracks.length > 0 && <><h3>Треки</h3>{r.tracks.map((t, i) => <div key={t.id} className="card track-card"><div className="track-row"><button className="icon-btn pri" onClick={() => playList(c, r.tracks, i)}><Play size={15} /></button><div className="track-info"><b>{t.title}</b><span className="mut">{t.artist} • {t.owner_name}</span></div></div></div>)}</>}
      {none && <Empty>Ничего не найдено.</Empty>}
    </>
  )
}

/* ===================== Уведомления ===================== */
const INBOX_KIND = { report: 'Жалоба', support: 'Поддержка', message: 'Сообщение', deletion: 'Удаление профиля', warning: 'Предупреждение' }
const INBOX_STATUS = { open: 'новая', in_progress: 'в работе', unread: 'не прочитано', pending: 'ждёт решения', confirmed: 'подтверждено', rejected: 'отклонено', active: 'активно', revoked: 'отозвано' }

/** Единый список обращений для модераторов и администраторов: жалобы, поддержка, сообщения, запросы на удаление, предупреждения. */
function StaffInbox(c) {
  const [d, setD] = useState(null); const [kind, setKind] = useState('')
  useEffect(() => { c.run(async () => setD(await c.api('/staff/inbox'))) }, [])
  if (!d) return null
  const items = d.items.filter(i => !kind || i.kind === kind)
  const open = (i) => i.ref.page === 'chats' ? c.go('chats', { open: i.ref.id }) : c.go(i.ref.page, i.ref.id ? { id: i.ref.id } : {})
  return (
    <>
      <div className="filter-chips" style={{ marginBottom: 10 }}>
        <button className={`chip ${!kind ? 'active' : ''}`} onClick={() => setKind('')}>Все · {d.items.length}</button>
        {Object.entries(INBOX_KIND).filter(([k]) => d.counts[k]).map(([k, l]) => <button key={k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{l} · {d.counts[k]}</button>)}
      </div>
      {items.map(i => (
        <div key={i.key} className={`card inbox-item ${i.urgent ? 'is-urgent' : ''}`} onClick={() => open(i)}>
          <Pill tone={i.kind === 'warning' ? 'warn' : i.kind === 'deletion' ? 'danger' : 'accent'}>{INBOX_KIND[i.kind]}</Pill>
          <div className="grow"><b>{i.title}</b>{i.user && <small className="nick"> · {i.user.name} {i.user.nickname}</small>}<div className="mut">{i.text}</div></div>
          <div className="col-end"><Pill tone={i.status === 'closed' || i.status === 'revoked' ? 'ok' : 'warn'}>{INBOX_STATUS[i.status] || i.status}</Pill>{i.urgent && <Pill tone="danger">срочно</Pill>}<small className="mut">{fmtDate(i.created_at)}</small></div>
        </div>))}
      {!items.length && <Empty>Обращений нет.</Empty>}
    </>
  )
}

export function Notifications(c) {
  const staff = c.me && (c.me.role === 'moderator' || c.me.role === 'admin'); const [tab, setTab] = useState('mine')
  const [list, setList] = useState([]); const [inv, setInv] = useState([])
  const load = () => c.run(async () => { setList(await c.api('/notifications')); setInv(await c.api('/invites/playlists')); c.refreshMe() })
  useEffect(() => { load() }, [])
  const open = (n) => {
    if (!n.read) c.api(`/notifications/${n.id}/read`, { method: 'POST' }).then(c.refreshMe).catch(() => {})
    if (n.ref_type === 'user') c.go('user', { id: n.ref_id }); else if (n.ref_type === 'chat') c.go('chats', { open: n.ref_id })
    else if (n.ref_type === 'post') c.go('post', { id: n.ref_id }); else if (n.ref_type === 'playlist') c.go('playlists'); else if (n.kind === 'friend_request') c.go('friends')
    setList(l => l.map(x => x.id === n.id ? { ...x, read: true } : x))
  }
  const respond = (pid, accept) => c.run(async () => { await c.api(`/playlists/${pid}/members/respond`, { method: 'POST', body: { accept } }); await load() })
  return (
    <>
      {staff && <Seg value={tab} onChange={setTab} options={[['mine', 'Уведомления'], ['inbox', 'Обращения', c.me.inbox_count || null]]} />}
      {tab === 'inbox' ? <><h2><Bell size={22} /> Обращения</h2><StaffInbox {...c} /></> : <>
      <div className="row between"><h2><Bell size={22} /> Уведомления</h2><button className="chip" onClick={() => c.run(async () => { await c.api('/notifications/read-all', { method: 'POST' }); await load() })}>Прочитать все</button></div>
      {inv.map(i => <div key={i.playlist_id} className="card"><b>Приглашение в плейлист «{i.name}»</b><div className="mut">от {i.invited_by.name} · {i.role === 'editor' ? 'соавтор' : 'слушатель'}</div>
        <div className="row" style={{ marginTop: 8 }}><button className="pri" onClick={() => respond(i.playlist_id, true)}><Check size={14} /> Принять</button><button onClick={() => respond(i.playlist_id, false)}>Отклонить</button></div></div>)}
      {list.map(n => (
        <div key={n.id} className={`card notif ${n.from_staff ? 'notif--staff' : ''} ${n.read ? '' : 'is-unread'}`} onClick={() => open(n)}>
          {n.from_staff && <span className="staff-tag"><ShieldAlert size={12} /> Модерация</span>}
          <div>{n.text}</div><small className="mut">{fmtDate(n.created_at)}</small>
        </div>))}
      {!list.length && !inv.length && <Empty>Уведомлений нет.</Empty>}
      </>}
    </>
  )
}

/* ===================== Приватность, рекомендации, блокировки, поддержка ===================== */
export function SettingsPage(c) {
  const [blocks, setBlocks] = useState([]); const [reports, setReports] = useState([]); const [txt, setTxt] = useState(''); const me = c.me
  const load = () => c.run(async () => { setBlocks(await c.api('/blocks')); setReports(await c.api('/reports/mine')) })
  useEffect(() => { load() }, [])
  const patch = (b) => c.run(async () => { await c.api('/users/me', { method: 'PATCH', body: b }); await c.refreshMe() })
  if (!me) return null
  const platformOn = me.platform?.recommendations_enabled
  return (
    <>
      <h2>Приватность и рекомендации</h2>
      {me.active_warnings > 0 && <div className="card notif notif--staff is-unread"><span className="staff-tag"><ShieldAlert size={12} /> Модерация</span>У вас активных предупреждений: {me.active_warnings}. Подробности — в уведомлениях.</div>}
      <div className="card">
        <Toggle checked={me.is_profile_public} label="Открытый профиль" hint="Открытый профиль виден в поиске, рекомендациях и ленте; закрытый — только друзьям. Закрытые профили нигде не показываются."
          onChange={(on) => window.confirm(`Сделать профиль ${on ? 'публичным' : 'закрытым'}? ${on ? 'Его смогут находить и видеть другие пользователи.' : 'Профиль исчезнет из поиска и рекомендаций.'}`) && patch({ is_profile_public: on })} />
        <hr />
        <Toggle checked={me.taste_recs && platformOn} disabled={!platformOn} label="Люди со схожим вкусом" hint={platformOn ? 'Показывать в ленте и в «Друзьях» профили и посты людей, чей вкус (жанры, настроения, исполнители) похож на ваш. Закрытые профили не рекомендуются.' : 'Рекомендации отключены администратором платформы.'} onChange={(on) => patch({ taste_recs: on })} />
      </div>
      <h3>Заблокированные</h3>
      <div className="card"><p className="mut">Заблокированные пользователи и вы невидимы друг для друга: ни профиля, ни постов, ни чата, ни комментариев.</p>
        {blocks.map(b => <div key={b.id} className="row between user-row"><span className="row"><Avatar u={b} size={32} /> <b>{b.name}</b></span><button onClick={() => c.run(async () => { await c.api(`/blocks/${b.id}`, { method: 'DELETE' }); await load() })}>Разблокировать</button></div>)}
        {!blocks.length && <span className="mut">Список пуст.</span>}</div>
      <h3><LifeBuoy size={18} /> Поддержка</h3>
      <div className="card"><div className="field"><label>Написать модераторам</label><textarea rows="3" maxLength={2000} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Опишите проблему или вопрос" /></div>
        <button className="pri" disabled={!txt.trim()} onClick={() => c.run(async () => { await c.api('/reports', { method: 'POST', body: { content_type: 'support', reason: txt } }); setTxt(''); await load() })}><Send size={14} /> Отправить</button>
        {reports.map(r => <div key={r.id} className="row between user-row"><span>№{r.id} · {r.content_type === 'support' ? 'обращение' : 'жалоба'} · {fmtDate(r.created_at)}</span><Pill tone={r.status === 'closed' ? 'ok' : 'warn'}>{r.status === 'closed' ? 'закрыто' : 'в работе'}</Pill></div>)}</div>
    </>
  )
}

/* ===================== Участники совместного плейлиста ===================== */
export function MembersPanel({ playlist, c, onClose }) {
  const [d, setD] = useState(null); const [friends, setFriends] = useState([]); const [pick, setPick] = useState(''); const [role, setRole] = useState('editor')
  const load = () => c.run(async () => { setD(await c.api(`/playlists/${playlist.id}/members`)); if (playlist.is_owner) setFriends((await c.api('/friends')).friends) })
  useEffect(() => { load() }, [])
  const act = (fn) => c.run(async () => { await fn(); await load() })
  if (!d) return null
  const ids = new Set(d.members.map(m => m.user.id))
  return (
    <Modal title="Участники плейлиста" onClose={onClose}>
      <p className="mut">Соавтор (editor) добавляет свои треки и меняет порядок; слушатель (viewer) только смотрит и слушает. Название, доступ и участников меняет владелец.</p>
      <div className="user-row row between"><span className="row"><Avatar u={d.owner} size={32} /><b>{d.owner.name}</b></span><Pill tone="accent">владелец</Pill></div>
      {d.members.map(m => (
        <div key={m.user.id} className="user-row row between"><span className="row"><Avatar u={m.user} size={32} /><b>{m.user.name}</b>{m.status === 'pending' && <Pill>ждёт ответа</Pill>}</span>
          <span className="row">{playlist.is_owner ? <>
            <select value={m.role} onChange={(e) => act(() => c.api(`/playlists/${playlist.id}/members/${m.user.id}`, { method: 'PATCH', body: { role: e.target.value } }))}><option value="editor">Соавтор</option><option value="viewer">Слушатель</option></select>
            <button className="icon-btn del" onClick={() => act(() => c.api(`/playlists/${playlist.id}/members/${m.user.id}`, { method: 'DELETE' }))}><X size={14} /></button></>
            : m.user.id === c.me.id ? <button onClick={() => act(async () => { await c.api(`/playlists/${playlist.id}/members/${m.user.id}`, { method: 'DELETE' }); onClose() })}>Выйти</button> : <Pill>{m.role === 'editor' ? 'соавтор' : 'слушатель'}</Pill>}</span></div>))}
      {playlist.is_owner && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">— пригласить друга —</option>{friends.filter(f => !ids.has(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <select value={role} onChange={(e) => setRole(e.target.value)}><option value="editor">Соавтор</option><option value="viewer">Слушатель</option></select>
          <button className="pri" disabled={!pick} onClick={() => act(async () => { await c.api(`/playlists/${playlist.id}/members`, { method: 'POST', body: { user_id: Number(pick), role } }); setPick('') })}>Пригласить</button>
        </div>)}
    </Modal>
  )
}
