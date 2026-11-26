# Discord Quest Completer

A script you paste into the Discord desktop app's console to finish Quests. One file,
no extension, no install.

## Use it

1. Open the Discord app and press **Ctrl+Shift+I** (DevTools).
2. Click the **Console** tab.
3. Open [`discord-quest-completer.js`](https://github.com/ezurinho/discord-quest-completer/releases/latest/download/discord-quest-completer.js) and copy the whole file.
4. Paste it into the console and press **Enter**.
5. The panel appears in the corner: tick what you want and press **Start**.

**Chromium blocks pasting into the console the first time.** It prints
`Warning: Don't paste code...` above the prompt. Type `allow pasting` and press Enter,
then paste normally. Discord's own "Hold up!" message is the client's warning about
self-XSS, not an error from this script.

Pasting a second time stops the previous copy and replaces the panel. Two live copies
would double every progress request.

## What it does

| Task | How |
|---|---|
| `WATCH_VIDEO` | `POST /quests/<id>/video-progress` with fractional `timestamp`, every 7-9.5 s, one quest at a time |
| `PLAY_ON_DESKTOP` | patches `RunningGameStore.getRunningGames` and `getGameForPID` with a stand-in process; Discord's own heartbeat does the rest |
| Enrol | `POST /quests/<id>/enroll` with the sealed attribution blob the client sends |
| Claim | `POST /quests/<id>/claim-reward` for completed quests, once per session |

`STREAM` and `ACHIEVEMENT` quests are labelled **NOT AUTOMATABLE**: a stream needs a
real Go Live with another person in the channel, and achievements are validated by the
game or the activity backend rather than the client.

Modules are found by a prototype method (`getQuest`, `flushWaitQueue`, `getRunningGames`,
`.post`) instead of by name, so a renamed export does not break the run.

## When something does not move

Press `?` in the panel header. It prints what the client holds:

```
diagnose: quests, questEnrollmentBlockedUntil, questsMap
diagnose: blocked until never
diagnose: 49 quests · 4 video · 2 game · 43 other · 24 joined · 3 done
diagnose: Firefox Browser · keys WATCH_VIDEO · app none
```

Read it in this order:

1. **`blocked until <date>`** - Discord stopped accepting enrolments on the account.
   Nothing here can fix that; wait for the date.
2. **`app none`** on a game quest - the application id is missing, so the stand-in has
   nothing to be. That quest cannot advance.
3. **`joined` low** - the quests are not accepted on the account. The log line
   `cannot join: <name>` comes with a 404 from `/enroll`.
4. **`Discord is not accepting progress`** - four posts in a row did not move the
   stored value. The endpoint is refusing them without saying so.

Rate limits: a 429 pauses every request for the `retry_after` window and the cooldown
is saved, so reloading during one does not restart the punishment.

## Limits worth knowing

- Automating your account breaks Discord's Terms of Service. Flagging or termination is
  a real outcome, not a hypothetical.
- The app must stay running and the panel must stay open; progress advances only while
  **Start** is on.
- Nothing here reads, stores or sends your token. Requests go through the client's own
  HTTP module, as you.
- Game quests are the weak path: the stand-in is not the complete process object the
  client builds, so some quests will not see it.

## Development

```sh
npm run check   # syntax, invariants, then the bundle runs against a stub client
```

The checker asserts the lessons this repo paid for: no hand-built game dispatch, the
sealed attribution present, a single video cadence, Map-shaped task configs, the moved
application id, and the re-paste guard.

`tools/smoke.js` boots the real bundle in a Node VM with a stub DOM and fake webpack
modules, presses Start, and asserts that a video quest posts progress and an unenrolled
quest posts an enrolment, a completed quest posts a claim with the sealed blob, the
`?` button counts correctly, Stop stops the traffic, an uncheck sticks across a restart,
and a 429 plus a 404 on enrolment are survived and reported. It caught a crash that
`node --check` could not see.

A release is a tag plus `discord-quest-completer.js`. The version lives in
`package.json` and the `const VERSION` line; `npm run check` fails when they disagree.

MIT.
