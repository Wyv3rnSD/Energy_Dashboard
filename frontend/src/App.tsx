import { Loader2, ServerCrash } from 'lucide-react'
import { AppDataProvider } from '@/lib/app-context'
import { Navbar } from '@/components/Navbar'
import { Overview } from '@/sections/Overview'
import { Countries } from '@/sections/Countries'
import { Rankings } from '@/sections/Rankings'
import { Forecasts } from '@/sections/Forecasts'
import { DataExplorer } from '@/sections/DataExplorer'
import { About, Footer } from '@/sections/About'

function Splash({ error }: { error?: Error }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      {error ? (
        <div className="max-w-md">
          <ServerCrash className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-lg font-semibold text-fg">Can't reach the API</h1>
          <p className="mt-2 text-sm text-muted">
            Start it from the project folder with{' '}
            <code className="rounded bg-panel-2 px-1.5 py-0.5 text-fg">python -m uvicorn api:app --reload</code>, then refresh.
          </p>
          <p className="mt-3 text-xs text-subtle">{error.message}</p>
        </div>
      ) : (
        <Loader2 className="size-6 animate-spin text-subtle" />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AppDataProvider fallback={(error) => <Splash error={error} />}>
      <Navbar />
      <main>
        <Overview />
        <Countries />
        <Rankings />
        <Forecasts />
        <DataExplorer />
        <About />
      </main>
      <Footer />
    </AppDataProvider>
  )
}
