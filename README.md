# Discord Quest Completer

A script you paste into the Discord desktop app's console to finish Quests: watch-video
quests, game quests, and the ones the client already reports as done.

No Tampermonkey, no extension, no install. It is one file.

## Use it

1. Open the Discord app and press **Ctrl+Shift+I** (DevTools).
2. Click the **Console** tab.
3. Open [`discord-quest-completer.js`](https://github.com/ezurinho/discord-quest-completer/releases/latest/download/discord-quest-completer.js) and copy the whole file.
4. Paste it into the console and press **Enter**.
5. The panel appears in the corner: press **Start**.

**Chromium blocks pasting into the console the first time.** It prints
`Warning: Don't paste code...` above the prompt. Type `allow pasting` and press Enter,
then paste normally. Discord's own "Hold up!" message is the client's warning about
self-XSS, not an error from this script.

Pasting a second time replaces the panel instead of starting a second copy, which would
double every progress request.

## What it does

- **WATCH_VIDEO**: posts `/quests/<id>/video-progress` with `timestamp` advancing 5 s
  every 900 ms until the target is reached.
- **PLAY_ON_DESKTOP / PLAY_ACTIVITY**: dispatches `RUNNING_GAMES_CHANGE` with a stand-in
  game every 15 s, the same event the client fires when an activity starts.
- **Enroll**: posts `/quests/<id>/enroll` for quests that are not accepted yet.
- **Stream quests** are left alone on purpose: faking a live stream is a louder kind of
  automation and needs a real voice connection.

It finds those pieces through `webpackChunkdiscord_app`, so it uses the client's own
dispatcher and HTTP client. If Discord renames a module, the log says `modules not found`
instead of failing silently.

## Limits worth knowing

- Automating your account breaks Discord's Terms of Service. Flagging or termination is
  a real outcome, not a hypothetical.
- The panel must stay open and the app must stay running; the quests advance while the
  script is started.
- Nothing here reads, stores or sends your token. Requests go through the client's own
  HTTP module, as you.
- Reopening DevTools after a quit means pasting again.

## Development

```sh
npm run check   # syntax, version agreement, paste-safety invariants
```

A release is a tag plus `discord-quest-completer.js`. The version lives in
`package.json` and the `const VERSION` line; `npm run check` fails when they disagree.

MIT.
