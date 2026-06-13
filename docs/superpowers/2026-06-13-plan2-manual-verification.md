# Plan 2 — Live2D rendering & action system: manual verification

Date: 2026-06-13
Scope: on-screen checks for the whole of Plan 2. Plan 2 is renderer-focused;
pixi/Live2D/GL/DOM glue is verified by hand here (pure logic is unit-tested in
`src/shared/live2d/**`). Run the app, then walk every check in order.

## Prerequisites

- [ ] `src/renderer/public/live2dcubismcore.min.js` exists (vendored Cubism Core).
- [ ] `src/renderer/public/models/haru/haru.model3.json` exists with its
      siblings (`haru_greeter_t03.moc3`, the `haru_greeter_t03.2048/` texture
      folder, `motion/`, `expressions/`).
- [ ] `npm install` has been run (pixi.js@^7.4.3, pixi-live2d-display-advanced@^1.1.0).

## How to run

```
npm run dev
```

The pet window appears transparent/frameless over the desktop. Open DevTools
(from the tray/menu if wired, else the panel) to watch for console errors.

## Checks

### 1. Model renders
- [ ] The Haru Live2D model appears centered in the pet window, scaled to fit
      (roughly 90% of the smaller window dimension), NOT the blue SVG
      placeholder circle.
- [ ] The window background is fully transparent — the desktop shows through
      everywhere the model is not drawn (no black/white box).
- [ ] Resize the pet window (or change DPI/display scale): the model re-centers
      and re-fits without clipping or blur.

### 2. Greet on appear
- [ ] On first render the model plays its greeting motion/expression once
      (the `greet` tag: `Tap` group + expression `f00`), then settles.

### 3. Idle micro-actions
- [ ] Leave the pet untouched for 10-30s: it periodically plays a small idle
      motion from the `Idle` group at random intervals (no input required).
- [ ] Idle never interrupts a higher-priority motion: trigger a tap (check 5)
      mid-idle and confirm the reaction plays immediately and idle resumes
      afterward.

### 4. Cursor-follow
- [ ] Move the mouse around the screen (over and near the pet): the model's
      head/eyes track toward the cursor (head angle + eyeball direction).
- [ ] Cursor at window center -> head/eyes return to neutral (no offset).
- [ ] Cursor at the far corners -> head/eyes reach their clamped extremes
      without snapping or jitter.

### 5. Tap -> react
- [ ] Single-click ON the model body (a click, not a drag): it plays a
      reaction (the `react` tag, `Tap` group, motion only) that interrupts idle.
- [ ] Click-and-release on a TRANSPARENT area (not over the model silhouette):
      NOTHING happens — no reaction, and the click passes through to whatever
      is behind the window (Plan-1 passthrough behavior preserved).
- [ ] Cross-group coupling sanity: the tap in the first bullet ACTUALLY fires.
      `onMouseDown` lives on `.pet-root` (pointer-events:none) and depends on
      the sibling-group `.pet-canvas { pointer-events: auto }` rule plus the
      canvas being a descendant of `.pet-root`. If the tap silently does
      nothing with no console error, that cross-group rule/layering is broken.

### 6. Alpha-silhouette passthrough
- [ ] Hover the cursor OVER the opaque model silhouette: the window becomes
      interactive (you can drag it / clicks land on the pet).
- [ ] Hover over a TRANSPARENT region inside the window bounds (e.g. a gap
      between limbs, or empty corner): clicks pass THROUGH to the desktop /
      windows behind. The cursor does not "grab" the pet there.
- [ ] Move quickly across the silhouette edge: interactive state flips on enter
      immediately and off on leave after a short (~120ms) debounce, with no
      chatter at the anti-aliased edge.

### 7. Drag
- [ ] Press-and-hold on the model body and move the mouse past ~4px: the whole
      pet window follows the cursor (drag via `window.petApi.drag.*`).
- [ ] Release: the window stays where dropped; the drag does NOT also fire a
      tap reaction (a drag is not a tap).
- [ ] During the drag, moving over a transparent area does NOT drop the window
      (the gesture is pinned interactive for its whole duration).
- [ ] A press that starts over a TRANSPARENT area does not start a drag.

### 8. File-drop -> receive
- [ ] Drag a file from the OS file manager and drop it ONTO the model body:
      the model plays the `receive` motion/expression (`Tap` + `f05`).
- [ ] The window does NOT navigate away / blank out (dragover+drop
      preventDefault working).
- [ ] No file is read, stored, logged, or sent anywhere: Plan 2 file-drop is
      VISUAL-ONLY — it only triggers the `receive` animation. No OS path is
      extracted (no `File.path`, no preload bridge) and there is no new IPC
      traffic or main-process side effect. (Real ingestion is Plan 3.)

### 9. Hidden -> pause (rendering)
- [ ] Hide the pet window (tray toggle / hotkey from Plan 1): the Live2D
      render/update loop pauses (CPU/GPU use for the pet drops; ticker stopped).
- [ ] Show the pet again: rendering resumes smoothly and the model animates
      from where it left off (no crash, no frozen frame, no doubled canvas).

### 10. Load-failure fallback
- [ ] (Optional) Temporarily rename the model folder or break `modelUrl`, run
      `npm run dev`: the blue SVG `PlaceholderPet` renders instead of the model,
      and the app does not crash. Restore the model afterward.

## Packaged smoke test (asset paths)
- [ ] `npm run build` then run the packaged/unpacked build: the model still
      loads over `file://` (relative `models/haru/...` and
      `./live2dcubismcore.min.js` resolve). If the `.moc3` fetch is blocked by
      CSP over `file://`, that is the known escalation point (app:// scheme) and
      is OUT OF SCOPE for Plan 2 — note it and stop.

## Result
- [ ] All checks 1-9 pass on `npm run dev`. Record any failures with the check
      number and observed vs. expected behavior.
