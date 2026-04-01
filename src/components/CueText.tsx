import { useState } from 'react'

// ─── Tokenizer ────────────────────────────────────────────────────────────────

interface Token {
  value: string
  isWord: boolean
  clean: string  // lowercase, no surrounding punctuation
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = /([a-zA-Z][a-zA-Z']*[a-zA-Z]|[a-zA-Z])|([^a-zA-Z]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[0]
    const isWord = !!m[1]
    const clean = value.toLowerCase().replace(/^'+|'+$/g, '')
    tokens.push({ value, isWord, clean })
  }
  return tokens
}

// ─── CueText ──────────────────────────────────────────────────────────────────

export interface CueTextProps {
  text: string
  onWordClick?: (word: string) => void
  savedWords?: Set<string>
  /** Light-on-dark styling (overlay on black video background) */
  dark?: boolean
}

export function CueText({ text, onWordClick, savedWords, dark }: CueTextProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const tokens = tokenize(text)

  return (
    <>
      {tokens.map((token, i) => {
        if (!token.isWord) return <span key={i}>{token.value}</span>

        const isSaved = savedWords?.has(token.clean)
        const isHovered = hovered === token.clean

        return (
          <span
            key={i}
            onMouseEnter={() => onWordClick && setHovered(token.clean)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
              if (!onWordClick) return
              e.stopPropagation()
              onWordClick(token.clean)
            }}
            className={[
              onWordClick ? 'cursor-pointer rounded-sm px-0.5 -mx-0.5 transition-colors' : '',
              dark
                ? [
                    isSaved ? 'text-yellow-300 underline decoration-dotted underline-offset-2' : '',
                    isHovered ? 'bg-white/30 text-white scale-110' : onWordClick ? 'hover:bg-white/20 hover:text-yellow-200' : '',
                  ].filter(Boolean).join(' ')
                : [
                    isSaved ? 'text-primary/80 underline decoration-dotted underline-offset-2' : '',
                    isHovered ? 'bg-primary/15 text-primary' : onWordClick ? 'hover:bg-primary/10 hover:text-primary' : '',
                  ].filter(Boolean).join(' '),
            ].filter(Boolean).join(' ')}
          >
            {token.value}
          </span>
        )
      })}
    </>
  )
}
