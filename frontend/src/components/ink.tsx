import type { ReactNode } from 'react'

/**
 * Hand-drawn "ink" look: shared SVG filters plus a set of sketched character portraits.
 * The filters are mounted once (InkDefs) and referenced from CSS as url(#ink-rough) etc.
 */
export function InkDefs() {
  return (
    <svg className="ink-defs" aria-hidden="true" focusable="false">
      <defs>
        {/* gentle wobble for lines and small shapes */}
        <filter id="ink-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* torn paper edge for bubbles and frames */}
        <filter id="ink-torn" x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022 0.06" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.04 0.7" numOctaves="2" seed="2" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.07  0 0 0 0 0.03  0 0 0 -3.4 1.8" result="scratch" />
          {/* hatching only in a band along the edge, so the middle stays clean for text */}
          <feMorphology in="d" operator="erode" radius="11" result="inner" />
          <feGaussianBlur in="inner" stdDeviation="5" result="innerSoft" />
          <feComposite in="scratch" in2="d" operator="in" result="scratchIn" />
          <feComposite in="scratchIn" in2="innerSoft" operator="out" result="edge" />
          <feMerge>
            <feMergeNode in="d" />
            <feMergeNode in="edge" />
          </feMerge>
        </filter>
        {/* sketchy chalk line for frame borders */}
        <filter id="ink-chalk" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="5" result="g" />
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2 1.5" result="mask" />
          <feComposite in="d" in2="mask" operator="in" />
        </filter>
        {/* sticker: wobbly lines plus a cream cut-out outline around the whole drawing */}
        <filter id="ink-sticker" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="art" />
          <feMorphology in="SourceAlpha" operator="dilate" radius="3.2" result="fat" />
          <feDisplacementMap in="fat" in2="n" scale="3" xChannelSelector="G" yChannelSelector="R" result="fatd" />
          <feFlood style={{ floodColor: 'var(--sticker, #efe6d3)' }} result="c" />
          <feComposite in="c" in2="fatd" operator="in" result="outline" />
          <feMerge>
            <feMergeNode in="outline" />
            <feMergeNode in="art" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  )
}

const INK = '#16120f'
const SKIN = '#f1e5d0'
const S = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
const L = { ...S, fill: 'none' }

const pirate = (
  <>
    <path d="M26 48C19 62 17 74 21 87M32 58C28 70 28 80 31 91M74 48C81 62 83 74 79 87M68 58C72 70 72 80 69 91" {...L} strokeWidth={4.2} />
    <path d="M28 44C28 67 36 83 50 83C64 83 72 67 72 44Z" fill="#c99a74" {...S} />
    <path d="M24 47C23 25 37 15 50 15C64 15 77 25 76 47C66 40 34 40 24 47Z" fill="#b3302a" {...S} />
    <path d="M73 39L88 49L79 53Z" fill="#b3302a" {...S} />
    <path d="M33 25C40 22 46 22 50 23M58 22C63 23 67 25 70 28" {...L} stroke="#7d1d18" strokeWidth={1.6} />
    <path d="M27 43L72 59" {...L} strokeWidth={1.8} />
    <ellipse cx="40" cy="54" rx="8.5" ry="7" fill={INK} />
    <path d="M55 51q5-3 11 0" {...L} />
    <circle cx="61" cy="56.5" r="2.2" fill={INK} />
    <path d="M50 56q-4 8 1 10" {...L} />
    <path d="M37 71q13-6 26 0q-13 5-26 0Z" fill={INK} {...S} strokeWidth={1.4} />
    <path d="M44 75q6 10 12 0Z" fill={INK} />
  </>
)

const lady = (
  <>
    <circle cx="50" cy="15" r="9" fill="#1a1613" {...S} />
    <path d="M23 52C20 27 35 19 50 19C66 19 80 28 77 52C72 40 62 33 50 33C39 33 29 39 23 52Z" fill="#1a1613" {...S} />
    <path d="M42 84V97M58 84V97" {...L} />
    <path d="M26 46C26 71 38 86 50 86C62 86 74 71 74 46C67 34 33 34 26 46Z" fill={SKIN} {...S} />
    <path d="M27 46C33 30 56 27 73 42C62 36 47 37 36 47C32 44 30 45 27 46Z" fill="#1a1613" />
    <path d="M33 49q7-4 13-1M54 48q7-3 13 1" {...L} strokeWidth={2.2} />
    <path d="M34 56q6-5 12 0q-6 4-12 0ZM54 56q6-5 12 0q-6 4-12 0Z" fill="#fff" {...S} strokeWidth={1.8} />
    <circle cx="41" cy="55.8" r="2.6" fill={INK} />
    <circle cx="60" cy="55.8" r="2.6" fill={INK} />
    <path d="M51 59q-2 6 1 8" {...L} strokeWidth={1.8} />
    <path d="M44 73q6-3 12 0q-6 5-12 0Z" fill="#b3302a" {...S} strokeWidth={1.6} />
    <circle cx="25" cy="64" r="3.4" fill="#3c5da6" {...S} strokeWidth={1.6} />
    <circle cx="75" cy="64" r="3.4" fill="#3c5da6" {...S} strokeWidth={1.6} />
  </>
)

const rabbit = (
  <>
    <path d="M33 41C19 22 19 6 29 6C39 6 43 24 43 38Z" fill="#f5ede3" {...S} />
    <path d="M67 41C81 22 81 6 71 6C61 6 57 24 57 38Z" fill="#f5ede3" {...S} />
    <path d="M32 34C25 22 26 13 29.5 13C34 13 37 24 38 33ZM68 34C75 22 74 13 70.5 13C66 13 63 24 62 33Z" fill="#e7a3ad" />
    <ellipse cx="50" cy="61" rx="31" ry="26" fill="#f5ede3" {...S} />
    <ellipse cx="32" cy="68" rx="5.5" ry="3.2" fill="#e7a3ad" opacity="0.85" />
    <ellipse cx="68" cy="68" rx="5.5" ry="3.2" fill="#e7a3ad" opacity="0.85" />
    <circle cx="39" cy="58" r="4.3" fill={INK} />
    <circle cx="61" cy="58" r="4.3" fill={INK} />
    <circle cx="40.6" cy="56.4" r="1.4" fill="#fff" />
    <circle cx="62.6" cy="56.4" r="1.4" fill="#fff" />
    <path d="M47 64.5h6l-3 3.2Z" fill={INK} {...S} strokeWidth={1.4} />
    <path d="M44 70q3 3.4 6 0q3 3.4 6 0" {...L} strokeWidth={2} />
  </>
)

const gentleman = (
  <>
    <path d="M30 50C30 73 40 87 52 87C64 87 72 73 72 50Z" fill={SKIN} {...S} />
    <path d="M30 50C30 58 31 63 34 66L37 50Z" fill="#1a1613" />
    <ellipse cx="51" cy="47" rx="33" ry="7.5" fill="#1a1613" {...S} />
    <path d="M34 46L36 11C44 7.5 58 7.5 66 11L68 46Z" fill="#1a1613" {...S} />
    <path d="M35.6 33L67 33L67.6 41L35.2 41Z" fill="#8e2a24" />
    <path d="M37 54l11 2.4M67 54l-11 2.4" {...L} strokeWidth={2.4} />
    <path d="M38 60q5-3 10 0M56 60q5-3 10 0" {...L} strokeWidth={2} />
    <circle cx="43" cy="60.4" r="1.9" fill={INK} />
    <circle cx="61" cy="60.4" r="1.9" fill={INK} />
    <path d="M53 61l-3 9h4" {...L} strokeWidth={2} />
    <path d="M45 77q7 2.5 12-2" {...L} />
    <g transform="rotate(13 77 78)">
      <rect x="67" y="64" width="20" height="28" rx="2" fill="#e2a52f" {...S} />
      <path d="M77 70c-6 6-8 9-4 12c2 1 3 0 4-1c1 1 2 2 4 1c4-3 2-6-4-12ZM77 81l-2.4 5h4.8Z" fill={INK} />
    </g>
  </>
)

const hooded = (
  <>
    <path d="M13 86C9 40 28 9 50 9C72 9 91 40 87 86C76 94 24 94 13 86Z" fill="#2a2321" {...S} />
    <path d="M22 80C22 44 34 22 50 22C66 22 78 44 78 80" fill="none" stroke="#0e0c0b" strokeWidth={5} opacity={0.6} />
    <path d="M32 50C32 75 42 87 50 87C58 87 68 75 68 50C60 40 40 40 32 50Z" fill={SKIN} {...S} />
    <path d="M27 66C29 40 44 31 60 33C71 37 74 50 73 60C65 50 52 52 40 61C35 64 31 66 27 66Z" fill="#14110f" />
    <path d="M55 66q3 5-1 7" {...L} strokeWidth={1.8} />
    <path d="M45 78q5.5-3.4 11 0q-5.5 4.6-11 0Z" fill="#b3302a" {...S} strokeWidth={1.6} />
  </>
)

const scholar = (
  <>
    <path d="M27 50C27 30 36 24 50 24C64 24 73 30 73 50C73 72 64 84 50 84C36 84 27 72 27 50Z" fill={SKIN} {...S} />
    <path d="M27 50C22 46 22 36 28 32M73 50C78 46 78 36 72 32" {...L} stroke="#cfc6b6" strokeWidth={5} />
    <path d="M33 44q6-4 12-1M55 43q6-3 12 1" {...L} stroke="#9a9184" strokeWidth={3.4} />
    <circle cx="40" cy="53" r="7.5" fill="#fff" fillOpacity={0.35} {...S} />
    <circle cx="60" cy="53" r="7.5" fill="#fff" fillOpacity={0.35} {...S} />
    <path d="M47.5 53h5" {...L} />
    <circle cx="40" cy="53.5" r="2" fill={INK} />
    <circle cx="60" cy="53.5" r="2" fill={INK} />
    <path d="M29 62C31 87 44 96 50 96C56 96 69 87 71 62C64 71 57 73 50 73C43 73 36 71 29 62Z" fill="#ece5d8" {...S} />
    <path d="M39 69q11-7 22 0q-11 3.6-22 0Z" fill="#ece5d8" {...S} strokeWidth={2} />
    <path d="M44 80q6 3 12 0M42 87q8 3 16 0" {...L} stroke="#a59b8c" strokeWidth={1.4} />
  </>
)

const cat = (
  <>
    <path d="M23 46L27 13L47 31Z" fill="#221d1a" {...S} />
    <path d="M77 46L73 13L53 31Z" fill="#221d1a" {...S} />
    <path d="M28 36L30 21L40 30ZM72 36L70 21L60 30Z" fill="#c97f8a" />
    <ellipse cx="50" cy="58" rx="30" ry="26" fill="#221d1a" {...S} />
    <ellipse cx="38" cy="55" rx="7" ry="6" fill="#e8c547" {...S} strokeWidth={1.8} />
    <ellipse cx="62" cy="55" rx="7" ry="6" fill="#e8c547" {...S} strokeWidth={1.8} />
    <ellipse cx="38" cy="55" rx="1.8" ry="4.6" fill={INK} />
    <ellipse cx="62" cy="55" rx="1.8" ry="4.6" fill={INK} />
    <path d="M47 66h6l-3 3Z" fill="#e7a3ad" />
    <path d="M44 72q3 3 6 0q3 3 6 0" {...L} stroke="#d9ccb4" strokeWidth={1.8} />
    <path d="M30 66L12 63M30 70L13 73M70 66L88 63M70 70L87 73" {...L} stroke="#d9ccb4" strokeWidth={1.4} />
  </>
)

const kid = (
  <>
    <ellipse cx="27" cy="62" rx="4.5" ry="6.5" fill={SKIN} {...S} />
    <ellipse cx="73" cy="62" rx="4.5" ry="6.5" fill={SKIN} {...S} />
    <path d="M28 48C28 73 38 87 50 87C62 87 72 73 72 48Z" fill={SKIN} {...S} />
    <path d="M23 50C21 27 36 17 50 17C66 17 81 27 77 47Z" fill="#5b6c4b" {...S} />
    <circle cx="50" cy="18" r="3" fill="#3e4a33" {...S} strokeWidth={1.6} />
    <path d="M23 49C36 42 52 42 64 46C55 53 36 54 23 49Z" fill="#3e4a33" {...S} />
    <path d="M30 22C40 30 44 38 44 44M50 18V43M70 24C60 30 56 38 56 44" {...L} stroke="#3e4a33" strokeWidth={1.4} />
    <circle cx="40" cy="61" r="3.3" fill={INK} />
    <circle cx="60" cy="61" r="3.3" fill={INK} />
    <circle cx="41" cy="60" r="1" fill="#fff" />
    <circle cx="61" cy="60" r="1" fill="#fff" />
    <path d="M33 68h.1M36 70h.1M35 66h.1M67 68h.1M64 70h.1M65 66h.1" {...L} stroke="#b07850" strokeWidth={2.4} />
    <path d="M42 74q8 9 16 0Z" fill="#fff" {...S} strokeWidth={2} />
  </>
)

const detective = (
  <>
    <path d="M28 50C28 30 38 22 50 22C62 22 72 30 72 50L75 88C69 83 64 91 58 86C52 91 48 84 42 89C36 84 31 91 25 86Z" fill="#f4efe6" {...S} />
    <path d="M27 37C27 18 39 9 50 9C62 9 73 18 73 37C62 32 38 32 27 37Z" fill="#7a4a34" {...S} />
    <path d="M36 18L40 34M50 10V33M63 16L60 34M29 28C42 24 58 24 72 28" {...L} stroke="#4a2c20" strokeWidth={1.3} />
    <path d="M62 35C70 32 81 34 84 39C75 41 67 39 62 35Z" fill="#62392a" {...S} strokeWidth={2} />
    <path d="M49 10L45 3L55 6Z" fill="#7a4a34" {...S} strokeWidth={1.8} />
    <ellipse cx="42" cy="50" rx="2.5" ry="3.4" fill={INK} />
    <ellipse cx="57" cy="50" rx="2.5" ry="3.4" fill={INK} />
    <path d="M50 61C43 64 37 63 33 66" {...L} strokeWidth={3.2} />
    <path d="M22 61h11v8c0 5-11 5-11 0Z" fill="#3a2a22" {...S} strokeWidth={2} />
  </>
)

const CAST: ReactNode[] = [pirate, lady, rabbit, gentleman, hooded, cat, scholar, kid]

/** A sketched character portrait. `index` picks a character; 'host' is the detective ghost. */
export function Portrait({ index, size = 56, className = '', title }: { index: number | 'host'; size?: number; className?: string; title?: string }) {
  const art = index === 'host' ? detective : CAST[((index % CAST.length) + CAST.length) % CAST.length]
  return (
    <svg className={`portrait ${className}`} width={size} height={size} viewBox="-6 -6 112 112" role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <g filter="url(#ink-sticker)">{art}</g>
    </svg>
  )
}

/** Story text with quoted speech picked out, like dialogue in a picture book. */
export function Narration({ text }: { text: string }) {
  const parts = text.split(/(“[^”]*”|「[^」]*」|"[^"\n]*")/g)
  return <>{parts.map((part, i) => (i % 2 ? <span key={i} className="quote">{part}</span> : part))}</>
}
