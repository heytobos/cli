/**
 * The phone page, at `<content origin>/<code>`: whatever activity the presenter is on, to answer
 * once. Our code only, never a deck's. No account and no cookies: what the phone keeps in
 * localStorage is for one show only (Kept), and a phone that only looks keeps and sends nothing.
 */
import type { PhoneActivity, PhoneState } from '../activities.ts';

const code = location.pathname.split('/')[1] ?? '';
const root = document.getElementById('tobos-phone')!;

/** How often a phone looks whether the deck went live, while it isn't. */
const POLL_MS = 30_000;
/** How long what the phone keeps lasts after the page was last open. */
const KEEP_MS = 3 * 60 * 60_000;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing may refuse: the phone just forgets.
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // as above
    }
  },
};

/** A random v4 UUID; crypto.randomUUID() needs a secure context, which a dev server isn't. */
function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * What the phone keeps for the deck, under `tobos:phone:<code>`, for one show: its id in it,
 * made when it sends its first answer, so that its answers stay together and each counts once;
 * what it has answered, so that a reload doesn't offer it again; and what it has typed but not
 * sent. All of it goes when the phone sees another show live, or 3 hours after the page was last
 * open (`until`, renewed while it is). The next show, or another deck, gets another id, so one
 * phone's answers can't be lined up across them.
 */
interface Kept {
  show: string;
  participant?: string;
  until: number;
  sent: string[];
  drafts: Record<string, Record<string, string>>;
}
const KEPT = 'tobos:phone:';
const keptKey = `${KEPT}${code}`;

function parse(text: string | null): Kept | null {
  try {
    const kept = JSON.parse(text ?? 'null') as Partial<Kept> | null;
    return typeof kept?.show === 'string' &&
      typeof kept.until === 'number' &&
      Array.isArray(kept.sent) &&
      typeof kept.drafts === 'object' &&
      kept.drafts !== null
      ? (kept as Kept)
      : null;
  } catch {
    return null;
  }
}

// On every load, since localStorage expires nothing by itself: what earlier versions of this page
// kept, among it an id per deck for good, and whatever has expired, for any deck, goes.
try {
  for (const key of Object.keys(localStorage)) {
    const legacy = /^tobos:(participant|sent|draft):/.test(key);
    const expired = key.startsWith(KEPT) && !((parse(store.get(key))?.until ?? 0) > Date.now());
    if (legacy || expired) localStorage.removeItem(key);
  }
} catch {
  // Storage refused: nothing was kept.
}

let kept = parse(store.get(keptKey));

let state: PhoneState | null = null;
/** An activity closed while it was open here, unsent. */
let closed = false;
let sending = false;
let error = '';
/** A response's id, kept across retries of the same answer, so a retry is never counted twice. */
const pending = new Map<string, string>();
/** The option picked in the open poll. */
let picked: string | null = null;

/**
 * The objection's mail, in the notice the server puts on the page: the join code goes in, and the
 * phone's id in this show, which only the phone knows, so that its answers can be found.
 */
const objection = document.querySelector<HTMLAnchorElement>('a[data-object]');
const mailto = objection?.getAttribute('href') ?? '';

/** The show in which the person started answering here, by picking or typing. */
let started: string | null = null;

/** What follows from what the phone keeps, outside the screen the script draws. */
function changed() {
  // Answering in this show, here or before a reload: the notice, which was on the first screen,
  // gives way to the question's Send button (phone.css). Another show, the next or a cleared one,
  // isn't answered yet, and has it on the first screen again.
  const show = state?.live ? state.show : null;
  document.body.classList.toggle(
    'answering',
    !!kept?.sent.length || (show !== null && started === show),
  );
  if (!objection) return;
  const [ask, codeIs, idIs] =
    objection.closest('[lang]')?.getAttribute('lang') === 'de'
      ? ['Bitte löschen Sie meine Antworten.', 'Code', 'Zufallszahl dieses Handys']
      : ['Please delete my answers.', 'Join code', "This phone's random number"];
  const id = kept?.participant;
  const lines = [ask, '', `${codeIs}: ${code}`, ...(id ? [`${idIs}: ${id}`] : [])];
  objection.href = `${mailto}&body=${encodeURIComponent(lines.join('\r\n'))}`;
}

/** Keep this, for 3 hours from now. */
function keep(next: Omit<Kept, 'until'>) {
  kept = { ...next, until: Date.now() + KEEP_MS };
  store.set(keptKey, JSON.stringify(kept));
  changed();
}

/** Forget all the phone kept for the deck, its id with it. */
function forget() {
  kept = null;
  store.remove(keptKey);
  pending.clear();
  changed();
}

/**
 * What the phone keeps, while it may still use it: before its time is up, and for the show that
 * is live, if one is. Otherwise it is forgotten.
 */
function mine(): Kept | null {
  if (kept && (kept.until <= Date.now() || (state?.live && kept.show !== state.show))) forget();
  return kept;
}

const blank = (show: string): Omit<Kept, 'until'> => ({ show, sent: [], drafts: {} });

/** The page is open: what the phone keeps lasts 3 hours from now, unless its time is up. */
function renew() {
  const here = mine();
  if (here) keep(here);
}
// Renewed as the page opens, wakes and stays open. A page asleep in the background renews
// nothing, and finds it gone if it wakes more than 3 hours later.
window.setInterval(renew, 60_000);

// The page open twice, as after a second scan: what one keeps, the other uses, so that the phone
// has one id in the show.
window.addEventListener('storage', (event) => {
  if (event.key !== keptKey && event.key !== null) return;
  kept = parse(store.get(keptKey));
  changed();
  render();
});

const open = (): PhoneActivity | null => (state?.live ? state.activity : null);
const sent = (activity: PhoneActivity) =>
  state?.live === true && mine()?.sent.includes(activity.id) === true;

function apply(next: PhoneState) {
  const before = open();
  const after = next.live ? next.activity : null;
  if (before && before.id !== after?.id) {
    if (!sent(before) && !after) closed = true;
    picked = null;
    error = '';
  }
  if (after) closed = false;
  state = next;
  // Another show live: what the phone kept for the last one goes.
  mine();
  changed();
  if (next.live) follow();
  else stopFollowing();
  render();
}

/** What is open now, from the server: whether it could be asked. */
async function look(): Promise<boolean> {
  try {
    const response = await fetch(`/${code}/state`, { cache: 'no-store' });
    if (!response.ok) return false;
    apply((await response.json()) as PhoneState);
    return true;
  } catch {
    return false;
  }
}

// While nothing is live: a look every 30 s, and whenever the page is shown again. Offline for a
// moment, the next look tries again.
let timer = 0;
async function poll() {
  window.clearTimeout(timer);
  await look();
  if (!events) timer = window.setTimeout(poll, POLL_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renew();
  render();
  if (!events) void poll();
});

// While live: the server's stream of the same state.
let events: EventSource | null = null;
function follow() {
  if (events) return;
  window.clearTimeout(timer);
  events = new EventSource(`/${code}/events`);
  events.addEventListener('state', (event) =>
    apply(JSON.parse((event as MessageEvent<string>).data) as PhoneState),
  );
  events.addEventListener('error', () => {
    // Refused rather than dropped: back to looking now and then.
    if (events?.readyState === EventSource.CLOSED) {
      events = null;
      timer = window.setTimeout(poll, POLL_MS);
    }
  });
}
function stopFollowing() {
  if (!events) return;
  events.close();
  events = null;
  timer = window.setTimeout(poll, POLL_MS);
}

const draft = (activity: PhoneActivity) => mine()?.drafts[activity.id] ?? {};

async function send(activity: PhoneActivity, value: unknown) {
  if (sending || !state?.live) return;
  const show = state.show;
  // The phone's id in this show: made with its first answer, and kept for the rest of the show.
  const here = mine() ?? blank(show);
  const participant = here.participant ?? uuid();
  if (!here.participant) keep({ ...here, participant });
  sending = true;
  error = '';
  update();
  const id = pending.get(activity.id) ?? uuid();
  pending.set(activity.id, id);
  try {
    const response = await fetch(`/${code}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The show goes with the answer: the server takes it in that show only, as the id is.
      body: JSON.stringify({ id, participant, show, activity: activity.id, value }),
    });
    if (response.status === 202) {
      // Unless another show went live meanwhile, which the answer is no part of.
      const now = mine();
      if (now?.show === show) {
        const drafts = { ...now.drafts };
        delete drafts[activity.id];
        keep({ ...now, sent: [...now.sent, activity.id], drafts });
      }
      pending.delete(activity.id);
    } else if (response.status === 409) {
      // Closed, or the show is over: the presenter cleared the responses as it went. What is open
      // now says which. Open again in the next show, it may be sent again, with an id of that one.
      if (!(await look())) {
        closed = true;
        if (state?.live) state = { ...state, activity: null };
      } else if (open()?.id === activity.id)
        error =
          state?.live && state.show !== show
            ? 'The session started over. Send again.'
            : "That couldn't be sent.";
    } else if (response.status === 429) error = 'Too many tries. Wait a minute, then send again.';
    else error = "That couldn't be sent.";
  } catch {
    error = "Couldn't reach the server. Send again.";
  }
  sending = false;
  render();
}

// Rendering. The page is rebuilt only when what it shows changes, so typing keeps its focus.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, String(value));
    else (node as unknown as Record<string, unknown>)[key] = value;
  }
  node.append(...children);
  return node;
}

let shown = '';
let sendButton: HTMLButtonElement | null = null;
let errorLine: HTMLElement | null = null;
let ready: () => boolean = () => false;

function message(text: string) {
  root.replaceChildren(el('p', { className: 'message' }, text));
  sendButton = errorLine = null;
}

function render() {
  const activity = open();
  const screen = !state
    ? 'loading'
    : activity
      ? sent(activity)
        ? `sent:${activity.id}`
        : `open:${activity.id}`
      : closed
        ? 'closed'
        : state.live
          ? 'waiting'
          : 'idle';
  if (screen !== shown) {
    shown = screen;
    if (screen === 'loading') message('Loading…');
    else if (screen === 'idle') message('Nothing is live here right now.');
    else if (screen === 'waiting') message('Waiting for the next poll…');
    else if (screen === 'closed') message('This poll has closed.');
    else if (screen.startsWith('sent:')) message('Sent ✓');
    else if (activity?.kind === 'choice') showChoice(activity);
    else if (activity?.kind === 'text') showText(activity);
  }
  update();
}

/** What changes without rebuilding: the button and the error line. */
function update() {
  if (sendButton) {
    sendButton.disabled = sending || !ready();
    sendButton.setAttribute('aria-busy', String(sending));
    if (sending !== sendButton.classList.contains('sending')) {
      sendButton.classList.toggle('sending', sending);
      sendButton.replaceChildren(
        ...(sending
          ? [el('span', { className: 'spinner', 'aria-hidden': 'true' }), 'Sending…']
          : ['Send']),
      );
    }
  }
  if (errorLine) errorLine.textContent = error;
}

function actions(onSend: () => void): HTMLElement {
  sendButton = el('button', { type: 'button', className: 'send', onclick: onSend }, 'Send');
  errorLine = el('p', { className: 'error', role: 'alert' });
  return el('div', { className: 'actions' }, sendButton, errorLine);
}

/** The person picks or types: they have started answering in this show. */
function start() {
  if (state?.live) started = state.show;
  changed();
}

function showChoice(activity: Extract<PhoneActivity, { kind: 'choice' }>) {
  // Nothing picked yet on this screen: not what was picked before it was sent, or another show.
  picked = null;
  const buttons = activity.options.map((option) =>
    el(
      'button',
      {
        type: 'button',
        className: 'option',
        role: 'radio',
        'aria-checked': 'false',
        onclick: () => {
          picked = option;
          for (const b of buttons) b.setAttribute('aria-checked', String(b.textContent === option));
          start();
          update();
        },
      },
      option,
    ),
  );
  ready = () => picked !== null && activity.options.includes(picked);
  root.replaceChildren(
    el('h1', {}, activity.prompt),
    el(
      'div',
      { className: 'options', role: 'radiogroup', 'aria-label': activity.prompt },
      ...buttons,
    ),
    actions(() => {
      if (picked !== null) void send(activity, { option: picked });
    }),
  );
}

function showText(activity: Extract<PhoneActivity, { kind: 'text' }>) {
  const saved = draft(activity);
  const inputs = activity.fields.map((field) => {
    const input = field.multiline
      ? el('textarea', { rows: 4 })
      : el('input', { type: 'text', autocomplete: 'off' });
    input.maxLength = field.max;
    input.name = field.id;
    input.value = (saved[field.id] ?? '').slice(0, field.max);
    input.addEventListener('input', () => {
      const values = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      if (state?.live) {
        const here = mine() ?? blank(state.show);
        keep({ ...here, drafts: { ...here.drafts, [activity.id]: values } });
      }
      start();
      update();
    });
    return input;
  });
  ready = () => inputs.some((i) => i.value.trim() !== '');
  root.replaceChildren(
    ...(activity.prompt ? [el('h1', {}, activity.prompt)] : []),
    ...activity.fields.map((field, i) => el('label', {}, el('span', {}, field.label), inputs[i]!)),
    actions(() => {
      const fields = Object.fromEntries(inputs.map((i) => [i.name, i.value]));
      void send(activity, { fields });
    }),
  );
}

renew();
changed();
render();
void poll();
