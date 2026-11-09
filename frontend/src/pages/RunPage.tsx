import { ArrowLeft, FileQuestion, KeyRound, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type ApiError, api, toApiError } from '../api/client'
import type { Metrics, RunDetail } from '../api/types'
import { BypassBreakdown } from '../components/run/Breakdown'
import { MetricTiles } from '../components/run/MetricTiles'
import { OutcomeTape } from '../components/run/OutcomeTape'
import { TraceDetail } from '../components/run/TraceDetail'
import { TraceExplorer } from '../components/run/TraceExplorer'
import { isActive, RunStatusBadge, targetLabel } from '../components/RunStatusBadge'
import { Button, EmptyState, Notice, Skeleton } from '../components/ui'
import { useApiKey } from '../lib/apiKey'
import { suiteTitle } from '../lib/catalog'
import { duration, plural, shortId, timeAgo } from '../lib/format'
import { hrefFor, navigate } from '../lib/router'
import { useResource } from '../lib/useResource'

export function RunPage({ runId }: { runId: string }) {
  const { apiKey, requestKey } = useApiKey()
  const [polling, setPolling] = useState(true)
  const run = useResource((signal) => api.run(apiKey, runId, signal), [apiKey, runId], polling ? 1000 : null)
  const status = run.data?.status

  useEffect(() => {
    if (status) setPolling(isActive(status))
  }, [status])
  useEffect(() => {
    if (run.error && (run.error.status === 404 || run.error.isUnauthorized)) setPolling(false)
  }, [run.error])

  if (run.data) return <RunView run={run.data} refreshError={run.error} />

  if (run.error?.status === 404) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Run not found"
        action={<Button onClick={() => navigate({ page: 'history' })}>Run history</Button>}
      >
        Runs are kept in memory and disappear when the backend restarts.
      </EmptyState>
    )
  }
  if (run.error?.isUnauthorized) {
    return (
      <Notice
        tone="warn"
        title="An API key is required"
        action={
          <Button size="sm" variant="primary" icon={KeyRound} onClick={requestKey}>
            Add key
          </Button>
        }
      />
    )
  }
  if (run.error) {
    return (
      <Notice tone="error" title="Couldn't load this run" action={<Button size="sm" onClick={run.reload}>Retry</Button>}>
        {run.error.message}
      </Notice>
    )
  }
  return (
    <div className="space-y-4" aria-label="Loading run">
      <Skeleton className="h-12" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

function RunView({ run, refreshError }: { run: RunDetail; refreshError?: ApiError }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [order, setOrder] = useState<number[]>([])
  const metrics = run.status === 'COMPLETED' ? run.metrics : null

  return (
    <div className="space-y-6">
      <RunHeader run={run} />

      {refreshError && !refreshError.isOffline && (
        <Notice tone="warn" title="Live updates paused">
          {refreshError.message}
        </Notice>
      )}
      {isActive(run.status) && <Progress run={run} />}
      {run.status === 'FAILED' && (
        <Notice tone="error" title="Run failed">
          <span className="font-mono text-xs">{run.error ?? 'No error message was recorded.'}</span>
        </Notice>
      )}

      {metrics && (
        <>
          <MetricTiles metrics={metrics} />
          <PartialNote metrics={metrics} />

          {run.results.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <OutcomeTape
                  results={run.results}
                  onSelect={(index) => {
                    setOrder(run.results.map((_, i) => i))
                    setSelected(index)
                  }}
                />
              </div>
              <div className="lg:col-span-2">
                <BypassBreakdown results={run.results} hasMutators={run.mutator_names.length > 0} />
              </div>
            </div>
          )}

          {run.results.length > 0 && (
            <TraceExplorer
              results={run.results}
              onSelect={(index, visibleOrder) => {
                setOrder(visibleOrder)
                setSelected(index)
              }}
            />
          )}
          <TraceDetail
            results={run.results}
            index={selected}
            order={order}
            onNavigate={setSelected}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </div>
  )
}

function RunHeader({ run }: { run: RunDetail }) {
  const { apiKey, requestKey } = useApiKey()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const took = duration(run.started_at, run.completed_at)

  async function runAgain() {
    setBusy(true)
    setError(null)
    try {
      const accepted = await api.startRun(apiKey, {
        target_type: run.target_type,
        target_url: run.target_type === 'mock' ? undefined : run.target_url,
        suite_names: run.suite_names,
        mutator_names: run.mutator_names,
        max_concurrency: 5,
      })
      navigate({ page: 'run', runId: accepted.run_id })
    } catch (err) {
      const apiError = toApiError(err)
      setError(apiError)
      if (apiError.isUnauthorized) requestKey()
    } finally {
      setBusy(false)
    }
  }

  const meta = [
    targetLabel(run),
    run.suite_names.map(suiteTitle).join(' + '),
    plural(run.mutator_names.length, 'mutator'),
    timeAgo(run.created_at),
    took && `took ${took}`,
  ].filter(Boolean)

  return (
    <header className="space-y-3">
      <a href={hrefFor({ page: 'history' })} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Run history
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Run <span className="font-mono">{shortId(run.run_id)}</span>
            </h1>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-1 text-sm text-muted">{meta.join(' · ')}</p>
        </div>
        {!isActive(run.status) && (
          <Button size="sm" icon={RotateCcw} onClick={runAgain} busy={busy}>
            Run again
          </Button>
        )}
      </div>
      {error && (
        <Notice tone="error" title="Couldn't start the run again">
          {error.message}
        </Notice>
      )}
    </header>
  )
}

function Progress({ run }: { run: RunDetail }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.round((now - new Date(run.started_at ?? run.created_at).getTime()) / 1000))

  return (
    <div className="rounded-xl border border-line bg-panel p-4" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{run.status === 'QUEUED' ? 'Queued' : `Sending prompts to ${targetLabel(run)}`}</span>
        <span className="text-muted tabular">{seconds}s</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken">
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
      </div>
      {run.target_type !== 'mock' && (
        <p className="mt-2 text-xs text-muted">A sleeping free-tier gateway can take ~30 s to wake up.</p>
      )}
    </div>
  )
}

/** One line, only when some prompts got no verdict or were skipped. */
function PartialNote({ metrics }: { metrics: Metrics }) {
  const c = metrics.outcome_counts
  const errors = (c.VALIDATION_ERROR ?? 0) + (c.RATE_LIMITED ?? 0) + (c.SYSTEM_ERROR ?? 0)
  const parts = [
    errors > 0 && `${plural(errors, 'prompt')} got no verdict (errors)`,
    metrics.skipped_prompts > 0 && `${plural(metrics.skipped_prompts, 'prompt')} skipped as too long`,
  ].filter(Boolean)
  if (!parts.length) return null
  return (
    <p className="rounded-lg bg-alarm-soft px-3 py-2 text-sm text-alarm">
      {parts.join(' · ')}. Use the Errors filter below to see why.
    </p>
  )
}
