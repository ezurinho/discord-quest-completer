/*
 * Discord Quest Completer 3.0.0
 * Paste into the Discord app's DevTools console (Ctrl+Shift+I), press Enter, then Start.
 * https://github.com/ezurinho/discord-quest-completer
 *
 * Chromium blocks pasting into the console until you type `allow pasting` and press Enter.
 * This automates your account against Discord's Terms of Service. That risk is yours.
 */
(() => {
  'use strict';
  const NAME = 'Quest Completer';
  const VERSION = '3.0.0';
  // A real player posts fractional media time every 7-9.5 s; 5 s of video every
  // 900 ms was five times faster than the player it pretends to be.
  const VIDEO_MIN_MS = 7000;
  const VIDEO_MAX_MS = 9500;
  // Pasted twice? The old panel goes, not a second one: two copies would double
  // every progress request.
  const previous = document.getElementById('dqc-panel');
  if (previous) previous.remove();
  // The old instance kept its own timers: two panels meant two video loops and two
  // request queues against one account, which is how a 429 gets made.
  if (typeof window.__dqcStop === 'function') {
    try { window.__dqcStop(); } catch (err) { /* the old copy is already gone */ }
  }

  const state = { running: false, quests: [], lines: [], timers: new Map(), pulse: null, ui: null, video: null, cursor: 0, selected: new Set(), chosen: false };
  // A quest that answers 404 will answer 404 on every retry: remember it instead of
  // burning the queue. A 429 pauses every video, not just the one that hit it.
  const blocked = new Set();
  let pauseUntil = 0;
  let limits = 0;

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
  function pick(exports, keys, protoMethod) {
    if (!exports) return null;
    for (const key of keys) {
      const value = exports[key];
      if (value && value.__proto__ && typeof value.__proto__[protoMethod] === 'function') return value;
    }
    return null;
  }
  function modules() {
    const stream = findModule((e) => pick(e, ['A', 'Z'], 'getStreamerActiveStreamMetadata'));
    const quests = findModule((e) => pick(e, ['A', 'Z'], 'getQuest'));
    const dispatcher = findModule((e) => pick(e, ['h', 'Z'], 'flushWaitQueue'));
    const games = findModule((e) => (e && e.Ay && typeof e.Ay.getRunningGames === 'function') || (e && e.ZP && typeof e.ZP.getRunningGames === 'function'));
    const api = findModule((e) => (e && e.Bo && typeof e.Bo.get === 'function') || (e && e.tn && typeof e.tn.get === 'function'));
    return {
      questStore: pick(quests, ['A', 'Z'], 'getQuest'),
      runStore: (games && games.Ay) || (games && games.ZP),
      dispatcher: pick(dispatcher, ['h', 'Z'], 'flushWaitQueue'),
      api: (api && api.Bo) || (api && api.tn),
      streamStore: pick(stream, ['A', 'Z'], 'getStreamerActiveStreamMetadata')
    };
  }
  function allQuests(mods) {
    const raw = mods.questStore && mods.questStore.quests;
    if (!raw) return [];
    return raw instanceof Map ? Array.from(raw.values()) : Object.values(raw);
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
    const key = video || has('PLAY') || has('STREAM') || has('ACTIVITY') || keys[0];
    const type = video ? 'VIDEO' : has('PLAY') ? 'GAME' : has('STREAM') ? 'STREAM' : has('ACTIVITY') ? 'ACTIVITY' : 'GAME';
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
          const wait = Number(err.body && err.body.retry_after) || 5;
          coolDown(wait * 1000 + 500);
          traffic.queue.unshift(req);
          log('rate limited: waiting ' + wait.toFixed(1) + 's (strike ' + limits + ')', 'err');
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
    panel.querySelector('#dqc-hide').addEventListener('click', () => panel.remove());
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
    return Boolean(task) && (task.type === 'VIDEO' || task.type === 'GAME');
  }

  function cardFor(quest) {
    const task = taskOf(quest);
    const done = Boolean(quest.userStatus && quest.userStatus.completedAt);
    const live = state.running && !done && task && task.type === 'VIDEO' && state.selected.has(quest.id);
    const supported = isSupported(task);
    const value = task ? questValue(quest, task.key) : 0;
    const target = task ? task.target : 0;
    const pct = target ? Math.min(100, Math.round((value / target) * 100)) : done ? 100 : 0;
    const label = blocked.has(quest.id) ? 'UNAVAILABLE' : !isSupported(task) && !done ? 'NOT AUTOMATABLE' : done ? 'DONE' : live ? 'RUNNING' : quest.userStatus && quest.userStatus.enrolledAt ? 'QUEUE' : 'NOT JOINED';
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

  function render() {
    const list = state.ui && state.ui.querySelector('[data-list]');
    if (!list) return;
    list.textContent = '';
    if (!state.quests.length) {
      const empty = document.createElement('div');
      empty.className = 'dqc-meta';
      empty.style.padding = '14px 6px';
      empty.textContent = 'No quests on this account right now.';
      list.appendChild(empty);
      return;
    }
    for (const quest of state.quests) list.appendChild(cardFor(quest));
    const done = state.quests.filter((q) => q.userStatus && q.userStatus.completedAt).length;
    const count = state.ui.querySelector('[data-count]');
    if (count) {
      const wait = Math.max(0, Math.round((pauseUntil - Date.now()) / 1000));
      const mmss = Math.floor(wait / 60) + ':' + String(wait % 60).padStart(2, '0');
      count.textContent = done + ' / ' + state.quests.length + ' claimed' + (wait ? ' · rate limited, ' + mmss + ' left' : '');
    }
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
    const next = Math.min(task.target, Number((current + step).toFixed(6)));
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

  function nextVideoQuest() {
    const waiting = state.quests.filter((quest) => {
      if (quest.userStatus && quest.userStatus.completedAt) return false;
      if (blocked.has(quest.id)) return false;
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
  function fakeGame(appId) {
    const id = appId || '000000000000000000';
    if (standIns.has(id)) return standIns.get(id);
    const now = Date.now();
    const safe = String(id).replace(/[^0-9]/g, '');
    const exe = 'quest-' + safe + '.exe';
    const game = {
      pid: 1000 + Math.floor(Math.random() * 8000),
      id,
      name: 'Quest Activity',
      start: now,
      createdAt: now,
      exeName: exe,
      exePath: 'c:/program files/quest activity/' + exe,
      cmdLine: '"C:\\\\Program Files\\\\Quest Activity\\\\' + exe + '"'
    };
    standIns.set(id, game);
    return game;
  }

  function unpatchRunStore(mods) {
    const store = mods && mods.runStore;
    if (!store || !store.__dqcPatched) return;
    if (store.__dqcReal) store.getRunningGames = store.__dqcReal;
    if (store.__dqcRealPid) store.getGameForPID = store.__dqcRealPid;
    delete store.__dqcPatched;
    delete store.__dqcReal;
    delete store.__dqcRealPid;
  }

  function patchRunStore(mods) {
    const store = mods.runStore;
    if (!store || store.__dqcPatched || typeof store.getRunningGames !== 'function') return;
    const real = store.getRunningGames;
    const realPid = store.getGameForPID;
    store.getRunningGames = function () { return real.call(store).concat(Array.from(standIns.values())); };
    if (typeof realPid === 'function') {
      store.getGameForPID = function (pid) {
        return Array.from(standIns.values()).find((game) => game.pid === pid) || realPid.call(store, pid);
      };
    }
    store.__dqcReal = real;
    store.__dqcRealPid = realPid;
    store.__dqcPatched = true;
  }

  // Dispatching RUNNING_GAMES_CHANGE with a hand-built game crashed Discord's own
  // ClipStore ("Cannot read properties of undefined (reading 'some')"), because the
  // client expects a complete process object. The store patch alone is enough for the
  // heartbeat to see it, so the dispatch is gone.
  function pulseGame(mods, quest, task) {
    const app = (quest.config && quest.config.application) || {};
    fakeGame(app.id);
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
    traffic.post = mods.api.post.bind(mods.api);
    state.mods = mods;
    patchRunStore(mods);
    state.quests = allQuests(mods);
    render();
    log(state.quests.length + ' quests on this account');
    const blockedUntil = mods.questStore && mods.questStore.questEnrollmentBlockedUntil;
    if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) {
      log('Discord blocked enrolment on this account until ' + new Date(blockedUntil).toLocaleString(), 'err');
    }
    // Nothing here waits for the network. The old version enrolled every quest first
    // and only then logged anything, so one request the client never settled hid the
    // whole run behind an empty panel. Enrolment is now fire-and-forget and the
    // store refresh picks up the result.
    if (!state.chosen) {
      state.chosen = true;
      for (const quest of state.quests) {
        const task = taskOf(quest);
        if (task && (task.type === 'VIDEO' || task.type === 'GAME')) state.selected.add(quest.id);
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
      if (state.selected.size && !state.selected.has(quest.id)) continue;
      const value = questValue(quest, task.key);
      const joined = Boolean(quest.userStatus && quest.userStatus.enrolledAt);
      if (!joined) {
        log('not joined: ' + task.name + ' · asking to join', 'err');
        enroll(quest).catch(() => {});
        continue;
      }
      log(task.name + ' · ' + task.type + ' · ' + value + '/' + task.target);
      if (task.type !== 'VIDEO') { fakeGame(task.appId); pulseGame(mods, quest, task); }
    }
    startVideos();
    state.pulse = setInterval(() => {
      state.quests = allQuests(mods);
      const pending = state.quests.filter((q) => !(q.userStatus && q.userStatus.completedAt));
      for (const quest of pending) {
        const task = taskOf(quest);
        if (task && task.type !== 'VIDEO' && !blocked.has(quest.id)) { fakeGame(task.appId); pulseGame(mods, quest, task); }
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
