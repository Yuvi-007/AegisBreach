import type { ReactNode } from 'react'
import { inspectText, isLookalike, isZeroWidth } from '../lib/preview'
import { cx } from './ui'

/**
 * Renders a prompt so its hidden tricks are visible: invisible characters show
 * as amber ticks and look-alike (Cyrillic) letters are tinted red.
 */
export function VisibleText({
  text,
  className,
  singleLine = false,
}: {
  text: string
  className?: string
  /** For truncated table cells: no wrapping, newlines collapse to spaces. */
  singleLine?: boolean
}) {
  const parts: ReactNode[] = []
  let plain = ''
  let key = 0
  const flush = () => {
    if (plain) parts.push(plain)
    plain = ''
  }

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (isZeroWidth(code)) {
      flush()
      parts.push(
        <span
          key={key++}
          title="Invisible character"
          className="mx-px inline-block h-[0.95em] w-[3px] translate-y-[0.12em] rounded-sm bg-alarm/80"
        />,
      )
    } else if (isLookalike(code)) {
      flush()
      parts.push(
        <span
          key={key++}
          title="Look-alike letter (Cyrillic)"
          className="rounded-[3px] bg-bypassed-soft text-bypassed underline decoration-bypassed/50 decoration-dotted underline-offset-2"
        >
          {char}
        </span>,
      )
    } else {
      plain += char
    }
  }
  flush()

  // wrap-anywhere (not break-words) so long unbroken strings like base64 can't
  // force their container wider than the screen.
  return (
    <span className={cx(singleLine ? 'whitespace-nowrap' : 'whitespace-pre-wrap wrap-anywhere', className)}>{parts}</span>
  )
}

/** Legend explaining the markers, shown only when the text actually contains them. */
export function HiddenTrickLegend({ text }: { text: string }) {
  const { zeroWidth, lookalikes } = inspectText(text)
  if (!zeroWidth && !lookalikes) return null
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {zeroWidth > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-[3px] rounded-sm bg-alarm/80" aria-hidden />
          {zeroWidth} invisible character{zeroWidth === 1 ? '' : 's'}
        </span>
      )}
      {lookalikes > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-[3px] bg-bypassed-soft px-1 text-bypassed" aria-hidden>
            a
          </span>
          {lookalikes} look-alike letter{lookalikes === 1 ? '' : 's'}
        </span>
      )}
    </p>
  )
}
