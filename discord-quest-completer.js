/*
 * Discord Quest Completer 1.1.0
 * Paste into the Discord app's DevTools console (Ctrl+Shift+I), press Enter, then Start.
 * https://github.com/ezurinho/discord-quest-completer
 *
 * Chromium blocks pasting into the console until you type `allow pasting` and press Enter.
 * If the Quest panel does not appear, the log line in the console says why.
 *
 * This automates your account against Discord's Terms of Service. That risk is yours.
 */
(() => {
  'use strict';
  // Discord gates the client behind webpack; every automation script has to borrow
  // the client's own dispatcher and HTTP client instead of guessing at endpoints.
  const NAME = 'Discord Quest Completer';
  const VERSION = '1.1.0';
  const VIDEO_STEP = 5;
  const VIDEO_TICK = 900;
  const ENROLL_ON_START = true;

  // Pasted twice? The old panel goes, not a second one: two script instances would
  // drive the same quest and double every progress request.
  const previous = document.getElementById('dqc-panel');
  if (previous) previous.remove();

  const state = { running: false, quests: [], lines: [], videoTimers: new Map(), gameTimer: null, ui: null };

  // ---- client internals -------------------------------------------------
  function webpackModules() {
    const chunk = window.webpackChunkdiscord_app;
    if (!chunk) return null;
    const found = [];
    const key = 'cw_' + Math.random().toString(36).slice(2);
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
    const dispatcher = findBy((e) => {
      const d = e && (e.default || e);
      return d && typeof d.dispatch === 'function' && typeof d.subscribe === 'function' ? d : null;
    });
    const http = findBy((e) => (e && typeof e.get === 'function' && typeof e.post === 'function' ? e : null));
    const store = findBy((e) => {
      const s = e && (e.default || e);
      return s && typeof s.getQuest === 'function' ? s : null;
    });
    return { dispatcher, http, store };
  }

  // ---- logging and panel ------------------------------------------------
  function log(text) {
    const stamp = new Date().toLocaleTimeString();
    state.lines.push('[' + stamp + '] ' + text);
    if (state.lines.length > 120) state.lines.shift();
    const box = state.ui && state.ui.querySelector('[data-log]');
    if (box) { box.textContent = state.lines.join('\n'); box.scrollTop = box.scrollHeight; }
  }

  function progressText(quest) {
    const tasks = (quest.config && quest.config.taskConfig && quest.config.taskConfig.tasks) || quest.configDefinition || {};
    const keys = Object.keys(tasks || {});
    if (!keys.length) return 'no tasks';
    const parts = [];
    for (const key of keys) {
      const task = tasks[key] || {};
      const current = (quest.userStatus && quest.userStatus.progress && quest.userStatus.progress[key] && quest.userStatus.progress[key].value) || 0;
      parts.push(key + ' ' + current + '/' + (task.target || '?'));
    }
    return parts.join(' · ');
  }

  function render() {
    const list = state.ui && state.ui.querySelector('[data-list]');
    if (!list) return;
    list.textContent = '';
    for (const quest of state.quests) {
      const row = document.createElement('div');
      row.className = 'dqc-row';
      const title = document.createElement('div');
      title.className = 'dqc-title';
      title.textContent = (quest.config && quest.config.messages && quest.config.messages.questName) || quest.id;
      const meta = document.createElement('div');
      meta.className = 'dqc-meta';
      meta.textContent = (quest.userStatus && quest.userStatus.completedAt ? 'done · ' : '') + progressText(quest);
      row.appendChild(title);
      row.appendChild(meta);
      list.appendChild(row);
    }
    if (!state.quests.length) {
      const empty = document.createElement('div');
      empty.className = 'dqc-meta';
      empty.textContent = 'No quests on this account right now.';
      list.appendChild(empty);
    }
  }

  const CSS = [
    '#dqc-panel{position:fixed;right:16px;bottom:16px;width:320px;z-index:2147483000;background:#1e1f22;color:#dbdee1;border:1px solid #2b2d31;border-radius:10px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.45)}',
    '#dqc-panel header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#232428;border-radius:10px 10px 0 0;cursor:move}',
    '#dqc-panel h1{margin:0;font-size:12px;font-weight:700;letter-spacing:.3px}',
    '#dqc-panel button{background:#5865f2;color:#fff;border:0;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}',
    '#dqc-panel button[data-stop]{background:#da373c}',
    '#dqc-panel button:disabled{opacity:.5;cursor:default}',
    '#dqc-panel [data-list]{max-height:220px;overflow:auto;padding:8px 12px}',
    '.dqc-row{padding:6px 0;border-bottom:1px solid #2b2d31}',
    '.dqc-row:last-child{border-bottom:0}',
    '.dqc-title{font-weight:600}',
    '.dqc-meta{color:#949ba4;font-size:11px}',
    '#dqc-panel [data-log]{margin:0;padding:8px 12px;max-height:120px;overflow:auto;background:#0e0f10;color:#949ba4;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;border-radius:0 0 10px 10px}'
  ].join('');

  function mount() {
    if (state.ui) return state.ui;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const panel = document.createElement('section');
    panel.id = 'dqc-panel';
    panel.innerHTML = [
      '<header data-drag><h1>' + NAME + ' ' + VERSION + '</h1>',
      '<span><button data-start>Start</button> <button data-stop disabled>Stop</button></span></header>',
      '<div data-list></div>',
      '<pre data-log></pre>'
    ].join('');
    panel.querySelector('[data-start]').addEventListener('click', () => run());
    panel.querySelector('[data-stop]').addEventListener('click', () => stop());
    document.body.appendChild(panel);
    state.ui = panel;
    drag(panel, panel.querySelector('[data-drag]'));
    return panel;
  }

  function drag(panel, handle) {
    let ox = 0, oy = 0, dragging = false;
    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      ox = event.clientX - panel.offsetLeft;
      oy = event.clientY - panel.offsetTop;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      panel.style.left = (event.clientX - ox) + 'px';
      panel.style.top = (event.clientY - oy) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', () => { dragging = false; });
  }

  // ---- the work ---------------------------------------------------------
  function questList(mods) {
    const store = mods.store;
    if (!store) return [];
    const raw = typeof store.getQuests === 'function' ? store.getQuests() : store.quests;
    return Object.values(raw || {});
  }

  async function enroll(mods, quest) {
    if (!ENROLL_ON_START || !mods.http) return;
    if (quest.userStatus) return;
    try {
      await mods.http.post({ url: '/quests/' + quest.id + '/enroll' });
      log('enrolled ' + quest.id);
    } catch (err) {
      log('enroll failed ' + quest.id + ': ' + err.message);
    }
  }

  function videoTask(quest) {
    const tasks = (quest.config && quest.config.taskConfig && quest.config.taskConfig.tasks) || {};
    const key = Object.keys(tasks).find((k) => tasks[k] && tasks[k].type === 'WATCH_VIDEO');
    const definition = (quest.config && quest.config.taskConfig && quest.config.taskConfig.tasks) || quest.configDefinition || {};
    const detail = (key && (definition[key] || quest.configDefinition || {})) || {};
    return key ? { key, target: tasks[key].target || detail.target || 60 } : null;
  }

  async function videoTick(mods, quest) {
    const task = videoTask(quest);
    if (!task) return;
    const status = (quest.userStatus && quest.userStatus.progress && quest.userStatus.progress[task.key] && quest.userStatus.progress[task.key].value) || 0;
    if (status >= task.target) {
      log('video done ' + quest.id);
      stopVideo(quest.id);
      return;
    }
    try {
      await mods.http.post({ url: '/quests/' + quest.id + '/video-progress', body: { timestamp: Math.min(task.target, status + VIDEO_STEP) } });
      log('video ' + quest.id + ' ' + Math.min(task.target, status + VIDEO_STEP) + '/' + task.target);
    } catch (err) {
      log('video error: ' + err.message);
      stopVideo(quest.id);
    }
  }

  function startVideo(mods, quest) {
    if (state.videoTimers.has(quest.id)) return;
    videoTick(mods, quest);
    state.videoTimers.set(quest.id, setInterval(() => videoTick(mods, quest), VIDEO_TICK));
  }

  function stopVideo(id) {
    const timer = state.videoTimers.get(id);
    if (timer) clearInterval(timer);
    state.videoTimers.delete(id);
  }

  // A game quest only needs the client to believe a game is running; this is the
  // same event Discord's own activities fire, with a stand-in app.
  function fakeGame() {
    const now = Date.now();
    return { id: '000000000000000000', name: 'Quest Activity', type: 0, createdAt: now, executables: [{ os: 'win32', name: 'Quest Activity', application_id: '000000000000000000' }], sessionId: 'dqc-' + now };
  }

  function gameTask(quest) {
    const tasks = (quest.config && quest.config.taskConfig && quest.config.taskConfig.tasks) || {};
    const key = Object.keys(tasks).find((k) => tasks[k] && /PLAY/.test(tasks[k].type));
    return key ? { key, target: tasks[key].target || 900 } : null;
  }

  function pulseGame(mods, quest) {
    const task = gameTask(quest);
    if (!task) return;
    try {
      mods.dispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', added: [fakeGame()], removed: [] });
    } catch (err) {
      log('game dispatch failed: ' + err.message);
    }
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.lines = [];
    const panel = mount();
    panel.querySelector('[data-start]').disabled = true;
    panel.querySelector('[data-stop]').disabled = false;
    log('looking for the client modules');
    const mods = modules();
    if (!mods.store || !mods.http) {
      log('modules not found: open discord.com/app and reload with the script enabled');
      state.running = false;
      panel.querySelector('[data-start]').disabled = false;
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
    state.gameTimer = setInterval(() => {
      for (const quest of state.quests) {
        if (quest.userStatus && quest.userStatus.completedAt) continue;
        if (gameTask(quest)) pulseGame(mods, quest);
      }
      state.quests = questList(mods);
      render();
    }, 15000);
    log('running: leave this tab open');
  }

  function stop() {
    state.running = false;
    for (const id of Array.from(state.videoTimers.keys())) stopVideo(id);
    if (state.gameTimer) clearInterval(state.gameTimer);
    state.gameTimer = null;
    const panel = state.ui;
    if (panel) {
      panel.querySelector('[data-start]').disabled = false;
      panel.querySelector('[data-stop]').disabled = true;
    }
    log('stopped');
  }

  mount();
  log(NAME + ' ' + VERSION + ' loaded · press Start');
  window.addEventListener('beforeunload', stop);
})();
