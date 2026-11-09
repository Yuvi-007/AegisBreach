import type { EvaluationResult } from '../../api/types'
import { pct } from '../../lib/format'
import { LEVEL_STYLE, levelFor, SCALES } from '../../lib/severity'
import { cx } from '../ui'

export interface BreakdownRow {
  key: string
  label: string
  bypassed: number
  total: number
}

/** Bypass rate of attack prompts, grouped by any key (disguise, attack type...). */
export function bypassBy(
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

export function Breakdown({ title, hint, rows }: { title: string; hint: string; rows: BreakdownRow[] }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const rate = row.total ? row.bypassed / row.total : 0
          const level = levelFor(rate, SCALES.bypass)
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 tabular">
                  <span className="font-semibold">{pct(rate)}</span>{' '}
                  <span className="text-xs text-muted">
                    ({row.bypassed}/{row.total})
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                <div
                  className={cx('h-full rounded-full transition-[width] duration-700', LEVEL_STYLE[level].bar)}
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
