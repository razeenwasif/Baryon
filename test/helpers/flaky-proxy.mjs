// Fairy away from the mini, Away 5: a small TCP proxy between a face and the other Mac's link, for tests of a bad
// connection. Bytes pass through as they are (the TLS stays end to end); the proxy can delay them, stall them, cut every
// connection, and refuse new ones, as hotel Wi-Fi or a dropped hotspot would.
import { connect, createServer } from 'node:net';

export async function flakyProxy(targetPort, { host = '127.0.0.1' } = {}) {
  const sockets = new Set(), held = [];
  let delayMs = 0, stalled = false, refusing = false;
  const forward = (from, to) => from.on('data', chunk => {
    const send = () => { if (!to.destroyed) to.write(chunk); };
    if (stalled) held.push(send); else if (delayMs) setTimeout(send, delayMs); else send();
  });
  const server = createServer(client => {
    if (refusing) { client.destroy(); return; }
    const upstream = connect(targetPort, host);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); (socket === client ? upstream : client).destroy(); });
    }
    forward(client, upstream); forward(upstream, client);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    // Each chunk waits this long before going on.
    delay(ms) { delayMs = ms; },
    // Nothing goes through, though every connection stays open; stall(false) sends what was held, in order.
    stall(on = true) { stalled = on; if (!on) for (const send of held.splice(0)) send(); },
    // Every open connection ends at once, and (refuse) new ones are turned away until pass().
    cut({ refuse = true } = {}) { refusing = refuse; for (const socket of [...sockets]) socket.destroy(); },
    pass() { refusing = false; stalled = false; delayMs = 0; for (const send of held.splice(0)) send(); },
    close() { this.cut(); return new Promise(resolve => server.close(resolve)); },
  };
}
