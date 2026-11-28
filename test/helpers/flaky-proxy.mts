// Fairy away from the mini, Away 5: a small TCP proxy between a face and the other Mac's link, for tests of a bad
// connection. Bytes pass through as they are (the TLS stays end to end); the proxy can delay them, stall them, cut every
// connection, and refuse new ones, as hotel Wi-Fi or a dropped hotspot would.
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

export interface FlakyProxyHandle {
  port: number;
  delay: (ms: number) => void;
  stall: (on?: boolean) => void;
  cut: (options?: { refuse?: boolean }) => void;
  pass: () => void;
  close: () => Promise<void>;
}

export async function flakyProxy(targetPort: number, { host = '127.0.0.1' }: { host?: string } = {}): Promise<FlakyProxyHandle> {
  const sockets = new Set<Socket>();
  const held: Array<() => void> = [];
  let delayMs = 0;
  let stalled = false;
  let refusing = false;

  const forward = (from: Socket, to: Socket): Socket =>
    from.on('data', (chunk: Buffer) => {
      const send = (): void => { if (!to.destroyed) to.write(chunk); };
      if (stalled) held.push(send);
      else if (delayMs) setTimeout(send, delayMs);
      else send();
    });

  const server = createServer(client => {
    if (refusing) { client.destroy(); return; }
    const upstream = connect(targetPort, host);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); (socket === client ? upstream : client).destroy(); });
    }
    forward(client, upstream);
    forward(upstream, client);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));

  const cut = ({ refuse = true }: { refuse?: boolean } = {}): void => {
    refusing = refuse;
    for (const socket of [...sockets]) socket.destroy();
  };

  return {
    port: (server.address() as AddressInfo).port,
    // Each chunk waits this long before going on.
    delay(ms: number) { delayMs = ms; },
    // Nothing goes through, though every connection stays open; stall(false) sends what was held, in order.
    stall(on = true) { stalled = on; if (!on) for (const send of held.splice(0)) send(); },
    // Every open connection ends at once, and (refuse) new ones are turned away until pass().
    cut,
    pass() { refusing = false; stalled = false; delayMs = 0; for (const send of held.splice(0)) send(); },
    close() { cut(); return new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
