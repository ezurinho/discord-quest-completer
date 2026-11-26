# Discord Quest Completer

A Tampermonkey userscript that finishes Discord Quests from the web client: watch-video
quests, game quests, and the ones the client reports as done by itself. It borrows the
client's own modules instead of inventing endpoints, so it breaks when Discord changes
its internals — that is the deal with every client mod.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open [discord-quest-completer.user.js](https://github.com/ezurinho/discord-quest-completer/releases/latest/download/discord-quest-completer.user.js).
3. Open `https://discord.com/app`, log in, and press **Start** on the panel.

The script updates itself from the latest release every time Tampermonkey checks.

## What it does

- **WATCH_VIDEO**: posts `/quests/<id>/video-progress` with `timestamp` advancing 5 s
  every 900 ms until the target is reached.
- **PLAY_ON_DESKTOP / PLAY_ACTIVITY**: dispatches `RUNNING_GAMES_CHANGE` with a stand-in
  game every 15 s, which is the same event the client fires when an activity starts.
- **Enroll**: posts `/quests/<id>/enroll` for quests that are not accepted yet.
- Everything else (stream quests and anything that needs a real voice connection) is
  left alone on purpose: faking a stream is a different, louder kind of automation.

## Honest limits

- Discord's ToS forbid automation of your account. Using this can get the account
  flagged or terminated. That risk is yours; the script does not pretend otherwise.
- The module search depends on `webpackChunkdiscord_app`. When Discord ships a new
  client bundle, the search can miss and the panel will say so instead of failing
  silently.
- No session token is read, stored or sent anywhere. Every request goes through the
  client's own HTTP module, as you.

## Development

```sh
npm run check   # syntax, version agreement, header invariants
```

A release is a tag plus the two assets (`*.user.js`, `*.meta.js`). Version lives in
`package.json` and both headers; `npm run check` fails when they disagree.

MIT.
