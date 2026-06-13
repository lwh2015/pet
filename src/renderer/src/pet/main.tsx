// src/renderer/src/pet/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { PetApp } from './PetApp'
import './pet.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PetApp />
  </React.StrictMode>
)
