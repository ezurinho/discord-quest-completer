# Changelog

## 4.0.1 — 2026-11-26

The new smoke case found a real one on its first run.

- **A quest that has not started was still being enrolled.** `isSupported` learned about
  `startsAt` in 4.0.0 and the card reflected it, but the selection pass and the drive loop
  still called it with the task alone, so the run picked the quest, asked to join, and put a
  future quest on the block list with the 404 it earned. Both call sites pass the quest now,
  and `enroll` refuses anything this client cannot drive.
- The smoke suite covers the two states that were only asserted by the checker: a quest with a
  future `startsAt` must render **SOON**, keep its box disabled and send no request naming it,
  and a claim refused on both attempts must leave a **CLAIM** pill and never retry on its own —
  asserted again after a Stop/Start, which is where a timer would have shown up.

## 4.0.0 — 2026-11-26

The pass that came out of reading every other tool's source and Discord's own quest
documentation. Nothing here is a rewrite; every item is a state the client already tracks
and this script was ignoring.

- **Quest access suspension is read and obeyed.** `questAccessSuspendedUntil` and
  `isQuestAccessSuspended` arrive beside `questEnrollmentBlockedUntil` on the quest store,
  and Discord's own client refuses to start any quest while they are set. This one locks
  every task type, video included. The run now stops with the date instead of heartbeating
  into a locked surface, and the footer says `QUEST ACCESS SUSPENDED` while it lasts.
- **Quests that have not started are left alone.** `config.startsAt` / `starts_at` is read;
  an unstarted quest shows **SOON**, its checkbox is disabled, and it is never enrolled.
  Before, every one of them answered 404 and landed on the block list.
- **The reward is on the card.** Orbs are summed from `config.rewards.rewards[].orbQuantity`
  and printed next to the progress, with the account total in the footer, so the run has a
  score instead of a pile of percentages.
- **The list is ordered by what matters.** Active quests first, highest progress at the top,
  then the ones this client cannot drive, then the finished ones. Twenty quests in fetch
  order was a wall of noise.
- **A failed claim is manual, not a loop.** Claiming is often gated by a captcha that no
  amount of retrying clears. Two attempts, then a **CLAIM** pill on the card that retries
  exactly once per press, and the auto-claim pass skips a quest that already failed so it is
  not re-POSTed every minute.
- `isSupported` now takes the quest as well as the task, so "not automatable" means the
  quest, not only its type.
- The diagnosis prints the access state and how many quests have not started, and the video
  sample line carries the orb value.
- The smoke suite runs a third time against a suspended store and asserts that the run
  sends zero requests; the orb line is asserted on the rendered card.

## 3.6.1 — 2026-11-26

The panel worked and the console filled with the client's own crash.

- `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` from
  `setActiveIrProgressingPlayOnDesktopQuests`, thrown inside Discord's
  `RUNNING_GAMES_CHANGE` handler four times a second as soon as a play quest was
  completed. The handler lowercases fields of every running game; the stand-in carried
  only the fields this repo knew about, so the first one it did not know was `undefined`
  and every log line after it was noise.
- The stand-in now carries `distributor`, `sku`, `shortcutName` and `version`, and is
  wrapped in a `Proxy` that answers `''` for any other string field while leaving real
  properties, methods and symbols alone. The client can lowercase whatever it likes.
- A play quest with no application id is no longer ticked or announced: the stand-in had
  nothing to be, so it never advanced and only made the log look busy. It shows
  **NOT AUTOMATABLE** like the stream quests do.
- The smoke suite asserts both: a known field is a string, an unknown one is `''`.

## 3.6.0 — 2026-11-26

Six things the client was doing wrong, found by reading the run instead of the happy path.

- **Unchecking a card mid-run did nothing.** The single video cadence picked the next
  quest without asking whether it was still ticked, so a quest you turned off kept
  posting until the next paste. The selection is now part of the pick.
- **A video timestamp could outrun the wall clock.** `sent` climbed on its own when the
  store lagged, so after a slow patch the script claimed more seconds than the player
  had been running — the exact shape the endpoint answers with "not accepting
  progress". Every post is now capped at the value this run started from plus the
  elapsed seconds plus three of slack.
- **Expired quests were driven.** They answer 404 on every endpoint, which filled the
  log with `cannot join` and burned a request per pulse. `config.expiresAt` /
  `expires_at` now drops them from the list; a completed quest survives its expiry
  because the reward is still claimable.
- **A blocked enrolment was ignored.** `questEnrollmentBlockedUntil` was printed and
  then every quest asked to join anyway, one 404 per quest per run. While the block is
  live the run stops asking and drives only the quests already joined.
- **Every render rebuilt the list.** Once every eight seconds the cards were thrown away
  and rebuilt, which stole the checkbox focus and jumped the scroll. A signature of what
  is on screen decides whether to paint; the footer tally still updates every tick.
- **Hiding the panel was a one-way door.** `×` removed it and the README's answer was
  "paste again". A small **QC** chip in the corner brings the same panel back, so there
  is still exactly one copy running.
- `retry_after` is read as seconds but a millisecond answer is no longer multiplied by
  1000, which would have parked the queue for hours.
- `modules()` lost its broken indentation, and the checker grew four new invariants:
  the clock ceiling, the enrolment block, the expiry filter and the selection filter.

## 3.5.1 — 2026-11-26

The suite measured the queue, not the script.

- The smoke suite waited 2.6 s for the first video request. Every request goes through
  the client queue with a 250-500 ms gap, and on a fresh run the video tick is queued
  behind the enrolments and the claim, so the first post could land after the deadline and
  the rate-limit retry after that. It waits for the queue now.

## 3.5.0 — 2026-11-26

`PLAY_ACTIVITY` quests can now be driven, and they are no longer misread as games.

- Activity quests are credited by `POST /quests/<id>/heartbeat` with the call stream key,
  not by anything in a store. The key is built the way the client builds it:
  `call:<dm channel>:<user>` when you sit in a DM call, `guild:<guild>:<channel>:<user>`
  when you are in a server voice channel, and nothing when you are in neither.
- Because the key is 'no key, no heartbeat', an activity quest shows **NEEDS VOICE** and
  stays unchecked instead of silently doing nothing.
- Fixed a classification bug that would have made the feature useless: `PLAY_ACTIVITY`
  contains the substring `PLAY`, so every activity quest was typed as `GAME` and got a
  stand-in process instead of a heartbeat.
- A beat that Discord never credits stops after four attempts with
  `Discord is not accepting activity beats` instead of looping forever.
- The smoke suite now carries an activity quest, a DM call and a user, and asserts the
  heartbeat and its stream key.

## 3.4.0 — 2026-11-26

Play quests were invisible to the client, and now they are not.

- The stand-in was only injected through `getRunningGames` and `getGameForPID`. Canary
  decides quest eligibility from the visible and candidate views, so a game missing from
  `getVisibleGame`, `getVisibleRunningGames`, `getCandidateGames` and
  `getRunningDiscordApplicationIds` never gets a heartbeat scheduled and the quest sits at
  0 % forever. All six are patched now, each one only if the build has it.
- `RUNNING_GAMES_CHANGE` is dispatched again, with the `games` field. The missing field is
  exactly what made the client's handler throw "reading 'some'" and crashed ClipStore in
  2.3.0; the dispatch is inside a try/catch and the error is reported instead of killing
  the run.
- The stand-in is withdrawn when Stop is pressed, so the client stops scheduling
  heartbeats for a process that no longer exists.
- A quest waiting on its enrolment still registers its stand-in immediately, instead of
  waiting up to a minute for the next pulse.
- Module lookup accepts a method carried directly on the object, not only on its
  prototype.
- The smoke suite asserts that a game is announced with the `games` array and withdrawn
  on Stop.

## 3.3.0 — 2026-11-26

Find the store even when every name changed.

- `QuestStore` is now matched by `constructor.displayName` as well as by a prototype
  method. Discord renames minified export keys between builds; the class name survives.
  Orion matches its stores the same way.
- The smoke suite runs twice, once with a prototype-shaped store and once with a
  displayName-only store, so both discovery paths are executed.

## 3.2.0 — 2026-11-26

The failure paths get a test too.

- The smoke suite now throws a 429 with `retry_after` at the first video post and a 404
  at every enrolment, then asserts the retry happened, the 429 was logged, and the 404
  was reported instead of swallowed. Backoff and error reporting were the two paths
  nobody had ever executed outside a live client.

## 3.1.0 — 2026-11-26

- Unchecking every quest ran *every* quest: the guard was `state.selected.size &&`,
  so an empty selection fell through to "no filter". An empty selection now means
  nothing runs.
- The smoke suite covers the picker (uncheck, restart, nothing driven), the claim path
  with its sealed blob, the `?` diagnosis, and that Stop really stops the requests.

## 3.0.0 — 2026-11-26

Every render since 2.6.0 threw, and this is the fix.

- `cardFor` read `supported` six lines before declaring it. That is a temporal dead
  zone error, not a syntax error, so `node --check` was happy and the panel still
  looked ready: pressing Start logged `[dqc] ReferenceError: Cannot access 'supported'
  before initialization` and then nothing. 2.6.0 through 2.9.0 were broken the moment
  the quest list was drawn.
- The flag now comes from `isSupported(task)`, declared above its first use.
- `tools/smoke.js` boots the real bundle in a Node VM with a stub DOM and fake webpack
  modules, presses Start, and asserts a video post plus an enrolment. `npm run check`
  runs it, so a crash of this shape cannot ship again.

## 2.9.0 — 2026-11-26

Small things that make the traffic look less like a script.

- Gaps between requests are jittered (250-500 ms) instead of a fixed 300 ms.
- Repeated 429s back off exponentially (2x, 4x, 8x) rather than a flat multiplier.
- The stand-in game now carries `exeName`, `exePath` and `cmdLine` derived from the
  application id, which is what the client's own entries have.
- Pressing Start clears the previous run's marks, so a retry is a retry.

## 2.8.0 — 2026-11-26

Documentation that matches the code, and regressions that stay dead.

- README rewritten: the old one still promised 5 s of video every 900 ms and a
  `RUNNING_GAMES_CHANGE` dispatch, both removed versions ago. It now documents the real
  cadence, the sealed enrolment body, auto-claim, the picker and the `?` diagnosis.
- New troubleshooting section: how to read `blocked until`, `app none`, `joined` and
  `Discord is not accepting progress`, in that order.
- `npm run check` now asserts the eight fixes as regression invariants, so a later edit
  cannot quietly bring back the game dispatch or drop the sealed blob.
- A failed claim is retried once after 3 s; a 404 is not.

## 2.7.0 — 2026-11-26

Ask the client what it holds.

- `?` in the header prints a diagnosis to the log: quest-related store keys, the
  enrolment block date, counts by task type, joined/done totals, and for the first video
  quest its task keys and application id. That is the difference between "no funciona"
  and knowing which field is empty.
- Four consecutive video posts with the store value unchanged means Discord is not
  accepting progress; the quest is marked and the log says so, instead of posting into
  the void every 8 s.

## 2.6.1 — 2026-11-26

- `RUNNING` never appeared: the label still checked the per-quest timer map that the
  single video loop replaced. It now reads the selection and the running flag.

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

