import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { EvaluationResult } from '../../api/types'
import { categoryLabel, mutatorTitle, ORIGINAL } from '../../lib/catalog'
import { ms } from '../../lib/format'
import { OUTCOMES } from '../../lib/outcomes'
import { HiddenTrickLegend, VisibleText } from '../VisibleText'
import { Button, Chip, cx, Dialog } from '../ui'

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function targetMeta(result: EvaluationResult): Record<string, unknown> {
  const meta = result.details.target_metadata
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
}

/** Slide-over drawer: verdict, original vs sent prompt, gateway reply, facts. */
export function TraceDetail({
  results,
  index,
  order,
  onNavigate,
  onClose,
}: {
  results: EvaluationResult[]
  index: number | null
  order: number[]
  onNavigate: (index: number) => void
  onClose: () => void
}) {
  const result = index === null ? undefined : results[index]
  const position = index === null ? -1 : order.indexOf(index)

  return (
    <Dialog
      open={result !== undefined}
      onClose={onClose}
      side
      title={result ? `${result.original_seed_id ?? 'Prompt'} · ${mutatorTitle(result.mutator)}` : ''}
      description={result ? categoryLabel(result.category) : undefined}
    >
      {result && (
        <div className="space-y-6">
          <TraceBody result={result} results={results} />
          {order.length > 1 && position !== -1 && (
            <div className="flex items-center justify-between border-t border-line pt-4">
              <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={position <= 0} onClick={() => onNavigate(order[position - 1])}>
                Previous
              </Button>
              <span className="text-xs text-muted tabular">
                {position + 1} / {order.length}
              </span>
              <Button size="sm" variant="ghost" disabled={position >= order.length - 1} onClick={() => onNavigate(order[position + 1])}>
                Next
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function TraceBody({ result, results }: { result: EvaluationResult; results: EvaluationResult[] }) {
  const meta = OUTCOMES[result.outcome]
  const target = targetMeta(result)
  const disguised = (result.mutator ?? ORIGINAL) !== ORIGINAL
  const original = disguised
    ? results.find((r) => r.original_seed_id === result.original_seed_id && (r.mutator ?? ORIGINAL) === ORIGINAL)
    : undefined
  const reply =
    text(result.details.refusal_phrase) ?? text(target.reply) ?? text(result.details.message) ?? text(result.details.reason)

  const facts: [string, string][] = [
    ['Expected', result.expected_action === 'block' ? 'Block' : 'Allow'],
    ['Gateway verdict', text(target.verdict) ?? (result.outcome === 'DEFENDED' || result.outcome === 'FALSE_POSITIVE' ? 'Blocked' : 'Not blocked')],
    ['Response time', ms(result.latency_ms)],
    ['HTTP status', result.status_code === 0 ? 'No response' : String(result.status_code)],
  ]
  const optional: [string, unknown][] = [
    ['Threat category', target.threat_category],
    ['Confidence', typeof target.confidence === 'number' ? `${Math.round(target.confidence * 100)}%` : undefined],
    ['Decided by', target.rail_path],
    ['Matched phrase', target.matched_term],
    ['Error', text(result.details.error) ?? text(target.error)],
  ]
  for (const [label, value] of optional) {
    const v = text(value)
    if (v) facts.push([label, v])
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Chip className={cx('px-2.5 py-1 text-sm', meta.badge)}>{meta.label}</Chip>
        <p className="text-sm text-ink-soft">{meta.meaning}</p>
      </div>

      {disguised ? (
        <div className="space-y-3">
          <PromptBlock label="Original" value={original?.prompt} muted />
          <PromptBlock label={`Sent · ${mutatorTitle(result.mutator)}`} value={result.prompt} />
        </div>
      ) : (
        <PromptBlock label="Prompt" value={result.prompt} />
      )}
      {result.details.truncated === true && (
        <p className="-mt-3 text-xs text-alarm">Cut short to fit the gateway's length limit.</p>
      )}

      <Section label="Gateway reply">
        <p className={cx('whitespace-pre-wrap break-words text-sm', !reply && 'text-muted')}>{reply ?? 'No reply text recorded.'}</p>
      </Section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</h3>
        {aside}
      </div>
      <div className="rounded-lg border border-line bg-paper/60 px-3 py-2.5">{children}</div>
    </section>
  )
}

function PromptBlock({ label, value, muted = false }: { label: string; value?: string; muted?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Section
      label={label}
      aside={
        value && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // Clipboard blocked; nothing useful to do.
              }
            }}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )
      }
    >
      {value ? (
        <>
          <p className={cx('font-mono text-[13px] leading-relaxed', muted && 'text-ink-soft')}>
            <VisibleText text={value} />
          </p>
          <HiddenTrickLegend text={value} />
        </>
      ) : (
        <p className="text-sm text-muted">Not part of this run.</p>
      )}
    </Section>
  )
}
