/**
 * Verifies Electron IPC sender webContents, main-frame origin, and allowed page URLs before dispatch.
 */
export function assertTrustedIpcSender(event, {
  expectedWebContents = null,
  expectedUrl = '',
  allowedUrls = [],
  allowPredicate = null,
  requireMainFrame = true,
} = {}) {
  if (!event || !event.sender) throw new Error('Untrusted application frame.');
  if (expectedWebContents) {
    if (event.sender !== expectedWebContents) throw new Error('Untrusted application frame.');
    if (requireMainFrame && event.senderFrame !== expectedWebContents.mainFrame) {
      throw new Error('Untrusted application frame.');
    }
  }
  const frameUrl = event.senderFrame?.url || '';
  if (expectedUrl && frameUrl !== expectedUrl) {
    throw new Error('Untrusted application frame.');
  }
  if (Array.isArray(allowedUrls) && allowedUrls.length && !allowedUrls.includes(frameUrl)) {
    throw new Error('Untrusted application frame.');
  }
  if (typeof allowPredicate === 'function' && !allowPredicate(frameUrl, event)) {
    throw new Error('Untrusted application frame.');
  }
  return true;
}
