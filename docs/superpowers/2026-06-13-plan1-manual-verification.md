# Plan 1 — Manual Verification Checklist (Foundation & Desktop Shell)

Everything automatable is already green (lint, typecheck, 123 unit tests, full build, headless dev-launch smoke). The checks below need a **human looking at the screen** — they cover transparency, click-through, drag, tray, and the panel, which can't be verified headlessly.

## How to run

```bash
npm run dev
```

This starts the Vite dev server + Electron with HMR. Quit with `Ctrl+C` in the terminal (or via the tray **Quit** item). To test packaged-startup specifics (macOS no-Dock flash), use `npm run build` then run the packaged app.

> Tip: settings persist to `<userData>/settings.json` (Windows: `%APPDATA%/pet/settings.json`, macOS: `~/Library/Application Support/pet/settings.json`). Delete it to reset to defaults between runs.

---

## 1. Window appearance & stacking
- [ ] A small **transparent, frameless** window appears showing the placeholder pet (no title bar, no window chrome, no opaque rectangle around it).
- [ ] The pet **floats on top** of other windows — click another app to give it focus; the pet stays visible above it.
- [ ] **Windows:** no taskbar entry for the pet. **macOS:** no Dock icon (only the tray/menu-bar icon).
- [ ] **macOS:** enter another app's fullscreen — the pet still floats over it.

## 2. Mouse passthrough (the core feature)
- [ ] Hover **empty space** inside the pet window (around the pet, not on it) and click — the click goes **through** to whatever is on the desktop behind it (e.g. a desktop icon or the window below reacts, the pet does not).
- [ ] Hover **directly over the pet body** — it becomes interactive (the cursor interacts with the pet, clicks land on it, not the desktop behind).
- [ ] Move the cursor on and off the pet repeatedly — no flicker, no "stuck" state.

## 3. Drag to reposition + persistence
- [ ] **Press and drag on the pet body** — the pet follows the cursor smoothly (no jump on the first move).
- [ ] Release — the pet stays where you dropped it.
- [ ] Quit (`Ctrl+C` / tray Quit) and `npm run dev` again — the pet **reappears at the same position**.
- [ ] (Off-screen recovery) With the app closed, edit `settings.json` and set `petPosition.x`/`y` to a huge value (e.g. `99999`), relaunch — the pet is **pulled back on-screen** (onto the primary display), not lost off-screen.
- [ ] (Multi-monitor, if available) Drag the pet to a second monitor, quit, relaunch — it restores on that monitor; unplug it and relaunch — it re-homes to the primary display, still visible.

## 4. Tray menu
- [ ] A **tray / menu-bar icon** appears (Windows: system tray; macOS: menu bar). 
- [ ] **Windows:** left-click the tray icon opens the **panel** window; right-click opens the menu. **macOS:** click the menu-bar icon to open the menu.
- [ ] The menu contains: **Show/Hide Pet**, three **passthrough mode** options (Auto / Locked-Interactive / Locked-Passthrough) shown as radio items, **Open Panel**, **Reset Interaction**, **Quit**.
- [ ] **Show/Hide Pet** hides the pet; the menu label flips to the opposite action; selecting it again shows the pet. (Hidden state persists across restart.)
- [ ] Switching **passthrough mode** updates the radio dot:
  - **Locked-Interactive** → the whole pet window is clickable everywhere (no passthrough), even over empty space.
  - **Locked-Passthrough** → clicks pass through everywhere, even over the pet (the pet can't be grabbed).
  - **Auto** → back to per-pixel behavior from section 2. (Selected mode persists across restart.)
- [ ] **Reset Interaction** — after any mode/drag, this returns the pet to the correct resting state for the current mode (recovery from a stuck state).
- [ ] **Quit** exits the app cleanly (tray icon disappears, process ends).

## 5. Panel window
- [ ] **Open Panel** (tray, or Windows tray left-click) opens a **normal, opaque, resizable** window titled "Pet Panel".
- [ ] It shows "Settings loaded." and a JSON dump of the current settings.
- [ ] Open Panel again while it's already open — it **focuses the existing** window (doesn't spawn a second one).
- [ ] Toggle pet visibility or change mode from the tray while the panel is open — the panel's JSON reflects the updated `petVisible`/`passthroughMode` (live `settings:changed` broadcast).
- [ ] Close the panel — the app **keeps running** (pet stays; it's a tray app, only Quit exits).

## 6. Single instance
- [ ] With the app running, launch it again (`npm run dev` in a second terminal, or the packaged app) — **no second pet appears**; the existing pet/panel is surfaced/focused instead.

## 7. Stability
- [ ] Over a couple of minutes of hovering, dragging, toggling modes, and opening/closing the panel — no crash, no console errors in the dev terminal, no runaway CPU.

---

## What's intentionally NOT here (later plans)
- The pet is a **placeholder** (CSS/SVG), not Live2D — that's **Plan 2**.
- No file ingestion / storage — **Plan 3**.
- No AI chat — **Plan 4**.

If anything above fails, note which item and the dev-terminal output; that's enough to pinpoint it.
