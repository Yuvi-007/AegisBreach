import type { EvaluationResult, Outcome } from '../../api/types'
import { categoryLabel, mutatorTitle } from '../../lib/catalog'
import { OUTCOME_ORDER, OUTCOMES } from '../../lib/outcomes'
import { cx } from '../ui'

/**
 * Every prompt as one coloured square, attacks and everyday requests in separate
 * rows, so the shape of a run is visible at a glance. Keyboard users get the
 * same data from the prompt list below.
 */
export function OutcomeTape({
  results,
  onSelect,
}: {
  results: EvaluationResult[]
  onSelect: (index: number) => void
}) {
  const rows = [
    { title: 'Attack prompts', expected: 'block' as const },
    { title: 'Everyday requests', expected: 'allow' as const },
  ]
    .map((row) => ({
      ...row,
      items: results.map((result, index) => ({ result, index })).filter(({ result }) => result.expected_action === row.expected),
    }))
    .filter((row) => row.items.length > 0)

  const counts = new Map<Outcome, number>()
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1)

  return (
    <div className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Every prompt at a glance</h3>
        <p className="text-xs text-muted">One square per prompt. Click a square to see what happened.</p>
      </div>

      <div className="mt-4 space-y-4">
        {rows.map((row) => (
          <div key={row.title}>
            <p className="mb-1.5 text-xs font-medium text-muted">
              {row.title} <span className="tabular">({row.items.length})</span>
            </p>
            <div className="flex flex-wrap gap-[3px]" aria-hidden>
              {row.items.map(({ result, index }) => (
                <button
                  key={index}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSelect(index)}
                  title={`${result.original_seed_id ?? 'Prompt'} · ${mutatorTitle(result.mutator)} · ${categoryLabel(result.category)}: ${OUTCOMES[result.outcome].label}`}
                  className={cx(
                    'size-3.5 rounded-[3px] transition-transform hover:z-10 hover:scale-150 sm:size-4',
                    OUTCOMES[result.outcome].swatch,
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-ink-soft">
        {OUTCOME_ORDER.filter((o) => counts.has(o)).map((o) => (
          <li key={o} className="inline-flex items-center gap-1.5">
            <span className={cx('size-3 rounded-[3px]', OUTCOMES[o].swatch)} aria-hidden />
            {OUTCOMES[o].label} <span className="tabular text-muted">{counts.get(o)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
