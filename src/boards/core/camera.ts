import type { Camera } from '../shared/document'
import { clamp, type Box, type Vec } from './geometry'

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 32
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8]

/**
 * The camera stores the board coordinate sitting at the viewport's top-left
 * corner plus a zoom factor:  screen = (board - camera) * zoom
 */
export function boardToScreen(p: Vec, camera: Camera): Vec {
  return {
    x: (p.x - camera.x) * camera.zoom,
    y: (p.y - camera.y) * camera.zoom
  }
}

export function screenToBoard(p: Vec, camera: Camera): Vec {
  return {
    x: p.x / camera.zoom + camera.x,
    y: p.y / camera.zoom + camera.y
  }
}

export function boardBoxToScreen(box: Box, camera: Camera): Box {
  return {
    x: (box.x - camera.x) * camera.zoom,
    y: (box.y - camera.y) * camera.zoom,
    width: box.width * camera.zoom,
    height: box.height * camera.zoom
  }
}

/** The board rectangle currently visible in a viewport of the given size. */
export function visibleBounds(camera: Camera, width: number, height: number): Box {
  return {
    x: camera.x,
    y: camera.y,
    width: width / camera.zoom,
    height: height / camera.zoom
  }
}

/** Zooms while keeping `anchor` (a screen point) pinned to the same board point. */
export function zoomAt(camera: Camera, anchor: Vec, nextZoom: number): Camera {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  const before = screenToBoard(anchor, camera)
  const after = { x: anchor.x / zoom + camera.x, y: anchor.y / zoom + camera.y }
  return {
    zoom,
    x: camera.x + (before.x - after.x),
    y: camera.y + (before.y - after.y)
  }
}

export function zoomBy(camera: Camera, anchor: Vec, factor: number): Camera {
  return zoomAt(camera, anchor, camera.zoom * factor)
}

/** Next/previous stop from the preset ladder, so Ctrl+= feels predictable. */
export function steppedZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = ZOOM_STEPS.find((z) => z > current * 1.001)
    return next ?? clamp(current * 1.25, MIN_ZOOM, MAX_ZOOM)
  }
  const prev = [...ZOOM_STEPS].reverse().find((z) => z < current * 0.999)
  return prev ?? clamp(current * 0.8, MIN_ZOOM, MAX_ZOOM)
}

export function cameraForBox(
  box: Box,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0.12,
  maxZoom = 2
): Camera {
  if (box.width <= 0 || box.height <= 0) {
    return {
      zoom: 1,
      x: box.x - viewportWidth / 2,
      y: box.y - viewportHeight / 2
    }
  }
  const zoom = clamp(
    Math.min(viewportWidth / box.width, viewportHeight / box.height) * (1 - padding),
    MIN_ZOOM,
    maxZoom
  )
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return {
    zoom,
    x: cx - viewportWidth / 2 / zoom,
    y: cy - viewportHeight / 2 / zoom
  }
}

export function centerOn(camera: Camera, point: Vec, width: number, height: number): Camera {
  return {
    zoom: camera.zoom,
    x: point.x - width / 2 / camera.zoom,
    y: point.y - height / 2 / camera.zoom
  }
}
