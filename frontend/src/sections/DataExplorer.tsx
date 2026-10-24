import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import { getJson, useApi, type DataPage } from '@/lib/api'
import { useAppData } from '@/lib/app-context'
import { SOURCE_COLOR, sourceKey } from '@/lib/colors'
import { cn, fmtNum } from '@/lib/utils'
import { Button, ChartState, Panel, PanelHeader, SectionHeading } from '@/components/ui/primitives'
import { MultiCountryPicker, Select } from '@/components/ui/select'

const SOURCE_NAMES = ['Solar', 'Wind', 'Hydro', 'Bioenergy', 'Other renewables', 'Nuclear', 'Gas', 'Coal', 'Other fossil', 'Net imports']
const PAGE = 20
const COLUMNS = [
  { key: 'area', label: 'Country' },
  { key: 'electricity_source', label: 'Source' },
  { key: 'year', label: 'Year', num: true },
  { key: 'generation_twh', label: 'Generation (TWh)', num: true },
  { key: 'generation_share_percent', label: 'Share (%)', num: true },
  { key: 'capacity_gw', label: 'Capacity (GW)', num: true },
  { key: 'emissions_mtco2e', label: 'Emissions (MtCO₂e)', num: true },
] as const

export function DataExplorer() {
  const { countries, meta } = useAppData()
  const [ids, setIds] = useState<number[]>(() => {
    const de = countries.find((c) => c.area === 'Germany')
    return de ? [de.country_id] : []
  })
  const [sources, setSources] = useState<string[]>([])
  const [yearFrom, setYearFrom] = useState(2015)
  const [yearTo, setYearTo] = useState(meta.year_max)
  const [page, setPage] = useState(0)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => setPage(0), [ids, sources, yearFrom, yearTo])

  const filters = { country_ids: ids, sources, year_from: yearFrom, year_to: yearTo }
  const res = useApi<DataPage>('/data', { ...filters, limit: PAGE, offset: page * PAGE })
  const total = res.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const years = []
  for (let y = meta.year_max; y >= meta.year_min; y--) years.push({ value: y, label: String(y) })

  const toggle = (s: string) => setSources(sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s])

  const downloadCsv = async () => {
    setDownloading(true)
    try {
      const all = await getJson<DataPage>('/data', { ...filters, limit: 5000, offset: 0 })
      const header = COLUMNS.map((c) => c.key).join(',')
      const lines = all.rows.map((r) => COLUMNS.map((c) => {
        const v = r[c.key]
        return v == null ? '' : typeof v === 'string' && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v)
      }).join(','))
      const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `energy_data_${yearFrom}-${yearTo}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section id="data" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow="Data" title="Query the raw numbers"
        description="Filter the source-level table straight from MySQL, page through it, and download what you see as CSV." />
      <Panel>
        <PanelHeader
          title="Data explorer"
          subtitle={res.data ? `${total.toLocaleString()} matching rows` : 'Loading…'}
          actions={
            <Button variant="primary" size="sm" onClick={downloadCsv} disabled={downloading || !total}>
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download CSV{total > 5000 ? ' (first 5,000)' : ''}
            </Button>
          }
        />
        <div className="space-y-4 px-5 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-20 text-xs font-medium uppercase tracking-wider text-subtle">Countries</span>
            <MultiCountryPicker value={ids} onChange={setIds} countries={countries} max={8} />
            {!ids.length && <span className="text-xs text-subtle">All countries</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-20 text-xs font-medium uppercase tracking-wider text-subtle">Sources</span>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_NAMES.map((s) => {
                const key = sourceKey(s)
                const on = sources.includes(s)
                return (
                  <button key={s} onClick={() => toggle(s)} aria-pressed={on}
                    className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                      on ? 'border-primary/60 bg-primary-soft text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg')}>
                    {key && <span className="size-2 rounded-full" style={{ background: SOURCE_COLOR[key] }} />}
                    {s}
                  </button>
                )
              })}
              {sources.length > 0 && <button onClick={() => setSources([])} className="px-2 text-xs text-subtle hover:text-fg">Clear</button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-20 text-xs font-medium uppercase tracking-wider text-subtle">Years</span>
            <Select label="From year" value={yearFrom} onChange={(v) => { setYearFrom(v); if (v > yearTo) setYearTo(v) }} options={years} />
            <span className="text-subtle">to</span>
            <Select label="To year" value={yearTo} onChange={(v) => { setYearTo(v); if (v < yearFrom) setYearFrom(v) }} options={years} />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto border-t border-border">
          <ChartState loading={res.loading} error={res.error} empty={!res.data?.rows.length} height={300}>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-panel-2/60 text-left text-xs text-subtle">
                  {COLUMNS.map((c) => <th key={c.key} className={cn('px-5 py-3 font-medium', 'num' in c && 'text-right')}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(res.data?.rows ?? []).map((r, i) => (
                  <tr key={`${r.area}-${r.electricity_source}-${r.year}-${i}`} className="border-t border-border hover:bg-panel-2/60">
                    <td className="px-5 py-2.5 text-fg">{r.area}</td>
                    <td className="px-5 py-2.5 text-muted">{r.electricity_source}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{r.year}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-fg">{fmtNum(r.generation_twh, 2)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{fmtNum(r.generation_share_percent, 1)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{fmtNum(r.capacity_gw, 2)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{fmtNum(r.emissions_mtco2e, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ChartState>
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setPage(page - 1)} disabled={page === 0}><ChevronLeft className="size-4" />Prev</Button>
            <Button size="sm" onClick={() => setPage(page + 1)} disabled={page + 1 >= pages}>Next<ChevronRight className="size-4" /></Button>
          </div>
        </div>
      </Panel>
    </section>
  )
}
