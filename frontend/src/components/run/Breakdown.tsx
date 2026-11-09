import { useState } from 'react'
import type { EvaluationResult } from '../../api/types'
import { categoryLabel, mutatorTitle, ORIGINAL } from '../../lib/catalog'
import { pct } from '../../lib/format'
import { LEVEL_STYLE, levelFor, SCALES } from '../../lib/severity'
import { cx } from '../ui'

interface BreakdownRow {
  key: string
  label: string
  bypassed: number
  total: number
}

/** Bypass rate of attack prompts, grouped by any key. Worst first. */
function bypassBy(
  results: EvaluationResult[],
  keyOf: (r: EvaluationResult) => string,
  labelOf: (key: string) => string,
): BreakdownRow[] {
  const groups = new Map<string, BreakdownRow>()
  for (const r of results) {
    if (r.expected_action !== 'block') continue
    const key = keyOf(r)
    const row = groups.get(key) ?? { key, label: labelOf(key), bypassed: 0, total: 0 }
    row.total += 1
    if (r.outcome === 'BYPASSED') row.bypassed += 1
    groups.set(key, row)
  }
  return [...groups.values()].sort((a, b) => b.bypassed / b.total - a.bypassed / a.total || a.label.localeCompare(b.label))
}

type GroupBy = 'mutator' | 'category'

/** "Bypass rate by mutator / attack type", switchable. Renders nothing without attacks. */
export function BypassBreakdown({ results, hasMutators }: { results: EvaluationResult[]; hasMutators: boolean }) {
  const [groupBy, setGroupBy] = useState<GroupBy>(hasMutators ? 'mutator' : 'category')
  const rows =
    groupBy === 'mutator'
      ? bypassBy(results, (r) => r.mutator ?? ORIGINAL, mutatorTitle)
      : bypassBy(results, (r) => r.category ?? 'unknown', categoryLabel)
  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Bypass rate by</h3>
        {hasMutators ? (
          <div role="group" aria-label="Group by" className="inline-flex rounded-md border border-line bg-sunken/70 p-0.5 text-xs">
            {(['mutator', 'category'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={groupBy === option}
                onClick={() => setGroupBy(option)}
                className={cx(
                  'h-6 rounded px-2 font-medium',
                  groupBy === option ? 'bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-ink',
                )}
              >
                {option === 'mutator' ? 'Mutator' : 'Attack type'}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted">Attack type</span>
        )}
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((row) => {
          const rate = row.bypassed / row.total
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 tabular">
                  <span className="font-medium">{pct(rate)}</span>{' '}
                  <span className="text-xs text-muted">
                    {row.bypassed}/{row.total}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className={cx('h-full rounded-full', LEVEL_STYLE[levelFor(rate, SCALES.bypass)].bar)}
                  style={{ width: `${Math.max(rate, 0.01) * 100}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
