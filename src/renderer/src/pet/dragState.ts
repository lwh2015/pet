// ============================================================================
// src/renderer/src/pet/dragState.ts
// Renderer-local flag shared between PetApp's drag gesture and usePassthrough.
// While true, usePassthrough MUST skip its hit-test so the window stays
// interactive (setIgnoreMouseEvents(false)) for the entire drag — otherwise
// an auto-mode passthrough flip would forward mousemove but NOT mouseup,
// stranding the drag and leaving a stale offset in the main process.
// ============================================================================

let dragging = false

/** True while a pet drag gesture is in progress. */
export function isPetDragging(): boolean {
  return dragging
}

/** Set by PetApp on mousedown/mouseup around the drag gesture. */
export function setPetDragging(value: boolean): void {
  dragging = value
}
