/** Chart colours. The eight categorical slots are a validated, colour-blind-safe
 *  set for this dark surface (#13111c), always used in this order. Colour follows
 *  the entity: a source or country keeps its colour whatever else is on screen. */
export const SLOTS = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const

/** Generation sources, in stacking order (bottom to top). "Other" folds
 *  "Other fossil" and "Other renewables" so the stack stays within 8 colours. */
export const SOURCES = ['Hydro', 'Coal', 'Wind', 'Solar', 'Nuclear', 'Bioenergy', 'Gas', 'Other'] as const
export type SourceKey = (typeof SOURCES)[number]

export const SOURCE_COLOR: Record<SourceKey, string> = Object.fromEntries(
  SOURCES.map((s, i) => [s, SLOTS[i]]),
) as Record<SourceKey, string>

export function sourceKey(name: string): SourceKey | null {
  if (name === 'Other fossil' || name === 'Other renewables') return 'Other'
  return (SOURCES as readonly string[]).includes(name) ? (name as SourceKey) : null
}

/** Energy categories (continent breakdown) use the first three slots. */
export const CATEGORY_COLOR: Record<string, string> = {
  Nuclear: SLOTS[0],
  Fossil: SLOTS[1],
  Renewable: SLOTS[2],
}

/** Forecast models. */
export const MODEL_COLOR: Record<string, string> = {
  ridge_lags: SLOTS[0],
  linear_trend: SLOTS[1],
  naive: SLOTS[2],
}
export const MODEL_LABEL: Record<string, string> = {
  ridge_lags: 'Ridge (lags)',
  linear_trend: 'Linear trend',
  naive: 'Naive',
}

/** Text ink and chart chrome, mirrored from index.css tokens for SVG use. */
export const INK = {
  fg: '#f0eef6',
  muted: '#a39fb5',
  subtle: '#77728a',
  grid: '#24203a',
  panel: '#13111c',
  primary: '#9085e9',
}
