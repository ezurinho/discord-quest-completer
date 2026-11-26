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
  ['q-404', {
    id: 'q-404',
    config: { messages: { questName: 'Gone quest' }, taskConfigV2: { tasks: { PLAY_ON_DESKTOP: { target: 15, applications: [{ id: '888' }] } } } },
    userStatus: {}
  }],
  ['q-act', {
    id: 'q-act',
    config: { messages: { questName: 'Join the activity' }, taskConfigV2: { tasks: { PLAY_ACTIVITY: { target: 100, applications: [{ id: '777' }] } } } },
    userStatus: { enrolledAt: '2026-01-01T00:00:00Z', progress: {} }
  }],
  ['q-claim', {
    id: 'q-claim',
    config: {
      messages: { questName: 'Reward waiting' },
      rewards: { assignment_method: 0, rewards: [{ orbQuantity: 700 }] },
      taskConfigV2: { tasks: { WATCH_VIDEO: { target: 30 } } }
    },
    userStatus: { enrolledAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z', progress: { WATCH_VIDEO: { value: 30 } } }
  }]
]);

const useName = process.argv.indexOf('--name') >= 0;
const suspendedMode = process.argv.indexOf('--suspended') >= 0;
const questStore = useName
  ? { constructor: { displayName: 'QuestStore' }, quests, getQuest: (id) => quests.get(id) }
  : Object.create(proto({ getQuest: (id) => quests.get(id) }));
if (!useName) questStore.quests = quests;
// The harsher of Discord's two states: enrolment blocked stops new quests, access
// suspended stops every task type. The run must not send a single request.
if (suspendedMode) questStore.isQuestAccessSuspended = true;
const events = [];
const runStore = proto({
  getRunningGames: () => [],
  getGameForPID: () => null,
  getVisibleGame: () => null,
  getVisibleRunningGames: () => [],
  getCandidateGames: () => [],
  getRunningDiscordApplicationIds: () => new Set()
});
let limited = false;
const userStore = Object.create(proto({ getCurrentUser: () => ({ id: 'u1' }) }));
const chanStore = Object.create(proto({ getSortedPrivateChannels: () => [{ id: 'dm1' }] }));
const guildChanStore = Object.create(proto({ getAllGuilds: () => ({}) }));

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
    if (url.indexOf('/heartbeat') >= 0) return { body: { progress: { PLAY_ACTIVITY: { value: 100 } } } };
    if (url.indexOf('q-404') >= 0) {
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
  4: { exports: { h: proto({ flushWaitQueue: () => {}, dispatch: (payload) => events.push(payload) }) } }
}; }]];
const window = {
  webpackChunkdiscord_app: { push: (arr) => { arr[2]({ c: chunks[0][2] && undefined }); return 0; }, pop: () => {} }
};

// The bundle pushes its probe into the real global and reads modules from the result.
const req = { c: {
  1: { exports: { A: questStore } },
  2: { exports: { Ay: runStore } },
  3: { exports: { Bo: api } },
  4: { exports: { h: proto({ flushWaitQueue: () => {}, dispatch: (payload) => events.push(payload) }) } },
  5: { exports: { A: userStore } },
  6: { exports: { A: chanStore } },
  7: { exports: { A: guildChanStore } }
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
  if (suspendedMode) {
    if (start && start.handlers.click) start.handlers.click[0]();
    await new Promise((r) => setTimeout(r, 700));
    const logged = loggedNow();
    if (calls.length) failures.push('a suspended account still sent ' + calls.length + ' request(s)');
    if (logged.indexOf('suspended quest access') < 0) failures.push('the suspension was not reported');
    if (failures.length) {
      console.error('smoke (suspended): ' + failures.join('; '));
      console.error('log was: ' + logged.slice(0, 300));
      process.exit(1);
    }
    console.log('smoke (suspended): ok, 0 requests, run refused');
    process.exit(0);
  }
  if (start && start.handlers.click) start.handlers.click[0]();
  // Every request goes through the client queue with a 250-500 ms gap, so the first
  // video tick can sit behind four other calls: wait for the queue, not for a round number.
  await new Promise((r) => setTimeout(r, 4500));
  const video = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/video-progress') >= 0);
  const enrol = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/enroll') >= 0);
  if (video.length < 2) failures.push('the rate-limited video request was never retried; calls=' + JSON.stringify(calls.map((c) => String(c.url))));
  if (!enrol.length) failures.push('the unenrolled game quest was not enrolled');
  if (loggedNow().indexOf('rate limited') < 0) failures.push('nothing logged the 429');
  if (loggedNow().indexOf('cannot join') < 0) failures.push('the 404 on enrol was not reported');
  if (video.length && !(video[0].body && typeof video[0].body.timestamp === 'number')) failures.push('the video body has no numeric timestamp');
  const listNode = panel && panel.querySelector('[data-list]');
  const cards = listNode && listNode.children ? listNode.children.map((card) => card.html || '').join('') : '';
  if (cards.indexOf('700 Orbs') < 0) failures.push('the orb reward is not on the card');
  const logBox = panel && panel.querySelector('[data-log]');
  const logged = logBox ? logBox.textContent : '';
  if (logged.indexOf('quests on this account') < 0) failures.push('the run never logged the quest count');
  const claim = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/claim-reward') >= 0);
  if (!claim.length) failures.push('the completed quest was never claimed');
  if (claim.length && claim[0].body && claim[0].body.traffic_metadata_sealed === undefined) failures.push('the claim body is missing the sealed blob');
  const beats = calls.filter((c) => String((c && (c.url || c.path)) || '').indexOf('/heartbeat') >= 0);
  if (!beats.length) failures.push('the activity quest never sent a heartbeat');
  else if (beats[0].body && beats[0].body.stream_key !== 'call:dm1:u1') failures.push('the heartbeat carried the wrong stream key');
  const announced = events.find((e) => e.type === 'RUNNING_GAMES_CHANGE' && e.added && e.added.length);
  if (!announced) failures.push('no game was announced to the client');
  else {
    if (!Array.isArray(announced.games)) failures.push('the game event has no games array');
    else if (!announced.games.some((g) => String(g.id) === '999')) failures.push('the stand-in is missing from the games array');
    // Discord lowercases game fields in its own handler; an undefined one throws there.
    if (typeof announced.added[0].distributor !== 'string') failures.push('the stand-in has no distributor string');
    if (announced.added[0].someFieldNobodySets !== '') failures.push('an unknown string field is not an empty string');
  }
  if (diag && diag.handlers.click) diag.handlers.click[0]();
  await new Promise((r) => setTimeout(r, 200));
  const after = logBox ? logBox.textContent : '';
  if (after.indexOf('blocked until') < 0) failures.push('the diagnosis printed nothing about the block');
  if (after.indexOf('5 quests') < 0) failures.push('the diagnosis miscounted the quests');
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
    await new Promise((r) => setTimeout(r, 2500));
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
  console.log('smoke (' + (useName ? 'displayName' : 'prototype') + '): ok, ' + calls.length + ' requests, ' + video.length + ' video, ' + enrol.length + ' enrol, ' + claim.length + ' claim');
  process.exit(0);
})();
