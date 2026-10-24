import { useMemo } from 'react'
import { ArrowRight, Gauge, Leaf, Sun, Zap } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type MixHistoryRow, type MixRow, type SeriesRow } from '@/lib/api'
import { useAppData } from '@/lib/app-context'
import { INK, SLOTS, SOURCE_COLOR, sourceKey, SOURCES } from '@/lib/colors'
import { cn, fmtDelta, fmtNum, fmtPct, fmtTwh } from '@/lib/utils'
import { axisProps, crosshair, gridProps, Legend, TooltipCard } from '@/components/charts/parts'
import { MixAreaChart, MixDonut } from '@/components/charts/energy'
import { Badge, ChartState, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives'

/** One World metric over time, keyed by year. */
function useWorldSeries(source: string, metric: string) {
  const { worldId } = useAppData()
  const res = useApi<SeriesRow[]>('/timeseries/source', { country_ids: [worldId], source, metric })
  const byYear = useMemo(() => new Map((res.data ?? []).map((r) => [r.year, r[metric] as number | null])), [res.data, metric])
  return { ...res, byYear }
}

function StatTile({ icon, label, value, delta, deltaGood, note, spark, loading }: {
  icon: React.ReactNode; label: string; value: string; delta?: string; deltaGood?: boolean
  note: string; spark: { year: number; v: number | null }[]; loading: boolean
}) {
  return (
    <Panel className="overflow-hidden p-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="grid size-7 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</span>
        {label}
      </div>
      {loading ? <Skeleton className="mt-4 h-9 w-32" /> : (
        <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta && (
          <span className={cn('rounded-full px-2 py-0.5 font-medium', deltaGood ? 'bg-good/15 text-[#5fd35f]' : 'bg-critical/15 text-[#f08a8a]')}>
            {delta}
          </span>
        )}
        <span className="text-subtle">{note}</span>
      </div>
      <div className="pointer-events-none -mx-5 -mb-5 mt-3 h-12 opacity-70" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spark} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Line dataKey="v" stroke={INK.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

function spark(byYear: Map<number, number | null>, year: number) {
  const out = []
  for (let y = year - 14; y <= year; y++) out.push({ year: y, v: byYear.get(y) ?? null })
  return out
}

export function Overview() {
  const { year, worldId, countries, meta } = useAppData()
  const gen = useWorldSeries('Total generation', 'generation_twh')
  const ren = useWorldSeries('Renewables', 'generation_share_percent')
  const ws = useWorldSeries('Wind and solar', 'generation_share_percent')
  const ci = useWorldSeries('Total generation', 'emissions_intensity_gco2e_kwh')
  const fos = useWorldSeries('Fossil', 'generation_share_percent')
  const history = useApi<MixHistoryRow[]>(`/countries/${worldId}/mix-history`)
  const mix = useApi<MixRow[]>(`/countries/${worldId}/mix`, { year })
  const mixPrev = useApi<MixRow[]>(`/countries/${worldId}/mix`, { year: year - 1 })

  const pctChange = (m: Map<number, number | null>) => {
    const a = m.get(year), b = m.get(year - 1)
    return a != null && b ? ((a - b) / b) * 100 : null
  }
  const ptsChange = (m: Map<number, number | null>) => {
    const a = m.get(year), b = m.get(year - 1)
    return a != null && b != null ? a - b : null
  }
  const loadingTiles = gen.loading && !gen.data

  const shareLines = useMemo(() => {
    const years = [...ren.byYear.keys()].filter((y) => y >= 2000).sort((a, b) => a - b)
    return years.map((y) => ({ year: y, Renewables: ren.byYear.get(y), Fossil: fos.byYear.get(y) }))
  }, [ren.byYear, fos.byYear])

  const sourceTiles = useMemo(() => {
    const share = (rows?: MixRow[]) => {
      const acc = new Map<string, number>()
      for (const r of rows ?? []) {
        const k = sourceKey(r.electricity_source)
        if (k) acc.set(k, (acc.get(k) ?? 0) + r.share_percent)
      }
      return acc
    }
    const now = share(mix.data), before = share(mixPrev.data)
    return SOURCES.filter((s) => now.has(s)).map((s) => ({ s, share: now.get(s)!, delta: before.has(s) ? now.get(s)! - before.get(s)! : null }))
      .sort((a, b) => b.share - a.share)
  }, [mix.data, mixPrev.data])

  return (
    <section id="overview" className="relative">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-[-18rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[140px]" />
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-24">
          <Badge className="mb-6 gap-2 border-primary/40 bg-primary-soft text-fg">
            <span className="size-1.5 rounded-full bg-primary" />
            Ember global electricity data · {meta.year_min}–{meta.year_max} · {countries.length} countries
          </Badge>
          <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-fg sm:text-6xl">
            How the world makes its{' '}
            <span className="bg-gradient-to-r from-[#b9a8ff] via-primary to-[#d55181] bg-clip-text text-transparent">electricity</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
            Explore generation, renewables and emissions for every country, compare them side by side,
            and see where each is heading by 2030.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#countries" className="inline-flex h-11 items-center gap-2 rounded-control bg-primary px-5 text-sm font-medium text-primary-fg hover:bg-primary-hover">
              Explore countries <ArrowRight className="size-4" />
            </a>
            <a href="#forecasts" className="inline-flex h-11 items-center rounded-control border border-border bg-panel-2 px-5 text-sm font-medium text-fg hover:border-border-strong">
              See forecasts
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
        {/* Global snapshot */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Zap className="size-4" />} label="World generation" loading={loadingTiles}
            value={fmtTwh(gen.byYear.get(year))} delta={fmtDelta(pctChange(gen.byYear))} deltaGood={(pctChange(gen.byYear) ?? 0) >= 0}
            note={`vs ${year - 1}`} spark={spark(gen.byYear, year)} />
          <StatTile icon={<Leaf className="size-4" />} label="Renewable share" loading={loadingTiles}
            value={fmtPct(ren.byYear.get(year))} delta={fmtDelta(ptsChange(ren.byYear), ' pts')} deltaGood={(ptsChange(ren.byYear) ?? 0) >= 0}
            note={`vs ${year - 1}`} spark={spark(ren.byYear, year)} />
          <StatTile icon={<Sun className="size-4" />} label="Wind + solar share" loading={loadingTiles}
            value={fmtPct(ws.byYear.get(year))} delta={fmtDelta(ptsChange(ws.byYear), ' pts')} deltaGood={(ptsChange(ws.byYear) ?? 0) >= 0}
            note={`vs ${year - 1}`} spark={spark(ws.byYear, year)} />
          <StatTile icon={<Gauge className="size-4" />} label="Carbon intensity" loading={loadingTiles}
            value={`${fmtNum(ci.byYear.get(year), 0)} g/kWh`} delta={fmtDelta(pctChange(ci.byYear))} deltaGood={(pctChange(ci.byYear) ?? 0) <= 0}
            note={`CO₂ per kWh vs ${year - 1}`} spark={spark(ci.byYear, year)} />
        </div>

        {/* World trends */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Panel className="lg:col-span-3">
            <PanelHeader title="World generation by source" subtitle="TWh per year since 2000. Hover for each year's breakdown." />
            <div className="p-5 pt-4">
              <ChartState loading={history.loading} error={history.error} empty={!history.data?.length} height={320}>
                <MixAreaChart rows={history.data ?? []} />
              </ChartState>
            </div>
          </Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader title="Renewables vs fossil" subtitle="Share of world electricity (%)" />
            <div className="p-5 pt-4">
              <ChartState loading={ren.loading} error={ren.error} empty={!shareLines.length} height={320}>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={shareLines} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="year" {...axisProps} minTickGap={24} />
                    <YAxis {...axisProps} width={40} unit="%" domain={[0, 100]} />
                    <Tooltip cursor={crosshair} content={({ active, payload, label }) => active && payload?.length ? (
                      <TooltipCard title={label} items={[
                        { name: 'Fossil', color: SLOTS[1], value: fmtPct(payload[0].payload.Fossil) },
                        { name: 'Renewables', color: SLOTS[2], value: fmtPct(payload[0].payload.Renewables) },
                      ]} />
                    ) : null} />
                    <Line dataKey="Fossil" stroke={SLOTS[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="Renewables" stroke={SLOTS[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <Legend className="mt-3" items={[{ name: 'Fossil', color: SLOTS[1] }, { name: 'Renewables', color: SLOTS[2] }]} />
              </ChartState>
            </div>
          </Panel>
        </div>

        {/* Energy mix */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Panel className="lg:col-span-2">
            <PanelHeader title={`World energy mix, ${year}`} subtitle="Share of generation by source" />
            <div className="p-5">
              <ChartState loading={mix.loading} error={mix.error} empty={!mix.data?.length} height={240}>
                <MixDonut rows={mix.data ?? []} />
              </ChartState>
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-3">
            {sourceTiles.map(({ s, share, delta }) => (
              <Panel key={s} className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="size-2.5 rounded-sm" style={{ background: SOURCE_COLOR[s] }} />
                  {s}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-fg">{fmtPct(share)}</div>
                <div className="mt-1 text-xs text-subtle">{delta == null ? '–' : `${fmtDelta(delta, ' pts')} vs ${year - 1}`}</div>
              </Panel>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
