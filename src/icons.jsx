// Stroke-based service icon set — matches the GearSVG/WrenchSVG mechanical
// style. All icons use currentColor so callers control color via CSS.

export function IconWrench({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <g transform="rotate(45 14 14)">
        <rect x="11" y="2"  width="6" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
        <rect x="12.5" y="8" width="3" height="12" fill="currentColor"/>
        <rect x="11" y="19" width="6" height="7" rx="2" stroke="currentColor" strokeWidth="2"/>
      </g>
    </svg>
  )
}

export function IconUpgrade({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M6 19l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 25l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
    </svg>
  )
}

export function IconGauge({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 19a9 9 0 1 1 18 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="14" y1="19" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="14" cy="19" r="1.8" fill="currentColor"/>
      <line x1="6" y1="23" x2="22" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export function IconWash({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 4 C18 9 21 13 21 16.5 A7 7 0 0 1 14 24 A7 7 0 0 1 7 16.5 C7 13 10 9 14 4 Z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M21 6.5l1.6 1.6M21 10l1.6-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}

export function IconPickup({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M3 17h14l2-5h3a2 2 0 0 1 2 2v3h-2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      <path d="M3 17v-6h9l3 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx="8"  cy="20" r="2.2" fill="currentColor"/>
      <circle cx="19" cy="20" r="2.2" fill="currentColor"/>
    </svg>
  )
}

export function IconRescue({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <line x1="6"  y1="3"  x2="12" y2="3"  stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="6"  y1="25" x2="22" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="9"  y1="13" x2="9"  y2="25" stroke="currentColor" strokeWidth="2"/>
      <line x1="19" y1="13" x2="19" y2="25" stroke="currentColor" strokeWidth="2"/>
      <path d="M9 4v9a5 5 0 0 0 10 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="19" cy="11" r="2.4" stroke="currentColor" strokeWidth="2"/>
    </svg>
  )
}

export function IconFlag({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M6 4h16v12H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none"/>
      <rect x="6"  y="4"  width="4" height="4" fill="currentColor"/>
      <rect x="14" y="4"  width="4" height="4" fill="currentColor"/>
      <rect x="10" y="8"  width="4" height="4" fill="currentColor"/>
      <rect x="18" y="8"  width="4" height="4" fill="currentColor"/>
      <rect x="6"  y="12" width="4" height="4" fill="currentColor"/>
      <rect x="14" y="12" width="4" height="4" fill="currentColor"/>
    </svg>
  )
}

export function IconCash({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
    </svg>
  )
}

export function IconCamera({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8"/>
    </svg>
  )
}

export function IconStar({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 3.5l3.1 6.5 7.1.9-5.2 4.9 1.4 7-6.4-3.5-6.4 3.5 1.4-7-5.2-4.9 7.1-.9z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}
