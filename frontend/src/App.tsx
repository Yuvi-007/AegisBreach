import { RefreshCw, ServerOff } from 'lucide-react'
import { api } from './api/client'
import { Header } from './components/Header'
import { Button, Kbd, Notice } from './components/ui'
import { ApiKeyProvider } from './lib/apiKey'
import { useRoute } from './lib/router'
import { useResource } from './lib/useResource'
import { HistoryPage } from './pages/HistoryPage'
import { NewRunPage } from './pages/NewRunPage'
import { RunPage } from './pages/RunPage'

export default function App() {
  return (
    <ApiKeyProvider>
      <Shell />
    </ApiKeyProvider>
  )
}

function Shell() {
  const route = useRoute()
  const health = useResource((signal) => api.health(signal), [], 10_000)
  const offline = Boolean(health.error?.isOffline)

  return (
    <div className="flex min-h-screen flex-col">
      <button
        type="button"
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
      >
        Skip to content
      </button>
      <Header route={route} health={health} />

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 outline-none sm:px-6">
        {offline && (
          <Notice
            tone="error"
            title="Can't reach the AegisBreach backend"
            className="mb-6"
            action={
              <Button size="sm" icon={RefreshCw} onClick={health.reload}>
                Retry
              </Button>
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <ServerOff className="size-4" aria-hidden /> Start it in a terminal, then retry:
            </span>{' '}
            <Kbd>cd backend &amp;&amp; uvicorn app.main:app --env-file ../.env</Kbd>
          </Notice>
        )}

        {route.page === 'new' && <NewRunPage />}
        {route.page === 'history' && <HistoryPage />}
        {route.page === 'run' && <RunPage key={route.runId} runId={route.runId} />}
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        AegisBreach tests guardrails you own or are authorised to test.
      </footer>
    </div>
  )
}
