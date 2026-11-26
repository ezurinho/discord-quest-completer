# Changelog

## 1.6.0 — 2026-11-26

Quests the account cannot join stop pretending they can.

- A 404 from `enroll` marks the quest UNAVAILABLE and logs `cannot join: <name>`.
  Before, it printed `[object Object]` and tried again on every cycle.
- The ETA only appears for quests that are actually advancing; a NOT JOINED card no
  longer promises `~26s left`.

## 1.5.0 — 2026-11-26

The panel tells you how long it will take, and survives a reload.

- Each card shows an ETA (`~2 min left`) computed from the real 5 s-of-video-per-900 ms
  ratio, not from a guess.
- A 5xx or a 502 retries once after 2 s instead of dropping the quest.
- The panel remembers where you dragged it (`localStorage`, per browser).

## 1.4.0 — 2026-11-26

Stops hammering quests that cannot answer.

- A 404 on `video-progress` marks that quest UNAVAILABLE and stops its timer, instead
  of retrying every 900 ms until the queue turns into 429s.
- A 429 pauses every video for the `retry_after` window instead of only the request
  that hit it.
- Quests that are still `NOT JOINED` after enrolling are skipped with a reason in the
  log, so the panel says why instead of pretending they are queued.
- Errors read `body.message` first: no more `video error: [object Object]`.

## 1.3.0 — 2026-11-26

Finds the modules the client actually ships.

- The old search matched the first module that merely mentioned `getQuest`, which was
  the i18n table: the panel listed two quests named `undefined` and posted to
  `https://discord.com/[object Object]`. Modules are now identified by a prototype
  method (`getQuest`, `flushWaitQueue`, `getStreamerActiveStreamMetadata`) and their
  mangled export key is read from the object that has it.
- Task config falls back to `taskConfigV2`, so quests without `taskConfig` are read
  instead of skipped.
- Requests are serialised through one queue with 300 ms spacing and a real 429 wait
  from `retry_after`, instead of firing in parallel.
- Enrolment sends `{ location: 1 }`, the body the client sends.

## 1.2.0 — 2026-11-26

A panel worth looking at.

- Header is a gradient bar with a logo tile, the version chip and three compact
  buttons; the window is rounded, translucent and draggable by its header.
- Every quest is a card with a type icon, a status pill (RUNNING / QUEUE / DONE) and a
  gradient progress bar that reads `342 / 900 s · 38%` instead of a bare number.
- The log is timestamped, colour-coded (ok / err) and capped at 140 rows.
- The footer counts claimed quests and names the shortcut to reopen the panel.
## 1.1.0 — 2026-11-26

A script for the console, not an extension.

- Dropped the userscript header and the `.meta.js`: the file is copied whole and
  pasted into the Discord app's DevTools console (Ctrl+Shift+I).
- Re-pasting removes the previous panel, so two copies can never drive one quest.
- README covers the first-time `allow pasting` prompt and Discord's self-XSS notice.

## 1.0.0 — 2026-11-26

First release.

- Panel with Start/Stop, quest list with live progress, and a log.
- Video quests advance `/quests/<id>/video-progress` by 5 s every 900 ms.
- Game quests dispatch `RUNNING_GAMES_CHANGE` every 15 s.
- Enrollment for quests that were never accepted.

