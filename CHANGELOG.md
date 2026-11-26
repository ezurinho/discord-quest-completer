# Changelog

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

