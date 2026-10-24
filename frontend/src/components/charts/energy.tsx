/** Generation-mix charts shared by the World and Country sections. */
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MixHistoryRow, MixRow } from '@/lib/api'
import { INK, SOURCE_COLOR, SOURCES, sourceKey, type SourceKey } from '@/lib/colors'
import { fmtCompact, fmtPct, fmtTwh } from '@/lib/utils'
import { axisProps, crosshair, gridProps, Legend, TooltipCard } from './parts'

type Pivot = { year: number; total: number } & Partial<Record<SourceKey, number>>

function pivot(rows: MixHistoryRow[]): Pivot[] {
  const byYear = new Map<number, Pivot>()
  for (const r of rows) {
    const key = sourceKey(r.electricity_source)
    if (!key) continue
    const p = byYear.get(r.year) ?? { year: r.year, total: 0 }
    p[key] = (p[key] ?? 0) + Math.max(r.generation_twh, 0)
    p.total += Math.max(r.generation_twh, 0)
    byYear.set(r.year, p)
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/** Stacked area of generation by source over time. */
export function MixAreaChart({ rows, height = 320, fromYear = 2000 }: { rows: MixHistoryRow[]; height?: number; fromYear?: number }) {
  const data = useMemo(() => pivot(rows).filter((p) => p.year >= fromYear), [rows, fromYear])
  const present = SOURCES.filter((s) => data.some((d) => (d[s] ?? 0) > 0))
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="year" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={48} tickFormatter={(v) => fmtCompact(v)} />
          <Tooltip
            cursor={crosshair}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as Pivot
              const items = [...present].reverse()
                .filter((s) => (p[s] ?? 0) > 0)
                .map((s) => ({ name: s, color: SOURCE_COLOR[s], value: `${fmtTwh(p[s])} · ${fmtPct(((p[s] ?? 0) / p.total) * 100, 0)}` }))
              return <TooltipCard title={label} items={items} footer={`Total ${fmtTwh(p.total)}`} />
            }}
          />
          {present.map((s) => (
            <Area
              key={s} dataKey={s} stackId="mix" type="monotone"
              stroke={INK.panel} strokeWidth={1}
              fill={SOURCE_COLOR[s]} fillOpacity={0.9}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <Legend className="mt-3 px-1" items={[...present].reverse().map((s) => ({ name: s, color: SOURCE_COLOR[s] }))} />
    </div>
  )
}

/** Donut of one year's mix, with a ranked legend beside it. */
export function MixDonut({ rows, height = 240, centerLabel }: { rows: MixRow[]; height?: number; centerLabel?: string }) {
  const slices = useMemo(() => {
    const acc = new Map<SourceKey, number>()
    for (const r of rows) {
      const key = sourceKey(r.electricity_source)
      if (key && r.generation_twh > 0) acc.set(key, (acc.get(key) ?? 0) + r.generation_twh)
    }
    const total = [...acc.values()].reduce((a, b) => a + b, 0)
    // Slices keep the stacking order so colours sit in their validated sequence.
    return { total, items: SOURCES.filter((s) => acc.has(s)).map((s) => ({ name: s, value: acc.get(s)!, share: (acc.get(s)! / total) * 100 })) }
  }, [rows])

  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as { name: SourceKey; value: number; share: number }
                return <TooltipCard title={d.name} items={[{ name: 'Generation', color: SOURCE_COLOR[d.name], value: fmtTwh(d.value) }, { name: 'Share', color: SOURCE_COLOR[d.name], value: fmtPct(d.share) }]} />
              }}
            />
            <Pie
              data={slices.items} dataKey="value" nameKey="name"
              innerRadius="62%" outerRadius="92%" stroke={INK.panel} strokeWidth={2}
              startAngle={90} endAngle={-270} isAnimationActive={false}
            >
              {slices.items.map((s) => <Cell key={s.name} fill={SOURCE_COLOR[s.name]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-semibold tabular-nums text-fg">{fmtCompact(slices.total)}</span>
          <span className="text-xs text-subtle">{centerLabel ?? 'TWh total'}</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {[...slices.items].sort((a, b) => b.value - a.value).map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <span className="size-2.5 rounded-sm" style={{ background: SOURCE_COLOR[s.name] }} />
              {s.name}
            </span>
            <span className="tabular-nums text-fg">{fmtPct(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
