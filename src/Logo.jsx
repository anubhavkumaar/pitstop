// Pit Stop brand marks — pure SVG, recolorable via CSS vars.

export function PitStopBadge({ size = 96, title = 'Pit Stop' }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title} className="ps-badge">
      <defs>
        <linearGradient id="psRing" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD84D"/>
          <stop offset="1" stopColor="#F5C518"/>
        </linearGradient>
        <radialGradient id="psCore" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#1C1F26"/>
          <stop offset="1" stopColor="#0B0B0F"/>
        </radialGradient>
      </defs>

      {/* outer ring */}
      <circle cx="60" cy="60" r="56" fill="none" stroke="url(#psRing)" strokeWidth="4"/>
      {/* inner disc */}
      <circle cx="60" cy="60" r="48" fill="url(#psCore)" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>

      {/* tick marks (pit-board ticks) */}
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i * 360) / 24
        const r1 = 50, r2 = 53
        const x1 = 60 + Math.cos((a * Math.PI) / 180) * r1
        const y1 = 60 + Math.sin((a * Math.PI) / 180) * r1
        const x2 = 60 + Math.cos((a * Math.PI) / 180) * r2
        const y2 = 60 + Math.sin((a * Math.PI) / 180) * r2
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(245,197,24,0.55)" strokeWidth="1.2"/>
      })}

      {/* wrench crossed behind a piston */}
      <g transform="translate(60 62)">
        {/* wrench */}
        <g transform="rotate(-35)">
          <rect x="-22" y="-3" width="44" height="6" rx="3" fill="#E9ECEF"/>
          <path d="M -25,-7 a 8 8 0 1 0 0 14 l 5,-3 a 5 5 0 1 1 0,-8 z" fill="#E9ECEF"/>
          <path d="M  25,-7 a 8 8 0 1 1 0 14 l -5,-3 a 5 5 0 1 0 0,-8 z" fill="#E9ECEF"/>
        </g>
        {/* piston / brake disc center */}
        <circle r="11" fill="#0B0B0F" stroke="#F5C518" strokeWidth="2"/>
        <circle r="4"  fill="#E63946"/>
      </g>

      {/* curved top text */}
      <defs>
        <path id="psTop" d="M 60,60 m -42,0 a 42,42 0 0,1 84,0" />
        <path id="psBot" d="M 60,60 m -38,6 a 38,38 0 0,0 76,0" />
      </defs>
      <text fontFamily="var(--display)" fontSize="11" letterSpacing="3" fill="#F5C518">
        <textPath href="#psTop" startOffset="50%" textAnchor="middle">PIT · STOP</textPath>
      </text>
      <text fontFamily="var(--display)" fontSize="7" letterSpacing="2.4" fill="#A8AFBA">
        <textPath href="#psBot" startOffset="50%" textAnchor="middle">LOS · SANTOS</textPath>
      </text>
    </svg>
  )
}

export function PitStopWordmark({ height = 28 }) {
  return (
    <span className="ps-wordmark" style={{ height }}>
      <span className="ps-wm-pit">PIT</span>
      <span className="ps-wm-dot" aria-hidden="true"/>
      <span className="ps-wm-stop">STOP</span>
    </span>
  )
}

export function CheckeredStrip({ height = 6 }) {
  return (
    <div className="ps-checker" style={{ height }} aria-hidden="true"/>
  )
}
