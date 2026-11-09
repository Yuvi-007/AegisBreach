import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import type { RunStatus, RunSummary } from '../api/types'
import { cx } from './ui'

const STATUS = {
  QUEUED: { label: 'Queued', icon: Clock, className: 'bg-sunken text-ink-soft', spin: false },
  RUNNING: { label: 'Running', icon: Loader2, className: 'bg-accent-soft text-accent', spin: true },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, className: 'bg-defended-soft text-defended', spin: false },
  FAILED: { label: 'Failed', icon: XCircle, className: 'bg-bypassed-soft text-bypassed', spin: false },
} satisfies Record<RunStatus, unknown>

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const { label, icon: Icon, className: tone, spin } = STATUS[status]
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', tone, className)}
    >
      <Icon className={cx('size-3.5', spin && 'animate-spin')} aria-hidden />
      {label}
    </span>
  )
}

export function isActive(status: RunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING'
}

export function targetLabel(run: Pick<RunSummary, 'target_type' | 'target_url'>): string {
  if (run.target_type === 'mock') return 'Practice gateway'
  try {
    return new URL(run.target_url).host
  } catch {
    return run.target_url
  }
}
