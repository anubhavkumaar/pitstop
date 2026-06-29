// Generative garage-scene backplate for the hero — perspective floor grid,
// ambient spotlight glow, roller-door slats, and a bottom scrim for text
// contrast. Pure SVG so it stays crisp at any size and matches the brand's
// existing all-vector aesthetic (Logo, Gear/Wrench/Bolt/Nut).
export function HeroBackplate() {
  return (
    <svg className="hero-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="haGlow" cx="50%" cy="38%" r="55%">
          <stop offset="0%" stopColor="rgba(230,57,70,0.14)"/>
          <stop offset="100%" stopColor="rgba(230,57,70,0)"/>
        </radialGradient>
        <linearGradient id="haScrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(11,11,15,0)"/>
          <stop offset="65%"  stopColor="rgba(11,11,15,0.35)"/>
          <stop offset="100%" stopColor="rgba(11,11,15,0.85)"/>
        </linearGradient>
      </defs>

      <circle cx="800" cy="320" r="480" fill="url(#haGlow)"/>

      {/* perspective garage-floor grid */}
      <g stroke="rgba(255,255,255,0.045)" strokeWidth="1">
        <line x1="-400" y1="900" x2="800" y2="430"/>
        <line x1="0"    y1="900" x2="800" y2="430"/>
        <line x1="400"  y1="900" x2="800" y2="430"/>
        <line x1="800"  y1="900" x2="800" y2="430"/>
        <line x1="1200" y1="900" x2="800" y2="430"/>
        <line x1="1600" y1="900" x2="800" y2="430"/>
        <line x1="2000" y1="900" x2="800" y2="430"/>
        <line x1="0" y1="470" x2="1600" y2="470" opacity="0.5"/>
        <line x1="0" y1="540" x2="1600" y2="540" opacity="0.42"/>
        <line x1="0" y1="620" x2="1600" y2="620" opacity="0.34"/>
        <line x1="0" y1="720" x2="1600" y2="720" opacity="0.26"/>
        <line x1="0" y1="850" x2="1600" y2="850" opacity="0.18"/>
      </g>

      {/* roller-door slats along the bottom edge */}
      <g stroke="rgba(230,57,70,0.05)" strokeWidth="3">
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={i} x1="0" y1={760 + i * 9} x2="1600" y2={760 + i * 9}/>
        ))}
      </g>

      <rect x="0" y="0" width="1600" height="900" fill="url(#haScrim)"/>
    </svg>
  )
}
