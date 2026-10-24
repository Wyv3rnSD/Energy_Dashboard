import { useMemo } from 'react'
import { Trophy } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type ForecastRun, type ModelSummary, type SeriesRow } from '@/lib/api'
import { useAppData, useDefaultCountryId } from '@/lib/app-context'
import { INK, MODEL_COLOR, MODEL_LABEL } from '@/lib/colors'
import { useUrlNumber, useUrlParam } from '@/lib/url-state'
import { fmtNum, fmtPct, fmtTwh } from '@/lib/utils'
import { axisProps, crosshair, gridProps, Legend, TooltipCard } from '@/components/charts/parts'
import { Badge, ChartState, Panel, PanelHeader, SectionHeading } from '@/components/ui/primitives'
import { CountryPicker, Select } from '@/components/ui/select'

const TARGETS = [
  { value: 'renewable_generation_twh', label: 'Renewable generation' },
  { value: 'total_generation_twh', label: 'Total generation' },
  { value: 'fossil_generation_twh', label: 'Fossil generation' },
]
const MODELS = ['ridge_lags', 'linear_trend', 'naive']

export function Forecasts() {
  const { countries } = useAppData()
  const defaultId = useDefaultCountryId('India')
  const [countryId, setCountryId] = useUrlNumber('fcountry', defaultId)
  const [targetParam, setTarget] = useUrlParam('ftarget')
  const target = TARGETS.find((t) => t.value === targetParam)?.value ?? TARGETS[0].value
  const name = countries.find((c) => c.country_id === countryId)?.area ?? ''

  const runs = useApi<ForecastRun[]>(`/forecasts/${countryId}`, { target })
  const actual = useApi<SeriesRow[]>('/timeseries/summary', { country_ids: [countryId], metric: target })
  const summary = useApi<ModelSummary[]>('/forecasts/summary', { target })

  const { data, lastActual, testStart } = useMemo(() => {
    const rows = new Map<number, Record<string, number | null>>()
    const row = (y: number) => rows.get(y) ?? rows.set(y, { year: y }).get(y)!
    let lastActual = 0
    for (const r of actual.data ?? []) {
      if (r.year < 2000) continue
      row(r.year).actual = r[target] as number
      lastActual = Math.max(lastActual, r.year)
    }
    let testStart = 2020
    for (const run of runs.data ?? []) {
      testStart = Number(run.params.test_start ?? testStart)
      // Backtest points go in `model`, forecast points in `model_fc`, so the two
      // segments draw as separate lines instead of jumping at the boundary.
      for (const p of run.predictions) row(p.year)[p.kind === 'forecast' ? `${run.model}_fc` : run.model] = p.value
    }
    // Each forecast line starts from the last actual value it was refit on.
    const last = rows.get(lastActual)
    if (last) for (const m of MODELS) last[`${m}_fc`] = last.actual ?? null
    return { data: [...rows.values()].sort((a, b) => (a.year as number) - (b.year as number)), lastActual, testStart }
  }, [actual.data, runs.data, target])

  const ranked = [...(runs.data ?? [])].sort((a, b) => a.metrics.mae - b.metrics.mae)
  const best = ranked[0]?.model
  const hasRuns = !!runs.data?.length
  const yearMax = hasRuns ? (data.at(-1)?.year as number) : 2030
  const cmd = `python forecasting.py --target ${target}`

  return (
    <section id="forecasts" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading eyebrow="Forecasts" title={`Where it's heading by ${yearMax}`}
          description={`Three models are trained on data before ${testStart}, tested on ${testStart}–${lastActual || 'latest'}, then refit to forecast ahead. Lower error means a better fit.`} />
        <div className="mb-8 flex flex-wrap gap-2">
          <CountryPicker value={countryId} onChange={setCountryId} countries={countries} className="h-11 min-w-56" />
          <Select label="Target" value={target} onChange={setTarget} options={TARGETS} className="h-11 min-w-52" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title={`${name}: ${TARGETS.find((t) => t.value === target)?.label.toLowerCase()}`}
            subtitle="Actual values (solid) and each model's backtest and forecast (dashed), TWh" />
          <div className="p-5 pt-4">
            <ChartState loading={runs.loading} error={runs.error} empty={!data.length} height={360}>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <ReferenceArea x1={testStart} x2={lastActual} fill={INK.primary} fillOpacity={0.06}
                    label={{ value: 'Backtest', position: 'insideTop', fill: INK.subtle, fontSize: 11 }} />
                  <ReferenceLine x={lastActual} stroke={INK.subtle} strokeDasharray="3 3"
                    label={{ value: 'Forecast →', position: 'insideTopRight', fill: INK.subtle, fontSize: 11, dx: 64 }} />
                  <XAxis dataKey="year" {...axisProps} minTickGap={24} />
                  <YAxis {...axisProps} width={52} tickFormatter={(v) => fmtNum(v, 0)} />
                  <Tooltip cursor={crosshair} content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const r = payload[0].payload as Record<string, number | null>
                    const items = [
                      ...(r.actual != null ? [{ name: 'Actual', color: INK.fg, value: fmtTwh(r.actual) }] : []),
                      ...MODELS.map((m) => ({ m, v: Number(label) > lastActual ? r[`${m}_fc`] : r[m] }))
                        .filter(({ v }) => v != null)
                        .map(({ m, v }) => ({ name: MODEL_LABEL[m], color: MODEL_COLOR[m], value: fmtTwh(v) })),
                    ]
                    return <TooltipCard title={label} items={items}
                      footer={Number(label) > lastActual ? 'Forecast' : Number(label) >= testStart ? 'Backtest (model did not see these years)' : undefined} />
                  }} />
                  {MODELS.flatMap((m) => [
                    <Line key={m} dataKey={m} stroke={MODEL_COLOR[m]} strokeWidth={1.5} strokeDasharray="3 3"
                          dot={false} isAnimationActive={false} />,
                    <Line key={`${m}_fc`} dataKey={`${m}_fc`} stroke={MODEL_COLOR[m]} strokeWidth={2} strokeDasharray="6 4"
                          dot={false} isAnimationActive={false} />,
                  ])}
                  <Line dataKey="actual" stroke={INK.fg} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <Legend className="mt-3" items={[
                { name: 'Actual', color: INK.fg },
                ...MODELS.map((m) => ({ name: MODEL_LABEL[m], color: MODEL_COLOR[m], dashed: true })),
              ]} />
            </ChartState>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Model accuracy" subtitle={`${name}, ${testStart}–${lastActual} backtest`} />
            <div className="p-5 pt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-subtle">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 text-right font-medium">MAE</th>
                    <th className="pb-2 text-right font-medium">MAPE</th>
                  </tr>
                </thead>
                <tbody>
                  {!hasRuns && !runs.loading && (
                    <tr className="border-t border-border"><td colSpan={3} className="py-3 text-subtle">No backtest for this target yet.</td></tr>
                  )}
                  {ranked.map((r) => (
                    <tr key={r.model} className="border-t border-border">
                      <td className="py-2.5">
                        <span className="flex items-center gap-2 text-fg">
                          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: MODEL_COLOR[r.model] }} />
                          {MODEL_LABEL[r.model]}
                          {r.model === best && <Badge className="gap-1 border-primary/40 py-0 text-[11px] text-fg"><Trophy className="size-3 text-primary" />Best</Badge>}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-fg">{fmtTwh(r.metrics.mae)}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted">{fmtPct(r.metrics.mape)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-subtle">MAE: average error in TWh. MAPE: average error as a % of the actual value.</p>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Across all countries" subtitle="Median backtest error (MongoDB aggregation)" />
            <div className="space-y-3 p-5 pt-4">
              {(summary.data ?? []).map((s) => (
                <div key={s._id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted">
                    <span className="size-2.5 rounded-sm" style={{ background: MODEL_COLOR[s._id] }} />
                    {MODEL_LABEL[s._id] ?? s._id}
                  </span>
                  <span className="tabular-nums text-fg">{fmtTwh(s.median_mae)} <span className="text-subtle">· {fmtPct(s.median_mape)}</span></span>
                </div>
              ))}
              {summary.data && !summary.data.length && (
                <p className="text-sm text-subtle">Nothing saved for this target yet. Run <code className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-fg">{cmd}</code></p>
              )}
              {!!summary.data?.length && <p className="text-xs text-subtle">{summary.data[0]?.countries} countries each. The median is used because a few tiny grids have huge percentage errors.</p>}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  )
}
