import type { EvaluationResult, Outcome } from '../../api/types'
import { categoryLabel, mutatorTitle } from '../../lib/catalog'
import { OUTCOME_ORDER, OUTCOMES } from '../../lib/outcomes'
import { cx } from '../ui'

/**
 * One square per prompt, attacks and everyday requests in separate rows.
 * Mouse shortcut only; keyboard users get the same data from the trace table.
 */
export function OutcomeTape({
  results,
  onSelect,
}: {
  results: EvaluationResult[]
  onSelect: (index: number) => void
}) {
  const rows = [
    { title: 'Attacks', expected: 'block' as const },
    { title: 'Everyday', expected: 'allow' as const },
  ]
    .map((row) => ({
      ...row,
      items: results.map((result, index) => ({ result, index })).filter(({ result }) => result.expected_action === row.expected),
    }))
    .filter((row) => row.items.length > 0)

  const counts = new Map<Outcome, number>()
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1)

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold">Every prompt</h3>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {OUTCOME_ORDER.filter((o) => counts.has(o)).map((o) => (
            <li key={o} className="inline-flex items-center gap-1">
              <span className={cx('size-2.5 rounded-[2px]', OUTCOMES[o].swatch)} aria-hidden />
              {OUTCOMES[o].label} <span className="tabular">{counts.get(o)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 space-y-3">
        {rows.map((row) => (
          <div key={row.title}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{row.title}</p>
            <div className="flex flex-wrap gap-[3px]" aria-hidden>
              {row.items.map(({ result, index }) => (
                <button
                  key={index}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSelect(index)}
                  title={`${result.original_seed_id ?? 'Prompt'} · ${mutatorTitle(result.mutator)} · ${categoryLabel(result.category)}: ${OUTCOMES[result.outcome].label}`}
                  className={cx(
                    'size-3 rounded-[2px] transition-transform hover:z-10 hover:scale-150 sm:size-3.5',
                    OUTCOMES[result.outcome].swatch,
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
