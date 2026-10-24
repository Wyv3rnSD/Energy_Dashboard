import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const oneDp = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

/** TWh with a sensible precision: 28,432 TWh, 512 TWh, 3.4 TWh. */
export function fmtTwh(value: number | null | undefined) {
  if (value == null) return '–'
  return `${Math.abs(value) >= 100 ? whole.format(value) : oneDp.format(value)} TWh`
}

export function fmtPct(value: number | null | undefined, digits = 1) {
  if (value == null) return '–'
  return `${value.toFixed(digits)}%`
}

export function fmtNum(value: number | null | undefined, digits = 1) {
  if (value == null) return '–'
  return value.toLocaleString('en', { maximumFractionDigits: digits })
}

export function fmtCompact(value: number | null | undefined) {
  if (value == null) return '–'
  return compact.format(value)
}

/** "+3.2%" / "−1.0 pts" style change labels; sign uses a real minus. */
export function fmtDelta(value: number | null | undefined, unit = '%', digits = 1) {
  if (value == null || Number.isNaN(value)) return '–'
  const rounded = Number(value.toFixed(digits))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toFixed(digits)}${unit}`
}
