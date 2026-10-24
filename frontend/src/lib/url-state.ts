/** Filter state that lives in the page URL, so "copy link" shares the exact view. */
import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  window.addEventListener('popstate', fn)
  return () => { listeners.delete(fn); window.removeEventListener('popstate', fn) }
}
const getSearch = () => window.location.search

function write(key: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value == null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  window.history.replaceState(null, '', url)
  listeners.forEach((fn) => fn())
}

export function useUrlParam(key: string): [string | null, (v: string | null) => void] {
  const search = useSyncExternalStore(subscribe, getSearch)
  const value = new URLSearchParams(search).get(key)
  const set = useCallback((v: string | null) => write(key, v), [key])
  return [value, set]
}

export function useUrlNumber(key: string, fallback: number): [number, (v: number) => void] {
  const [raw, set] = useUrlParam(key)
  const parsed = raw == null ? NaN : Number(raw)
  const setNumber = useCallback((v: number) => set(String(v)), [set])
  return [Number.isFinite(parsed) ? parsed : fallback, setNumber]
}

export function useUrlNumberList(key: string, fallback: number[]): [number[], (v: number[]) => void] {
  const [raw, set] = useUrlParam(key)
  const parsed = raw == null ? fallback : raw.split(',').filter(Boolean).map(Number).filter(Number.isFinite)
  const setList = useCallback((v: number[]) => set(v.join(',')), [set])
  return [parsed, setList]
}
