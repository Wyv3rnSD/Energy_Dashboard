/** Small shadcn-style building blocks: Panel (bordered card), Button, Badge,
 *  section headers, skeletons and empty/error states. */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-panel border border-border bg-panel shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset]',
        className,
      )}
      {...props}
    />
  )
}

export function PanelHeader({ title, subtitle, actions, className }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
        outline: 'border border-border bg-panel-2 text-fg hover:border-border-strong hover:bg-[#211d31]',
        ghost: 'text-muted hover:bg-panel-2 hover:text-fg',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', icon: 'size-9' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
)

export function Button({ className, variant, size, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full border border-border bg-panel-2 px-2.5 py-0.5 text-xs font-medium text-muted', className)}
      {...props}
    />
  )
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h2>
      {description && <p className="mt-3 text-base text-muted">{description}</p>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-panel-2', className)} />
}

/** Wraps a chart body: spinner while loading, message on error or no data. */
export function ChartState({ loading, error, empty, height = 300, children }: {
  loading?: boolean; error?: Error; empty?: boolean; height?: number; children: ReactNode
}) {
  if (error) return <StateBox height={height} icon={<AlertTriangle className="size-5 text-[#fab219]" />} text={error.message} />
  if (empty && !loading) return <StateBox height={height} text="No data for this selection." />
  if (empty && loading) return <StateBox height={height} icon={<Loader2 className="size-5 animate-spin text-subtle" />} text="Loading…" />
  return <div className={cn('relative transition-opacity', loading && 'opacity-60')}>{children}</div>
}

function StateBox({ height, icon, text }: { height: number; icon?: ReactNode; text: string }) {
  return (
    <div style={{ height }} className="flex flex-col items-center justify-center gap-2 text-center text-sm text-subtle">
      {icon}
      <span className="max-w-sm">{text}</span>
    </div>
  )
}
