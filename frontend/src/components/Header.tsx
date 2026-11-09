import { CheckCircle2, KeyRound, ShieldHalf } from 'lucide-react'
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
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a
          href={hrefFor({ page: 'new' })}
          aria-label="AegisBreach home"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-ink text-paper">
            <ShieldHalf className="size-[18px]" aria-hidden />
          </span>
          <span className="hidden text-[17px] sm:inline">AegisBreach</span>
        </a>

        <nav aria-label="Main" className="ml-2 flex items-center gap-1">
          <NavLink href={hrefFor({ page: 'new' })} current={route.page === 'new'}>
            New test
          </NavLink>
          <NavLink href={hrefFor({ page: 'history' })} current={route.page !== 'new'}>
            Runs
            {activeRuns > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white tabular">
                {activeRuns}
              </span>
            )}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <HealthPill health={health} />
          <ApiKeyButton />
        </div>
      </div>
    </header>
  )
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors',
        current ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-sunken',
      )}
    >
      {children}
    </a>
  )
}

function HealthPill({ health }: { health: Resource<Health> }) {
  const online = Boolean(health.data) && !health.error
  const checking = health.loading && !health.data && !health.error
  const label = checking ? 'Checking backend' : online ? 'Backend online' : 'Backend offline'
  return (
    <span
      role="status"
      title={online ? `${health.data?.engine.mutators} disguises and ${health.data?.engine.suites.length} prompt sets available` : label}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-ink-soft"
    >
      <span className="relative flex size-2.5">
        {online && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-defended opacity-40 motion-reduce:hidden" />
        )}
        <span
          className={cx(
            'relative inline-flex size-2.5 rounded-full',
            checking ? 'bg-line-strong' : online ? 'bg-defended' : 'bg-bypassed',
          )}
        />
      </span>
      <span className="hidden md:inline">{label}</span>
    </span>
  )
}

function ApiKeyButton() {
  const { apiKey, setDialogOpen } = useApiKey()
  return (
    <>
      <Button
        size="md"
        variant={apiKey ? 'secondary' : 'primary'}
        icon={KeyRound}
        onClick={() => setDialogOpen(true)}
        aria-label={apiKey ? 'API key saved. Change API key' : 'Add API key'}
      >
        <span className="hidden sm:inline">{apiKey ? 'API key' : 'Add API key'}</span>
        {apiKey && <CheckCircle2 className="size-4 text-defended" aria-hidden />}
      </Button>
      <ApiKeyDialog />
    </>
  )
}

type CheckResult =
  | { tone: 'success'; title: string; body: string }
  | { tone: 'error' | 'warn'; title: string; body: string; offerSave?: boolean }

async function checkKey(key: string | null): Promise<CheckResult> {
  try {
    await api.mutators(key)
    return { tone: 'success', title: 'Key accepted', body: 'The backend accepted this key. It is saved in this browser.' }
  } catch (error) {
    const err = toApiError(error)
    if (err.isUnauthorized) {
      return {
        tone: 'error',
        title: 'Key rejected',
        body: "The backend didn't accept this key. Check it matches AEGIS_API_KEY in the backend's .env file.",
      }
    }
    if (err.isOffline) {
      return {
        tone: 'warn',
        title: "Couldn't check the key",
        body: "The backend isn't reachable right now, so the key couldn't be tested.",
        offerSave: true,
      }
    }
    return { tone: 'error', title: 'Something went wrong', body: err.message }
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
    if (!key) {
      setResult({ tone: 'error', title: 'Paste a key first', body: 'The field is empty.' })
      return
    }
    setBusy(true)
    const outcome = await checkKey(key)
    setBusy(false)
    setResult(outcome)
    if (outcome.tone === 'success') {
      saveKey(key)
      setDraft('')
    }
  }

  async function testSaved() {
    setBusy(true)
    setResult(await checkKey(apiKey))
    setBusy(false)
  }

  return (
    <Dialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      title="API key"
      description="The backend asks for this key on every request except the health check."
    >
      <div className="space-y-5 text-sm">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-sunken px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Saved key</p>
            <p className="mt-0.5 font-mono">{apiKey ? maskKey(apiKey) : 'None'}</p>
          </div>
          {apiKey && (
            <div className="flex gap-2">
              <Button size="sm" onClick={testSaved} busy={busy}>
                Test
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  clearKey()
                  setResult(null)
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-2">
          <label htmlFor="api-key-input" className="font-medium">
            {apiKey ? 'Replace with a new key' : 'Paste your key'}
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
              placeholder="e.g. 3kq9...x7Zp"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <Button variant="ghost" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
              {reveal ? 'Hide' : 'Show'}
            </Button>
          </div>
          <Button type="submit" variant="primary" busy={busy} className="w-full">
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
                    setResult({ tone: 'success', title: 'Saved without testing', body: 'It will be checked on the next request.' })
                  }}
                >
                  Save anyway
                </Button>
              ) : undefined
            }
          >
            {result.body}
          </Notice>
        )}

        <div className="space-y-2 border-t border-line pt-4 text-muted">
          <p>
            Find it in the <Kbd>AEGIS_API_KEY</Kbd> line of the backend's <Kbd>.env</Kbd> file. It is stored only in
            this browser (localStorage), so anyone using this browser profile can read it.
          </p>
          <p>
            Running the backend locally with <Kbd>AEGIS_ENV=development</Kbd> and no key? You can skip this.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
