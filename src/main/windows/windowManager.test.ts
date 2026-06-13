// D:\aicode\pet\src\main\windows\windowManager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPetWindow,
  getPetWindow,
  setPanelWindow,
  getPanelWindow,
  togglePetVisibility,
  __resetWindowManagerForTests
} from './windowManager'

interface FakeWin {
  destroyed: boolean
  shown: boolean
  isDestroyed(): boolean
  show(): void
  hide(): void
}

function makeFakeWin(): FakeWin {
  return {
    destroyed: false,
    shown: false,
    isDestroyed() {
      return this.destroyed
    },
    show() {
      this.shown = true
    },
    hide() {
      this.shown = false
    }
  }
}

describe('windowManager', () => {
  beforeEach(() => {
    __resetWindowManagerForTests()
  })

  it('returns null before any window is registered', () => {
    expect(getPetWindow()).toBeNull()
    expect(getPanelWindow()).toBeNull()
  })

  it('stores and returns the registered pet window', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    expect(getPetWindow()).toBe(win)
  })

  it('stores and returns the registered panel window', () => {
    const win = makeFakeWin()
    setPanelWindow(win as unknown as Electron.BrowserWindow)
    expect(getPanelWindow()).toBe(win)
  })

  it('getPetWindow returns null when the stored window is destroyed', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    win.destroyed = true
    expect(getPetWindow()).toBeNull()
  })

  it('togglePetVisibility(true) shows the pet window and returns true', () => {
    const win = makeFakeWin()
    setPetWindow(win as unknown as Electron.BrowserWindow)
    const result = togglePetVisibility(true)
    expect(win.shown).toBe(true)
    expect(result).toBe(true)
  })

  it('togglePetVisibility(false) hides the pet window and returns false', () => {
    const win = makeFakeWin()
    win.shown = true
    setPetWindow(win as unknown as Electron.BrowserWindow)
    const result = togglePetVisibility(false)
    expect(win.shown).toBe(false)
    expect(result).toBe(false)
  })

  it('togglePetVisibility is a no-op returning the requested value when no window', () => {
    expect(togglePetVisibility(true)).toBe(true)
    expect(togglePetVisibility(false)).toBe(false)
  })
})
