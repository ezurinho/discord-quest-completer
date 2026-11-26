# Changelog

## 2.6.0 — 2026-11-26

Pick what runs, and never run twice.

- Every card has a checkbox, selected by default for video and game quests. Start only
  drives what is ticked, so a broken quest can be left out without editing the file.
- `STREAM` and `ACHIEVEMENT` cards say NOT AUTOMATABLE and their checkbox is disabled:
  a stream needs a real Go Live with another person in the channel, and achievements
  are validated by the game or the activity backend, not by the client.
- Pasting again stops the previous instance first. Before, the old panel's timers kept
  running, so two video loops and two request queues hit the same account.

## 2.5.0 — 2026-11-26

The July 2026 field move, and video first.

- Discord moved the quest application id from `config.application.id` to
  `config.taskConfigV2.tasks.<KEY>.applications[0].id`. Reading only the old path gave
  `undefined`, so every play quest registered a stand-in with no app and nothing
  advanced. Both paths are read now.
- A quest offering `WATCH_VIDEO` is driven as video even when it also lists a stream or
  a play task. Video is the path that still works; a broken play task was winning the
  selection and parking the quest.
- The pulse no longer re-registers stand-ins for quests already marked unavailable.

## 2.4.0 — 2026-11-26

Progress stops going backwards.

- The video loop worked from the snapshot taken when Start was pressed, so
  `questValue` returned the same number for up to a minute and Discord kept receiving
  the same `timestamp`. The store is re-read before every tick, and the highest value
  sent is remembered as a floor.
- Completed quests are claimed during the run, not only at the start, and each quest is
  claimed once per session.

## 2.3.0 — 2026-11-26

Stop crashing Discord's own handlers.

- 2.2.0 dispatched `RUNNING_GAMES_CHANGE` with a hand-built process object and the
  client's ClipStore threw `Cannot read properties of undefined (reading 'some')` on
  every beat. That is an error in their code caused by an incomplete object on ours, so
  the dispatch is removed: the `RunningGameStore` patch stays, which is what the
  heartbeat reads.
- `stop()` restores the patched store methods instead of leaving the client altered.
- Nothing else changes; the video path never used the dispatch.

## 2.2.0 — 2026-11-26

The requests now carry what Discord's own client sends.

Source: `nyxxbit/discord-quest-completer` (`index.js` v4.11.5), whose comments document
this against the live client. Two things were missing from every call we made:

- **`traffic_metadata_sealed`**: a per-quest blob the server issues with the quest list
  and the client echoes back on `enroll` and `claim-reward`. Bodies are now
  `{ platform: 0, location: 11, is_targeted: false, metadata_sealed: null,
  traffic_metadata_sealed: <quest.trafficMetadataSealed> }`, which is what the 404s were
  about: `{ location: 1 }` is not the shape the client sends.
- **Tasks delivered as a `Map`**: `Object.keys()` on a Map is empty, so quests read as
  "no tasks" and were skipped without a line in the log. `taskKeysOf`/`taskAt` handle
  both shapes, and `taskConfigV2` wins when it carries tasks.

Also new:

- **Auto-claim**: a completed quest without `claimedAt` posts `claim-reward`, so the
  rewards of the three you finished stop sitting there unclaimed.
- **Enrolment block**: `questStore.questEnrollmentBlockedUntil` is logged with its date
  when set. That is Discord saying it stopped accepting enrolments on the account, and
  no retry will change it.

## 2.1.0 — 2026-11-26

Nothing waits for enrolment any more.

- 2.0.0 still logged nothing because the run enrolled every quest **before** printing
  anything, and `Promise.all` over 46 requests meant a quiet panel until the slowest
  one settled (or timed out, 25 s each, serialised). The classification and the log now
  come first; enrolment is fire-and-forget per quest.
- Requests time out in 12 s instead of 25 s.
- A quest that is not enrolled is logged as `not joined · asking to join` and picked up
  by the 60 s store refresh when Discord accepts it, instead of being written off.

## 2.0.0 — 2026-11-26

It stops hanging, and it tells you where.

- The 1.9.0 run died silently after `49 quests on this account`: `enroll` awaited a
  request that Discord's client never settled while rate limited, so `run()` never
  reached `running: leave the app open` and nothing else happened. Every request now
  has a 25 s deadline.
- `run()` is wrapped: a crash logs the message and the stack instead of vanishing, and
  an `unhandledrejection` listener catches anything that escapes.
- `taskOf` no longer throws on a quest without `config`, which is what an uncaught
  rejection during the loop would have looked like.
- Enrolment runs concurrently instead of one long serial chain.
- Each quest logs its state as it is picked up: `Firefox Browser · VIDEO · 0/142`, so a
  quiet panel now means a real reason, not a swallowed exception.

## 1.9.0 — 2026-11-26

The cooldown survives a reload, and repeated strikes escalate.

- `pauseUntil` is saved in `localStorage` (`dqc-pause`). Re-pasting during a 34-minute
  limit used to start the count from zero and earn another one; now the panel resumes
  the old cooldown and says how long is left.
- Every further 429 on the same session multiplies the wait (up to 4x); the log names
  the strike, so a repeating pattern is visible instead of a single silent pause.
- Pasting while limited logs `cooldown from a previous paste: N min left` before it
  reads anything.

## 1.8.0 — 2026-11-26

One cadence for the account, and the cooldown is visible.

- The video loop used to run per quest: four quests meant four loops against the same
  rate-limit bucket. There is now a single loop that advances one quest at a time,
  round-robin, every 7-9.5 s. That is what earns the 429s in the screenshots.
- While limited, the footer counts it down (`rate limited, 33:48 left`) instead of the
  panel looking frozen.
- The selected quest is re-read from the store on every turn, so a finished video stops
  immediately instead of waiting for the next 60 s pulse.

## 1.7.0 — 2026-11-26

Video progress at the speed a player actually posts it.

- `video-progress` now runs on a randomised 7-9.5 s loop with six-decimal fractional
  timestamps, which is Discord's own player cadence. The old loop posted 5 s of video
  every 900 ms, five times faster than anything a browser does, and that is what
  produced the 429s.
- Game quests keep one stand-in process per app instead of a new pid every 15 s, and
  `getGameForPID` is patched too, so Discord's own 60 s heartbeat can find it. The
  dispatch now repeats every 60 s, matching the heartbeat.
- ETA is real seconds again, since progress advances at real time.

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

