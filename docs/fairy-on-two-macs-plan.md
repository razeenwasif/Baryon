# Fairy on two Macs: architecture and implementation plan

> **This file is a copy**, exported on 15 Nov 2026 from the Claude doc
> [Fairy on two Macs: architecture and implementation plan](https://claude.ai/artifact/JrB2NaC3H12uPzceEi7oRC).
> The design it implements is [Fairy on two Macs: design](https://claude.ai/artifact/2nerRnhgnGHg8Y7tkYjyCc).
> If the two differ, ask the user which is current.
>
> **If you are building from this file:** take one step per session. Read Ground rules, What exists already
> and your own step before writing anything. Line numbers are for `desktop/main.cjs` at commit `291a5c6`; find
> the code by the names given if they have moved. Nothing here has been built or run. Where the plan and the
> code disagree, the code is right: stop and say what you found. Steps 1, 2, 5, 7 and 8 each need something
> from the user, listed in the step and under Decisions still needed. When a step is done, fill in its row
> under Progress at the end of this file.

Nov 15, 2026 · @Razeen Wasif

This plan turns the two-Mac design into eight steps that can be taken one at a time, each with its files, interfaces, tests and a check. It is written so that a model with no memory of the design can build it from this page and the repo.

## Architecture

Face is the existing companion window with a small main process behind it that forwards everything to Home; Home gains a set of routes on the phone link's server and a rule for which Mac shows her.

```
MacBook: Face                                   Mac mini: Home
+--------------------------------------+        +--------------------------------------+
| Companion window (exists, changed)   |        | main.cjs (exists, changed)           |
|   src/companion.js, src/face-voice.js|        |   Quick chat, approvals, voice,      |
+--------------------------------------+        |   quiz, ink                          |
| face-main.cjs            NEW         |        +--------------------------------------+
|   window, menu, companion handlers   |        | face-link.mjs            NEW         |
+--------------------------------------+        |   /v1/face/ routes: turns, voice,    |
| face-client.mjs          NEW         | HTTPS  |   events                             |
|   pinned HTTPS, event stream, retries| -----> +--------------------------------------+
+--------------------------------------+ over   | phone-link.mjs (exists, changed)     |
| pointer-sampler.mjs      NEW         | Tail-  |   Tailscale only, pairing, keys      |
|   is this Mac in use? entry and exit | scale; +--------------------------------------+
|   edges                              | events | face-presence.mjs        NEW         |
+--------------------------------------+ back   |   decides which Mac shows her        |
| face-store.mjs           NEW         |        +--------------------------------------+
|   pairing, sealed keys, switches:    |        | the lyra data folder (exists)        |
|   face/face.json                     |        |   chats, memory, settings: only copy |
+--------------------------------------+        +--------------------------------------+
Every connection starts on the MacBook. Files are in desktop/ unless they say otherwise.
```

In words, for a reader without the picture. On the MacBook: the companion page calls `face-main.cjs` over Electron's IPC; `face-main.cjs` calls `face-client.mjs`, which holds one pinned HTTPS connection to Home; `pointer-sampler.mjs` reports whether the MacBook is in use; `face-store.mjs` keeps the pairing. On the mini: `phone-link.mjs` accepts the connection and hands `/v1/face/*` to `face-link.mjs`, which runs turns through the Quick chat code already in `main.cjs`; `face-presence.mjs` decides where she is shown; the data folder is touched only by Home.

| New file | Runs on | Purpose |
| --- | --- | --- |
| `desktop/role.cjs` | Both | Reads and writes the role |
| `desktop/face-main.cjs` | Face | Face's whole main process |
| `desktop/face-client.mjs` | Face | The pinned connection to Home |
| `desktop/face-store.mjs` | Face | `face/face.json` |
| `desktop/pointer-sampler.mjs` | Both | Is this Mac in use, and by which edge |
| `desktop/face-link.mjs` | Home | The `/v1/face/*` routes and a Face's turns |
| `desktop/face-presence.mjs` | Home | The rule for which Mac shows her |
| `desktop/quiz-setup.mjs` | Both | The quiz watcher's construction, shared (step 8) |
| `src/face-voice.js` | Face | Plays her voice in the companion page |
| `scripts/pointer-log.swift`, `scripts/pointer-report.mjs` | Either | The pointer test |
| `scripts/pack-fairy-home.mjs`, `scripts/unpack-fairy-home.mjs` | Either | The move |

## Ground rules

These hold for every step; a change that breaks one is wrong even if its tests pass.

**Words used here.** *Home* is the full Fairy, running on the Mac mini. *Face* is the same app started in a thin role on the MacBook. *The link* is Home's existing phone link. The design this implements is [Fairy on two Macs: design](https://claude.ai/artifact/2nerRnhgnGHg8Y7tkYjyCc).

**Working in the repo**

- Read code from `origin/main`, not from the working folder, which can be many commits behind. This plan was written against `291a5c6`.
- One branch per step, named `two-macs-<step number>`. Do not switch the branch of the main folder; work in a worktree.
- Commit when a step's tests pass. Push and install only when the user asks.
- No new npm packages. `npm install` in a worktree replaces the shared `node_modules` link.
- Do not edit `SANDBOX_LOG.md`, `VERDICT.md`, `RESEARCH_PLAN.md` or `AGENTS.md`.
- The app's name (`lyra-companion`), Keychain item and data folder keep their names.

**Code style, as the repo already does it**

- Logic goes in `desktop/*.mjs` as classes or functions that take what they need as arguments (`now`, `request`, `seal`, `screen`), so tests run without Electron. `.cjs` is only for Electron entry points and preloads.
- Tests are `test/<name>.test.mjs`, using `node:test` and `node:assert/strict`, run with `npm test`. Wiring in `main.cjs` is checked by reading the file with a regular expression, as `test/background-calls.test.mjs` does.
- Comments say why, in plain sentences. Text the user sees uses curly apostrophes and no jargon.
- `main.cjs` is 3,429 lines. Add to it by calling into a new module, not by growing it.

**Safety invariants**

1. Face never opens, reads or writes the `lyra` data folder.
2. Face makes no model calls and holds no sign-in to any service.
3. Face listens on no port. Every connection goes from Face to Home.
4. Face sends its key only to a server whose certificate matches the pinned fingerprint, checked before any request byte is written.
5. Home sends a Face nothing but what the routes in this plan list. A route not listed is refused.
6. A picture of the MacBook's screen is taken only by Face, only while Face's own screen switch is on.
7. Nothing in this plan lets Home click or type on the MacBook.
8. An install that has never chosen a role behaves exactly as today.

## What exists already

Fairy already has both halves this needs: a small companion window that is a ready-made face, and a paired, pinned link that a phone uses today.

| File | What it does now | How this plan uses it |
| --- | --- | --- |
| `companion.html`, `src/companion.js` | The companion: Fairy's eye, a ring menu, a quick chat box, an approval card. It talks to the app only through `window.fairy.companion*` calls. | Becomes Face's only window. Face answers the same calls from the link instead of from local code. |
| `desktop/preload.cjs` (lines 4 to 41) | Declares the `companion*` calls and `onCompanion*` events. | Gains four Face entries; the existing ones are reused as they are. |
| `desktop/main.cjs` `setCompanion` (line 224) | Makes the companion window: 340 by 520, frameless, see-through, always on top. | Face's window copies these options. |
| `desktop/main.cjs` `fromCompanion(...)` (lines 810 to 958) | The handlers behind the companion's calls: `chat`, `explain`, `task`, `stop`, `cursor`, `history`, `answer`, `action`, `ride`. | The body of `chat` is pulled out so a Face request can run it with its own output. |
| `desktop/companion-chat.mjs` `CompanionChat` | Quick chat: one saved chat, one turn at a time. `send(text, { onText, run })` returns `{ text }` and throws while a turn is running. | A Face's messages go into this same chat. |
| `desktop/phone-link.mjs` `PhoneLink` | An HTTPS server on the Mac's Tailscale address, port 47616. Pairing code (5 minutes, 5 tries), a self-made certificate whose fingerprint the device pins, a read key and an approve key per device, an event stream, `/v1/answer` for approvals. | Home's door for Face. Gains a device kind and a hook for `/v1/face/*`. |
| `desktop/reply-voice.mjs` `ReplyVoice`, `desktop/phone-turns.mjs` | Turn a reply into MP3 parts as it is written; the phone fetches parts from `/v1/voice`. | The same class makes a Face's audio. |
| `desktop/approvals.mjs`, `askWorkApproval`, `askChatApproval` (main.cjs lines 401 to 422) | Every question that needs an OK, sent to the window, the companion and the phone. | Also sent to a connected Face. |
| `desktop/companion-visibility.cjs` | Hides the floating window without closing it (see-through, takes no clicks). | Hides Home's avatar while Face shows her, and Face's window while Home does. |
| `desktop/presence.mjs` | Window levels and the menu-bar menu, as pure functions. | Face's menu-bar menu is added here. |
| `desktop/screen-helper.mjs`, `inkCapture` (main.cjs line 199) | Takes pictures of a screen through one `fairy-screen` process. | Face takes the MacBook's pictures the same way. |
| `desktop/screen-ink.mjs` `explainOnScreen({ capture, read, show, ... })` | Explain anything. The capture, the text reading and the drawing are passed in. | Those three become calls to Face (step 7). |
| `desktop/quiz.mjs` `QuizMonitor` (made at main.cjs line 1036) | Quiz hints: watches the screen, finds the question, asks a model, shows the answer. | Face runs the watching; only the model call goes to Home (step 8). |
| `src/phone-link-settings.js` | Settings for the phone link: on or off, pair, the device list. | Gains "Pair a Mac" and shows each device's kind. |

Three facts about today's behaviour that the plan depends on:

- **The window owns her voice.** After a companion reply, `main.cjs` sends `fairy:companion-speak` to the main window, which plays it. Face has no main window, so it needs its own player.
- **Sign-ins are sealed per Mac.** `keys.json`, `gmail.json`, `calendar.json`, `drive.json`, `spotify.json`, `push-key.json` and the link's certificate key are sealed with Electron's `safeStorage`, which uses that Mac's Keychain.
- **Idle time is whole seconds.** `powerMonitor.getSystemIdleTime()` returns an integer, so a sub-second hand-over must also watch the pointer's position.

## Roles

One app, two roles, chosen before anything else starts: Home runs today's `main.cjs` unchanged, and Face runs a separate, small entry file.

**Where the role is kept.** In `role.json` in Electron's user-data folder (`~/Library/Application Support/lyra-companion/role.json`), which sits beside the `lyra` data folder, not inside it. The environment variable `FAIRY_ROLE` (`home` or `face`) wins over the file, for test copies. With neither, the role is `home`.

**The branch.** `desktop/role.cjs` exports `readRole({ userData, env, read })` and `writeRole(userData, role)`. In `main.cjs`, straight after the `app.setPath('userData', ...)` line (line 13):

```js
// A Mac set up as a face of another Fairy starts only the companion and the link to her (face-main.cjs).
if (require('./role.cjs').readRole({ userData: app.getPath('userData') }) === 'face') { require('./face-main.cjs').start({ app }); return; }
```

A top-level `return` is legal in a CommonJS file, so nothing below that line runs in a Face. Check that `scripts/package-fairy.mjs` copies the new `desktop` files into the app.

| At startup | Home | Face |
| --- | --- | --- |
| Opens the `lyra` data folder | Yes | Never |
| Model providers, Claude Code, Codex, Antigravity | Yes | Never |
| Timers: check-ins, brief, schedules, promises, reflection | Yes | Never |
| Gmail, Calendar, Drive, Spotify, notes index, book index | Yes | Never |
| Sockets for Tachyon, Flux, Electron, AudioPulse | Yes | Never |
| Phone link server | Yes | Never (it is a client) |
| Main workspace window | Yes | Never |
| Companion window | When you open it | Always, as its only window |
| Menu-bar item | Today's menu | A short Face menu |
| Its own file | The data folder | `face/face.json` in the user-data folder |

**Face's own file.** `face/face.json` holds the Home's host name, port and certificate fingerprint, this device's id, its two keys sealed with `safeStorage`, the window's place on screen, and three switches: muted, screen pictures, open at login. Nothing else is saved by a Face.

**Changing role.** Both directions write `role.json` and relaunch (`app.relaunch(); app.exit(0)`), after a confirmation that says the data folder is left as it is.

- Home to Face: a button in Settings under Phone, "Use this Mac as a face of another Fairy".
- Face to Home: "Switch back to the full Fairy" in Face's menu-bar menu.

## The face protocol

Face speaks to Home over the phone link's own server, on paths under `/v1/face/`, which only a device paired as a Mac may use.

**What is reused unchanged:** the port, the certificate and its pin, the Tailscale-only check, the `Host` check, the refusal of any request with an `Origin`, and `Authorization: Bearer <read key>`.

**The seam in `PhoneLink.receive`.** Before the list of phone paths is checked, a path starting `/v1/face/` goes to a handler passed in as `face`:

```js
if (pathname.startsWith('/v1/face/')) {
  const device = this.device(request);
  if (!device || device.kind !== 'mac' || !this.face) return this.send(response, 401, { error: 'This Mac isn’t paired.' });
  device.lastSeen = new Date(this.now()).toISOString();
  return await this.face.handle(request, response, { device, pathname, searchParams, link: this });
}
```

A device paired as a Mac may also call `/v1/answer` and `/v1/leave`. Every other phone path answers a Mac with 403, and every `/v1/face/` path answers a phone with 401.

**Requests from Face**

| Request | Body or query | Answer | Step |
| --- | --- | --- | --- |
| `GET /v1/face/events` | none | An event stream (below). One per device: a new one closes the old. | 4 |
| `POST /v1/face/ask` | `{ text, explain }`: `text` of 1 to 12,000 characters; `explain: true` asks for a drawn answer (step 7) | `{ turn }` at once. The reply arrives as events. 409 while a turn is running. | 4 |
| `POST /v1/face/stop` | `{}` | `{ ok: true }`. Stops the running turn and its voice. | 4 |
| `GET /v1/face/history` | none | `{ name, history }`: her name and Quick chat's last 20 messages. | 4 |
| `GET /v1/face/voice` | `turn`, `part` | `audio/mpeg` bytes, or 404 if that part isn't ready. | 4 |
| `POST /v1/answer` | `{ id, decision, approveKey }` | As for a phone. `approveKey` is needed to allow. | 4 |
| `POST /v1/face/presence` | `{ activeAgoMs, locked, claim }` | `{ ok: true }` | 5 |
| `POST /v1/face/picture` | JSON `{ id, png, shot, read }`, or `{ id, refused: true }` | `{ ok: true }`. 409 if no picture with that `id` was asked for. | 6 |
| `POST /v1/face/quiz` | The quiz question, as step 8 describes | `{ answer }` | 8 |

Body limits: 64 KB for JSON (the link's `MAX_MESSAGE_BODY`), 20 MB for a picture, which travels as base64.

**Events from Home**, written as `event: <type>` and `data: <JSON>`, with a `: still here` comment every 15 seconds:

| Event | Data | Meaning |
| --- | --- | --- |
| `hello` | `{ name, turn, approvals, show }` | Sent first. Her name, the running turn if any, questions waiting, and whether this Mac shows her. |
| `text` | `{ turn, text }` | The whole reply so far. Replaces what was shown. |
| `progress` | `{ turn, text }` | A status line under her eye. |
| `voice` | `{ turn, parts, done, failed }` | How many audio parts are ready to fetch. |
| `done` | `{ turn, text }` | The turn finished. |
| `failed` | `{ turn, message }` | The turn failed or was stopped. |
| `say` | `{ text }` | Something she says unasked (an idea, news), sent only while this Mac shows her. |
| `approval` | `{ id, title, detail, macOnly, tooBig }` | A question that needs an OK. |
| `approval-closed` | `{ id }` | That question was answered elsewhere or withdrawn. |
| `show` | `{ on }` | `on` is `true` when this Mac should show her. Each Mac works out its own edge. |
| `want-picture` | `{ id, purpose }` | Home asks for a picture of this Mac's screen. Face may refuse by not answering. |
| `ink` | `{ id, state }` or `{ clear: true }` | A drawing to show on this Mac's screen, or to wipe (step 7). |

A turn id is a random UUID made by Home. Face ignores events for a turn it didn't start, except `text`, `done` and `failed` for the turn named in `hello`.

## Pairing and keys

A Mac pairs the way a phone does, with one added field that says which kind of device the code was made for.

**On Home (`phone-link.mjs`)**

- A device record gains `kind`: `'phone'` or `'mac'`. A saved record with no `kind` is a phone.
- `pair({ kind = 'phone' } = {})` keeps `kind` with the pairing code and adds `kind=mac` to the `fairy://pair?...` link for a Mac.
- `takeCode` reads `{ code, name, kind }`. A `kind` that differs from the code's counts as a wrong code, with the same message and the same count of tries.
- `state()` lists each device's `kind`, so Settings can label it.
- Settings, under Phone, gains "Pair a Mac". It shows the pairing link as text with a Copy button. Universal Clipboard carries it to the MacBook.

**On Face (`face-client.mjs`, `face-store.mjs`)**

1. With no pairing saved, the companion shows one field: "Paste the pairing link from your other Mac".
2. `FaceClient.pair(link, name)` requires the `fairy:` scheme, `kind=mac`, a host, a port, a code and a 64-character hexadecimal pin. Anything else is refused before any connection is made.
3. It posts `{ code, name, kind: 'mac' }` to `/v1/pair` and receives `{ readKey, approveKey, device }`.
4. `FaceStore` saves the host, port, pin and device id as they are, and both keys sealed with `safeStorage`.

**The pin check.** Requests use an `https.Agent` whose `createConnection` opens the TLS socket itself, waits for `secureConnect`, and compares `socket.getPeerCertificate().fingerprint256` (colons removed, lower case) with the saved pin. On a mismatch it destroys the socket and fails the request, so no header is ever written to an unpinned server. `rejectUnauthorized` is `false` because the certificate is self-made; the pin is the whole check.

**Using the keys**

- The read key is unsealed at start and kept in memory.
- The approve key is unsealed only to send an Allow, and only after `systemPreferences.promptTouchID(...)` succeeds. Where `canPromptTouchID()` is false, Face cannot allow; it says to answer on the other Mac or the iPhone. Deny needs neither.
- A question marked `macOnly` or `tooBig` cannot be allowed from a Face, as it cannot from a phone.

**When trust ends**

- Home replaces its certificate when its Tailscale name changes or the certificate nears its end, and forgets every device. Face then sees a pin mismatch, shows "Your other Mac’s certificate changed. Pair again." and never trusts the new one by itself.
- "Forget this Mac" on Home, or "Forget the other Mac" in Face's menu (which calls `/v1/leave`), removes the pairing. Face deletes its keys.

## Presence and hand-over

Home decides which Mac shows her from one number per Mac, how long ago it last had input, and each Mac works out its own entry and exit edge.

**The signal.** While a Face is connected, each Mac samples every 200 ms. A sample is *active* if the pointer's position differs from the last sample's, or `powerMonitor.getSystemIdleTime()` is 0. The hope, to be confirmed by the pointer test in step 1, is that under Universal Control only the Mac in use produces active samples.

**What Face sends.** `POST /v1/face/presence` with `{ activeAgoMs, locked, claim }`: at once when it turns active after 400 ms of quiet, every second while active, and every 5 seconds otherwise. `activeAgoMs` is a duration, so the two Macs' clocks are never compared. Home samples itself the same way, with no request.

**The rule**, in `desktop/face-presence.mjs` as a class with no Electron in it. `decide(now)` returns `'home'` or `'face'`, taking the first row that applies:

| When | She is shown on |
| --- | --- |
| No Face stream is open, or Face's last report is older than 15 seconds | Home |
| Face reports its screen locked | Home |
| Home's screen is locked or asleep | Face |
| One Mac sent `claim: true` more recently than the other was claimed | That Mac, until the other claims |
| Face was active within the last 400 ms and Home has been quiet for 1 second | Face |
| Home was active within the last 400 ms and Face has been quiet for 1 second | Home |
| Otherwise | Where she already is |

Constants, exported so tests can name them: `SAMPLE_MS = 200`, `FRESH_MS = 400`, `DWELL_MS = 1000`, `HEARTBEAT_MS = 5000`, `STALE_MS = 15000`.

**What changes on screen**

- Home, when she moves to Face: if the window is floating, stop any walk and call `companionVisibility.hide()`; if the companion window is out, make it see-through and click-through. Remember which was hidden, and restore only that when she comes back. A full workspace window is left alone.
- Home sends `show` with `{ on: true }` or `{ on: false }` to Face on every change, and in `hello`.
- Face, on `on: false`: glide the window to the exit edge over 300 ms in 12 steps of `setBounds`, fading to nothing, then hide it with `CompanionVisibility`.
- Face, on `on: true`: place the window at the entry edge, restore it, and glide to its saved place the same way.

**Edges, worked out locally.** Each sampler keeps the pointer's last active position and the first position of each new run of activity. The exit edge is the screen edge nearest the last active position. The entry edge is the edge nearest the first position of the current run. The window meets that edge at the pointer's height or width along it.

**If the pointer test fails.** Face's menu and Home's menu each get "Bring Fairy here", which sends `claim: true`. `face.json` keeps `follow` as `'pointer'` or `'manual'`; with `'manual'`, only claims move her.

## Screen pictures, voice and approvals

Each of the three crosses the link in one direction only, and Face can refuse a picture.

**Voice (Home to Face)**

- For a Face turn, Home makes a `ReplyVoice` exactly as `phoneTurns` does for a phone: `update(text)` as the reply grows, `finish(reply)` at the end. Each part it emits is kept in memory with the turn, up to the phone's limits (60 parts, 30 MB), and a `voice` event goes out.
- With `settings.voiceProvider === 'off'` there is no voice and no `voice` event.
- Home does not send `fairy:companion-speak` to its own window for a Face turn, so the mini stays quiet.
- Face fetches each new part from `/v1/face/voice` and passes the bytes to its page on `fairy:face-voice`. A new file, `src/face-voice.js`, plays them in order through `Audio` and blob URLs, and sets the eye's mood to `speaking` while it plays.
- `companion.html`'s content policy gains `media-src 'self' blob:`.
- Face's own Mute switch stops the fetching. Stop sends `fairy:face-hush`, which empties the queue.

**Approvals (Home to Face, answer back)**

- `toCompanion` (main.cjs line 441) is where approval cards reach the companion. Beside it, the same `{ id, title, detail }` or `{ id, closed: true }` goes to a connected Face as `approval` or `approval-closed`.
- `hello` carries the questions already waiting, from the link's `overview().approvals`.
- The companion page's existing card shows them. Its Allow and Deny call `companionAnswer`, which Face turns into `POST /v1/answer`.

**Pictures of the MacBook's screen (Face to Home, on request)**

- Home asks with a `want-picture` event, only during a turn that this Face started. A request made on Home or on the phone can never fetch the MacBook's screen.
- Face answers only if its own switch "Let Fairy see this screen" is on, macOS has granted Screen Recording, and the screen isn't locked. The switch is off until you turn it on.
- Face takes the picture of the display its window is on, through `ScreenHelper` and `native/bin/fairy-screen`, leaving out its own windows, sized as `inkCapture` sizes it (at most 2,048 wide, scale at most 2).
- It posts `{ id, png, shot, read }` to `/v1/face/picture`: the PNG as base64, the shot's `{ width, height, bounds, scale }`, and the screen text if step 7 needs it. To refuse, it posts `{ id, refused: true }`, so Home isn't left waiting.
- On Home, `faceLink.picture(purpose, signal)` returns the shot, or fails with "Your MacBook isn’t sharing its screen." after a refusal or 8 seconds.
- Home keeps the picture in memory for that turn and never writes it to disk.
- One request at a time. Face ignores more than two a second.

## When the link is down

Face says plainly that it can't reach Home and does nothing else: it never answers by itself and never queues a message.

| `FaceClient.state()` | When | What the companion shows |
| --- | --- | --- |
| `unpaired` | No pairing is saved | The field for the pairing link |
| `connecting` | Starting, or trying again | Her eye dimmed, "Reaching your other Mac…" |
| `connected` | The event stream is open | Fairy as usual |
| `unreachable` | A try failed: Tailscale off, the mini asleep or off | Her eye closed, "Can’t reach your other Mac", the box disabled |
| `changed` | The certificate didn't match the pin | "Your other Mac’s certificate changed. Pair again." |
| `forgotten` | Home answered 401 | "This Mac was removed. Pair again." |

- **Trying again.** After 1, 2, 5, 10 and then every 30 seconds. At once when the Mac wakes or unlocks, and when you click her eye. Not at all while the screen is locked.
- **A turn in flight.** If the stream drops mid-reply, Face keeps what it had and adds "Lost the link. The answer is saved in Quick chat on your other Mac." On reconnecting, `hello` names any turn still running and `/v1/face/history` gives the last reply.
- **Typed text** stays in the box. Nothing is sent later without you.
- **On Home**, with no Face connected, nothing from this plan runs: no sampling timer, no events, no voice made.

## The move

Two small scripts pack the data folder on the MacBook and unpack it on the mini, leaving out everything that is sealed to the MacBook.

**As built (15 Nov):** one script, `scripts/fairy-to-mini.mjs`, run on the MacBook, does this over SSH (`Host mini` in `~/.ssh/config`), instead of the two below. `check` looks at both Macs and changes nothing. `move` streams the app and the data folder to the mini (`ditto` and `tar` piped through `ssh`, so no archive of your chats is left anywhere), renames anything already there instead of deleting it, writes the mini's phone link settings switched on, and lists what's left for you. `finish`, once the mini's Fairy works, renames this Mac's data folder and makes it a face. All three take `--dry-run`.

`scripts/folders-to-mini.mjs` copies the folders Fairy works with (Courses, OnyxVault, Documents/Books, Research, Github) to the same paths on the mini with rsync over SSH. It never deletes there, never replaces a newer file there, leaves out `node_modules`, virtual environments and caches unless `--everything`, and sends only what changed when run again.

**`scripts/pack-fairy-home.mjs --out <file.tgz>`**, run on the MacBook:

1. Refuses if Fairy is running (`pgrep -f 'Fairy.app/Contents/MacOS'`).
2. Archives `~/Library/Application Support/lyra-companion/lyra` with `/usr/bin/tar`, about 219 MB.
3. Leaves out: `keys.json`, `gmail.json`, `calendar.json`, `drive.json`, `spotify.json`, `push-key.json`, `phone-link.json`, `phone.json`, `window.json` and every `*.sock`.
4. Prints what it left out and the archive's size.

**`scripts/unpack-fairy-home.mjs <file.tgz>`**, run on the mini:

1. Refuses if Fairy is running.
2. If a `lyra` folder is already there, renames it `lyra-before-move-<date>`; it never deletes one.
3. Unpacks, then prints the sign-ins to redo: Claude Code, Codex, Google, Spotify, the API keys, the push key, and pairing the iPhone.

Both take `--dir <folder>` in place of the real location, so tests run on a temporary folder.

**Checks before relying on it**

- Read how `connectors.json` is written. If it holds anything sealed with `safeStorage`, add it to the list left out.
- Start a Home on the unpacked copy with `FAIRY_DATA_DIR` set, on a Mac where the folders named in `local-folders.json` and in work chats don't exist. It must start cleanly and show those as missing.
- The archive holds your chats and memory in the clear. Carry it over AirDrop or a cable, and delete it from both Macs afterwards.

**Going back** is the same two scripts in the other direction, then `role.json` set to `home` on the MacBook.

## Implementation steps

Eight steps in order. Each ends with `npm test` passing and its own check; steps 1 and 2 need no change to the app.

| Step | Adds | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Pointer test | Small | Nothing |
| 2 | The move scripts; Fairy at home on the mini | Small | Nothing |
| 3 | Roles, and a Face that starts but isn't paired | Medium | Nothing |
| 4 | The face link: pairing, chat, voice, approvals | Large | 3 |
| 5 | Floating across | Medium | 1, 4 |
| 6 | Pictures on request | Medium | 4 |
| 7 | Explain anything on the MacBook's screen | Large, least certain | 6 |
| 8 | Quiz hints on the MacBook's screen | Large, restructures the quiz | 6 |

### Step 1: pointer test

**Goal.** Learn whether each Mac can tell, from its own pointer and idle time, that it is the one in use under Universal Control.

**New files**

- `scripts/pointer-log.swift`. Run as `swift scripts/pointer-log.swift > pointer-<name>.jsonl`. Every 100 ms it prints one line: `{"t": <Unix ms>, "x": .., "y": .., "idle": <seconds, with fraction>}`. `x` and `y` come from `NSEvent.mouseLocation`; `idle` from `CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)`. It needs no permission and stops on Ctrl-C.
- `scripts/pointer-report.mjs`. `node scripts/pointer-report.mjs macbook.jsonl mini.jsonl`. It exports `activeSamples(lines)`, `crossings(a, b)` and `report(a, b)` for tests, and prints: crossings each way; for each, the time from one Mac's last active sample to the moment the rule in Presence and hand-over would name the other; and how many 400 ms windows had both Macs active.
- `test/pointer-report.test.mjs`, on made-up logs.

**Passes if** every crossing is named within 0.3 seconds beyond the 1-second dwell, measured from the old Mac's last real input, no two switches are less than 2 seconds apart (that is flapping), and no stretch longer than 2 seconds has both Macs looking in use at once. A crossing normally has 0.6 to 1.1 seconds of that, because the Mac holding the keyboard and trackpad sees them just before the pointer leaves the other. The two logs are lined up by wall-clock time, which is close enough because both Macs keep network time; `--offset-ms` corrects a known difference.

**What the report does.** It replays the presence rule four ways: the plan's rule and a "latest input" rule (move when the other Mac's last input is more recent and this one has been quiet for the dwell), each with idle time to the fraction of a second and in whole seconds. Electron's `powerMonitor.getSystemIdleTime()` gives whole seconds, so on a real Mac "in use" would last up to a second after the last input, which the whole-second rows show. It also exposes a gap in the plan's rule: someone who stops moving the pointer after crossing is not named until they move again. Its last line is the choice: `follow`, `follow-finer-idle`, `follow-latest-rule` or `manual`.

**Yours.** Build the logger on the MacBook (`swiftc -O scripts/pointer-log.swift -o pointer-log`), copy the binary to the mini (AirDrop; run `xattr -d com.apple.quarantine pointer-log` there) or run `swift scripts/pointer-log.swift` if the mini has Xcode's command-line tools. Start `./pointer-log 240 > macbook.jsonl` on one Mac and `./pointer-log 240 > mini.jsonl` on the other within a few seconds of each other. For the four minutes: cross slowly ten times each way, pausing three seconds on each side; type for a few seconds on each without moving the pointer; leave both alone for ten seconds. Copy `mini.jsonl` to the MacBook and run `node scripts/pointer-report.mjs macbook.jsonl mini.jsonl --expect 20`.

**Done when** the report's result is written into this plan's copy in the repo, with the choice it leads to: follow the pointer, or "Bring Fairy here" only.

### Step 2: the move, and Fairy at home on the mini

**Goal.** Fairy runs on the mini with your data, with no new app code.

**New files (as built).** `scripts/fairy-to-mini.mjs` and `test/fairy-to-mini.test.mjs`, which runs the mini's side in a temporary home through a stand-in `ssh`.

**Interfaces.** Each script exports its work as a function so tests can call it: `pack({ dir, out, running })` and `unpack({ dir, archive, running, today })`, where `running` is a function that says whether Fairy is running.

**Tests.** Packing a temporary folder leaves out every listed file and every `.sock`; unpacking over an existing folder renames it and never deletes; both refuse while `running()` is true.

**Yours.** Install Fairy on the mini, grant her permissions, run the two scripts, sign in again, pair the iPhone with the mini.

**Done when** a check-in reaches the iPhone overnight with the MacBook closed.

### Step 3: roles

**Goal.** `FAIRY_ROLE=face` starts only the companion window and a menu-bar item, touches no data, and says it isn't paired. With no role set, nothing changes.

**New files**

- `desktop/role.cjs`: `readRole({ userData, env = process.env, read = fs.readFileSync })` returns `'home'` or `'face'`; a missing or unreadable file, or any other value, is `'home'`. `writeRole(userData, role)`.
- `desktop/face-store.mjs`: `class FaceStore({ path, seal, unseal })` with `load()`, `state()`, `savePairing({ host, port, pin, device, readKey, approveKey })`, `readKey()`, `approveKey()`, `forget()`, and `set(name, value)` for `muted`, `screen`, `follow`, `place`, `openAtLogin`. Keys are only ever written sealed. It writes with `atomicJSON` from `json-store.mjs`.
- `desktop/face-main.cjs`: `exports.start = ({ app }) => { ... }`. It takes the single-instance lock, waits for `app.whenReady()`, makes the window with the options `setCompanion` uses (main.cjs line 230), and loads `dist/companion.html` with `{ query: { role: 'face' } }` and `preload.cjs`. It registers the `fairy:companion-*` handlers the page calls, each checking the sender and the page's address as `fromCompanion` does.
- In this step the handlers do only this: `cursor` answers as on Home; `mirror-request` sends every mirrored button as hidden; `history` returns `{ name: 'Fairy', history: [] }`; `close` hides the window; the rest throw "Not paired with your other Mac yet."

**Changed files**

- `desktop/main.cjs`: the two-line branch in Roles, and a `role-set-face` handler that confirms, calls `writeRole` and relaunches.
- `desktop/presence.mjs`: `faceTrayTemplate({ state, visible, muted, screen })` with Show or Hide Fairy, Mute voice, Let Fairy see this screen, Open at login, Forget the other Mac, Switch back to the full Fairy, Quit.
- `desktop/preload.cjs`: `faceState()`, `onFaceState(callback)`, `facePair(link)`, `onFaceVoice(callback)`, `onFaceHush(callback)`.
- `src/companion.js`, `src/companion.css`: when `new URLSearchParams(location.search).get('role') === 'face'`, add the class `face-page`, which hides `#open-workspace`, `#floating-mode`, `#floating-ride`, `#floating-explain` and every `[data-mirror]` button. Show the state's message from When the link is down.
- `src/phone-link-settings.js`: the button "Use this Mac as a face of another Fairy".
- `scripts/package-fairy.mjs`, only if it lists `desktop` files one by one.

**Tests**

- `test/role.test.mjs`: the environment wins; a bad file is `home`; in `main.cjs` the branch comes before `requestSingleInstanceLock` and before `app.whenReady`.
- `test/face-store.test.mjs`: the saved file never holds a key unsealed; `forget()` removes both.
- `test/face-main.test.mjs`, reading `face-main.cjs` as text: it requires none of `core.mjs`, `sessions.mjs`, `claude.mjs`, `codex.mjs`, `antigravity.mjs`, `gmail.mjs`, `calendar.mjs`, `check-ins.mjs`, `automation.mjs` or `phone-link.mjs`, and never builds a path ending in `lyra`.

**Done when** `FAIRY_ROLE=face FAIRY_DATA_DIR=<empty folder> npx electron .` shows only the companion and the menu-bar item, and afterwards the folder holds nothing but `browser/` (Electron's own, with `face/face.json` inside it). A launch with no role runs the full suite green.

### Step 4: the face link

**Goal.** A paired Face can ask in Quick chat, hear the answer, stop it, and answer approvals.

**New files**

- `desktop/face-link.mjs` (Home):

```js
export class FaceLink {
  constructor({ ask, stop, history, makeVoice, waiting, name, onChange = () => {}, now = Date.now, uuid = randomUUID })
  async handle(request, response, { device, pathname, searchParams, link })
  connected()        // true while a Face's event stream is open
  emit(type, data)   // to that stream, if there is one
  approval(value)    // { id, title, detail } or { id, closed: true }
  say(text)          // sent only while she is shown on Face
  close()
}
```

- `desktop/face-client.mjs` (Face):

```js
export class FaceClient {
  constructor({ store, connect = tls.connect, now = Date.now, timers = globalThis, onEvent = () => {}, onState = () => {} })
  state()            // 'unpaired' | 'connecting' | 'connected' | 'unreachable' | 'changed' | 'forgotten'
  async pair(link, name)
  start(); stop(); retryNow()
  async ask(text, { explain = false } = {})   // -> { turn }
  async stopTurn()
  async history()
  async voicePart(turn, part)                 // -> Buffer
  async answer(id, decision, approveKey)
  async forget()
}
export function parsePairLink(link)   // -> { host, port, code, pin }, or throws
export function eventParser()         // feed(chunk) -> [{ type, data }], across split chunks
```

- `src/face-voice.js`: the player described under Screen pictures, voice and approvals.

**What `FaceLink` is given by `main.cjs`**

- `ask(text, { onText, onProgress, signal })` resolves to `{ text }`. It runs `quickRule(text)` and, if no rule answers, `quickChat.send(text, { onText })`. It does not call `appLauncher.openAsked`, the guide or the drawing path: those act on the Mac they run on, which would be the mini.
- `stop()` calls `quickChat.stop()`. `history()` returns Quick chat's last 20 messages. `makeVoice` is the function `phoneTurns` is given. `waiting()` returns the link's `overview().approvals`.

**A turn inside `FaceLink`.** `POST /v1/face/ask` checks the text, answers 409 if a turn is running (and if `CompanionChat` says she is still answering), makes `{ id, controller, text, parts }`, answers `{ turn }`, then runs `ask`. It emits `text` at most every 100 ms and always the last one, `voice` as parts arrive, then `done` or `failed`. A turn's parts are dropped when the next turn starts.

**Changed files**

- `desktop/phone-link.mjs`: device `kind`, `pair({ kind })`, the `face` option and the seam in `receive`, and the 403 for a Mac on phone paths.
- `desktop/main.cjs`: pull the body of `fromCompanion('chat', ...)` into a function both callers use; build `FaceLink` and pass it to `PhoneLink` as `face`; forward approvals from `toCompanion`; add `handle('phone-link-pair-mac', () => phoneLink.pair({ kind: 'mac' }))`.
- `desktop/preload.cjs`, `src/phone-link-settings.js`: `phoneLinkPairMac`, "Pair a Mac", and each device's kind in the list.
- `desktop/face-main.cjs`: the handlers now call the client. `companion-chat` calls `client.ask(text)` and resolves on that turn's `done` (or rejects on `failed` or a lost link). Events go to the page: `text` to `fairy:companion-text`, `progress` to `fairy:companion-progress`, `approval` and `approval-closed` to `fairy:companion-approval`, `say` to `fairy:companion-say`. `companion-answer` asks for Touch ID before an Allow.
- `companion.html`: `media-src 'self' blob:`. `src/companion.js`: the pairing field and the voice player, only on a `face-page`.

**Tests**

- `test/face-link.test.mjs`, against a real `PhoneLink` on port 0, set up as `test/phone-link.test.mjs` does. A phone's code can't pair a Mac, nor a Mac's a phone; an old record with no `kind` is a phone. A phone's key gets 401 on `/v1/face/history`; a Mac's key gets 403 on `/v1/chats`. An ask yields `text` then `done`; a second ask meanwhile gets 409; stop yields `failed`. Voice parts are served and the next is 404. Approvals arrive as events. A second stream closes the first.
- `test/face-client.test.mjs`, against the same real server. A wrong pin fails the request and the server counts no request. `parsePairLink` refuses a wrong scheme, a missing `kind=mac` and a short pin. The retry times follow 1, 2, 5, 10, 30 seconds on a fake clock. A 401 gives `forgotten`. The event parser copes with an event split across chunks.
- In `main.cjs`, by regular expression: a Face turn does not send `fairy:companion-speak`.

**Done when** two test copies on one Mac pair by a pasted link (Home: `FAIRY_DATA_DIR=/tmp/h FAIRY_PHONE_LINK_PORT=47626`; Face: `FAIRY_ROLE=face FAIRY_DATA_DIR=/tmp/f`). A question typed into Face is answered aloud by Face, the chat is in Home's Quick chat, and `/tmp/f` holds no chat.

### Step 5: floating across

**Goal.** She is shown on the Mac in use and hidden on the other, by the rule in Presence and hand-over. If step 1 failed, build only the claim rows and "Bring Fairy here".

**New files**

- `desktop/face-presence.mjs`: the constants, and `class FacePresence({ now })` with `home(report)`, `face(report)`, `faceConnected(on)`, `homeLocked(on)` and `decide()`, which returns `{ shownOn, changed }`. A report is `{ activeAgoMs, locked, claim }`.
- `desktop/pointer-sampler.mjs`: `class PointerSampler({ point, idleSeconds, display, now })` with `sample()`, which returns `{ active, activeAgoMs, entry, exit }`. `entry` and `exit` are `{ edge, along }`, with `edge` one of `left`, `right`, `top`, `bottom` and `along` from 0 to 1. Also `glidePath(from, to, steps)`, which returns the window bounds for each step.

**Changed files**

- `desktop/face-link.mjs`: `POST /v1/face/presence`, the `show` event, `show` in `hello`, and `say` held back while she is shown on Home.
- `desktop/main.cjs`: a 200 ms sampler that runs only while `faceLink.connected()`; on a change of `shownOn`, hide or restore Home's own avatar as Presence and hand-over says.
- `desktop/face-main.cjs`: its own sampler and reports; the glide; hiding with `CompanionVisibility`.
- `desktop/presence.mjs`: "Bring Fairy here" in both menus.

**Tests**

- `test/face-presence.test.mjs`, on a fake clock: one test for each row of the rule's table; activity that alternates inside the dwell never moves her; a report older than 15 seconds sends her Home; a claim holds until the other Mac claims.
- `test/pointer-sampler.test.mjs`: active by a moved pointer, active by idle time 0, quiet otherwise; the nearest edge and the place along it; `glidePath` starts and ends where asked.
- In `main.cjs`, by regular expression: the sampler is started and stopped by the Face's connection, not at startup.

**Done when**, on the real pair of Macs, ten crossings each way put her on the right Mac every time, never on both, and never on neither for more than 1.5 seconds.

### Step 6: pictures on request

**Goal.** During a turn a Face started, Home can ask that Face for one picture of its screen, and Face can refuse.

**Changed files**

- `desktop/face-link.mjs`: `picture(purpose, signal)`, the `want-picture` event and `POST /v1/face/picture`, as Screen pictures, voice and approvals describes. A picture posted with no matching request gets 409.
- `desktop/face-main.cjs`: a `ScreenHelper`, the "Let Fairy see this screen" switch, the permission check, the capture and the post. `desktop/face-client.mjs`: `picture(reply)`.
- `desktop/main.cjs`: find how a companion turn gets screen context today (search for `awareness.fresh(`). If Quick chat turns use it, give Face turns a second `ScreenAwareness` whose `capture` is `faceLink.picture('awareness')` and whose `allowed` is `faceLink.connected()`. If they don't, this step is plumbing only and step 7 is its first user.

**Tests** (`test/face-picture.test.mjs`): a picture is accepted only during that Face's turn; a refusal and an 8-second silence both fail with the message; a body over 20 MB gets 413; `face-link.mjs` imports nothing that writes files.

**Done when** a test copy pair shows Home receiving a picture of the Face's screen during a Face turn with the switch on, and the refusal message with it off.

### Step 7: Explain anything on the MacBook's screen

**Goal.** The pen on Face draws an answer on the MacBook's screen, thought out on Home.

**How.** `explainOnScreen` in `screen-ink.mjs` already takes `capture`, `read` and `show` as arguments. For a Face turn with `explain: true`, Home passes:

- `capture`: `() => faceLink.picture('explain')`.
- `read`: a function that returns the screen text Face sent with the picture. Face runs `readScreenText` on its own shot before posting.
- `show`: `state => faceLink.emit('ink', { id, state })`.

Face builds its own `InkScene` and `InkOverlay`, as `main.cjs` does at line 532, and on an `ink` event calls `inkOverlay.show(state, display.bounds, display.id)`. The overlay's `onAsk` and `onPen` go to the Face's page on the existing `fairy:companion-ask` and `fairy:companion-morph` channels. `companion-explain` on Face calls `client.ask(text, { explain: true })`. The `face-page` class stops hiding `#floating-explain`.

**Check first.** The `state` given to `show` must survive `JSON.parse(JSON.stringify(state))` unchanged. Write that test before anything else. If it fails, stop and report what in the state isn't plain data; do not invent a format.

**Tests** (`test/face-explain.test.mjs`): the round trip above on a real scene; during a Face explain turn Home never calls its own `inkOverlay` or `screenCapture` (pass in stand-ins that fail if called); a refusal of the picture ends the turn with the message.

**Done when**, on the real pair, pressing the pen on the MacBook and asking about what is on its screen draws the answer there, and nothing appears on the mini's screen.

### Step 8: quiz hints on the MacBook's screen

**Goal.** Quiz hints work for a question open on the MacBook, with only the model call made on Home.

**How.** Read how the quiz is built in `main.cjs` (lines 1017 to about 1100: `QuizOverlay`, `QuizMonitor`, `QuizTarget`, the quiz's `ScreenAwareness`). Move that construction into `buildQuiz({ solve, ... })` in a new `desktop/quiz-setup.mjs`, so Home and Face build the same watcher. Home passes its model-backed `solve`. Face passes `question => client.quiz(question)`, which posts to `/v1/face/quiz`. Home's handler runs the same `solve`, notes the call with `noteBackground('quiz', ...)`, and returns `{ answer }`. Images in the question travel as base64.

On Face the answer cache and question history live in memory only. The `face-page` class stops hiding the two quiz buttons, whose state is now Face's own.

**This step restructures working quiz code**, so it needs your go-ahead before it starts, and Home's quiz must be checked by hand afterwards.

**Tests.** The existing quiz tests pass unchanged. `test/face-quiz.test.mjs`: `/v1/face/quiz` calls the same `solve` and records one background call; Face's watcher makes no model call of its own.

**Done when** a hint appears on the MacBook for a practice question open on the MacBook (`examples/mip-practice/mip-practice-quiz.html`), and Home's own quiz still works.

## Changes made while building

Steps 3 to 5 were built on 15 Nov 2026. Where the code differs from the plan above, the code is right, for these reasons:

- **Test copies have a Keychain item of their own.** A full test copy (`FAIRY_DATA_DIR`) used the installed Fairy's Keychain item and made macOS ask to let the dev Electron app open it. Test copies now use `lyra-companion-test`; the installed app keeps `lyra-companion`.
- **A face sees only the questions it can answer.** The phone link's Allow and Deny work for the questions it lists, which are a work session's. A chat's own questions, such as a Calendar event, aren't sent to a face; they are answered on the other Mac.
- **Answers from rules aren't saved in Quick chat**, as for the companion today. Answers from the model are.
- **`native/Idle.swift` (`fairy-idle`)** gives idle time to the fraction of a second, because step 1 showed Electron's whole seconds make her late. It is built by `npm run build:idle`, packaged with the other helpers, and stops when Fairy closes its input.
- **Opening Fairy again on either Mac brings her there**, the same as Bring Fairy here. Bring Fairy here moves her at once; following the pointer carries on after it. With Follow the pointer off on the face, only Bring Fairy here moves her.
- **On a face, Explain draws on the face's screen** (step 7) and desktop tasks are refused, since they would run on the other Mac. As on the full Fairy, a question that asks for a drawing, or one asked while a drawing shows, is drawn too.
- **An Explain ask from a face says which parts still show there** (`drawn`, the scene's ids), so a card you closed on the MacBook isn't drawn again by the next answer. Home keeps a scene for the face apart from its own, and "clear" wipes the face's.
- **The face draws on the display its picture was of** (the pointer's at the time), kept clear of her window, with the pen leaving from her eye. Hiding her yourself wipes the drawing; gliding to the other Mac leaves it.
- **Quiz hints on a face show beside its menu-bar icon** (`Tray.setTitle`), not in the full Fairy's native menu-bar hint, which replaces the menu-bar item it runs in. The face's menu has a Quiz hints switch with what it's doing, and the ring's Quiz hints and Auto hints are its own. They need Let Fairy see this screen (the question's picture goes to the mini) and Screen Recording. Written answers aren't copied on a face. The mini answers one face question at a time; a newer one stops the model call for the one before.
- **A face has ⌃⌥A and ⌥⌘** (`quick-ask.mjs`, as on the full Fairy): the area is dragged on the face's ink window, and the selection goes to the mini with the Explain ask as `focus` (plain numbers, in the display's points). Holding ⌃⌥ to talk stays off on a face, which has no microphone of its own yet. The keys need Accessibility and Input Monitoring for Fairy on the MacBook.
- **The mini waits 30 seconds for a picture, not 8**, and a refusal says why (`reason`: off, locked, busy, permission, failed), each with its own message. On the real MacBook the face took the picture but 8 seconds didn't cover reading its text with Vision (up to 9 seconds) and the upload, and a timeout showed the same message as the switch being off.
- **Ride along goes with her** (`desktop/ride-carry.cjs`). The Mac she leaves reads its page's Ride along switch and whether she's riding, and tells the page she's away so it stops asking to ride; the face sends that state in its presence reports and the mini in the `show` event. The Mac she reaches takes on the switch and, if she was riding, rides at once at the pointer instead of gliding in. Before this, each Mac stopped riding without telling its page, so she arrived as the companion and didn't ride again until the page reset.

## Decisions still needed

These are yours; the right-hand column is what the plan assumes until you say otherwise.

| Decision | Needed before | Assumed until then |
| --- | --- | --- |
| Where this sits in the plan order | Any step | After the existing-feature work and Proton Research |
| How the mini's copy of Fairy is built and signed | Step 2 | Built on the mini from `main`, as on the MacBook |
| Which projects get a copy on the mini, for work sessions there | Using step 2 for work | None; work sessions on the mini wait |
| A mini with FileVault waits at its login screen after a power cut, so Fairy is down until you unlock it | Step 2 | FileVault stays on, and that is accepted |
| How much memory Fairy may use on the mini beside Nexus jobs | Step 2 | No limit set; she measured 0.9 to 1.2 GB on the MacBook |
| Whether a Face may allow a question marked Mac-only, with Touch ID | Step 4 | No: those are allowed only on the mini |
| Follow the pointer, or only "Bring Fairy here" | Step 5 | Whatever the pointer test in step 1 shows |
| The 1-second wait before she follows | During step 5 | 1 second |
| Restructuring the quiz code for step 8 | Step 8 | Not started without your go-ahead |

**Not in this plan:** the MacBook's microphone and meeting notes; desktop tasks and any other control of the MacBook; opening apps on the MacBook when asked from Face; Fairy's links to Tachyon, Flux, Electron and AudioPulse on the MacBook; ride-along on Face; a full workspace window on the MacBook.

## Progress

Kept in this file only. One row per step; fill it in when the step's check has passed.

| Step | State | Branch or commit | Date | Notes |
| --- | --- | --- | --- | --- |
| 1. Pointer test | Run done on 15 Nov; one case left to test (keys typed with the pointer on the mini) | `two-macs-1` | 2026-11-15 | Result: she can follow the pointer. 24 crossings (12 each way) plus one when you moved to start the second logger, every one named within 0.2 s of the old Mac's last input, none flapping. The sampler must read idle time to the fraction of a second: Electron's whole seconds were late (up to 1 s, once 3.2 s). Dwell: 0.5 s is the shortest clean value (0.4 s flaps), so the plan's 1 s leaves a margin. On the mini, driven from the MacBook by Universal Control, idle time resets only to about 0.5 s and the pointer position is the main signal. Not yet tested: typing on the MacBook's keyboard while the pointer is on the mini. |
| 2. The move; Fairy at home on the mini | Moved on 15 Nov; your part not done | `two-macs-2` | 2026-11-15 | `move` copied the main build and 224 MB of data in 33 s. Fairy runs on the mini with all 53 chats; her phone link made its own certificate there and listens on the mini's Tailscale address, port 47616. Not yet: permissions on the mini, Claude Code (not installed there), sign-ins, keys, pairing the iPhone, `finish`. Courses, OnyxVault, Books, Github and Research aren't on the mini. |
| 3. Roles | Done | `two-macs-3` 291690e | 2026-11-15 | A face test copy starts with only the companion and a menu-bar item, says it isn't paired, and writes nothing but Electron's own folder and `face/face.json`. |
| 4. The face link | Done | `two-macs-4` 3eb4080 | 2026-11-15 | Two test copies paired over Tailscale with a pasted link; the face asked, the full Fairy's rule answered, the reply showed on the face; the link dropped and came back by itself. Her voice wasn't heard: test copies have no voice key. |
| 5. Floating across | Done; tested on the real pair 15 Nov | `two-macs-5` 779afc0 | 2026-11-15 | Bring Fairy here (and opening Fairy again) moved her to the face and back, sliding out and in; the face showed her, dimmed, when the link dropped. Following the pointer between the two real Macs is untested: both test copies share one pointer, and it needs step 2 and an installed face. On the real pair (15 Nov, 15:31): 8 crossings, each handover within about 0.1 s, never on both Macs or neither; her voice played on the MacBook. The first try failed only because Vorssaint’s Auto Quit had quit the face; Fairy is now one of its exceptions. |
| 6. Pictures on request | Done; on main | `two-macs-6` 340e1c4 | 2026-11-15 | Plumbing only, as the plan foresaw: Quick chat turns don’t use screen awareness, so step 7 is its first user. A test face with the switch on but no Screen Recording (the development Electron) refuses, and the turn ends with the message. |
| 7. Explain anything on the MacBook | Done; tried on the real pair 15 Nov | `two-macs-7` d2cde46 | 2026-11-15 | The drawing’s state survives a JSON round trip (every mark and card kind). Two test copies: the pen on the face asked, the mini asked for a picture, and the face’s refusal (no Screen Recording for the development Electron) ended the turn with the message. A drawing on the real MacBook needs the installed Fairy, which has Screen Recording. On the real pair the pen drew on the MacBook, once Screen Recording was re-granted (it named Fairy’s old signature) and the mini waited long enough for the picture; ⌃⌥A works there too. |
| 8. Quiz hints on the MacBook | Built; the real pair not yet tried | `two-macs-8` | 2026-11-15 | The watcher moved to `desktop/quiz-setup.mjs` (efce1ce), and the full Fairy builds it from there with its quiz unchanged: a test copy took a picture, read it and waited for a hovered heading as before. A test face, with quiz hints on, took pictures of its screen and read them ("No readable question", as no quiz was open). Its question goes to `/v1/face/quiz`, which the tests check calls the mini’s own solve. Still to check by hand: the mini’s own quiz hints, and a hint on the MacBook for a practice question. |
