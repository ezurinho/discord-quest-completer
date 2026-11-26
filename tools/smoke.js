'use strict';
// Runs the real bundle against a stub DOM and fake client modules, so a change that
// breaks mounting, rendering or the video tick fails here instead of in someone's
// console.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeNode(tag) {
  const node = {
    tagName: tag || 'div',
    style: {},
    dataset: {},
    className: '',
    children: [],
    text: '',
    handlers: {},
    queries: new Map(),
    childElementCount: 0,
    set innerHTML(value) { this.html = String(value); },
    get innerHTML() { return this.html || ''; },
    set textContent(value) { this.text = String(value); this.children = []; },
    get textContent() {
      return this.text + this.children.map((child) => child.textContent || '').join('');
    },
    appendChild(child) { this.children.push(child); this.childElementCount = this.children.length; return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); this.childElementCount = this.children.length; },
    get firstChild() { return this.children[0]; },
    querySelector(selector) {
      if (!this.queries.has(selector)) this.queries.set(selector, makeNode());
      return this.queries.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    remove() { this.removed = true; },
    setPointerCapture() {},
    releasePointerCapture() {},
    offsetLeft: 0,
    offsetTop: 0,
    scrollTop: 0,
    scrollHeight: 0
  };
  return node;
}

const body = makeNode('body');
const head = makeNode('head');
const byId = new Map();
const document = {
  body,
  head,
  createElement: (tag) => makeNode(tag),
  createTextNode: (value) => ({ textContent: String(value) }),
  getElementById: (id) => byId.get(id) || null
};
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v))
};

const calls = [];
const proto = (methods) => { const p = {}; for (const [k, v] of Object.entries(methods)) p[k] = v; return p; };
const quests = new Map([
  ['q-video', {
    id: 'q-video',
    config: { messages: { questName: 'Watch the trailer' }, taskConfigV2: { tasks: { WATCH_VIDEO: { target: 60 } } } },
    userStatus: { enrolledAt: '2026-01-01T00:00:00Z', progress: { WATCH_VIDEO: { value: 0 } } }
  }],
  ['q-game', {
    id: 'q-game',
    config: { messages: { questName: 'Play the game' }, taskConfigV2: { tasks: { PLAY_ON_DESKTOP: { target: 15, applications: [{ id: '999' }] } } } },
    userStatus: {}
  }],
  ['q-claim', {
    id: 'q-claim',
    config: { messages: { questName: 'Reward waiting' }, taskConfigV2: { tasks: { WATCH_VIDEO: { target: 30 } } } },
    userStatus: { enrolledAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z', progress: { WATCH_VIDEO: { value: 30 } } }
  }]
]);

const questStore = Object.create(proto({ getQuest: (id) => quests.get(id) }));
questStore.quests = quests;
const runStore = proto({ getRunningGames: () => [], getGameForPID: () => null });
let limited = false;
const api = {
  // First video call is rate limited, enrolments 404: the two failure paths that
  // used to hang the run or spam the log.
  post: async (opts) => {
    calls.push(opts);
    const url = String((opts && opts.url) || '');
    if (url.indexOf('/video-progress') >= 0 && !limited) {
      limited = true;
      const err = new Error('rate limited');
      err.status = 429;
      err.body = { retry_after: 0.2 };
      throw err;
    }
    if (url.indexOf('/enroll') >= 0) {
      const err = new Error('unknown quest');
      err.status = 404;
      err.body = { message: 'Unknown quest' };
      throw err;
    }
    return { ok: true };
  },
  get: async () => ({})
};
const chunks = [[[Symbol()], {}, (req) => { req.c = {
  1: { exports: { A: questStore } },
  2: { exports: { Ay: runStore } },
  3: { exports: { Bo: api } },
  4: { exports: { h: proto({ flushWaitQueue: () => {} }) } }
}; }]];
const window = {
  webpackChunkdiscord_app: { push: (arr) => { arr[2]({ c: chunks[0][2] && undefined }); return 0; }, pop: () => {} }
};

// The bundle pushes its probe into the real global and reads modules from the result.
const req = { c: {
  1: { exports: { A: questStore } },
  2: { exports: { Ay: runStore } },
  3: { exports: { Bo: api } },
  4: { exports: { h: proto({ flushWaitQueue: () => {} }) } }
} };
window.webpackChunkdiscord_app = {
  push: (arr) => { arr[2](req); return req; },
  pop: () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {}
};

window.addEventListener = () => {};
window.removeEventListener = () => {};

const context = {
  window,
  document,
  localStorage,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  Map,
  Set,
  Promise,
  JSON,
  Number,
  String,
  Object,
  Array,
  RegExp,
  Error,
  console
};
context.globalThis = context;
vm.createContext(context);
const bundle = fs.readFileSync(path.join(__dirname, '..', 'discord-quest-completer.js'), 'utf8');
vm.runInContext(bundle, context, { filename: 'discord-quest-completer.js' });

const failures = [];
const loggedNow = () => (panel && panel.querySelector('[data-log]') ? panel.querySelector('[data-log]').textContent : '');
const panel = body.children.find((node) => node.id === 'dqc-panel');
if (!panel) failures.push('the panel was not mounted');
const start = panel && panel.querySelector('#dqc-start');
const stop = panel && panel.querySelector('#dqc-stop');
const diag = panel && panel.querySelector('#dqc-diag');
if (!diag || !diag.handlers.click || !diag.handlers.click.length) failures.push('the ? button has no handler');
if (!start || !start.handlers.click || !start.handlers.click.length) failures.push('Start has no click handler');

(async () => {
  if (start && start.handlers.click) start.handlers.click[0]();
  await new Promise((r) => setTimeout(r, 2600));
  const video = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/video-progress') >= 0);
  const enrol = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/enroll') >= 0);
  if (video.length < 2) failures.push('the rate-limited video request was never retried');
  if (!enrol.length) failures.push('the unenrolled game quest was not enrolled');
  if (loggedNow().indexOf('rate limited') < 0) failures.push('nothing logged the 429');
  if (loggedNow().indexOf('cannot join') < 0) failures.push('the 404 on enrol was not reported');
  if (video.length && !(video[0].body && typeof video[0].body.timestamp === 'number')) failures.push('the video body has no numeric timestamp');
  const logBox = panel && panel.querySelector('[data-log]');
  const logged = logBox ? logBox.textContent : '';
  if (logged.indexOf('quests on this account') < 0) failures.push('the run never logged the quest count');
  const claim = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/claim-reward') >= 0);
  if (!claim.length) failures.push('the completed quest was never claimed');
  if (claim.length && claim[0].body && claim[0].body.traffic_metadata_sealed === undefined) failures.push('the claim body is missing the sealed blob');
  if (diag && diag.handlers.click) diag.handlers.click[0]();
  await new Promise((r) => setTimeout(r, 200));
  const after = logBox ? logBox.textContent : '';
  if (after.indexOf('blocked until') < 0) failures.push('the diagnosis printed nothing about the block');
  if (after.indexOf('3 quests') < 0) failures.push('the diagnosis miscounted the quests');
  if (stop && stop.handlers.click) stop.handlers.click[0]();
  const before = calls.length;
  await new Promise((r) => setTimeout(r, 800));
  if (calls.length !== before) failures.push('requests continued after Stop');

  const list = panel && panel.querySelector('[data-list]');
  const change = list && list.handlers.change && list.handlers.change[0];
  if (!change) failures.push('the quest list has no change handler');
  if (change) {
    change({ target: { classList: { contains: (name) => name === 'dqc-pick' }, dataset: { id: 'q-game' }, checked: false } });
    calls.length = 0;
    start.handlers.click[0]();
    await new Promise((r) => setTimeout(r, 1200));
    const again = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('q-game') >= 0);
    if (again.length) failures.push('an unchecked quest was still driven');
    if (!calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/video-progress') >= 0).length) failures.push('the checked quest stopped running after a restart');
    if (stop && stop.handlers.click) stop.handlers.click[0]();
  }
  if (failures.length) {
    console.error('smoke: ' + failures.join('; '));
    console.error('log was: ' + (panel && panel.querySelector('[data-log]') ? panel.querySelector('[data-log]').textContent.slice(0, 400) : 'no log node'));
    process.exit(1);
  }
  console.log('smoke: ok, ' + calls.length + ' requests, ' + video.length + ' video, ' + enrol.length + ' enrol, ' + claim.length + ' claim');
  process.exit(0);
})();
