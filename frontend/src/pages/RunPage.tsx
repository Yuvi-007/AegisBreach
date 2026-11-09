import { ArrowLeft, FileQuestion, KeyRound, RotateCcw, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type ApiError, api, toApiError } from '../api/client'
import type { Metrics, RunDetail } from '../api/types'
import { Breakdown, bypassBy } from '../components/run/Breakdown'
import { MetricTiles } from '../components/run/MetricTiles'
import { OutcomeTape } from '../components/run/OutcomeTape'
import { TraceDetail } from '../components/run/TraceDetail'
import { TraceExplorer } from '../components/run/TraceExplorer'
import { isActive, RunStatusBadge, targetLabel } from '../components/RunStatusBadge'
import { Button, cx, EmptyState, Notice, Skeleton } from '../components/ui'
import { useApiKey } from '../lib/apiKey'
import { categoryLabel, mutatorTitle, ORIGINAL, SUITE_GUIDE } from '../lib/catalog'
import { dateTime, duration, plural, shortId } from '../lib/format'
import { hrefFor, navigate } from '../lib/router'
import { type Level, LEVEL_STYLE, levelFor, SCALES } from '../lib/severity'
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

  if (!run.data) {
    if (run.error?.status === 404) {
      return (
        <EmptyState
          icon={FileQuestion}
          title="Run not found"
          action={
            <div className="flex gap-2">
              <Button onClick={() => navigate({ page: 'history' })}>All runs</Button>
              <Button variant="primary" onClick={() => navigate({ page: 'new' })}>
                Start a new test
              </Button>
            </div>
          }
        >
          Runs live in the backend's memory, so they disappear when it restarts.
        </EmptyState>
      )
    }
    if (run.error?.isUnauthorized) {
      return (
        <Notice
          tone="warn"
          title="An API key is needed to view this run"
          action={
            <Button size="sm" variant="primary" icon={KeyRound} onClick={requestKey}>
              Add API key
            </Button>
          }
        />
      )
    }
    if (run.error) {
      return (
        <Notice
          tone="error"
          title="Couldn't load this run"
          action={
            <Button size="sm" onClick={run.reload}>
              Retry
            </Button>
          }
        >
          {run.error.message}
        </Notice>
      )
    }
    return (
      <div className="space-y-4" aria-label="Loading run">
        <Skeleton className="h-24" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  return <RunView run={run.data} refreshError={run.error} />
}

function RunView({ run, refreshError }: { run: RunDetail; refreshError?: ApiError }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [order, setOrder] = useState<number[]>([])
  const active = isActive(run.status)
  const metrics = run.status === 'COMPLETED' ? run.metrics : null
  const usedDisguises = run.mutator_names.length > 0

  return (
    <div className="space-y-8">
      <RunHeader run={run} />

      {refreshError && !refreshError.isOffline && (
        <Notice tone="warn" title="Live updates paused">
          {refreshError.message}
        </Notice>
      )}

      {active && <Progress run={run} />}

      {run.status === 'FAILED' && (
        <Notice tone="error" title="This run failed before it finished">
          <span className="font-mono text-xs">{run.error ?? 'No error message was recorded.'}</span>
        </Notice>
      )}

      {metrics && (
        <>
          <Headline metrics={metrics} />
          <PartialNotices metrics={metrics} />
          <MetricTiles metrics={metrics} />

          {run.results.length > 0 && (
            <OutcomeTape
              results={run.results}
              onSelect={(index) => {
                setOrder(run.results.map((_, i) => i))
                setSelected(index)
              }}
            />
          )}

          {metrics.malicious_prompts > 0 && (
            <div className={cx('grid gap-3', usedDisguises && 'lg:grid-cols-2')}>
              {usedDisguises && (
                <Breakdown
                  title="Which disguises worked"
                  hint="Share of attack prompts that got through, for each disguise."
                  rows={bypassBy(run.results, (r) => r.mutator ?? ORIGINAL, mutatorTitle)}
                />
              )}
              <Breakdown
                title="Which attack types worked"
                hint="Share of attack prompts that got through, by kind of attack."
                rows={bypassBy(run.results, (r) => r.category ?? 'unknown', categoryLabel)}
              />
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

  const facts = [
    ['Target', targetLabel(run)],
    ['Prompt sets', run.suite_names.map((s) => SUITE_GUIDE[s]?.title ?? s).join(', ')],
    ['Disguises', run.mutator_names.length ? run.mutator_names.map(mutatorTitle).join(', ') : 'None'],
    ['Started', dateTime(run.created_at)],
    ...(took ? [['Took', took]] : []),
  ]

  return (
    <header className="space-y-5">
      <a href={hrefFor({ page: 'history' })} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All runs
      </a>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Run <span className="font-mono">{shortId(run.run_id)}</span>
          </h1>
          <RunStatusBadge status={run.status} />
        </div>
        {!isActive(run.status) && (
          <Button icon={RotateCcw} onClick={runAgain} busy={busy}>
            Run again
          </Button>
        )}
      </div>
      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-panel px-4 py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
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
  const since = run.started_at ?? run.created_at
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))

  return (
    <div className="rounded-xl border border-accent/25 bg-accent-soft p-5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">
          {run.status === 'QUEUED' ? 'Waiting to start...' : `Sending prompts to ${targetLabel(run)}...`}
        </p>
        <p className="text-sm text-ink-soft tabular">{seconds}s elapsed</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/70">
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        This page updates by itself. You can leave it and come back from <strong>Runs</strong>.
        {run.target_type !== 'mock' && ' A sleeping free-tier gateway can take 30 seconds to wake up.'}
      </p>
    </div>
  )
}

const HEADLINE_ICON = { good: ShieldCheck, warn: ShieldAlert, bad: ShieldX }

function Headline({ metrics }: { metrics: Metrics }) {
  const counts = metrics.outcome_counts
  const bypassed = counts.BYPASSED ?? 0
  const falseAlarms = counts.FALSE_POSITIVE ?? 0
  const attacks = metrics.malicious_prompts
  const benign = metrics.benign_prompts

  const level: Level | null = attacks
    ? levelFor(metrics.bypass_rate, SCALES.bypass)
    : benign
      ? levelFor(metrics.false_positive_rate, SCALES.falseAlarm)
      : null
  const Icon = HEADLINE_ICON[level ?? 'good']

  const lines: string[] = []
  if (attacks) {
    lines.push(
      bypassed === 0
        ? `The guard stopped every attack (${attacks} of ${attacks}).`
        : `${bypassed} of ${plural(attacks, 'attack')} got through the guard.`,
    )
  }
  if (benign) {
    lines.push(
      falseAlarms === 0
        ? `No everyday requests were wrongly blocked.`
        : `${falseAlarms} of ${plural(benign, 'everyday request')} ${falseAlarms === 1 ? 'was' : 'were'} wrongly blocked.`,
    )
  }
  if (!lines.length) lines.push('This run produced no results.')

  return (
    <div className={cx('flex items-start gap-4 rounded-xl p-5', level ? LEVEL_STYLE[level].chip : 'bg-sunken')}>
      <Icon className="mt-0.5 size-7 shrink-0" aria-hidden />
      <div>
        <p className="text-xl font-semibold tracking-tight text-ink text-balance">{lines[0]}</p>
        {lines[1] && <p className="mt-1 text-ink-soft">{lines[1]}</p>}
      </div>
    </div>
  )
}

function PartialNotices({ metrics }: { metrics: Metrics }) {
  const errors =
    (metrics.outcome_counts.VALIDATION_ERROR ?? 0) +
    (metrics.outcome_counts.RATE_LIMITED ?? 0) +
    (metrics.outcome_counts.SYSTEM_ERROR ?? 0)
  return (
    <>
      {errors > 0 && (
        <Notice tone="warn" title={`${plural(errors, 'prompt')} got no verdict`}>
          The gateway returned an error, rejected the input, or asked us to slow down. These count as neither blocked nor
          bypassed, so the rates below are based on fewer answers. Filter the list by <strong>Errors</strong> to see why.
        </Notice>
      )}
      {metrics.skipped_prompts > 0 && (
        <Notice tone="info" title={`${plural(metrics.skipped_prompts, 'disguised prompt')} skipped`}>
          They were longer than the gateway accepts (2,000 characters), so they weren't sent.
        </Notice>
      )}
    </>
  )
}
