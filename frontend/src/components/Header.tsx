import { KeyRound, ShieldHalf } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { api, toApiError } from '../api/client'
import type { Health } from '../api/types'
import { maskKey, useApiKey } from '../lib/apiKey'
import { hrefFor, type Route } from '../lib/router'
import type { Resource } from '../lib/useResource'
import { Button, cx, Dialog, Kbd, Notice } from './ui'

export function Header({ route, health }: { route: Route; health: Resource<Health> }) {
  const activeRuns = health.data?.engine.active_runs ?? 0
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto grid h-14 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <a
            href={hrefFor({ page: 'new' })}
            aria-label="AegisBreach home"
            className="flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight"
          >
            <span className="grid size-7 place-items-center rounded-md bg-ink text-paper">
              <ShieldHalf className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">AegisBreach</span>
          </a>
          <HealthPill health={health} />
        </div>

        <nav aria-label="Main" className="flex items-center rounded-lg border border-line bg-sunken/70 p-0.5">
          <Tab href={hrefFor({ page: 'new' })} current={route.page === 'new'}>
            New Test
          </Tab>
          <Tab href={hrefFor({ page: 'history' })} current={route.page !== 'new'}>
            <span className="sm:hidden">History</span>
            <span className="hidden sm:inline">Run History</span>
            {activeRuns > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white tabular">
                {activeRuns}
              </span>
            )}
          </Tab>
        </nav>

        <div className="flex justify-end">
          <ApiKeyButton />
        </div>
      </div>
    </header>
  )
}

function Tab({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors',
        current ? 'bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </a>
  )
}

function HealthPill({ health }: { health: Resource<Health> }) {
  const online = Boolean(health.data) && !health.error
  const checking = health.loading && !health.data && !health.error
  const label = checking ? 'Checking' : online ? 'Online' : 'Offline'
  return (
    <span
      role="status"
      aria-label={`Backend ${label.toLowerCase()}`}
      title={online ? `Backend online: ${health.data?.engine.mutators} mutators` : `Backend ${label.toLowerCase()}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-muted"
    >
      <span
        className={cx(
          'size-1.5 rounded-full',
          checking ? 'bg-line-strong' : online ? 'bg-defended' : 'bg-bypassed',
        )}
        aria-hidden
      />
      <span className="hidden md:inline">{label}</span>
    </span>
  )
}

function ApiKeyButton() {
  const { apiKey, setDialogOpen } = useApiKey()
  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label={apiKey ? 'API key saved. Change API key' : 'No API key. Add API key'}
        title={apiKey ? 'API key saved' : 'No API key'}
        className="relative grid size-9 place-items-center rounded-lg border border-line bg-panel text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        <KeyRound className="size-4" aria-hidden />
        <span
          className={cx(
            'absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-panel',
            apiKey ? 'bg-defended' : 'bg-line-strong',
          )}
          aria-hidden
        />
      </button>
      <ApiKeyDialog />
    </>
  )
}

type CheckResult =
  | { tone: 'success'; title: string }
  | { tone: 'error' | 'warn'; title: string; offerSave?: boolean }

async function checkKey(key: string | null): Promise<CheckResult> {
  try {
    await api.mutators(key)
    return { tone: 'success', title: 'Key accepted and saved' }
  } catch (error) {
    const err = toApiError(error)
    if (err.isUnauthorized) return { tone: 'error', title: 'Key rejected by the backend' }
    if (err.isOffline) return { tone: 'warn', title: "Backend unreachable, couldn't test the key", offerSave: true }
    return { tone: 'error', title: err.message }
  }
}

function ApiKeyDialog() {
  const { apiKey, saveKey, clearKey, dialogOpen, setDialogOpen } = useApiKey()
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)

  useEffect(() => {
    if (dialogOpen) {
      setDraft('')
      setReveal(false)
      setResult(null)
    }
  }, [dialogOpen])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const key = draft.trim()
    if (!key) return
    setBusy(true)
    const outcome = await checkKey(key)
    setBusy(false)
    setResult(outcome)
    if (outcome.tone === 'success') {
      saveKey(key)
      setDraft('')
    }
  }

  return (
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="API key">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Must match <Kbd>AEGIS_API_KEY</Kbd> in the backend's <Kbd>.env</Kbd>. Stored in this browser only.
        </p>

        {apiKey && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-defended" aria-hidden />
              <span className="font-mono">{maskKey(apiKey)}</span>
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                busy={busy}
                onClick={async () => {
                  setBusy(true)
                  setResult(await checkKey(apiKey))
                  setBusy(false)
                }}
              >
                Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-bypassed"
                onClick={() => {
                  clearKey()
                  setResult(null)
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-2">
          <label htmlFor="api-key-input" className="sr-only">
            API key
          </label>
          <div className="flex gap-2">
            <input
              id="api-key-input"
              autoFocus
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={apiKey ? 'Paste a new key' : 'Paste your key'}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <Button variant="ghost" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
              {reveal ? 'Hide' : 'Show'}
            </Button>
          </div>
          <Button type="submit" variant="primary" busy={busy} disabled={!draft.trim()} className="w-full">
            Test and save
          </Button>
        </form>

        {result && (
          <Notice
            tone={result.tone}
            title={result.title}
            action={
              result.tone !== 'success' && result.offerSave && draft.trim() ? (
                <Button
                  size="sm"
                  onClick={() => {
                    saveKey(draft)
                    setResult({ tone: 'success', title: 'Saved without testing' })
                  }}
                >
                  Save anyway
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </Dialog>
  )
}
