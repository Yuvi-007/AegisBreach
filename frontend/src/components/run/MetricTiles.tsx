import type { Metrics } from '../../api/types'
import { ms, pct } from '../../lib/format'
import { type Level, LEVEL_STYLE, levelFor, SCALES } from '../../lib/severity'
import { Chip, cx } from '../ui'

interface TileProps {
  label: string
  value: string
  level: Level | null
  /** 0..1, how full the meter is. */
  fill: number
  detail: string
  meaning: string
}

function Tile({ label, value, level, fill, detail, meaning }: TileProps) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        {level && <Chip className={LEVEL_STYLE[level].chip}>{LEVEL_STYLE[level].label}</Chip>}
      </div>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular">{value}</p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
      >
        <div
          className={cx('h-full rounded-full transition-[width] duration-700', level ? LEVEL_STYLE[level].bar : 'bg-line-strong')}
          style={{ width: `${Math.max(fill, level ? 0.015 : 0) * 100}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-ink">{detail}</p>
      <p className="mt-1 text-xs text-muted">{meaning}</p>
    </div>
  )
}

export function MetricTiles({ metrics }: { metrics: Metrics }) {
  const counts = metrics.outcome_counts
  const bypassed = counts.BYPASSED ?? 0
  const defended = counts.DEFENDED ?? 0
  const falseAlarms = counts.FALSE_POSITIVE ?? 0
  const hasAttacks = metrics.malicious_prompts > 0
  const hasBenign = metrics.benign_prompts > 0
  const latencyCeiling = SCALES.p95LatencyMs.warn * 1.5

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Attacks that got through"
        value={hasAttacks ? pct(metrics.bypass_rate) : '-'}
        level={hasAttacks ? levelFor(metrics.bypass_rate, SCALES.bypass) : null}
        fill={metrics.bypass_rate}
        detail={hasAttacks ? `${bypassed} of ${metrics.malicious_prompts} attack prompts` : 'No attack prompts in this run'}
        meaning="Bypass rate. The headline number: lower is better, 0% is the goal."
      />
      <Tile
        label="Attacks blocked"
        value={hasAttacks ? pct(metrics.defense_rate) : '-'}
        level={hasAttacks ? levelFor(metrics.defense_rate, SCALES.defense) : null}
        fill={metrics.defense_rate}
        detail={hasAttacks ? `${defended} of ${metrics.malicious_prompts} attack prompts` : 'No attack prompts in this run'}
        meaning="Defense rate. Higher is better. Errors count against it, since they got no verdict."
      />
      <Tile
        label="Everyday requests blocked"
        value={hasBenign ? pct(metrics.false_positive_rate) : '-'}
        level={hasBenign ? levelFor(metrics.false_positive_rate, SCALES.falseAlarm) : null}
        fill={metrics.false_positive_rate}
        detail={hasBenign ? `${falseAlarms} of ${metrics.benign_prompts} everyday requests` : 'No everyday requests in this run'}
        meaning="False alarm rate. Lower is better; every false alarm is a real user wrongly refused."
      />
      <Tile
        label="Response time"
        value={metrics.total_prompts ? ms(metrics.p95_latency_ms) : '-'}
        level={metrics.total_prompts ? levelFor(metrics.p95_latency_ms, SCALES.p95LatencyMs) : null}
        fill={Math.min(metrics.p95_latency_ms / latencyCeiling, 1)}
        detail={metrics.total_prompts ? `Average ${ms(metrics.avg_latency_ms)}` : 'No responses'}
        meaning="95% of prompts were answered within this time (p95). Lower is snappier."
      />
    </div>
  )
}
