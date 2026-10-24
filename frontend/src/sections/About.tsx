import * as Accordion from '@radix-ui/react-accordion'
import { BrainCircuit, ChevronDown, Database, Layers, Server, Zap } from 'lucide-react'
import { GithubIcon } from '@/components/ui/github-icon'
import { Panel, SectionHeading } from '@/components/ui/primitives'

const CARDS = [
  {
    icon: Database, title: 'The data',
    body: "Ember's yearly electricity dataset: generation, capacity and emissions by source for 200+ countries and regions, cleaned in a pandas preprocessing notebook.",
  },
  {
    icon: Server, title: 'MySQL',
    body: 'The source of truth, in third normal form: countries, energy_sources, energy_data, energy_summary and ml_features, with foreign keys, a view, and stored procedures.',
  },
  {
    icon: Layers, title: 'MongoDB',
    body: 'Document data that fits it better: one profile per country with its yearly series embedded, plus forecast runs and saved views with schema validation.',
  },
  {
    icon: BrainCircuit, title: 'Forecasting',
    body: 'A naive baseline, a linear trend and a pooled Ridge regression on lagged values, backtested on held-out years before forecasting ahead.',
  },
]

const FAQ = [
  {
    q: 'Why do the newest year’s numbers look incomplete?',
    a: "Ember publishes the latest year before every country has reported. The year picker defaults to the most recent year with broad coverage; newer years still work but some countries will be missing.",
  },
  {
    q: 'What counts as renewable?',
    a: 'Solar, wind, hydro, bioenergy and other renewables. Nuclear is low-carbon but not renewable, so it is counted separately.',
  },
  {
    q: 'Which queries run in the database?',
    a: 'Year-on-year growth uses LAG() and moving averages; rankings use RANK() with PARTITION BY; continent subtotals use GROUP BY … WITH ROLLUP; a CTE recomputes renewable shares as a data-quality check; and two stored procedures serve the mix and leaderboard views.',
  },
  {
    q: 'How good are the forecasts?',
    a: 'Each model is trained only on years before the test window, then judged on how close it gets to the real values. The Forecasts section shows each model’s error for the chosen country. Treat 2030 figures as trend extrapolation, not predictions of policy.',
  },
  {
    q: 'Can I share a view?',
    a: 'Yes. The year, countries and filters you pick are stored in the page address, so the link button in the top bar copies a link that opens exactly what you are looking at.',
  },
]

export function About() {
  return (
    <section id="about" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
      <SectionHeading eyebrow="About" title="Data and methods"
        description="Built for a Database Concepts & Data Science course: one dataset, two databases, a Python API and this dashboard." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map(({ icon: Icon, title, body }) => (
          <Panel key={title} className="p-5">
            <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-4.5" /></span>
            <h3 className="mt-4 font-semibold text-fg">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </Panel>
        ))}
      </div>

      <Panel className="mt-6 p-2">
        <Accordion.Root type="single" collapsible>
          {FAQ.map(({ q, a }, i) => (
            <Accordion.Item key={q} value={String(i)} className="border-b border-border last:border-0">
              <Accordion.Header>
                <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 rounded-control px-4 py-4 text-left text-sm font-medium text-fg hover:bg-panel-2">
                  {q}
                  <ChevronDown className="size-4 shrink-0 text-subtle transition-transform group-data-[state=open]:rotate-180" />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="px-4 pb-4 text-sm leading-relaxed text-muted">{a}</Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </Panel>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-subtle sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-fg"><Zap className="size-3.5" /></span>
          <span className="text-muted">Energy Dashboard</span>
          <span>· Data: <a className="text-muted hover:text-fg" href="https://ember-energy.org/" target="_blank" rel="noreferrer">Ember</a> (CC BY 4.0)</span>
        </div>
        <a href="https://github.com/Wyv3rnSD/Energy_Dashboard" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-fg">
          <GithubIcon className="size-4" /> Source on GitHub
        </a>
      </div>
    </footer>
  )
}
