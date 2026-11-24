import React, { useState } from 'react'
import { fmtDay } from './ui.jsx'

/** Линейный график на SVG: несколько рядов, подсказка по наведению. Цвета — из токенов темы. */
export default function LineChart({ series, keys, height = 220 }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = height, P = { l: 36, r: 12, t: 12, b: 24 }
  if (!series.length) return null
  const max = Math.max(1, ...series.flatMap(s => keys.map(k => s[k.key] || 0)))
  const nice = Math.max(1, Math.ceil(max / 4) * 4)
  const x = (i) => P.l + (series.length === 1 ? 0 : i * (W - P.l - P.r) / (series.length - 1))
  const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b)
  const path = (k) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[k] || 0).toFixed(1)}`).join(' ')
  const step = Math.max(1, Math.ceil(series.length / 7))
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; setHover(Math.max(0, Math.min(series.length - 1, Math.round((px - P.l) / ((W - P.l - P.r) / Math.max(series.length - 1, 1)))))) }}>
        {[0, 1, 2, 3, 4].map(i => { const v = nice / 4 * i; return <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="chart-grid" /><text x={P.l - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">{Math.round(v)}</text></g> })}
        {series.map((s, i) => i % step === 0 && <text key={i} x={x(i)} y={H - 6} className="chart-tick" textAnchor="middle">{fmtDay(s.date)}</text>)}
        {keys.map(k => <path key={k.key} d={path(k.key)} className="chart-line" style={{ stroke: k.color }} />)}
        {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="chart-cursor" />
          {keys.map(k => <circle key={k.key} cx={x(hover)} cy={y(series[hover][k.key] || 0)} r="4" style={{ fill: k.color }} />)}</g>}
      </svg>
      <div className="chart-legend">{keys.map(k => <span key={k.key}><i style={{ background: k.color }} />{k.label}</span>)}</div>
      {hover !== null && <div className="chart-tip"><b>{fmtDay(series[hover].date)}</b>{keys.map(k => <span key={k.key}><i style={{ background: k.color }} />{k.label}: {series[hover][k.key]}</span>)}</div>}
    </div>
  )
}
