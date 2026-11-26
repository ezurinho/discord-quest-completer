/*
 * Discord Quest Completer 1.2.0
 * Paste into the Discord app's DevTools console (Ctrl+Shift+I), press Enter, then Start.
 * https://github.com/ezurinho/discord-quest-completer
 *
 * Chromium blocks pasting into the console until you type `allow pasting` and press Enter.
 * This automates your account against Discord's Terms of Service. That risk is yours.
 */
(() => {
  'use strict';
  const NAME = 'Quest Completer';
  const VERSION = '1.2.0';
  const VIDEO_STEP = 5;
  const VIDEO_TICK = 900;
  const ENROLL_ON_START = true;

  const previous = document.getElementById('dqc-panel');
  if (previous) previous.remove();

  const state = { running: false, quests: [], lines: [], timers: new Map(), pulse: null, ui: null };

  // ---- client internals -------------------------------------------------
  function webpackModules() {
    const chunk = window.webpackChunkdiscord_app;
    if (!chunk) return null;
    const found = [];
    const key = 'dqc_' + Math.random().toString(36).slice(2);
    chunk.push([[key], {}, (req) => found.push(req)]);
    const index = chunk.findIndex((entry) => entry && entry[0] && entry[0][0] === key);
    if (index >= 0) chunk.splice(index, 1);
    return found.length ? found[0] : null;
  }

  function findBy(filter) {
    const req = webpackModules();
    if (!req || !req.c) return null;
    for (const id of Object.keys(req.c)) {
      const exports = req.c[id] && req.c[id].exports;
      if (!exports) continue;
      let hit = null;
      try { hit = filter(exports); } catch (err) { hit = null; }
      if (hit) return hit;
    }
    return null;
  }

  function modules() {
    return {
      dispatcher: findBy((e) => {
        const d = e && (e.default || e);
        return d && typeof d.dispatch === 'function' && typeof d.subscribe === 'function' ? d : null;
      }),
      http: findBy((e) => (e && typeof e.get === 'function' && typeof e.post === 'function' ? e : null)),
      store: findBy((e) => {
        const s = e && (e.default || e);
        return s && typeof s.getQuest === 'function' ? s : null;
      })
    };
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

  function tasksOf(quest) {
    return (quest && quest.config && quest.config.taskConfig && quest.config.taskConfig.tasks) || {};
  }

  function taskValue(quest, key) {
    const p = quest && quest.userStatus && quest.userStatus.progress;
    return (p && p[key] && p[key].value) || 0;
  }

  function cardFor(quest) {
    const tasks = tasksOf(quest);
    const key = Object.keys(tasks)[0] || '';
    const target = (tasks[key] && tasks[key].target) || 0;
    const type = (tasks[key] && tasks[key].type) || '';
    const value = taskValue(quest, key);
    const done = Boolean(quest.userStatus && quest.userStatus.completedAt);
    const live = state.running && !done && type === 'WATCH_VIDEO';
    const pct = target ? Math.min(100, Math.round((value / target) * 100)) : done ? 100 : 0;
    const card = document.createElement('div');
    card.className = 'dqc-card' + (done ? ' done' : live ? ' live' : '');
    const icon = done ? ICON.game : /VIDEO/.test(type) ? ICON.video : /PLAY/.test(type) ? ICON.game : ICON.clock;
    card.innerHTML = '<div class="dqc-icon">' + icon + '</div>' +
      '<div class="dqc-main"><div class="dqc-name"><span class="dqc-pill">' + (done ? 'DONE' : live ? 'RUNNING' : 'QUEUE') + '</span>' +
      esc((quest.config && quest.config.messages && quest.config.messages.questName) || quest.id) + '</div>' +
      '<div class="dqc-track"><div class="dqc-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="dqc-meta">' + (target ? value + ' / ' + target + ' s' : 'waiting for the client') + (pct ? ' · ' + pct + '%' : '') + '</div></div>';
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
    const foot = state.ui.querySelector('[data-count]');
    if (foot) foot.textContent = done + ' / ' + state.quests.length + ' claimed';
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
  function questList(mods) {
    const store = mods.store;
    if (!store) return [];
    const raw = typeof store.getQuests === 'function' ? store.getQuests() : store.quests;
    return Object.values(raw || {});
  }

  async function enroll(mods, quest) {
    if (!ENROLL_ON_START || !mods.http || quest.userStatus) return;
    try {
      await mods.http.post({ url: '/quests/' + quest.id + '/enroll' });
      log('enrolled ' + quest.id, 'ok');
    } catch (err) {
      log('enroll failed: ' + err.message, 'err');
    }
  }

  function videoTask(quest) {
    const tasks = tasksOf(quest);
    const key = Object.keys(tasks).find((k) => tasks[k] && tasks[k].type === 'WATCH_VIDEO');
    return key ? { key, target: tasks[key].target || 60 } : null;
  }

  function stopVideo(id) {
    const timer = state.timers.get(id);
    if (timer) clearInterval(timer);
    state.timers.delete(id);
  }

  async function videoTick(mods, quest) {
    const task = videoTask(quest);
    if (!task) return;
    const current = taskValue(quest, task.key);
    if (current >= task.target) {
      log('video done ' + quest.id, 'ok');
      stopVideo(quest.id);
      return;
    }
    const next = Math.min(task.target, current + VIDEO_STEP);
    try {
      await mods.http.post({ url: '/quests/' + quest.id + '/video-progress', body: { timestamp: next } });
      log('video ' + next + '/' + task.target + ' s · ' + (quest.config && quest.config.messages && quest.config.messages.questName || quest.id));
      state.quests = questList(mods);
      render();
    } catch (err) {
      log('video error: ' + err.message, 'err');
      stopVideo(quest.id);
    }
  }

  function startVideo(mods, quest) {
    if (state.timers.has(quest.id)) return;
    videoTick(mods, quest);
    state.timers.set(quest.id, setInterval(() => videoTick(mods, quest), VIDEO_TICK));
  }

  function fakeGame() {
    const now = Date.now();
    return { id: '000000000000000000', name: 'Quest Activity', type: 0, createdAt: now, executables: [{ os: 'win32', name: 'Quest Activity', application_id: '000000000000000000' }], sessionId: 'dqc-' + now };
  }

  function gameTask(quest) {
    const tasks = tasksOf(quest);
    const key = Object.keys(tasks).find((k) => tasks[k] && /PLAY/.test(tasks[k].type));
    return key ? { key, target: tasks[key].target || 900 } : null;
  }

  function pulseGame(mods, quest) {
    if (!gameTask(quest)) return;
    try {
      mods.dispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', added: [fakeGame()], removed: [] });
    } catch (err) {
      log('game dispatch failed: ' + err.message, 'err');
    }
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    const panel = mount();
    panel.querySelector('#dqc-start').disabled = true;
    panel.querySelector('#dqc-stop').disabled = false;
    log('looking for client modules');
    const mods = modules();
    if (!mods.store || !mods.http) {
      log('modules not found: reload the app (Ctrl+R) and paste again', 'err');
      stop();
      return;
    }
    state.quests = questList(mods);
    render();
    log(state.quests.length + ' quests on this account');
    for (const quest of state.quests) {
      if (quest.userStatus && quest.userStatus.completedAt) continue;
      await enroll(mods, quest);
      if (videoTask(quest)) startVideo(mods, quest);
      if (gameTask(quest)) pulseGame(mods, quest);
    }
    state.pulse = setInterval(() => {
      for (const quest of state.quests) {
        if (quest.userStatus && quest.userStatus.completedAt) continue;
        if (gameTask(quest)) pulseGame(mods, quest);
      }
      state.quests = questList(mods);
      render();
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
