// A private socket another of your apps asks Fairy through: Tachyon (tachyon-link.mjs) and Flux
// (flux-link.mjs). One line of JSON per message, each way:
//   → {type:'hello'}                ← {type:'hello', name}
//   → {type:'ask', text, context, speak?}  ← {type:'text', text} as she writes (the reply so far),
//                                      then {type:'done', text} or {type:'error', message}
//   → {type:'stop'}                 stops the answer being written, or being said
//                                   ← {type:'spoken'} after `done`, once an answer done() says has been said
//   → {type:'new'}                  ← {type:'ok'}: the next question starts a new conversation
// The socket is in Fairy's data folder and only this user can open it. It carries conversation
// only: no tools, files or desktop control.
import net from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';

const LINE_LIMIT = 1 << 20;

/** Listen at `path`. `chat` is a CompanionChat for its questions, `reset` starts it on a new
 * conversation, `prompt(text, context)` builds what Fairy is asked, `record(text, context)` what
 * the chat keeps of it, `name` is what Fairy is called, `done(text, message)` runs with each
 * finished answer, `runner(message)` may give an ask its own way of answering (CompanionChat's
 * `run`), `onStop()` runs on a stop as well (to stop her saying an answer), and `label` names the app in
 * the log. Returns {close}. */
export function startChatLink({ path, chat, reset, prompt, record, done = () => {}, runner = () => null, onStop = () => {}, name = () => 'Fairy', label = 'link', log = () => {} }) {
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    const send = message => { if (!conn.destroyed) conn.write(`${JSON.stringify(message)}\n`); };
    const handle = async line => {
      let message;
      try { message = JSON.parse(line); } catch { return send({ type: 'error', message: 'That was not JSON.' }); }
      switch (message?.type) {
        case 'hello': return send({ type: 'hello', name: name() || 'Fairy' });
        case 'stop': chat.stop(); return onStop();
        case 'new': await reset(); return send({ type: 'ok' });
        case 'ask': {
          try {
            const context = message.context ?? {};
            const settingsOverride = message.model || message.effort ? { model: message.model, effort: message.effort } : undefined;
            const { text } = await chat.send(prompt(message.text, context), { onText: value => send({ type: 'text', text: value }), record: record(message.text, context), run: runner(message) ?? undefined, settingsOverride });
            send({ type: 'done', text });
            // done() may say it aloud; when it returns a promise, tell the app once that's finished.
            const said = done(text, message);
            if (said && typeof said.then === 'function') {
              const ok = await said.catch(() => false);
              send({ type: 'spoken', spoken: ok !== false });
            }
          } catch (error) {
            send({ type: 'error', message: error?.name === 'AbortError' ? 'Stopped.' : error?.message || String(error) });
          }
          return;
        }
        default: return send({ type: 'error', message: 'Unknown request.' });
      }
    };
    conn.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > LINE_LIMIT) return conn.destroy();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) handle(line).catch(error => log(`${label} link: ${error.message}`));
      }
    });
    conn.on('error', () => {});
  });
  server.on('error', error => log(`${label} link: ${error.message}`));
  // Only this user: the data folder is private, and the socket is too.
  server.listen(path, () => { try { chmodSync(path, 0o600); } catch {} });
  return {
    close() {
      server.close();
      try { unlinkSync(path); } catch {}
    },
  };
}
