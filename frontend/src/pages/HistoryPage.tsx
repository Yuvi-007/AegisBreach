import { ChevronRight, History, KeyRound, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { RunSummary } from '../api/types'
import { isActive, RunStatusBadge, targetLabel } from '../components/RunStatusBadge'
import { Button, cx, EmptyState, Notice, Skeleton } from '../components/ui'
import { useApiKey } from '../lib/apiKey'
import { mutatorTitle, SUITE_GUIDE } from '../lib/catalog'
import { pct, timeAgo } from '../lib/format'
import { hrefFor, navigate } from '../lib/router'
import { LEVEL_STYLE, levelFor, SCALES, type Scale } from '../lib/severity'
import { useResource } from '../lib/useResource'

export function HistoryPage() {
  const { apiKey, requestKey } = useApiKey()
  const [polling, setPolling] = useState(false)
  const runs = useResource((signal) => api.runs(apiKey, 50, signal), [apiKey], polling ? 2000 : null)
  const anyActive = runs.data?.some((r) => isActive(r.status)) ?? false

  useEffect(() => setPolling(anyActive), [anyActive])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
          <p className="mt-1 text-sm text-muted">Newest first. Cleared when the backend restarts.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'new' })}>
          New test
        </Button>
      </div>

      {runs.error?.isUnauthorized ? (
        <Notice
          tone="warn"
          title="An API key is needed to list runs"
          action={
            <Button size="sm" variant="primary" icon={KeyRound} onClick={requestKey}>
              Add API key
            </Button>
          }
        />
      ) : runs.error?.isOffline && !runs.data ? (
        <EmptyState icon={History} title="Runs will appear here once the backend is running" />
      ) : runs.error && !runs.data ? (
        <Notice
          tone="error"
          title="Couldn't load runs"
          action={
            <Button size="sm" onClick={runs.reload}>
              Retry
            </Button>
          }
        >
          {runs.error.message}
        </Notice>
      ) : !runs.data ? (
        <div className="space-y-2" aria-label="Loading runs">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : runs.data.length === 0 ? (
        <EmptyState
          icon={History}
          title="No runs yet"
          action={
            <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'new' })}>
              Start your first test
            </Button>
          }
        >
          Start a test and it will show up here, with its results.
        </EmptyState>
      ) : (
        <RunList runs={runs.data} />
      )}
    </div>
  )
}

function RunList({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="hidden grid-cols-[8rem_1fr_7rem_7rem_7rem_1.5rem] gap-4 border-b border-line bg-sunken/60 px-5 py-2.5 text-xs font-medium text-muted lg:grid">
        <span>Status</span>
        <span>Test</span>
        <span className="text-right">Got through</span>
        <span className="text-right">Blocked</span>
        <span className="text-right">False alarms</span>
        <span />
      </div>
      <ul className="divide-y divide-line">
        {runs.map((run) => (
          <li key={run.run_id}>
            <a
              href={hrefFor({ page: 'run', runId: run.run_id })}
              className={cx(
                'group grid gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-sunken/60',
                'grid-cols-[1fr_auto] lg:grid-cols-[8rem_1fr_7rem_7rem_7rem_1.5rem] lg:items-center',
              )}
            >
              <span className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
              </span>
              <span className="col-span-2 min-w-0 lg:col-span-1">
                <span className="block truncate font-medium">
                  {run.suite_names.map((s) => SUITE_GUIDE[s]?.title ?? s).join(' + ')}
                  {run.mutator_names.length > 0 && (
                    <span className="font-normal text-muted">
                      {' '}
                      with {run.mutator_names.length === 1 ? mutatorTitle(run.mutator_names[0]) : `${run.mutator_names.length} disguises`}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {targetLabel(run)} · {timeAgo(run.created_at)} · <span className="font-mono">{run.run_id.slice(0, 8)}</span>
                </span>
              </span>
              <Rate value={run.metrics?.malicious_prompts ? run.metrics.bypass_rate : null} scale={SCALES.bypass} label="Got through" />
              <Rate value={run.metrics?.malicious_prompts ? run.metrics.defense_rate : null} scale={SCALES.defense} label="Blocked" />
              <Rate
                value={run.metrics?.benign_prompts ? run.metrics.false_positive_rate : null}
                scale={SCALES.falseAlarm}
                label="False alarms"
              />
              <ChevronRight
                className="hidden size-4 text-muted transition-transform group-hover:translate-x-0.5 lg:block"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Rate({ value, scale, label }: { value: number | null; scale: Scale; label: string }) {
  if (value === null) {
    return (
      <span className="text-sm text-muted lg:text-right">
        <span className="lg:hidden">{label}: </span>-
      </span>
    )
  }
  const level = levelFor(value, scale)
  return (
    <span className="text-sm lg:text-right">
      <span className="text-muted lg:hidden">{label}: </span>
      <span className={cx('rounded-md px-1.5 py-0.5 font-semibold tabular', LEVEL_STYLE[level].chip)}>{pct(value)}</span>
    </span>
  )
}
