/**
 * The phone page, at `<content origin>/<code>`: whatever activity the presenter is on, to answer
 * once. Our code only, never a deck's. No account and no cookies: the phone makes an id of its
 * own for each deck, and remembers in localStorage what it has sent in this show and its drafts.
 */
import type { PhoneActivity, PhoneState } from '../activities.ts';

const code = location.pathname.split('/')[1] ?? '';
const root = document.getElementById('tobos-phone')!;

/** How often a phone looks whether the deck went live, while it isn't. */
const POLL_MS = 30_000;

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
 * The phone's id for this deck, the same for all its activities and shows: a deck's responses
 * can be lined up by person, without anyone known. Another deck gets another id, so two decks'
 * responses can't be.
 */
const participantKey = `tobos:participant:${code}`;
const participant =
  store.get(participantKey) ??
  (() => {
    const id = uuid();
    store.set(participantKey, id);
    return id;
  })();

const sentKey = (show: string, activity: string) => `tobos:sent:${code}:${show}:${activity}`;
const draftKey = (activity: string) => `tobos:draft:${code}:${activity}`;

let state: PhoneState | null = null;
/** An activity closed while it was open here, unsent. */
let closed = false;
let sending = false;
let error = '';
/** A response's id, kept across retries of the same answer, so a retry is never counted twice. */
const pending = new Map<string, string>();
/** The option picked in the open poll. */
let picked: string | null = null;

const open = (): PhoneActivity | null => (state?.live ? state.activity : null);
const sent = (activity: PhoneActivity) =>
  state?.live === true && store.get(sentKey(state.show, activity.id)) === '1';

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
  if (next.live) follow();
  else stopFollowing();
  render();
}

// While nothing is live: a look every 30 s, and whenever the page is shown again.
let timer = 0;
async function poll() {
  window.clearTimeout(timer);
  try {
    const response = await fetch(`/${code}/state?participant=${participant}`, {
      cache: 'no-store',
    });
    if (response.ok) apply((await response.json()) as PhoneState);
  } catch {
    // Offline for a moment: the next look tries again.
  }
  if (!events) timer = window.setTimeout(poll, POLL_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !events) void poll();
});

// While live: the server's stream of the same state.
let events: EventSource | null = null;
function follow() {
  if (events) return;
  window.clearTimeout(timer);
  events = new EventSource(`/${code}/events?participant=${participant}`);
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

function draft(activity: PhoneActivity): Record<string, string> {
  try {
    return JSON.parse(store.get(draftKey(activity.id)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

async function send(activity: PhoneActivity, value: unknown) {
  if (sending || !state?.live) return;
  const show = state.show;
  sending = true;
  error = '';
  update();
  const id = pending.get(activity.id) ?? uuid();
  pending.set(activity.id, id);
  try {
    const response = await fetch(`/${code}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, participant, activity: activity.id, value }),
    });
    if (response.status === 202) {
      store.set(sentKey(show, activity.id), '1');
      store.remove(draftKey(activity.id));
      pending.delete(activity.id);
    } else if (response.status === 409) {
      closed = true;
      if (state?.live) state = { ...state, activity: null };
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
    else if (screen === 'waiting') message('Waiting for the next question…');
    else if (screen === 'closed') message('This question has closed.');
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

function showChoice(activity: Extract<PhoneActivity, { kind: 'choice' }>) {
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
      store.set(draftKey(activity.id), JSON.stringify(values));
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

render();
void poll();
