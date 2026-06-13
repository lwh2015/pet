// src/renderer/src/pet/PlaceholderPet.tsx
// Simple centered CSS/SVG placeholder pet (NOT Live2D). The .pet-body is the
// visible interactive region; the surrounding stage is click-through.
import React from 'react'

export function PlaceholderPet(): React.JSX.Element {
  return (
    <div className="pet-stage">
      <div className="pet-body" role="img" aria-label="Placeholder pet">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="56" fill="#7aa2f7" stroke="#3b5bdb" strokeWidth="4" />
          <circle cx="44" cy="52" r="9" fill="#ffffff" />
          <circle cx="76" cy="52" r="9" fill="#ffffff" />
          <circle cx="44" cy="54" r="4" fill="#1a1a1a" />
          <circle cx="76" cy="54" r="4" fill="#1a1a1a" />
          <path d="M44 80 Q60 94 76 80" fill="none" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
