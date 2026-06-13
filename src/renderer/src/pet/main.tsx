// src/renderer/src/pet/main.tsx
// NOTE: the pet entry deliberately does NOT use React.StrictMode. StrictMode
// double-invokes effects in dev, which remounts the Live2D pixi app on the same
// <canvas>; pixi's teardown force-loses that canvas's WebGL context, and a canvas
// yields only one context for its lifetime — so the second mount gets a dead
// context (blank pet) in dev. Production is single-mount and unaffected. The
// panel entry keeps StrictMode; only the GL-heavy pet route opts out.
import ReactDOM from 'react-dom/client'
import { PetApp } from './PetApp'
import './pet.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<PetApp />)
