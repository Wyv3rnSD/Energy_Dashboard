/** Shared chart pieces: themed tooltip, legend, and axis props for Recharts. */
import type { ReactNode } from 'react'
import { INK } from '@/lib/colors'

export const axisProps = {
  stroke: INK.grid,
  tickLine: false,
  axisLine: false,
  tick: { fill: INK.subtle, fontSize: 12 },
} as const

export const gridProps = { stroke: INK.grid, strokeDasharray: '0', vertical: false } as const

export const crosshair = { stroke: INK.subtle, strokeWidth: 1, strokeDasharray: '3 3' }

export interface TooltipItem { color: string; name: string; value: string }

/** Card-style tooltip: title row, then one row per series (swatch, name, value).
 *  Values stay in text ink; only the swatch carries the series colour. */
export function TooltipCard({ title, items, footer }: { title: ReactNode; items: TooltipItem[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-xl border border-border-strong bg-[#17142a]/95 px-3 py-2.5 text-xs shadow-2xl shadow-black/50 backdrop-blur">
      <div className="mb-1.5 font-semibold text-fg">{title}</div>
      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted">
              <span className="size-2 rounded-full" style={{ background: it.color }} />
              {it.name}
            </span>
            <span className="font-medium tabular-nums text-fg">{it.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-border pt-1.5 text-subtle">{footer}</div>}
    </div>
  )
}

export function Legend({ items, className = '' }: { items: { name: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted ${className}`}>
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5">
          {it.dashed
            ? <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: it.color }} />
            : <span className="size-2.5 rounded-sm" style={{ background: it.color }} />}
          {it.name}
        </span>
      ))}
    </div>
  )
}
