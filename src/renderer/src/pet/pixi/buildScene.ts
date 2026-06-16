// src/renderer/src/pet/pixi/buildScene.ts
// Builds the chrome-Z pet scene graph. Coordinates are scene-space (200x210).
// Each animatable part is its own Container whose pivot == position == its
// rotation/scale center, so children may be drawn in absolute scene coords
// while the container still transforms around the intended anchor.
import { Container, Graphics } from 'pixi.js'
import { CHROME, makeChromeGradient } from './metal'

export const SCENE_W = 200
export const SCENE_H = 210
export const EYE_L = { x: 86, y: 62, r: 12 }
export const EYE_R = { x: 118, y: 62, r: 12 }
export const PUPIL_R = 5.5
export const PUPIL_MAX_TRAVEL = EYE_L.r - PUPIL_R // 6.5
export const FACE_CENTER_X = 100

export interface PetParts {
  root: Container
  bodyGroup: Container
  earL: Container
  earR: Container
  tail: Container
  face: Container
  eyes: Container
  pupilL: Container
  pupilR: Container
  highlight: Graphics
}

function anchored(x: number, y: number): Container {
  const c = new Container()
  c.pivot.set(x, y)
  c.position.set(x, y)
  return c
}

export function buildScene(): PetParts {
  const root = new Container()

  // bodyGroup: breathing scales around the bottom-center (100,138).
  const bodyGroup = anchored(100, 138)
  root.addChild(bodyGroup)

  const grad = makeChromeGradient()

  // tail behind everything (sway around its root 150,132).
  const tail = anchored(150, 132)
  tail.addChild(
    new Graphics()
      .moveTo(150, 132)
      .quadraticCurveTo(178, 134, 176, 110)
      .stroke({ width: 9, color: CHROME.dark, cap: 'round' })
  )
  bodyGroup.addChild(tail)

  // ears (sway).
  const earL = anchored(82, 44)
  earL.addChild(
    new Graphics()
      .poly([72, 46, 79, 26, 93, 41])
      .fill(grad)
      .stroke({ width: 2, color: CHROME.edge, join: 'round' })
  )
  const earR = anchored(124, 43)
  earR.addChild(
    new Graphics()
      .poly([114, 42, 125, 24, 134, 43])
      .fill(grad)
      .stroke({ width: 2, color: CHROME.edge, join: 'round' })
  )
  bodyGroup.addChild(earL, earR)

  // dark rim under the metal Z stroke.
  bodyGroup.addChild(
    new Graphics()
      .moveTo(58, 62)
      .lineTo(142, 62)
      .lineTo(58, 138)
      .lineTo(142, 138)
      .stroke({ width: 37, color: CHROME.rim, cap: 'round', join: 'round' })
  )
  // arms (static).
  bodyGroup.addChild(
    new Graphics()
      .moveTo(48, 98)
      .quadraticCurveTo(31, 104, 29, 120)
      .stroke({ width: 11, fill: grad, cap: 'round' })
      .moveTo(152, 98)
      .quadraticCurveTo(169, 104, 171, 120)
      .stroke({ width: 11, fill: grad, cap: 'round' })
  )
  // metal Z body.
  bodyGroup.addChild(
    new Graphics()
      .moveTo(58, 62)
      .lineTo(142, 62)
      .lineTo(58, 138)
      .lineTo(142, 138)
      .stroke({ width: 31, fill: grad, cap: 'round', join: 'round' })
  )
  // top highlight line (sheen).
  const highlight = new Graphics()
    .moveTo(64, 56)
    .lineTo(136, 56)
    .stroke({ width: 5, color: 0xffffff, cap: 'round' })
  highlight.alpha = 0.6
  bodyGroup.addChild(highlight)

  // face: tilts slightly toward cursor; pivot at face center.
  const face = anchored(FACE_CENTER_X, 64)
  // eyes sub-group: blink scales this Y around the eye line (y=62).
  const eyes = anchored(FACE_CENTER_X, 62)
  eyes.addChild(new Graphics().circle(EYE_L.x, EYE_L.y, EYE_L.r).fill(CHROME.eyeWhite))
  eyes.addChild(new Graphics().circle(EYE_R.x, EYE_R.y, EYE_R.r).fill(CHROME.eyeWhite))
  const pupilL = new Container()
  pupilL.position.set(EYE_L.x, EYE_L.y)
  pupilL.addChild(new Graphics().circle(0, 0, PUPIL_R).fill(CHROME.ink))
  pupilL.addChild(new Graphics().circle(-2, -2, 2).fill(0xffffff))
  const pupilR = new Container()
  pupilR.position.set(EYE_R.x, EYE_R.y)
  pupilR.addChild(new Graphics().circle(0, 0, PUPIL_R).fill(CHROME.ink))
  pupilR.addChild(new Graphics().circle(-2, -2, 2).fill(0xffffff))
  eyes.addChild(pupilL, pupilR)
  // mouth (static, part of face).
  const mouth = new Graphics()
    .moveTo(93, 76)
    .quadraticCurveTo(102, 83, 111, 76)
    .stroke({ width: 3, color: CHROME.ink, cap: 'round' })
  face.addChild(eyes, mouth)
  bodyGroup.addChild(face)

  return { root, bodyGroup, earL, earR, tail, face, eyes, pupilL, pupilR, highlight }
}
