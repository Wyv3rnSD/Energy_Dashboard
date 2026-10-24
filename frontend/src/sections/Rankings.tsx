import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useApi, type ContinentRow, type MoverRow, type ScatterRow, type TopRow } from '@/lib/api'
import { useAppData } from '@/lib/app-context'
import { CATEGORY_COLOR, INK } from '@/lib/colors'
import { useUrlNumber, useUrlParam } from '@/lib/url-state'
import { cn, fmtCompact, fmtNum, fmtPct, fmtTwh } from '@/lib/utils'
import { axisProps, gridProps, Legend, TooltipCard } from '@/components/charts/parts'
import { ChartState, Panel, PanelHeader, SectionHeading } from '@/components/ui/primitives'
import { Select } from '@/components/ui/select'

const METRICS = [
  { value: 'renewable_share_percent', label: 'Renewable share', unit: '%' },
  { value: 'fossil_share_percent', label: 'Fossil share', unit: '%' },
  { value: 'total_generation_twh', label: 'Total generation', unit: 'TWh' },
  { value: 'renewable_generation_twh', label: 'Renewable generation', unit: 'TWh' },
]
const fmtMetric = (unit: string, v: number | null | undefined) => (unit === '%' ? fmtPct(v) : fmtTwh(v))

function Leaderboard() {
  const { year, meta } = useAppData()
  const [metricParam, setMetric] = useUrlParam('rmetric')
  const [continent, setContinent] = useUrlParam('rcont')
  const metric = METRICS.find((m) => m.value === metricParam) ?? METRICS[0]
  const top = useApi<TopRow[]>('/rankings/top', { year, metric: metric.value, n: 10, continent: continent || undefined })
  const max = Math.max(...(top.data ?? []).map((r) => r.value), 1)

  return (
    <Panel className="lg:col-span-3">
      <PanelHeader
        title={`Top 10, ${year}`}
        subtitle="Ranked with RANK() in MySQL. Grids under 1 TWh are left out."
        actions={<>
          <Select label="Metric" value={metric.value} onChange={setMetric} options={METRICS} className="min-w-44" />
          <Select label="Continent" value={continent ?? 'all'} onChange={(v) => setContinent(v === 'all' ? null : v)}
                  options={[{ value: 'all', label: 'All continents' }, ...meta.continents.map((c) => ({ value: c, label: c }))]} className="min-w-40" />
        </>}
      />
      <div className="p-5 pt-4">
        <ChartState loading={top.loading} error={top.error} empty={!top.data?.length} height={420}>
          <ol className="space-y-1">
            {(top.data ?? []).map((r) => (
              <li key={r.area} className="group grid grid-cols-[2rem_minmax(0,9rem)_1fr_5.5rem] items-center gap-3 rounded-control px-2 py-2 hover:bg-panel-2">
                <span className="text-sm tabular-nums text-subtle">{r.overall_rank}</span>
                <span className="truncate text-sm text-fg" title={`${r.area} · ${r.continent}`}>{r.area}</span>
                <span className="h-2 overflow-hidden rounded-full bg-panel-2 group-hover:bg-border">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                </span>
                <span className="text-right text-sm font-medium tabular-nums text-fg">{fmtMetric(metric.unit, r.value)}</span>
              </li>
            ))}
          </ol>
        </ChartState>
      </div>
    </Panel>
  )
}

function Movers() {
  const { year } = useAppData()
  const [fromYear, setFromYear] = useUrlNumber('from', 2010)
  const movers = useApi<MoverRow[]>('/rankings/movers', { year_from: fromYear, year_to: year, n: 8 })
  const options = [2000, 2005, 2010, 2015, 2020].filter((y) => y < year).map((y) => ({ value: y, label: `Since ${y}` }))
  return (
    <Panel className="lg:col-span-2">
      <PanelHeader title="Biggest climbers" subtitle={`Places gained in the renewable-share ranking, ${fromYear}→${year}`}
        actions={<Select label="From year" value={fromYear} onChange={setFromYear} options={options} />} />
      <div className="p-5 pt-4">
        <ChartState loading={movers.loading} error={movers.error} empty={!movers.data?.length} height={420}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th className="pb-2 font-medium">Country</th>
                <th className="pb-2 text-right font-medium">Share</th>
                <th className="pb-2 text-right font-medium">Rank</th>
              </tr>
            </thead>
            <tbody>
              {(movers.data ?? []).map((m) => (
                <tr key={m.area} className="border-t border-border">
                  <td className="py-2.5 text-fg">{m.area}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted">{fmtPct(m.value_from, 0)} → <span className="text-fg">{fmtPct(m.value_to, 0)}</span></td>
                  <td className="py-2.5 text-right">
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                      m.places_gained > 0 ? 'bg-good/15 text-[#5fd35f]' : m.places_gained < 0 ? 'bg-critical/15 text-[#f08a8a]' : 'bg-panel-2 text-muted')}>
                      {m.places_gained > 0 ? <ArrowUpRight className="size-3" /> : m.places_gained < 0 ? <ArrowDownRight className="size-3" /> : <Minus className="size-3" />}
                      {Math.abs(m.places_gained)} · #{m.rank_to}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartState>
      </div>
    </Panel>
  )
}

function ContinentTotals() {
  const { year } = useAppData()
  const res = useApi<ContinentRow[]>('/continents/totals', { year })
  const { data, grand } = useMemo(() => {
    const byCont = new Map<string, Record<string, number | string>>()
    let grand = 0
    for (const r of res.data ?? []) {
      if (r.continent == null) { if (r.energy_category == null) grand = r.generation_twh; continue }
      const row = byCont.get(r.continent) ?? { continent: r.continent, total: 0 }
      if (r.energy_category == null) row.total = r.generation_twh
      else row[r.energy_category] = r.generation_twh
      byCont.set(r.continent, row)
    }
    return { data: [...byCont.values()].sort((a, b) => Number(b.total) - Number(a.total)), grand }
  }, [res.data])
  const cats = ['Nuclear', 'Fossil', 'Renewable'] as const

  return (
    <Panel className="lg:col-span-2">
      <PanelHeader title={`Generation by continent, ${year}`}
        subtitle={<>Subtotals from GROUP BY … WITH ROLLUP · world total <span className="text-fg">{fmtTwh(grand)}</span></>} />
      <div className="p-5 pt-4">
        <ChartState loading={res.loading} error={res.error} empty={!data.length} height={300}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap={10}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtCompact(v)} />
              <YAxis type="category" dataKey="continent" {...axisProps} width={96} tick={{ fill: INK.muted, fontSize: 12 }} />
              <Tooltip cursor={{ fill: 'rgb(124 92 255 / 0.08)' }} content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0].payload as Record<string, number>
                return <TooltipCard title={label} footer={`Total ${fmtTwh(row.total)}`}
                  items={[...cats].reverse().map((c) => ({ name: c, color: CATEGORY_COLOR[c], value: `${fmtTwh(row[c])} · ${fmtPct((row[c] / row.total) * 100, 0)}` }))} />
              }} />
              {cats.map((c, i) => (
                <Bar key={c} dataKey={c} stackId="t" fill={CATEGORY_COLOR[c]} stroke={INK.panel} strokeWidth={2}
                     radius={i === cats.length - 1 ? [0, 4, 4, 0] : 0} maxBarSize={22} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <Legend className="mt-3" items={cats.map((c) => ({ name: c, color: CATEGORY_COLOR[c] }))} />
        </ChartState>
      </div>
    </Panel>
  )
}

function EmissionsScatter() {
  const { year } = useAppData()
  const res = useApi<ScatterRow[]>('/scatter/emissions', { year, min_total_twh: 1 })
  return (
    <Panel className="lg:col-span-3">
      <PanelHeader title="Cleaner grids, lower emissions"
        subtitle={`Renewable share vs carbon intensity (gCO₂ per kWh), ${year}. Bubble size is total generation.`} />
      <div className="p-5 pt-4">
        <ChartState loading={res.loading} error={res.error} empty={!res.data?.length} height={300}>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid {...gridProps} vertical />
              <XAxis type="number" dataKey="renewable_share_percent" {...axisProps} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                     tickFormatter={(v) => `${v}%`}
                     label={{ value: 'Renewable share →', position: 'insideBottom', offset: -10, fill: INK.subtle, fontSize: 12 }} />
              <YAxis type="number" dataKey="emissions_intensity_gco2e_kwh" {...axisProps} width={48} />
              <ZAxis type="number" dataKey="total_generation_twh" range={[30, 900]} />
              <Tooltip cursor={false} content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as ScatterRow
                return <TooltipCard title={r.area} items={[
                  { name: 'Renewable share', color: INK.primary, value: fmtPct(r.renewable_share_percent) },
                  { name: 'Carbon intensity', color: INK.primary, value: `${fmtNum(r.emissions_intensity_gco2e_kwh, 0)} g/kWh` },
                  { name: 'Generation', color: INK.primary, value: fmtTwh(r.total_generation_twh) },
                ]} footer={r.continent ?? undefined} />
              }} />
              <Scatter data={res.data ?? []} fill={INK.primary} fillOpacity={0.55} stroke={INK.panel} strokeWidth={1.5} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartState>
      </div>
    </Panel>
  )
}

export function Rankings() {
  return (
    <section id="rankings" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow="Rankings" title="Who leads the transition"
        description="Leaderboards for the selected year, the countries climbing fastest, and how emissions fall as renewables rise." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Leaderboard />
        <Movers />
        <ContinentTotals />
        <EmissionsScatter />
      </div>
    </section>
  )
}
