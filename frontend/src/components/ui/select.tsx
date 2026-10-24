/** Dropdown (Radix Select) and searchable country pickers (cmdk in a Popover). */
import { useState } from 'react'
import * as RSelect from '@radix-ui/react-select'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import type { Country } from '@/lib/api'
import { cn } from '@/lib/utils'

const triggerClass =
  'inline-flex h-9 items-center justify-between gap-2 rounded-control border border-border bg-panel-2 px-3 text-sm text-fg transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-primary data-[placeholder]:text-subtle'

const contentClass =
  'z-50 max-h-80 overflow-hidden rounded-control border border-border-strong bg-[#17142a] p-1 text-sm text-fg shadow-2xl shadow-black/50'

export interface Option<T extends string | number> { value: T; label: string }

export function Select<T extends string | number>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: Option<T>[]; label: string; className?: string
}) {
  return (
    <RSelect.Root
      value={String(value)}
      onValueChange={(v) => onChange((typeof value === 'number' ? Number(v) : v) as T)}
    >
      <RSelect.Trigger aria-label={label} className={cn(triggerClass, 'min-w-28', className)}>
        <RSelect.Value />
        <RSelect.Icon><ChevronDown className="size-4 text-subtle" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={6} className={cn(contentClass, 'min-w-[var(--radix-select-trigger-width)]')}>
          <RSelect.Viewport className="max-h-72">
            {options.map((o) => (
              <RSelect.Item
                key={String(o.value)}
                value={String(o.value)}
                className="relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-7 pr-3 outline-none data-[highlighted]:bg-primary-soft data-[highlighted]:text-fg"
              >
                <RSelect.ItemIndicator className="absolute left-2"><Check className="size-3.5 text-primary" /></RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

function CountryCommand({ countries, onPick, exclude = [] }: {
  countries: Country[]; onPick: (id: number) => void; exclude?: number[]
}) {
  return (
    <Command className="w-72" loop>
      <div className="flex items-center gap-2 border-b border-border px-2">
        <Search className="size-4 text-subtle" />
        <Command.Input autoFocus placeholder="Search countries…" className="h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle" />
      </div>
      <Command.List className="max-h-64 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-subtle">No country found.</Command.Empty>
        {countries.filter((c) => !exclude.includes(c.country_id)).map((c) => (
          <Command.Item
            key={c.country_id}
            value={`${c.area} ${c.iso_code ?? ''}`}
            onSelect={() => onPick(c.country_id)}
            className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 data-[selected=true]:bg-primary-soft"
          >
            <span>{c.area}</span>
            <span className="text-xs text-subtle">{c.continent ?? 'Region'}</span>
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  )
}

export function CountryPicker({ value, onChange, countries, className }: {
  value: number; onChange: (id: number) => void; countries: Country[]; className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = countries.find((c) => c.country_id === value)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Choose country" className={cn(triggerClass, 'min-w-48', className)}>
        <span className="truncate">{current?.area ?? 'Choose country'}</span>
        <ChevronDown className="size-4 text-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn(contentClass, 'p-0')}>
          <CountryCommand countries={countries} onPick={(id) => { onChange(id); setOpen(false) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Chips for the chosen countries plus an "Add" picker. Each chip shows its
 *  colour swatch so the chips double as the chart legend. */
export function MultiCountryPicker({ value, onChange, countries, max = 5, colorOf }: {
  value: number[]; onChange: (ids: number[]) => void; countries: Country[]; max?: number
  colorOf?: (id: number) => string
}) {
  const [open, setOpen] = useState(false)
  const byId = new Map(countries.map((c) => [c.country_id, c]))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((id) => (
        <span key={id} className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-panel-2 pl-3 pr-1 text-sm">
          {colorOf && <span className="size-2.5 rounded-full" style={{ background: colorOf(id) }} />}
          {byId.get(id)?.area ?? id}
          <button
            aria-label={`Remove ${byId.get(id)?.area}`}
            onClick={() => onChange(value.filter((v) => v !== id))}
            className="grid size-6 place-items-center rounded-full text-subtle hover:bg-border hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {value.length < max && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-sm text-muted hover:border-primary hover:text-fg">
            <Plus className="size-3.5" /> Add country
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={6} className={cn(contentClass, 'p-0')}>
              <CountryCommand countries={countries} exclude={value} onPick={(id) => { onChange([...value, id]); setOpen(false) }} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}
