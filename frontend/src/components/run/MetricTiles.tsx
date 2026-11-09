import type { Metrics } from '../../api/types'
import { ms, pct } from '../../lib/format'
import { type Level, levelFor, SCALES } from '../../lib/severity'
import { Chip, cx } from '../ui'

const LEVEL_TEXT: Record<Level, { label: string; className: string }> = {
  good: { label: 'Good', className: 'text-defended' },
  warn: { label: 'Fair', className: 'text-alarm' },
  bad: { label: 'Poor', className: 'text-bypassed' },
}

interface CardProps {
  label: string
  badge: string
  value: string
  sub: string
  level: Level | null
  hint: string
}

function StatCard({ label, badge, value, sub, level, hint }: CardProps) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4" title={hint}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Chip className={cx('whitespace-nowrap', badge)}>{label}</Chip>
        {level && <span className={cx('text-xs font-medium', LEVEL_TEXT[level].className)}>{LEVEL_TEXT[level].label}</span>}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  )
}

export function MetricTiles({ metrics }: { metrics: Metrics }) {
  const counts = metrics.outcome_counts
  const attacks = metrics.malicious_prompts
  const benign = metrics.benign_prompts

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Defense rate"
        badge="bg-defended-soft text-defended"
        value={attacks ? pct(metrics.defense_rate) : '-'}
        sub={attacks ? `${counts.DEFENDED ?? 0} of ${attacks} attacks blocked` : 'No attacks in this run'}
        level={attacks ? levelFor(metrics.defense_rate, SCALES.defense) : null}
        hint="Share of attack prompts the guard blocked. Higher is better."
      />
      <StatCard
        label="Bypass rate"
        badge="bg-bypassed-soft text-bypassed"
        value={attacks ? pct(metrics.bypass_rate) : '-'}
        sub={attacks ? `${counts.BYPASSED ?? 0} of ${attacks} attacks got through` : 'No attacks in this run'}
        level={attacks ? levelFor(metrics.bypass_rate, SCALES.bypass) : null}
        hint="Share of attack prompts that got through. Lower is better."
      />
      <StatCard
        label="False positive rate"
        badge="bg-alarm-soft text-alarm"
        value={benign ? pct(metrics.false_positive_rate) : '-'}
        sub={benign ? `${counts.FALSE_POSITIVE ?? 0} of ${benign} everyday blocked` : 'No everyday requests'}
        level={benign ? levelFor(metrics.false_positive_rate, SCALES.falseAlarm) : null}
        hint="Share of normal requests wrongly blocked. Lower is better."
      />
      <StatCard
        label="Latency p95"
        badge="bg-sunken text-ink-soft"
        value={metrics.total_prompts ? ms(metrics.p95_latency_ms) : '-'}
        sub={metrics.total_prompts ? `avg ${ms(metrics.avg_latency_ms)}` : 'No responses'}
        level={metrics.total_prompts ? levelFor(metrics.p95_latency_ms, SCALES.p95LatencyMs) : null}
        hint="95% of prompts were answered within this time."
      />
    </div>
  )
}
