import { useEffect, useState } from 'react'
import { Check, Link2, Menu, X, Zap } from 'lucide-react'
import { GithubIcon } from './ui/github-icon'
import { useAppData } from '@/lib/app-context'
import { cn } from '@/lib/utils'
import { Button } from './ui/primitives'
import { Select } from './ui/select'

export const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'countries', label: 'Countries' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'forecasts', label: 'Forecasts' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' },
] as const

const REPO_URL = 'https://github.com/Wyv3rnSD/Energy_Dashboard'

/** Highlights the section currently in view. */
function useActiveSection() {
  const [active, setActive] = useState<string>(NAV[0].id)
  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight * 0.35
      let current: string = NAV[0].id
      for (const { id } of NAV) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      // At the very bottom the last section wins even if it's short.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = NAV[NAV.length - 1].id
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])
  return active
}

export function Navbar() {
  const { meta, year, setYear } = useAppData()
  const active = useActiveSection()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const years = []
  for (let y = meta.year_max; y >= Math.max(meta.year_min, 2000); y--) years.push({ value: y, label: String(y) })

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <a href="#overview" className="flex items-center gap-2 font-semibold text-fg">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-fg"><Zap className="size-4" /></span>
          <span className="hidden sm:inline">Energy Dashboard</span>
        </a>

        <div className="mx-auto hidden items-center gap-1 rounded-full border border-border bg-panel/70 p-1 md:flex">
          {NAV.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? 'true' : undefined}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm transition-colors',
                active === id ? 'bg-primary-soft text-fg ring-1 ring-primary/40' : 'text-muted hover:text-fg',
              )}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Select label="Year" value={year} onChange={setYear} options={years} className="min-w-24" />
          <Button variant="ghost" size="icon" onClick={copyLink} title="Copy link to this view" aria-label="Copy link to this view">
            {copied ? <Check className="size-4 text-good" /> : <Link2 className="size-4" />}
          </Button>
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub repository"
             className="hidden size-9 place-items-center rounded-control text-muted hover:bg-panel-2 hover:text-fg sm:grid">
            <GithubIcon className="size-4" />
          </a>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border px-4 py-3 md:hidden">
          {NAV.map(({ id, label }) => (
            <a key={id} href={`#${id}`} onClick={() => setOpen(false)}
               className={cn('block rounded-control px-3 py-2 text-sm', active === id ? 'bg-primary-soft text-fg' : 'text-muted')}>
              {label}
            </a>
          ))}
        </div>
      )}
    </header>
  )
}
