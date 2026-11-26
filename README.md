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

**×** hides the panel. The small **QC** chip in the corner brings it back — no second paste,
and no second copy.

## What it does

| Task | How |
|---|---|
| `WATCH_VIDEO` | `POST /quests/<id>/video-progress` with fractional `timestamp`, every 7-9.5 s, one quest at a time |
| `PLAY_ON_DESKTOP` | patches the six `RunningGameStore` views (`getRunningGames`, `getGameForPID`, `getVisibleGame`, `getVisibleRunningGames`, `getCandidateGames`, `getRunningDiscordApplicationIds`) with a stand-in, then dispatches `RUNNING_GAMES_CHANGE` with the `games` array; Discord's own heartbeat does the rest |
| `PLAY_ACTIVITY` | `POST /quests/<id>/heartbeat` every 15 s with the call `stream_key` and `application_id`, then a final `terminal: true` beat. **Needs you to be in a voice channel or DM call** |
| Enrol | `POST /quests/<id>/enroll` with the sealed attribution blob the client sends |
| Claim | `POST /quests/<id>/claim-reward` for completed quests, once per session |

A quest whose `startsAt` is still in the future shows **SOON**, is never enrolled, and
cannot be ticked. An account with quest access suspended is not started at all: the footer
says so, and the `?` diagnosis prints the date.

`STREAM` and `ACHIEVEMENT` quests are labelled **NOT AUTOMATABLE**: a stream needs a
real Go Live with another person in the channel, and achievements are validated by the
game rather than the client. Without a voice channel, `PLAY_ACTIVITY` shows **NEEDS
VOICE** instead, because the heartbeat key is built from the call you are in.

### Lanes

The engine runs two lanes. **Video** is one cadence for the whole account: one quest posts
progress at a time, every 7–9.5 s, because five parallel loops are five times the request rate
against the same bucket. **Game** is bounded by how many stand-in processes are alive at once
(1 by default, up to 3), since Discord schedules a heartbeat per process. A finished, blocked or
unticked quest releases its slot and the next one in the queue takes it.

Click the `game n/n` readout in the footer to raise the limit. Click a card's status pill to
pause **that** quest: the other lane keeps its rhythm, the game lane backfills the freed slot,
and the pill reads **PAUSED** until you click it again. Pauses survive a re-paste, and the
console has the same controls:

```js
__dqc.lanes()        // { video, videoLimit, game, gameLimit, active, paused }
__dqc.pause(id)      // stop driving one quest
__dqc.resume(id)     // put it back in the queue
```

No progress claim is ever ahead of the player: a video timestamp is capped at the value the
run started from plus the seconds elapsed since, so a lagging store cannot make the script
report more video than the clock allows.

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
   The run stops asking to join and drives only the quests already accepted. Nothing here
   can fix the block; wait for the date.
2. **`app none`** on a game quest - the application id is missing, so the stand-in has
   nothing to be. That quest cannot advance.
3. **`joined` low** - the quests are not accepted on the account. The log line
   `cannot join: <name>` comes with a 404 from `/enroll`.
4. **`Discord is not accepting progress`** - four posts in a row did not move the
   stored value. The endpoint is refusing them without saying so.

Rate limits: a 429 pauses every request for the `retry_after` window and the cooldown
is saved, so reloading during one does not restart the punishment.

Claims: a claim is attempted twice, then the card grows a **CLAIM** pill. Pressing it is
the only thing that retries, because the usual reason a claim fails is a captcha and a
timer against a captcha is just traffic.

## How it compares

Read from each project's own README in November 2026, not from a description of it.

| Tool | Shape | Quests it finishes | How | Your token |
|---|---|---|---|---|
| **this one** | console script, one file | video, play-on-desktop, activity | patches `RunningGameStore` and posts through the client's own HTTP module | never touched |
| Orion (nyxxbit) | userscript or Vencord plugin | the same three, plus achievement-in-activity through an OAuth flow against `discordsays.com` | store spoof and heartbeats | never touched; the OAuth grant is created and revoked |
| markterence | native Windows app | play-on-desktop only | creates dummy executables Discord detects as a running game | not involved |
| xgg-2/discord-quests | Node library | video, play, stream, activity | talks to the HTTP API directly, one token per instance | **required** |
| r3aper007 | Python self-bot | video, play, activity | reversed endpoints, token from argv or a file | **required** |

Two things follow from that table. Anything that asks for your token can be run from
anywhere, including a server, which is also why those tools carry request fingerprints and
proxy support: they are the ones that look like a bot. This script and Orion run inside your
own logged-in client, so the requests are already yours — the cost is that the app has to
stay open.

Where this one is deliberately behind Orion: `ACHIEVEMENT_IN_ACTIVITY`. Orion completes it
by authorizing the quest's application on your account and posting forged progress to the
activity backend. That is the loudest thing in any of these tools, it is the behaviour
Discord's quest enforcement is aimed at, and it is off by default there too. It is not here.
`STREAM` is not here either: Discord checks that you are really live with another person in
the channel before it opens a heartbeat, and a fake metadata object does not satisfy that.

Where it is ahead: one cadence for the whole account instead of a loop per quest, the
sealed attribution blob on enrol and claim, map-shaped and versioned task configs, a
progress ceiling tied to the wall clock, the suspension and start-date states above, and a
smoke suite that runs the real bundle against a stub client — including a suspended account
that must send nothing.

## Limits worth knowing

- Automating your account breaks Discord's Terms of Service. Flagging or termination is
  a real outcome, not a hypothetical.
- The app must stay running and the panel must stay open; progress advances only while
  **Start** is on.
- Nothing here reads, stores or sends your token. Requests go through the client's own
  HTTP module, as you.
- Game quests are the weak path: the stand-in is not the complete process object the
  client builds, so some quests will not see it.
- Expired quests are dropped from the list instead of being enrolled and 404ing; a
  completed quest stays until its reward is claimed.
- A play quest with no application id shows **NOT AUTOMATABLE**: there is no process for
  the client to match, so it cannot advance.

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
