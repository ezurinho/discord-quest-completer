/*
 * Discord Quest Completer 3.6.0
 * Paste into the Discord app's DevTools console (Ctrl+Shift+I), press Enter, then Start.
 * https://github.com/ezurinho/discord-quest-completer
 *
 * Chromium blocks pasting into the console until you type `allow pasting` and press Enter.
 * This automates your account against Discord's Terms of Service. That risk is yours.
 */
(() => {
  'use strict';
  const NAME = 'Quest Completer';
  const VERSION = '3.6.0';
  // A real player posts fractional media time every 7-9.5 s; 5 s of video every
  // 900 ms was five times faster than the player it pretends to be.
  const VIDEO_MIN_MS = 7000;
  const VIDEO_MAX_MS = 9500;
  // Progress may never outrun the clock. A store that lags a climbing `sent` is how a
  // timestamp ends up ahead of the player it claims to be, which is what the endpoint
  // answers with "not accepting progress".
  const VIDEO_SLACK_S = 3;
  // Pasted twice? The old panel goes, not a second one: two copies would double
  // every progress request.
  const previous = document.getElementById('dqc-panel');
  if (previous) previous.remove();
  // The old instance kept its own timers: two panels meant two video loops and two
  // request queues against one account, which is how a 429 gets made.
  if (typeof window.__dqcStop === 'function') {
    try { window.__dqcStop(); } catch (err) { /* the old copy is already gone */ }
  }

  const state = { key: null, running: false, quests: [], lines: [], timers: new Map(), pulse: null, ui: null, video: null, cursor: 0, selected: new Set(), chosen: false };
  // A quest that answers 404 will answer 404 on every retry: remember it instead of
  // burning the queue. A 429 pauses every video, not just the one that hit it.
  const blocked = new Set();
  let pauseUntil = 0;
  let limits = 0;
  let enrollClosed = false;

  // The cooldown belongs to the account, not to this paste: reloading the page during a
  // 34-minute limit and pressing Start used to restart the count from zero and earn
  // another one.
  try {
    const saved = Number(localStorage.getItem('dqc-pause') || 0);
    if (saved > Date.now()) pauseUntil = saved;
  } catch (err) { /* private mode */ }

  function coolDown(waitMs) {
    limits += 1;
    const factor = limits > 1 ? Math.min(8, Math.pow(2, limits - 1)) : 1;
    pauseUntil = Math.max(pauseUntil, Date.now() + waitMs * factor);
    try { localStorage.setItem('dqc-pause', String(pauseUntil)); } catch (err) { /* private mode */ }
  }

  // Discord answers 429 in seconds; a proxy or an older route can answer in milliseconds,
  // and multiplying that by 1000 parked the whole run for hours.
  function retryAfterMs(err) {
    const body = (err && err.body) || {};
    const raw = Number(body.retry_after !== undefined ? body.retry_after : body.retryAfter);
    if (!Number.isFinite(raw) || raw <= 0) return 5000;
    return raw > 120 ? raw : raw * 1000;
  }

  function errorText(err) {
    if (!err) return 'unknown error';
    if (err.body && err.body.message) return err.body.message;
    if (err.message) return err.message;
    return String(err);
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // ---- client internals -------------------------------------------------
  // The mangled export keys (A, Bo, h, Ay) change between Discord builds, so each
  // module is found by a method that cannot be anything else, and the key is read
  // from the object that actually has it.
  function findModule(predicate) {
    const chunk = window.webpackChunkdiscord_app;
    if (!chunk) return null;
    const req = chunk.push([[Symbol()], {}, (r) => r]);
    chunk.pop();
    const hit = Object.values(req.c || {}).find((mod) => {
      try { return predicate(mod && mod.exports); } catch (err) { return false; }
    });
    return hit ? hit.exports : null;
  }
  // Minified keys change between builds; the class name survives. Orion matches
  // stores by `constructor.displayName` for the same reason.
  function byDisplayName(exports, name) {
    if (!exports) return null;
    return Object.keys(exports).map((key) => exports[key]).find((value) => {
      try { return value && value.constructor && value.constructor.displayName === name; } catch (err) { return false; }
    }) || null;
  }

  function pick(exports, keys, protoMethod) {
    if (!exports) return null;
    for (const key of keys) {
      const value = exports[key];
      // A normal property lookup walks the prototype chain, so this covers both class
      // instances and plain objects that carry the method directly.
      if (value && typeof value[protoMethod] === 'function') return value;
    }
    return null;
  }
  function modules() {
    const stream = findModule((e) => pick(e, ['A', 'Z'], 'getStreamerActiveStreamMetadata'));
    // Either signal is enough: a prototype method, or the class name when the method was
    // renamed along with the export key.
    const quests = findModule((e) => pick(e, ['A', 'Z'], 'getQuest') || byDisplayName(e, 'QuestStore'));
    const dispatcher = findModule((e) => pick(e, ['h', 'Z'], 'flushWaitQueue'));
    const games = findModule((e) => (e && e.Ay && typeof e.Ay.getRunningGames === 'function') || (e && e.ZP && typeof e.ZP.getRunningGames === 'function'));
    const api = findModule((e) => (e && e.Bo && typeof e.Bo.get === 'function') || (e && e.tn && typeof e.tn.get === 'function'));
    const users = findModule((e) => pick(e, ['A', 'Z'], 'getCurrentUser'));
    const chans = findModule((e) => pick(e, ['A', 'Z'], 'getSortedPrivateChannels'));
    const guilds = findModule((e) => pick(e, ['A', 'Z'], 'getAllGuilds'));
    return {
      questStore: pick(quests, ['A', 'Z'], 'getQuest') || byDisplayName(quests, 'QuestStore'),
      runStore: (games && games.Ay) || (games && games.ZP),
      dispatcher: pick(dispatcher, ['h', 'Z'], 'flushWaitQueue'),
      api: (api && api.Bo) || (api && api.tn),
      streamStore: pick(stream, ['A', 'Z'], 'getStreamerActiveStreamMetadata'),
      userStore: pick(users, ['A', 'Z'], 'getCurrentUser'),
      chanStore: pick(chans, ['A', 'Z'], 'getSortedPrivateChannels'),
      guildChanStore: pick(guilds, ['A', 'Z'], 'getAllGuilds')
    };
  }
  // An expired quest answers 404 on every endpoint, so it never enters the list: one dead
  // id used to become a card that logged "cannot join" and never moved. A completed quest
  // keeps its place even past its expiry, because the reward is still claimable.
  function isExpired(quest) {
    if (quest && quest.userStatus && quest.userStatus.completedAt) return false;
    const config = (quest && quest.config) || {};
    const raw = config.expiresAt || config.expires_at || (quest && quest.expiresAt) || null;
    const at = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(at) && at > 0 && at < Date.now();
  }
  function allQuests(mods) {
    const raw = mods.questStore && mods.questStore.quests;
    if (!raw) return [];
    const list = raw instanceof Map ? Array.from(raw.values()) : Object.values(raw);
    return list.filter((quest) => !isExpired(quest));
  }
  function taskKeysOf(tasks) {
    return tasks instanceof Map ? Array.from(tasks.keys()) : Object.keys(tasks || {});
  }

  function taskAt(tasks, key) {
    return tasks instanceof Map ? tasks.get(key) : tasks && tasks[key];
  }

  // Discord hands the same payload back as a Map on some builds; Object.keys on a Map
  // is empty, which read as "quest without tasks" and skipped every one of them.
  function configOf(quest) {
    const config = (quest && quest.config) || {};
    const current = config.taskConfigV2;
    if (current && taskKeysOf(current.tasks).length) return current;
    const legacy = config.taskConfig;
    if (legacy && taskKeysOf(legacy.tasks).length) return legacy;
    return current || legacy || {};
  }
  function taskOf(quest) {
    const config = configOf(quest);
    const tasks = (config && config.tasks) || {};
    const keys = taskKeysOf(tasks);
    if (!keys.length) return null;
    const has = (needle) => keys.find((key) => key.indexOf(needle) >= 0);
    // Video is the one path that still works reliably, so a quest that offers it is
    // driven as video even when it also lists a stream or a play task.
    const video = has('VIDEO') || has('WATCH');
    // PLAY_ACTIVITY contains PLAY, and matching PLAY first classified every activity
    // quest as a game: it was registered as a process and never sent a heartbeat.
    const activity = has('ACTIVITY');
    const key = video || activity || has('PLAY') || has('STREAM') || keys[0];
    const type = video ? 'VIDEO' : activity ? 'ACTIVITY' : has('PLAY') ? 'GAME' : has('STREAM') ? 'STREAM' : 'GAME';
    const messages = (quest.config && quest.config.messages) || {};
    const app = (quest.config && quest.config.application) || {};
    // July 2026: the application id moved from config.application.id to
    // taskConfigV2.tasks.<KEY>.applications[0].id. Reading only the old path returned
    // undefined and every play quest silently did nothing.
    const task = taskAt(tasks, key) || {};
    const firstApp = (task.applications && task.applications[0]) || {};
    const appId = firstApp.id || app.id || null;
    const name = messages.questName || app.name || task.name || quest.id;
    return { key, name, type, appId, target: Number(task.target) || 0 };
  }
  function questValue(quest, key) {
    const progress = quest.userStatus && quest.userStatus.progress;
    return Number(progress && progress[key] && progress[key].value) || 0;
  }
  // One request at a time, and a 429 pauses the whole queue: Discord answers with
  // retry_after in ms, and ignoring it turns a warning into a ban.
  const traffic = { queue: [], busy: false, post: null };
  async function enqueue(url, body) {
    return new Promise((resolve, reject) => {
      // Discord's client can swallow a call while rate limited and never settle it,
      // which left run() waiting forever with no line in the log. Every request now
      // has a deadline.
      const timer = setTimeout(() => reject({ status: 0, message: 'request timed out' }), 12000);
      const done = (fn, value) => { clearTimeout(timer); fn(value); };
      traffic.queue.push({ url, body, resolve: (v) => done(resolve, v), reject: (e) => done(reject, e) });
      drain();
    });
  }
  async function drain() {
    if (traffic.busy) return;
    if (!traffic.post) {
      const pending = traffic.queue.splice(0);
      pending.forEach((req) => req.reject({ status: 0, message: 'no http client' }));
      return;
    }
    traffic.busy = true;
    while (traffic.queue.length) {
      if (!state.running) { traffic.queue = []; break; }
      const req = traffic.queue.shift();
      try {
        req.resolve(await traffic.post({ url: req.url, body: req.body }));
      } catch (err) {
        const transient = err && (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504);
        if (transient && !req.retried) {
          req.retried = true;
          traffic.queue.unshift(req);
          log('server hiccup, retrying in 2s', 'err');
          await sleep(2000);
          continue;
        }
        if (err && err.status === 429) {
          const waitMs = retryAfterMs(err);
          coolDown(waitMs + 500);
          traffic.queue.unshift(req);
          log('rate limited: waiting ' + (waitMs / 1000).toFixed(1) + 's (strike ' + limits + ')', 'err');
          await sleep(Math.max(0, pauseUntil - Date.now()));
        } else {
          req.reject(err);
        }
      }
      // Jittered gaps: a fixed 300 ms between calls is a signature of its own.
      await sleep(250 + Math.random() * 250);
    }
    traffic.busy = false;
  }
  // ---- panel ------------------------------------------------------------
  const CSS = [
    '#dqc-panel{position:fixed;right:20px;top:64px;width:344px;z-index:2147483000;color:#e7e9ee;font:13px/1.45 "Inter",system-ui,sans-serif;border-radius:16px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(32,34,40,.97),rgba(22,23,28,.98));box-shadow:0 24px 60px -12px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.4);overflow:hidden;backdrop-filter:blur(14px)}',
    '#dqc-panel header{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;background:linear-gradient(120deg,#6d4bff 0%,#4468ff 55%,#2f9dff 100%);cursor:grab;user-select:none}',
    '#dqc-panel header:active{cursor:grabbing}',
    '#dqc-logo{width:28px;height:28px;border-radius:9px;background:rgba(255,255,255,.16);display:grid;place-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}',
    '#dqc-title{font-weight:700;font-size:13px;letter-spacing:.2px;line-height:1.1;margin:0}',
    '#dqc-ver{font-size:10px;color:rgba(255,255,255,.72);letter-spacing:.4px}',
    '#dqc-actions{margin-left:auto;display:flex;gap:6px}',
    '.dqc-btn{border:0;border-radius:8px;padding:6px 11px;font:600 11px/1 system-ui,sans-serif;letter-spacing:.4px;cursor:pointer;transition:transform .12s,filter .12s}',
    '.dqc-btn:active{transform:scale(.96)}',
    '.dqc-btn:disabled{opacity:.45;cursor:default;filter:grayscale(.3)}',
    '#dqc-start{background:#fff;color:#2a2c33}',
    '#dqc-stop{background:rgba(0,0,0,.22);color:#fff}',
    '#dqc-hide{background:transparent;color:rgba(255,255,255,.8);padding:6px 6px}',
    '#dqc-body{padding:10px 10px 4px;max-height:340px;overflow:auto}',
    '.dqc-pick{accent-color:#5865f2;margin:2px 0 0;cursor:pointer}',
    '.dqc-pick:disabled{cursor:not-allowed;opacity:.35}',
    '.dqc-card{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:11px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.05);margin-bottom:7px}',
    '.dqc-card.done{background:rgba(45,190,120,.1);border-color:rgba(45,190,120,.28)}',
    '.dqc-card.live{background:rgba(96,120,255,.14);border-color:rgba(120,140,255,.42);box-shadow:0 0 0 1px rgba(120,140,255,.18) inset}',
    '.dqc-icon{width:30px;height:30px;flex:0 0 30px;border-radius:9px;display:grid;place-items:center;background:rgba(255,255,255,.07);color:#a7b0c0}',
    '.dqc-card.live .dqc-icon{color:#aab6ff;background:rgba(120,140,255,.18)}',
    '.dqc-card.done .dqc-icon{color:#5bdba0;background:rgba(45,190,120,.16)}',
    '.dqc-main{flex:1;min-width:0}',
    '.dqc-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dqc-pill{float:right;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.6px;padding:2px 6px;border-radius:5px;background:rgba(255,255,255,.08);color:#98a1b0}',
    '.dqc-card.live .dqc-pill{background:rgba(120,140,255,.22);color:#c3ccff}',
    '.dqc-card.done .dqc-pill{background:rgba(45,190,120,.2);color:#7fe4b3}',
    '.dqc-track{height:5px;border-radius:99px;background:rgba(255,255,255,.08);margin-top:6px;overflow:hidden}',
    '.dqc-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#6d4bff,#3ea8ff);transition:width .45s ease}',
    '.dqc-card.done .dqc-fill{background:linear-gradient(90deg,#2dbe78,#7fe4b3)}',
    '.dqc-meta{font-size:10px;color:#8b93a3;margin-top:4px;letter-spacing:.2px}',
    '#dqc-log{margin:2px 4px 0;padding:9px 10px;max-height:124px;overflow:auto;border-radius:10px;background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.05);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:#8f97a6;white-space:pre-wrap}',
    '#dqc-log .ok{color:#7fe4b3}',
    '#dqc-log .err{color:#ff8f9a}',
    '#dqc-log .time{color:#5d6472}',
    '#dqc-bubble{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:44px;height:44px;border:0;border-radius:14px;background:linear-gradient(120deg,#6d4bff,#2f9dff);color:#fff;font:700 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 30px -8px rgba(0,0,0,.7);letter-spacing:.5px}',
    '#dqc-foot{padding:9px 12px 11px;font-size:10px;color:#6f7787;letter-spacing:.3px;display:flex;justify-content:space-between}',
    '#dqc-foot b{color:#98a1b0;font-weight:600}'
  ].join('');

  const ICON = {
    bolt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6l1-8z"/></svg>',
    video: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm15.5 3.4 3.1-2a.7.7 0 0 1 1.1.6v10a.7.7 0 0 1-1.1.6l-3.1-2z"/></svg>',
    game: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 8h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 8zm1 3v1.5H6.5V14H8v1.5h1.5V14H11v-1.5H9.5V11zm6.5.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
    clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.6l4 2.3-1 1.7-5-2.9V7z"/></svg>'
  };

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function log(text, kind) {
    state.lines.push({ text, kind: kind || '' });
    if (state.lines.length > 140) state.lines.shift();
    const box = state.ui && state.ui.querySelector('[data-log]');
    if (!box) return;
    const row = document.createElement('div');
    row.className = kind || '';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ';
    row.appendChild(time);
    row.appendChild(document.createTextNode(text));
    box.appendChild(row);
    while (box.childElementCount > 140) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function mount() {
    if (state.ui) return state.ui;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const panel = document.createElement('section');
    panel.id = 'dqc-panel';
    panel.innerHTML = [
      '<header data-drag><div id="dqc-logo">' + ICON.bolt + '</div>',
      '<div><h1 id="dqc-title">' + NAME + '</h1><div id="dqc-ver">v' + VERSION + '</div></div>',
      '<div id="dqc-actions">',
      '<button class="dqc-btn" id="dqc-start">Start</button>',
      '<button class="dqc-btn" id="dqc-stop" disabled>Stop</button>',
      '<button class="dqc-btn" id="dqc-diag" title="Print what the client sees">?</button>',
    '<button class="dqc-btn" id="dqc-hide" title="Hide (re-paste to reopen)">×</button>',
      '</div></header>',
      '<div id="dqc-body"><div data-list></div></div>',
      '<div id="dqc-log" data-log></div>',
      '<div id="dqc-foot"><span data-count>—</span><span><b>Ctrl+Shift+I</b> to reopen</span></div>'
    ].join('');
    document.body.appendChild(panel);
    state.ui = panel;
    panel.querySelector('#dqc-start').addEventListener('click', () => run());
    panel.querySelector('#dqc-stop').addEventListener('click', () => stop());
    panel.querySelector('#dqc-diag').addEventListener('click', () => diagnose());
    panel.querySelector('#dqc-hide').addEventListener('click', () => hide());
    try {
      const saved = JSON.parse(localStorage.getItem('dqc-pos') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        panel.style.left = saved.left + 'px';
        panel.style.top = saved.top + 'px';
        panel.style.right = 'auto';
      }
    } catch (err) { /* a corrupt position is not worth a broken panel */ }
    panel.querySelector('[data-list]').addEventListener('change', (event) => {
      const box = event.target;
      if (!box || !box.classList || !box.classList.contains('dqc-pick')) return;
      if (box.checked) state.selected.add(box.dataset.id); else state.selected.delete(box.dataset.id);
    });
    drag(panel, panel.querySelector('[data-drag]'));
    return panel;
  }

  // Hiding used to leave a re-paste as the only way back. A small chip in the corner
  // brings the same panel back, so there is still exactly one copy running.
  function bubble() {
    if (document.getElementById('dqc-bubble')) return;
    const chip = document.createElement('button');
    chip.id = 'dqc-bubble';
    chip.textContent = 'QC';
    chip.title = 'Quest Completer';
    chip.addEventListener('click', () => {
      chip.remove();
      const panel = mount();
      panel.style.display = '';
    });
    document.body.appendChild(chip);
  }

  function hide() {
    const panel = state.ui;
    if (!panel) return;
    panel.style.display = 'none';
    bubble();
  }

  function drag(panel, handle) {
    let ox = 0, oy = 0, moving = false;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      moving = true;
      ox = event.clientX - panel.offsetLeft;
      oy = event.clientY - panel.offsetTop;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!moving) return;
      panel.style.left = (event.clientX - ox) + 'px';
      panel.style.top = (event.clientY - oy) + 'px';
      panel.style.right = 'auto';
    });
    handle.addEventListener('pointerup', () => {
      moving = false;
      try { localStorage.setItem('dqc-pos', JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop })); } catch (err) { /* private mode */ }
    });
  }

  // ---- work ------------------------------------------------------------
  // 5 s of video per 900 ms: the only honest ETA is that ratio, not a guess.
  const SPEED = 1;
  function etaText(value, target) {
    const left = Math.max(0, target - value);
    if (!left) return '';
    const seconds = Math.ceil(left / SPEED);
    if (seconds < 60) return '· ~' + seconds + 's left';
    return '· ~' + Math.ceil(seconds / 60) + ' min left';
  }

  // Streams need a real Go Live plus someone else in the channel, and achievements
  // are validated by the game or the activity backend. Offering them a checkbox
  // would promise work the client cannot do.
  function isSupported(task) {
    if (!task) return false;
    if (task.type === 'VIDEO' || task.type === 'GAME') return true;
    // An activity only progresses while the client can key a call, so it is offered
    // only when that key can be built right now.
    return task.type === 'ACTIVITY' && Boolean(state.key);
  }

  function cardFor(quest) {
    const task = taskOf(quest);
    const done = Boolean(quest.userStatus && quest.userStatus.completedAt);
    const live = state.running && !done && task && task.type === 'VIDEO' && state.selected.has(quest.id);
    const supported = isSupported(task);
    const value = task ? questValue(quest, task.key) : 0;
    const target = task ? task.target : 0;
    const pct = target ? Math.min(100, Math.round((value / target) * 100)) : done ? 100 : 0;
    const label = blocked.has(quest.id) ? 'UNAVAILABLE' : task && task.type === 'ACTIVITY' && !state.key ? 'NEEDS VOICE' : !isSupported(task) && !done ? 'NOT AUTOMATABLE' : done ? 'DONE' : live ? 'RUNNING' : quest.userStatus && quest.userStatus.enrolledAt ? 'QUEUE' : 'NOT JOINED';
    const showEta = live || (state.running && !done && !blocked.has(quest.id) && Boolean(quest.userStatus && quest.userStatus.enrolledAt));
    const icon = task && task.type === 'VIDEO' ? ICON.video : task && (task.type === 'GAME' || task.type === 'ACTIVITY') ? ICON.game : ICON.clock;
    const card = document.createElement('div');
    card.className = 'dqc-card' + (done ? ' done' : live ? ' live' : '');
    card.innerHTML = '<input type="checkbox" class="dqc-pick" data-id="' + quest.id + '"' +
      (supported ? '' : ' disabled') + (state.selected.has(quest.id) ? ' checked' : '') + '>' +
      '<div class="dqc-icon">' + icon + '</div>' +
      '<div class="dqc-main"><div class="dqc-name"><span class="dqc-pill">' + label + '</span>' +
      esc(task ? task.name : quest.id) + '</div>' +
      '<div class="dqc-track"><div class="dqc-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="dqc-meta">' + (target ? value + ' / ' + target + ' s' + (pct ? ' · ' + pct + '%' : '') + (showEta && pct < 100 ? ' ' + etaText(value, target) : '') : 'waiting for a task config') + '</div></div>';
    return card;
  }

  // Rebuilding an unchanged list every eight seconds steals the checkbox focus and jumps
  // the scroll; a signature of what is already on screen decides whether to touch it.
  function signature() {
    return state.quests.map((quest) => {
      const task = taskOf(quest);
      return [
        quest.id,
        task && task.type,
        task && task.target,
        task ? questValue(quest, task.key) : 0,
        quest.userStatus && quest.userStatus.completedAt ? 1 : 0,
        blocked.has(quest.id) ? 1 : 0,
        state.selected.has(quest.id) ? 1 : 0,
        state.running ? 1 : 0,
        state.key ? 1 : 0
      ].join('|');
    }).join(',');
  }

  function tally() {
    const count = state.ui && state.ui.querySelector('[data-count]');
    if (!count) return;
    const done = state.quests.filter((q) => q.userStatus && q.userStatus.completedAt).length;
    const wait = Math.max(0, Math.round((pauseUntil - Date.now()) / 1000));
    const mmss = Math.floor(wait / 60) + ':' + String(wait % 60).padStart(2, '0');
    count.textContent = done + ' / ' + state.quests.length + ' claimed' + (wait ? ' · rate limited, ' + mmss + ' left' : '');
  }

  function render() {
    const list = state.ui && state.ui.querySelector('[data-list]');
    if (!list) return;
    const sig = signature();
    if (sig !== state.sig) {
      state.sig = sig;
      const keep = list.scrollTop || 0;
      list.textContent = '';
      if (!state.quests.length) {
        const empty = document.createElement('div');
        empty.className = 'dqc-meta';
        empty.style.padding = '14px 6px';
        empty.textContent = 'No quests on this account right now.';
        list.appendChild(empty);
      } else {
        for (const quest of state.quests) list.appendChild(cardFor(quest));
      }
      list.scrollTop = keep;
    }
    tally();
  }

  // Discord seals an attribution blob per quest and echoes it back on every enroll and
  // claim. Our old body sent `{ location: 1 }` and nothing else, which is why every
  // enroll answered 404 on a quest the client would have accepted.
  function sealedFor(quest) {
    return (quest && quest.trafficMetadataSealed) || null;
  }

  function enrollBody(quest) {
    return { platform: 0, location: 11, is_targeted: false, metadata_sealed: null, traffic_metadata_sealed: sealedFor(quest) };
  }

  async function enroll(quest) {
    if (quest.userStatus && quest.userStatus.enrolledAt) return;
    if (enrollClosed) return;
    try {
      await enqueue('/quests/' + quest.id + '/enroll', enrollBody(quest));
      log('joined ' + (taskOf(quest) ? taskOf(quest).name : quest.id), 'ok');
    } catch (err) {
      // 404 here means the account cannot join it at all: expired, region-locked,
      // or already claimed elsewhere. Retrying would only burn the queue.
      if (err && err.status === 404) {
        blocked.add(quest.id);
        log('cannot join: ' + (taskOf(quest) ? taskOf(quest).name : quest.id), 'err');
      } else {
        log('enroll failed: ' + errorText(err), 'err');
      }
    }
  }

  async function videoTick(quest, task) {
    if (Date.now() < pauseUntil || blocked.has(quest.id)) return;
    const current = Math.max(questValue(quest, task.key), sent.get(quest.id) || 0);
    if (current >= task.target) {
      log('done ' + task.name, 'ok');
      stopVideo(quest.id);
      return;
    }
    const step = (VIDEO_MIN_MS + Math.random() * (VIDEO_MAX_MS - VIDEO_MIN_MS)) / 1000;
    const clock = videoClock.get(quest.id) || { base: current, at: Date.now() };
    videoClock.set(quest.id, clock);
    const ceiling = clock.base + (Date.now() - clock.at) / 1000 + VIDEO_SLACK_S;
    const next = Math.min(task.target, ceiling, Number((current + step).toFixed(6)));
    // A store that already sits at the ceiling means the player is ahead of us; posting a
    // lower timestamp than the one stored is rejected, so the tick waits instead.
    if (next <= current) return;
    try {
      await enqueue('/quests/' + quest.id + '/video-progress', { timestamp: next });
      sent.set(quest.id, next);
      // Four posts in a row with the store unchanged means Discord is not taking the
      // progress, whatever the request returns.
      const observed = questValue(quest, task.key);
      const last = stalls.get(quest.id);
      const idle = last && observed <= last.value ? last.count + 1 : 0;
      stalls.set(quest.id, { value: observed, count: idle });
      if (idle === 4) {
        log(task.name + ': Discord is not accepting progress', 'err');
        blocked.add(quest.id);
      }
      log(task.name + ' · ' + next.toFixed(1) + '/' + task.target + ' s');
    } catch (err) {
      if (err && err.status === 404) {
        blocked.add(quest.id);
        stopVideo(quest.id);
        log(task.name + ': not available on this account', 'err');
      } else {
        log('video error: ' + errorText(err), 'err');
      }
    }
  }

  const claimed = new Set();

  // Answers the only question worth asking when a panel looks idle: what does the
  // client actually hold for these quests?
  function diagnose() {
    const mods = state.mods || modules();
    if (!mods.questStore) { log('diagnose: no quest store', 'err'); return; }
    const store = mods.questStore;
    log('diagnose: ' + Object.keys(store).filter((k) => k.indexOf('quest') >= 0).join(', '));
    log('diagnose: blocked until ' + (store.questEnrollmentBlockedUntil || 'never'));
    const list = allQuests(mods);
    const counts = { video: 0, game: 0, other: 0, joined: 0, done: 0 };
    for (const quest of list) {
      const task = taskOf(quest);
      if (!task) continue;
      if (task.type === 'VIDEO') counts.video += 1; else if (task.type === 'GAME') counts.game += 1; else counts.other += 1;
      if (quest.userStatus && quest.userStatus.enrolledAt) counts.joined += 1;
      if (quest.userStatus && quest.userStatus.completedAt) counts.done += 1;
    }
    log('diagnose: ' + list.length + ' quests · ' + counts.video + ' video · ' + counts.game + ' game · ' + counts.other + ' other · ' + counts.joined + ' joined · ' + counts.done + ' done');
    const sample = list.find((q) => { const t = taskOf(q); return t && t.type === 'VIDEO'; });
    if (sample) {
      const task = taskOf(sample);
      log('diagnose: ' + task.name + ' · keys ' + taskKeysOf(configOf(sample).tasks).join('|') + ' · app ' + (task.appId || 'none'));
    }
  }

  const stalls = new Map();

  async function claim(quest) {
    try {
      await enqueue('/quests/' + quest.id + '/claim-reward', enrollBody(quest));
      log('claimed ' + (taskOf(quest) ? taskOf(quest).name : quest.id), 'ok');
    } catch (err) {
      // One retry: a claim that lost a race with the completion heartbeat is worth
      // another try, a 404 is not.
      if (err && err.status !== 404) {
        try {
          await sleep(3000);
          await enqueue('/quests/' + quest.id + '/claim-reward', enrollBody(quest));
          log('claimed ' + (taskOf(quest) ? taskOf(quest).name : quest.id) + ' (second try)', 'ok');
          return;
        } catch (again) { /* fall through to the report */ }
      }
      log('claim failed: ' + errorText(err), 'err');
    }
  }

  function stopVideo(id) {
    const timer = state.timers.get(id);
    if (timer) clearInterval(timer);
    state.timers.delete(id);
  }

  // One cadence for the whole account, not one per quest: five parallel loops are
  // five times the request rate against the same bucket, which is exactly what
  // earns a 34-minute 429.
  const sent = new Map();
  // Per quest: the stored value and the moment this run started driving it. The ceiling
  // for every timestamp is that base plus the wall clock.
  const videoClock = new Map();

  function nextVideoQuest() {
    const waiting = state.quests.filter((quest) => {
      if (quest.userStatus && quest.userStatus.completedAt) return false;
      if (blocked.has(quest.id)) return false;
      // Unchecking a card mid-run used to leave its video loop alive until the next paste.
      if (!state.selected.has(quest.id)) return false;
      if (!quest.userStatus || !quest.userStatus.enrolledAt) return false;
      const task = taskOf(quest);
      return task && task.type === 'VIDEO' && questValue(quest, task.key) < task.target;
    });
    if (!waiting.length) return null;
    return waiting[state.cursor++ % waiting.length];
  }

  function startVideos() {
    if (state.video) return;
    const loop = async () => {
      if (!state.running) return;
      if (Date.now() >= pauseUntil) {
        state.quests = allQuests(state.mods);
        const quest = nextVideoQuest();
        if (quest) await videoTick(quest, taskOf(quest));
      }
      render();
      if (state.running) state.video = setTimeout(loop, VIDEO_MIN_MS + Math.random() * (VIDEO_MAX_MS - VIDEO_MIN_MS));
    };
    state.video = setTimeout(loop, 500);
  }

  // The client believes a game is running when the store says so and the running
  // games event fired; both are needed, the event alone gets ignored by some quests.
  // One stand-in per app, kept alive: Discord's own heartbeat reports progress every
  // 60 s once the process is in RunningGameStore, so churning the pid only breaks it.
  const standIns = new Map();
  // Canary derives quest eligibility from the visible and candidate views, not only
  // from getRunningGames: a game missing from those never gets a heartbeat scheduled,
  // which is why patching two methods parked every play quest at 0 %.
  const PATCHED = ['getRunningGames', 'getGameForPID', 'getVisibleGame', 'getVisibleRunningGames', 'getRunningDiscordApplicationIds', 'getCandidateGames'];

  function fakeGame(appId) {
    const id = appId || '000000000000000000';
    if (standIns.has(id)) return standIns.get(id);
    const now = Date.now();
    const safe = String(id).replace(/[^0-9]/g, '') || '0';
    const exe = 'quest-' + safe + '.exe';
    const game = {
      pid: 1000 + Math.floor(Math.random() * 8000),
      id,
      name: 'Quest Activity',
      start: now,
      createdAt: now,
      pidPath: [],
      processName: exe,
      exeName: exe,
      exePath: 'c:/program files/quest activity/' + exe,
      cmdLine: '"C:\\\\Program Files\\\\Quest Activity\\\\' + exe + '"',
      executables: [{ os: 'win32', name: exe, is_launcher: false }],
      windowHandle: 0,
      fullscreenType: 0,
      overlay: false,
      sandboxed: false,
      hidden: false,
      isLauncher: false
    };
    standIns.set(id, game);
    return game;
  }

  function dispatchGames(mods, added, removed) {
    const dispatcher = mods && mods.dispatcher;
    const store = mods && mods.runStore;
    if (!dispatcher || typeof dispatcher.dispatch !== 'function' || !store) return;
    try {
      // `games` is not optional: the client's own handler reads it and threw
      // "reading 'some'" when the field was missing.
      dispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', added, removed, games: store.getRunningGames() });
    } catch (err) {
      log('the client refused the game event: ' + errorText(err), 'err');
    }
  }

  function unpatchRunStore(mods) {
    const store = mods && mods.runStore;
    if (!store || !store.__dqcPatched) return;
    if (store.__dqcReal) {
      for (const name of PATCHED) if (typeof store.__dqcReal[name] === 'function') store[name] = store.__dqcReal[name];
    }
    delete store.__dqcPatched;
    delete store.__dqcReal;
    standIns.clear();
  }

  function patchRunStore(mods) {
    const store = mods.runStore;
    if (!store || store.__dqcPatched || typeof store.getRunningGames !== 'function') return;
    const real = {};
    for (const name of PATCHED) if (typeof store[name] === 'function') real[name] = store[name];
    const all = () => Array.from(standIns.values());
    store.getRunningGames = function () { return real.getRunningGames.call(store).concat(all()); };
    if (real.getGameForPID) store.getGameForPID = function (pid) { return all().find((g) => g.pid === pid) || real.getGameForPID.call(store, pid); };
    if (real.getVisibleGame) store.getVisibleGame = function () { return all()[0] || real.getVisibleGame.call(store); };
    if (real.getVisibleRunningGames) store.getVisibleRunningGames = function () { return real.getVisibleRunningGames.call(store).concat(all()); };
    if (real.getCandidateGames) store.getCandidateGames = function () { return real.getCandidateGames.call(store).concat(all()); };
    if (real.getRunningDiscordApplicationIds) store.getRunningDiscordApplicationIds = function () {
      const ids = real.getRunningDiscordApplicationIds.call(store);
      const ours = all().map((game) => String(game.id));
      return ids instanceof Set ? new Set(Array.from(ids).concat(ours)) : (ids || []).concat(ours);
    };
    store.__dqcReal = real;
    store.__dqcPatched = true;
  }

  // PLAY_ACTIVITY is credited by heartbeat, not by a store: the request needs the call
  // stream key the client itself builds (`call:` for a DM, `guild:` for a channel).
  function streamKey(mods) {
    try {
      const user = mods.userStore && mods.userStore.getCurrentUser && mods.userStore.getCurrentUser();
      const ownerId = user && user.id;
      if (!ownerId) return null;
      const dm = mods.chanStore && mods.chanStore.getSortedPrivateChannels && mods.chanStore.getSortedPrivateChannels()[0];
      if (dm && dm.id) return 'call:' + dm.id + ':' + ownerId;
      const guilds = (mods.guildChanStore && mods.guildChanStore.getAllGuilds && mods.guildChanStore.getAllGuilds()) || {};
      for (const id of Object.keys(guilds)) {
        const vocal = guilds[id] && guilds[id].VOCAL && guilds[id].VOCAL[0];
        const chan = vocal && vocal.channel;
        if (chan && chan.id) return 'guild:' + (chan.guild_id || id) + ':' + chan.id + ':' + ownerId;
      }
    } catch (err) { /* a build without the voice stores */ }
    return null;
  }

  const beating = new Set();

  async function beat(mods, quest, task) {
    if (beating.has(quest.id) || !state.running) return;
    const key = streamKey(mods);
    if (!key) { log(task.name + ': needs a voice channel to heartbeat', 'err'); return; }
    beating.add(quest.id);
    let idle = 0;
    let last = questValue(quest, task.key);
    try {
      while (state.running && questValue(quest, task.key) < task.target) {
        const res = await enqueue('/quests/' + quest.id + '/heartbeat', { stream_key: key, application_id: String(task.appId || ''), terminal: false });
        const progress = (res && res.body && res.body.progress) || {};
        const reported = progress[task.key] || progress.PLAY_ACTIVITY;
        const value = Number(reported && reported.value);
        if (Number.isFinite(value)) {
          quest.userStatus = quest.userStatus || {};
          quest.userStatus.progress = quest.userStatus.progress || {};
          quest.userStatus.progress[task.key] = { value };
        }
        if (Number.isFinite(value) && value > last) { last = value; idle = 0; } else idle++;
        if (idle >= 4) { log(task.name + ': Discord is not accepting activity beats', 'err'); break; }
        if (Number.isFinite(value) && value >= task.target) break;
        await sleep(15000);
        state.quests = allQuests(mods);
        quest = state.quests.find((q) => q.id === quest.id) || quest;
      }
      if (state.running) await enqueue('/quests/' + quest.id + '/heartbeat', { stream_key: key, application_id: String(task.appId || ''), terminal: true });
    } catch (err) {
      log('activity heartbeat failed: ' + errorText(err), 'err');
    } finally {
      beating.delete(quest.id);
    }
  }

  function pulseGame(mods, quest, task) {
    const game = fakeGame(task.appId);
    // Announcing an existing stand-in again is noise; a new one has to be announced so
    // the client schedules its heartbeat.
    if (game.__dqcLive) return;
    game.__dqcLive = true;
    dispatchGames(mods, [game], []);
  }

  async function run() {
    try {
      await runOnce();
    } catch (err) {
      log('crash: ' + errorText(err), 'err');
      console.error('[dqc]', err);
      stop();
    }
  }

  async function runOnce() {
    if (state.running) return;
    const panel = mount();
    panel.querySelector('#dqc-start').disabled = true;
    panel.querySelector('#dqc-stop').disabled = false;
    if (pauseUntil > Date.now()) log('cooldown from a previous paste: ' + Math.round((pauseUntil - Date.now()) / 60000) + ' min left', 'err');
    log('reading the client modules');
    const mods = modules();
    blocked.clear();
    if (!mods.questStore || !mods.api) {
      log('modules not found: reload (Ctrl+R) and paste again', 'err');
      stop();
      return;
    }
    state.running = true;
    sent.clear();
    stalls.clear();
    videoClock.clear();
    state.sig = '';
    traffic.post = mods.api.post.bind(mods.api);
    state.mods = mods;
    state.key = streamKey(mods);
    patchRunStore(mods);
    state.quests = allQuests(mods);
    render();
    log(state.quests.length + ' quests on this account');
    // While the block is live every enrolment answers the same refusal. Asking once per
    // quest anyway is how a warning turns into a longer block; joined quests still run.
    const blockedUntil = mods.questStore && mods.questStore.questEnrollmentBlockedUntil;
    enrollClosed = Boolean(blockedUntil && new Date(blockedUntil).getTime() > Date.now());
    if (enrollClosed) log('Discord blocked enrolment until ' + new Date(blockedUntil).toLocaleString() + ' · driving joined quests only', 'err');
    // Nothing here waits for the network. The old version enrolled every quest first
    // and only then logged anything, so one request the client never settled hid the
    // whole run behind an empty panel. Enrolment is now fire-and-forget and the
    // store refresh picks up the result.
    if (!state.chosen) {
      state.chosen = true;
      for (const quest of state.quests) {
        const task = taskOf(quest);
        if (isSupported(task)) state.selected.add(quest.id);
      }
      render();
    }
    for (const quest of state.quests) {
      if (quest.userStatus && quest.userStatus.completedAt) {
        if (!quest.userStatus.claimedAt) claim(quest).catch(() => {});
        continue;
      }
      const task = taskOf(quest);
      if (!task) continue;
      if (!state.selected.has(quest.id)) continue;
      const value = questValue(quest, task.key);
      const joined = Boolean(quest.userStatus && quest.userStatus.enrolledAt);
      if (!joined) {
        log('not joined: ' + task.name + ' · asking to join', 'err');
        enroll(quest).catch(() => {});
      } else {
        log(task.name + ' · ' + task.type + ' · ' + value + '/' + task.target);
      }
      // The stand-in is registered even when the enrolment is still in flight;
      // waiting for the next pulse delayed every play quest by up to a minute.
      if (task.type === 'GAME' || task.type === 'STREAM') pulseGame(mods, quest, task);
      if (task.type === 'ACTIVITY') beat(mods, quest, task).catch(() => {});
    }
    startVideos();
    state.pulse = setInterval(() => {
      state.quests = allQuests(mods);
      const pending = state.quests.filter((q) => !(q.userStatus && q.userStatus.completedAt));
      for (const quest of pending) {
        const task = taskOf(quest);
        if (task && !blocked.has(quest.id)) {
          if (task.type === 'ACTIVITY') beat(mods, quest, task).catch(() => {});
          else if (task.type !== 'VIDEO') pulseGame(mods, quest, task);
        }
        if (task) startVideos();
      }
      for (const quest of pending) {
        if (quest.userStatus && quest.userStatus.completedAt && !quest.userStatus.claimedAt && !claimed.has(quest.id)) {
          claimed.add(quest.id);
          claim(quest).catch(() => {});
        }
      }
      render();
      if (!pending.length) stop();
    }, 60000);
    log('running: leave the app open', 'ok');
  }

  function stop() {
    state.running = false;
    state.key = null;
    // Withdraw the stand-ins before restoring the store, so the client stops scheduling
    // heartbeats for a process that no longer exists.
    if (state.mods && standIns.size) dispatchGames(state.mods, [], Array.from(standIns.values()));
    unpatchRunStore(state.mods);
    if (state.video) clearTimeout(state.video);
    state.video = null;
    for (const id of Array.from(state.timers.keys())) stopVideo(id);
    if (state.pulse) clearInterval(state.pulse);
    state.pulse = null;
    const panel = state.ui;
    if (panel) {
      panel.querySelector('#dqc-start').disabled = false;
      panel.querySelector('#dqc-stop').disabled = true;
      render();
    }
    log('stopped');
  }

  window.addEventListener('unhandledrejection', (event) => {
    log('unhandled: ' + errorText(event.reason), 'err');
    console.error('[dqc]', event.reason);
  });

  window.__dqcStop = stop;
  mount();
  log(NAME + ' ' + VERSION + ' ready · press Start', 'ok');
  state.ui.querySelector('#dqc-foot span:last-child').textContent = 'Ctrl+Shift+I to reopen';
  window.addEventListener('beforeunload', stop);
})();
