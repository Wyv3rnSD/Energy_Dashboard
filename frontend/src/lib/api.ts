/** Typed client for the FastAPI backend (api.py). In development Vite proxies
 *  /api to http://localhost:8000; set VITE_API_URL to call another server. */
import { useEffect, useState } from 'react'

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>

export function apiUrl(path: string, params: Params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)))
    else search.append(key, String(value))
  }
  const qs = search.toString()
  return `${BASE}/api${path}${qs ? `?${qs}` : ''}`
}

const cache = new Map<string, Promise<unknown>>()

export async function getJson<T>(path: string, params: Params = {}): Promise<T> {
  const url = apiUrl(path, params)
  if (!cache.has(url)) {
    const request = fetch(url).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new ApiError(res.status, body.detail ?? res.statusText)
      }
      return res.json()
    })
    request.catch(() => cache.delete(url))   // don't cache failures
    cache.set(url, request)
  }
  return cache.get(url) as Promise<T>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ApiState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
}

/** Fetch an endpoint whenever its path/params change. Pass path=null to skip. */
export function useApi<T>(path: string | null, params: Params = {}): ApiState<T> {
  const key = path == null ? null : apiUrl(path, params)
  const [state, setState] = useState<ApiState<T> & { key: string | null }>({
    data: undefined, error: undefined, loading: path != null, key,
  })

  useEffect(() => {
    if (path == null) return
    let live = true
    getJson<T>(path, params)
      .then((data) => live && setState({ data, error: undefined, loading: false, key }))
      .catch((error) => live && setState({ data: undefined, error, loading: false, key }))
    return () => { live = false }
    // key captures path + params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // While a new request is in flight, report loading but keep the old data on
  // screen so charts don't flash empty.
  if (state.key !== key) return { data: state.data, error: undefined, loading: path != null }
  return state
}

// ---------------------------------------------------------------- types

export interface Meta {
  year_min: number
  year_max: number
  default_year: number
  continents: string[]
  memberships: string[]
  data_metrics: string[]
  summary_metrics: string[]
}

export interface Country {
  country_id: number
  area: string
  iso_code: string | null
  continent: string | null
  ember_region: string | null
  area_type: string
}

export interface MixRow {
  electricity_source: string
  energy_category: string
  generation_twh: number
  share_percent: number
}

export interface MixHistoryRow {
  year: number
  electricity_source: string
  energy_category: string
  generation_twh: number
}

export type SeriesRow = { area: string; year: number } & Record<string, number | null | string>

export interface GrowthRow {
  year: number
  generation_twh: number | null
  prev_twh: number | null
  yoy_twh: number | null
  yoy_percent: number | null
  moving_avg_3yr: number | null
}

export interface Profile {
  _id: number
  area: string
  iso_code: string | null
  continent: string | null
  ember_region: string | null
  memberships: string[]
  latest_year: number | null
  latest_mix_twh: Record<string, number>
  series: {
    year: number
    total_generation_twh: number | null
    renewable_generation_twh: number | null
    renewable_share_percent: number | null
    fossil_generation_twh: number | null
    fossil_share_percent: number | null
  }[]
}

export interface TopRow {
  area: string
  continent: string | null
  value: number
  total_generation_twh: number
  overall_rank: number
  continent_rank: number
}

export interface MoverRow {
  area: string
  value_from: number
  value_to: number
  rank_from: number
  rank_to: number
  places_gained: number
}

export interface ContinentRow {
  continent: string | null
  energy_category: string | null
  generation_twh: number
}

export interface ScatterRow {
  area: string
  continent: string | null
  renewable_share_percent: number
  total_generation_twh: number
  emissions_intensity_gco2e_kwh: number
}

export interface ForecastPoint {
  year: number
  value: number
  actual?: number
  kind: 'backtest' | 'forecast'
}

export interface ForecastRun {
  model: string
  target: string
  country_id: number
  area: string
  metrics: { mae: number; rmse: number; mape: number | null }
  predictions: ForecastPoint[]
  params: Record<string, unknown>
}

export interface ModelSummary {
  _id: string
  countries: number
  avg_mae: number
  avg_mape: number
  median_mae: number
  median_mape: number
}

export interface DataPage {
  total: number
  rows: {
    area: string
    continent: string | null
    electricity_source: string
    energy_category: string
    year: number
    generation_twh: number | null
    generation_share_percent: number | null
    capacity_gw: number | null
    emissions_mtco2e: number | null
    emissions_intensity_gco2e_kwh: number | null
  }[]
}
