/*
 * Discord Quest Completer 1.3.0
 * Paste into the Discord app's DevTools console (Ctrl+Shift+I), press Enter, then Start.
 * https://github.com/ezurinho/discord-quest-completer
 *
 * Chromium blocks pasting into the console until you type `allow pasting` and press Enter.
 * This automates your account against Discord's Terms of Service. That risk is yours.
 */
(() => {
  'use strict';
  const NAME = 'Quest Completer';
  const VERSION = '1.3.0';
  const VIDEO_STEP = 5;
  const VIDEO_TICK = 900;
  // Pasted twice? The old panel goes, not a second one: two copies would double
  // every progress request.
  const previous = document.getElementById('dqc-panel');
  if (previous) previous.remove();

  const state = { running: false, quests: [], lines: [], timers: new Map(), pulse: null, ui: null };
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
  function configOf(quest) {
    return (quest && quest.config && (quest.config.taskConfig || quest.config.taskConfigV2)) || {};
  }
  function taskOf(quest) {
    const config = configOf(quest);
    const tasks = (config && config.tasks) || {};
    const keys = Object.keys(tasks);
    if (!keys.length) return null;
    const has = (needle) => keys.find((key) => key.indexOf(needle) >= 0);
    const key = has('PLAY') || has('STREAM') || has('VIDEO') || has('ACTIVITY') || has('WATCH') || keys[0];
    const type = has('PLAY') ? 'GAME' : has('VIDEO') || has('WATCH') ? 'VIDEO' : has('STREAM') ? 'STREAM' : has('ACTIVITY') ? 'ACTIVITY' : 'GAME';
    const name = (quest.config.messages && quest.config.messages.questName) || (quest.config.application && quest.config.application.name) || quest.id;
    return { key, name, type, target: Number(tasks[key] && tasks[key].target) || 0 };
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
      traffic.queue.push({ url, body, resolve, reject });
      drain();
    });
  }
  async function drain() {
    if (traffic.busy) return;
    traffic.busy = true;
    while (traffic.queue.length) {
      if (!state.running) { traffic.queue = []; break; }
      const req = traffic.queue.shift();
      try {
        req.resolve(await traffic.post({ url: req.url, body: req.body }));
      } catch (err) {
        if (err && err.status === 429) {
          const wait = Number(err.body && err.body.retry_after) || 5;
          traffic.queue.unshift(req);
          log('rate limited: waiting ' + wait + 's', 'err');
          await sleep(wait * 1000 + 500);
        } else {
          req.reject(err);
        }
      }
      await sleep(300);
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
    panel.querySelector('#dqc-hide').addEventListener('click', () => panel.remove());
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
    handle.addEventListener('pointerup', () => { moving = false; });
  }

  // ---- work ------------------------------------------------------------
  function cardFor(quest) {
    const task = taskOf(quest);
    const done = Boolean(quest.userStatus && quest.userStatus.completedAt);
    const live = state.running && !done && task && task.type === 'VIDEO' && state.timers.has(quest.id);
    const value = task ? questValue(quest, task.key) : 0;
    const target = task ? task.target : 0;
    const pct = target ? Math.min(100, Math.round((value / target) * 100)) : done ? 100 : 0;
    const label = done ? 'DONE' : live ? 'RUNNING' : quest.userStatus && quest.userStatus.enrolledAt ? 'QUEUE' : 'NOT JOINED';
    const icon = task && task.type === 'VIDEO' ? ICON.video : task && (task.type === 'GAME' || task.type === 'ACTIVITY') ? ICON.game : ICON.clock;
    const card = document.createElement('div');
    card.className = 'dqc-card' + (done ? ' done' : live ? ' live' : '');
    card.innerHTML = '<div class="dqc-icon">' + icon + '</div>' +
      '<div class="dqc-main"><div class="dqc-name"><span class="dqc-pill">' + label + '</span>' +
      esc(task ? task.name : quest.id) + '</div>' +
      '<div class="dqc-track"><div class="dqc-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="dqc-meta">' + (target ? value + ' / ' + target + ' s' + (pct ? ' · ' + pct + '%' : '') : 'waiting for a task config') + '</div></div>';
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
    if (count) count.textContent = done + ' / ' + state.quests.length + ' claimed';
  }

  async function enroll(quest) {
    if (quest.userStatus && quest.userStatus.enrolledAt) return;
    try {
      await enqueue('/quests/' + quest.id + '/enroll', { location: 1 });
      log('joined ' + (taskOf(quest) ? taskOf(quest).name : quest.id), 'ok');
    } catch (err) {
      log('enroll failed: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  async function videoTick(quest, task) {
    const current = questValue(quest, task.key);
    if (current >= task.target) {
      log('done ' + task.name, 'ok');
      stopVideo(quest.id);
      return;
    }
    const next = Math.min(task.target, current + VIDEO_STEP);
    try {
      await enqueue('/quests/' + quest.id + '/video-progress', { timestamp: next });
      log(task.name + ' · ' + next + '/' + task.target + ' s');
    } catch (err) {
      log('video error: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  function stopVideo(id) {
    const timer = state.timers.get(id);
    if (timer) clearInterval(timer);
    state.timers.delete(id);
  }

  function startVideo(quest, task) {
    if (state.timers.has(quest.id)) return;
    videoTick(quest, task);
    state.timers.set(quest.id, setInterval(() => videoTick(quest, task), VIDEO_TICK));
  }

  // The client believes a game is running when the store says so and the running
  // games event fired; both are needed, the event alone gets ignored by some quests.
  function fakeGame(appId) {
    const now = Date.now();
    return { pid: 1000 + Math.floor(Math.random() * 8000), id: appId || '000000000000000000', name: 'Quest Activity', start: now, createdAt: now };
  }

  function patchRunStore(mods) {
    const store = mods.runStore;
    if (!store || store.__dqcPatched || typeof store.getRunningGames !== 'function') return;
    const real = store.getRunningGames;
    const fake = [fakeGame()];
    store.getRunningGames = function () { return real.call(store).concat(fake); };
    store.__dqcPatched = true;
  }

  function pulseGame(mods, quest, task) {
    if (!mods.dispatcher) return;
    const game = fakeGame(quest.config && quest.config.application && quest.config.application.id);
    try {
      mods.dispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', added: [game], removed: [] });
    } catch (err) {
      log('game dispatch failed: ' + err.message, 'err');
    }
  }

  async function run() {
    if (state.running) return;
    const panel = mount();
    panel.querySelector('#dqc-start').disabled = true;
    panel.querySelector('#dqc-stop').disabled = false;
    log('reading the client modules');
    const mods = modules();
    if (!mods.questStore || !mods.api) {
      log('modules not found: reload (Ctrl+R) and paste again', 'err');
      stop();
      return;
    }
    state.running = true;
    traffic.post = mods.api.post.bind(mods.api);
    patchRunStore(mods);
    state.quests = allQuests(mods);
    render();
    log(state.quests.length + ' quests on this account');
    for (const quest of state.quests) {
      if (quest.userStatus && quest.userStatus.completedAt) continue;
      await enroll(quest);
      const task = taskOf(quest);
      if (!task) continue;
      if (task.type === 'VIDEO') startVideo(quest, task);
      else pulseGame(mods, quest, task);
    }
    state.pulse = setInterval(() => {
      state.quests = allQuests(mods);
      const pending = state.quests.filter((q) => !(q.userStatus && q.userStatus.completedAt));
      for (const quest of pending) {
        const task = taskOf(quest);
        if (task && task.type !== 'VIDEO') pulseGame(mods, quest, task);
        if (task && task.type === 'VIDEO' && !state.timers.has(quest.id)) startVideo(quest, task);
      }
      render();
      if (!pending.length) stop();
    }, 15000);
    log('running: leave the app open', 'ok');
  }

  function stop() {
    state.running = false;
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

  mount();
  log(NAME + ' ' + VERSION + ' ready · press Start', 'ok');
  window.addEventListener('beforeunload', stop);
})();
