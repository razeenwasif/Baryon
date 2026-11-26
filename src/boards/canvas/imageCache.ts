/**
 * Images live in the document as data URIs. Decoding one per frame would be
 * ruinous, so they are decoded once and kept here; the canvas asks for an
 * image and gets either a ready bitmap or null plus a redraw when it lands.
 */
const cache = new Map<string, HTMLImageElement>()
const pending = new Set<string>()
const failed = new Set<string>()

let onLoaded: (() => void) | null = null

export function setImageLoadListener(handler: (() => void) | null): void {
  onLoaded = handler
}

export function getImage(src: string): HTMLImageElement | null {
  const cached = cache.get(src)
  if (cached) return cached
  if (pending.has(src) || failed.has(src)) return null

  pending.add(src)
  const image = new Image()
  image.onload = () => {
    pending.delete(src)
    cache.set(src, image)
    onLoaded?.()
  }
  image.onerror = () => {
    pending.delete(src)
    failed.add(src)
  }
  image.src = src
  return null
}

/** Decodes an image up front, e.g. when the user drops a file on the board. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = cache.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      cache.set(src, image)
      resolve(image)
    }
    image.onerror = () => reject(new Error('Could not decode image'))
    image.src = src
  })
}

/** Blocks until every image referenced by the board is decoded (used by export). */
export async function preloadAll(sources: string[]): Promise<void> {
  await Promise.all(
    sources.map((src) => loadImage(src).catch(() => undefined))
  )
}
