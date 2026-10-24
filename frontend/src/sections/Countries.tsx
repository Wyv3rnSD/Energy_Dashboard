import { useMemo, useRef } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type GrowthRow, type MixHistoryRow, type MixRow, type Profile, type SeriesRow } from '@/lib/api'
import { useAppData, useDefaultCountryId } from '@/lib/app-context'
import { INK, SLOTS, SOURCE_COLOR, SOURCES, type SourceKey } from '@/lib/colors'
import { useUrlNumber, useUrlNumberList, useUrlParam } from '@/lib/url-state'
import { fmtNum, fmtPct, fmtTwh } from '@/lib/utils'
import { axisProps, crosshair, gridProps, TooltipCard } from '@/components/charts/parts'
import { MixAreaChart, MixDonut } from '@/components/charts/energy'
import { Badge, ChartState, Panel, PanelHeader, SectionHeading, Skeleton } from '@/components/ui/primitives'
import { CountryPicker, MultiCountryPicker, Select } from '@/components/ui/select'

const COMPARE_METRICS = [
  { value: 'renewable_share_percent', label: 'Renewable share (%)', unit: '%' },
  { value: 'fossil_share_percent', label: 'Fossil share (%)', unit: '%' },
  { value: 'total_generation_twh', label: 'Total generation (TWh)', unit: 'TWh' },
  { value: 'renewable_generation_twh', label: 'Renewable generation (TWh)', unit: 'TWh' },
  { value: 'fossil_generation_twh', label: 'Fossil generation (TWh)', unit: 'TWh' },
]

const GROWTH_SOURCES = (SOURCES.filter((s) => s !== 'Other') as SourceKey[]).map((s) => ({ value: s, label: s }))

function ProfileCard({ countryId }: { countryId: number }) {
  const { year } = useAppData()
  const profile = useApi<Profile>(`/countries/${countryId}/profile`)
  const p = profile.data
  // The selected year if this country reported it, else its latest year.
  const latest = p?.series.find((s) => s.year === year) ?? p?.series.at(-1)
  const first = p?.series.find((s) => s.year === 2000) ?? p?.series[0]
  return (
    <Panel className="p-5">
      {!p ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle">{p.iso_code} · {p.continent}</div>
            <div className="mt-1 text-2xl font-semibold text-fg">{p.area}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.ember_region && <Badge>{p.ember_region}</Badge>}
              {p.memberships.map((m) => <Badge key={m} className="border-primary/40 text-fg">{m}</Badge>)}
            </div>
          </div>
          {latest && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-control border border-border bg-panel-2 p-3">
                <dt className="text-subtle">Generation {latest.year}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{fmtTwh(latest.total_generation_twh)}</dd>
              </div>
              <div className="rounded-control border border-border bg-panel-2 p-3">
                <dt className="text-subtle">Renewable share</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{fmtPct(latest.renewable_share_percent)}</dd>
              </div>
              <div className="rounded-control border border-border bg-panel-2 p-3">
                <dt className="text-subtle">Fossil share</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{fmtPct(latest.fossil_share_percent)}</dd>
              </div>
              <div className="rounded-control border border-border bg-panel-2 p-3">
                <dt className="text-subtle">Renewables since {first?.year}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
                  {first?.renewable_generation_twh ? `${fmtNum((latest.renewable_generation_twh ?? 0) / first.renewable_generation_twh, 1)}×` : '–'}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-xs text-subtle">Profile served from MongoDB <code className="text-muted">country_profiles</code>.</p>
        </div>
      )}
    </Panel>
  )
}

function GrowthChart({ countryId }: { countryId: number }) {
  const [source, setSource] = useUrlParam('src')
  const src = (source ?? 'Solar') as SourceKey
  const growth = useApi<GrowthRow[]>(`/countries/${countryId}/growth`, { source: src })
  const data = (growth.data ?? []).filter((r) => r.year >= 2000)
  return (
    <Panel>
      <PanelHeader
        title={`${src} growth`}
        subtitle="Yearly change in TWh (bars), computed in MySQL with LAG()"
        actions={<Select label="Source" value={src} onChange={(v) => setSource(v)} options={GROWTH_SOURCES} />}
      />
      <div className="p-5 pt-4">
        <ChartState loading={growth.loading} error={growth.error} empty={!data.length} height={260}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} minTickGap={20} />
              <YAxis {...axisProps} width={48} />
              <Tooltip cursor={{ fill: 'rgb(124 92 255 / 0.08)' }} content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as GrowthRow
                return <TooltipCard title={label} items={[
                  { name: 'Generation', color: SOURCE_COLOR[src], value: fmtTwh(r.generation_twh) },
                  { name: 'Change', color: SOURCE_COLOR[src], value: r.yoy_twh == null ? '–' : `${r.yoy_twh > 0 ? '+' : ''}${fmtNum(r.yoy_twh)} TWh` },
                  { name: 'Change %', color: SOURCE_COLOR[src], value: fmtPct(r.yoy_percent) },
                ]} />
              }} />
              <Bar dataKey="yoy_twh" fill={SOURCE_COLOR[src]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartState>
      </div>
    </Panel>
  )
}

function Compare() {
  const { countries, byId } = useAppData()
  const fallback = useMemo(() => ['Germany', 'India', 'United Kingdom', 'Brazil']
    .map((n) => countries.find((c) => c.area === n)?.country_id).filter((x): x is number => x != null), [countries])
  const [ids, setIds] = useUrlNumberList('compare', fallback)
  const [metricParam, setMetric] = useUrlParam('cmetric')
  const metric = COMPARE_METRICS.find((m) => m.value === metricParam) ?? COMPARE_METRICS[0]

  // Each country keeps the colour slot it was given, even when others are removed:
  // a newcomer takes the lowest free slot.
  const slots = useRef(new Map<number, number>())
  for (const id of [...slots.current.keys()]) if (!ids.includes(id)) slots.current.delete(id)
  for (const id of ids) {
    if (slots.current.has(id)) continue
    const used = new Set(slots.current.values())
    let free = 0
    while (used.has(free)) free++
    slots.current.set(id, free)
  }
  const colorOf = (id: number) => SLOTS[(slots.current.get(id) ?? 0) % 5]
  const series = useApi<SeriesRow[]>(ids.length ? '/timeseries/summary' : null, { country_ids: ids, metric: metric.value })
  const data = useMemo(() => {
    const byYear = new Map<number, Record<string, number | null>>()
    for (const r of series.data ?? []) {
      if (r.year < 2000) continue
      const row = byYear.get(r.year) ?? { year: r.year }
      row[r.area] = r[metric.value] as number | null
      byYear.set(r.year, row)
    }
    return [...byYear.values()].sort((a, b) => (a.year as number) - (b.year as number))
  }, [series.data, metric.value])
  const fmt = (v: number | null | undefined) => metric.unit === '%' ? fmtPct(v) : fmtTwh(v)

  return (
    <Panel>
      <PanelHeader
        title="Compare countries"
        subtitle="Pick up to five countries and a metric"
        actions={<Select label="Metric" value={metric.value} onChange={setMetric} options={COMPARE_METRICS} className="min-w-56" />}
      />
      <div className="px-5 pt-4">
        <MultiCountryPicker value={ids} onChange={setIds} countries={countries} colorOf={colorOf} />
      </div>
      <div className="p-5 pt-4">
        <ChartState loading={series.loading} error={series.error} empty={!data.length} height={340}>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={52} tickFormatter={(v) => metric.unit === '%' ? `${v}%` : fmtNum(v, 0)} />
              <Tooltip cursor={crosshair} content={({ active, payload, label }) => active && payload?.length ? (
                <TooltipCard title={label} items={[...payload]
                  .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
                  .map((p) => ({ name: String(p.dataKey), color: String(p.color), value: fmt(p.value as number) }))} />
              ) : null} />
              {ids.map((id) => byId.get(id) && (
                <Line key={id} dataKey={byId.get(id)!.area} stroke={colorOf(id)} strokeWidth={2} dot={false}
                      activeDot={{ r: 4, stroke: INK.panel, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartState>
      </div>
    </Panel>
  )
}

export function Countries() {
  const { countries, year } = useAppData()
  const defaultId = useDefaultCountryId()
  const [countryId, setCountryId] = useUrlNumber('country', defaultId)
  const name = countries.find((c) => c.country_id === countryId)?.area ?? ''
  const history = useApi<MixHistoryRow[]>(`/countries/${countryId}/mix-history`)
  const mix = useApi<MixRow[]>(`/countries/${countryId}/mix`, { year })

  return (
    <section id="countries" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading eyebrow="Countries" title="Explore any country"
          description="Search a country to see what powers it, how fast each source is growing, and how it compares with others." />
        <div className="mb-8"><CountryPicker value={countryId} onChange={setCountryId} countries={countries} className="h-11 min-w-64" /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ProfileCard countryId={countryId} />
        <Panel className="lg:col-span-2">
          <PanelHeader title={`${name}: generation by source`} subtitle="TWh per year since 2000" />
          <div className="p-5 pt-4">
            <ChartState loading={history.loading} error={history.error} empty={!history.data?.length} height={300}>
              <MixAreaChart rows={history.data ?? []} height={300} />
            </ChartState>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={`${name} mix, ${year}`} subtitle="From the get_country_mix stored procedure" />
          <div className="p-5">
            <ChartState loading={mix.loading} error={mix.error} empty={!mix.data?.length} height={220}>
              <MixDonut rows={mix.data ?? []} height={200} />
            </ChartState>
          </div>
        </Panel>
        <div className="lg:col-span-2"><GrowthChart countryId={countryId} /></div>
      </div>

      <div className="mt-6"><Compare /></div>
    </section>
  )
}
