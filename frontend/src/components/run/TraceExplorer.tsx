import { Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EvaluationResult, Outcome } from '../../api/types'
import { categoryLabel, mutatorTitle } from '../../lib/catalog'
import { ms } from '../../lib/format'
import { ERROR_OUTCOMES, OUTCOMES } from '../../lib/outcomes'
import { VisibleText } from '../VisibleText'
import { Button, Chip, cx, EmptyState } from '../ui'

type Filter = 'all' | 'BYPASSED' | 'DEFENDED' | 'FALSE_POSITIVE' | 'errors'

const PAGE_SIZE = 50
// Header and rows share these columns so the list reads as a table.
const COLUMNS = 'md:grid-cols-[7.5rem_5.5rem_8rem_minmax(0,1fr)_4.5rem]'

const FILTERS: { value: Filter; label: string; match: (o: Outcome) => boolean; optional?: boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'BYPASSED', label: 'Bypassed', match: (o) => o === 'BYPASSED' },
  { value: 'DEFENDED', label: 'Defended', match: (o) => o === 'DEFENDED' },
  { value: 'FALSE_POSITIVE', label: 'False positive', match: (o) => o === 'FALSE_POSITIVE', optional: true },
  { value: 'errors', label: 'Errors', match: (o) => ERROR_OUTCOMES.has(o), optional: true },
]

/** Searchable, filterable list of every prompt. Reports the visible order for prev/next in the drawer. */
export function TraceExplorer({
  results,
  onSelect,
}: {
  results: EvaluationResult[]
  onSelect: (index: number, visibleOrder: number[]) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match
    const q = query.trim().toLowerCase()
    return results
      .map((result, index) => ({ result, index }))
      .filter(
        ({ result }) =>
          match(result.outcome) &&
          (!q ||
            result.prompt.toLowerCase().includes(q) ||
            (result.original_seed_id ?? '').toLowerCase().includes(q) ||
            mutatorTitle(result.mutator).toLowerCase().includes(q)),
      )
  }, [results, filter, query])
  const order = visible.map((v) => v.index)

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by outcome" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count = results.filter((r) => f.match(r.outcome)).length
            if (f.optional && count === 0) return null
            const active = filter === f.value
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFilter(f.value)
                  setLimit(PAGE_SIZE)
                }}
                className={cx(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                  active ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-sunken',
                )}
              >
                {f.label}
                <span className={cx('text-xs tabular', active ? 'text-paper/70' : 'text-muted')}>{count}</span>
              </button>
            )
          })}
        </div>
        <label className="relative sm:w-64">
          <span className="sr-only">Search prompts</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            placeholder="Search"
            className="h-8 w-full rounded-md border border-line-strong bg-panel pl-8 pr-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={SearchX} title="No matching prompts" />
        </div>
      ) : (
        <>
          <div
            aria-hidden
            className={cx(
              'hidden gap-4 border-b border-line bg-sunken/50 px-4 py-2 text-xs font-medium text-muted md:grid',
              COLUMNS,
            )}
          >
            <span>Outcome</span>
            <span>ID</span>
            <span>Mutator</span>
            <span>Prompt sent</span>
            <span className="text-right">Time</span>
          </div>
          <ul className="divide-y divide-line">
            {visible.slice(0, limit).map(({ result, index }) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => onSelect(index, order)}
                  aria-label={`${OUTCOMES[result.outcome].label}: ${result.original_seed_id ?? 'prompt'}, ${mutatorTitle(result.mutator)}, ${categoryLabel(result.category)}, ${ms(result.latency_ms)}. Open details`}
                  className={cx(
                    'grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-sunken/60 md:gap-x-4',
                    COLUMNS,
                  )}
                >
                  <span>
                    <Chip className={OUTCOMES[result.outcome].badge}>{OUTCOMES[result.outcome].label}</Chip>
                  </span>
                  <span className="font-mono text-xs text-muted">{result.original_seed_id}</span>
                  <span className="truncate text-right text-ink-soft md:text-left">{mutatorTitle(result.mutator)}</span>
                  <span className="col-span-3 truncate font-mono text-[13px] text-ink md:col-span-1">
                    <VisibleText text={result.prompt} singleLine />
                  </span>
                  <span className="hidden text-right text-xs text-muted tabular md:block">{ms(result.latency_ms)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {visible.length > limit && (
        <div className="border-t border-line p-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Show more ({visible.length - limit} left)
          </Button>
        </div>
      )}
    </div>
  )
}
