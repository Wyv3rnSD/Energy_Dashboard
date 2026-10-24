/** Data every section needs: metadata, the country list, World's id and the
 *  global year (kept in the URL as ?year=). */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useApi, type Country, type Meta } from './api'
import { useUrlNumber } from './url-state'

interface AppData {
  meta: Meta
  countries: Country[]          // countries only, sorted by name
  regions: Country[]            // World, EU, G20, ...
  worldId: number
  year: number
  setYear: (y: number) => void
  byId: Map<number, Country>
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children, fallback }: { children: ReactNode; fallback: (error?: Error) => ReactNode }) {
  const meta = useApi<Meta>('/meta')
  const all = useApi<Country[]>('/countries', { include_regions: true })
  const [year, setYear] = useUrlNumber('year', meta.data?.default_year ?? 2024)

  const value = useMemo<AppData | null>(() => {
    if (!meta.data || !all.data) return null
    const countries = all.data.filter((c) => c.area_type !== 'Region')
    const regions = all.data.filter((c) => c.area_type === 'Region')
    const world = regions.find((r) => r.area === 'World')
    return {
      meta: meta.data,
      countries,
      regions,
      worldId: world?.country_id ?? -1,
      year: Math.min(Math.max(year, meta.data.year_min), meta.data.year_max),
      setYear,
      byId: new Map(all.data.map((c) => [c.country_id, c])),
    }
  }, [meta.data, all.data, year, setYear])

  if (!value) return <>{fallback(meta.error ?? all.error)}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppData outside AppDataProvider')
  return ctx
}

/** Default country for pickers: a recognisable one if present. */
export function useDefaultCountryId(preferred = 'Germany') {
  const { countries } = useAppData()
  return countries.find((c) => c.area === preferred)?.country_id ?? countries[0]?.country_id ?? 0
}
