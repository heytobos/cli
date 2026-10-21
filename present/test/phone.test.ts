// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneActivity, PhoneState } from '../src/activities.ts';

/**
 * The phone page's script against a server of the test's own: what the phone keeps, what it
 * sends with what, and when it forgets.
 */
const CODE = '123456';
const KEY = `tobos:phone:${CODE}`;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const poll = (id: string): PhoneActivity => ({
  id,
  kind: 'choice',
  prompt: 'Tea or coffee?',
  options: ['Tea', 'Coffee'],
});
const live = (show: string, activity: PhoneActivity | null = poll('drink')): PhoneState => ({
  live: true,
  show,
  activity,
});

/**
 * The server: what it is asked, the state it tells, and the answers sent to it, which it takes
 * (202) in the show that is live, and refuses (409) in any other.
 */
let asked: string[] = [];
let state: PhoneState = { live: false };
let answers: { participant: string; show: string; activity: string }[] = [];
let streams: FakeEventSource[] = [];

/** The server's stream of states, which the test tells. */
class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  private listener?: (event: MessageEvent<string>) => void;
  constructor(url: string) {
    asked.push(`GET ${url}`);
    streams.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    if (type === 'state') this.listener = listener;
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  tell(next: PhoneState) {
    state = next;
    this.listener?.({ data: JSON.stringify(next) } as MessageEvent<string>);
  }
}

/** Whatever the page set going, run to its end. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The page opened, as the server sends it: the script draws into `main`, below which the notice
 * holds the objection's mail. A page opened before is closed: its timers end, and the clock,
 * which clearing them would set back, goes on.
 */
async function open(lang = 'en') {
  const now = Date.now();
  vi.clearAllTimers();
  vi.setSystemTime(now);
  document.body.className = '';
  document.body.innerHTML = `<main id="tobos-phone"></main>
<footer lang="${lang}"><a href="mailto:hey@tobos.ai?subject=Delete%20my%20answers" data-object
>write to hey@tobos.ai</a></footer>`;
  vi.resetModules();
  await import('../src/phone/phone.ts');
  await settle();
}

const screen = () => document.querySelector('main')!.textContent;
const kept = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');

async function answer(option: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button.option')].find(
    (b) => b.textContent === option,
  )!;
  button.click();
  document.querySelector<HTMLButtonElement>('button.send')!.click();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({
    now: new Date('2026-10-20T09:00:00Z'),
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  history.replaceState(null, '', `/${CODE}`);
  localStorage.clear();
  [asked, answers, streams, state] = [[], [], [], { live: false }];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method !== 'POST') return Response.json(state);
    const answer = JSON.parse(String(init.body));
    answers.push(answer);
    const taken = state.live && answer.show === state.show;
    return new Response(taken ? null : 'This question has closed.', { status: taken ? 202 : 409 });
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the phone page', () => {
  it('keeps nothing and sends no id while it only looks and follows', async () => {
    await open();
    expect(screen()).toBe('Nothing is live here right now.');
    state = live('show-1', null);
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(screen()).toBe('Waiting for the next question…');
    expect(asked).toEqual([`GET /${CODE}/state`, `GET /${CODE}/state`, `GET /${CODE}/events`]);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('makes its id with its first answer, and keeps it for the rest of the show', async () => {
    state = live('show-1');
    await open();
    expect(kept()).toBeNull();
    // The notice holds the first screen until the person starts answering.
    expect(document.body.classList.contains('answering')).toBe(false);
    await answer('Tea');
    expect(screen()).toBe('Sent ✓');
    const participant = answers[0]!.participant;
    expect(participant).toMatch(UUID);
    expect(kept()).toMatchObject({ show: 'show-1', participant, sent: ['drink'] });

    // A reload within the show: still sent, and nothing sent again.
    await open();
    expect(screen()).toBe('Sent ✓');
    expect(answers).toHaveLength(1);
    // Answered: the notice needn't hold the first screen any more.
    expect(document.body.classList.contains('answering')).toBe(true);
    // The next question, in the same show: the same id.
    streams.at(-1)!.tell(live('show-1', poll('food')));
    await answer('Coffee');
    expect(answers.map((a) => [a.activity, a.participant])).toEqual([
      ['drink', participant],
      ['food', participant],
    ]);
  });

  it('forgets it all when another show is live: the next answer has another id', async () => {
    state = live('show-1', { id: 'wish', kind: 'text', fields: [{ id: 'w', label: 'W', max: 9 }] });
    await open();
    const field = document.querySelector('input')!;
    field.value = 'More';
    field.dispatchEvent(new Event('input'));
    // A draft is kept for the show, and makes no id: only an answer does.
    expect(kept()).toMatchObject({ show: 'show-1', drafts: { wish: { w: 'More' } } });
    expect(kept().participant).toBeUndefined();
    streams.at(-1)!.tell(live('show-1'));
    await answer('Tea');
    const first = answers[0]!.participant;

    streams.at(-1)!.tell(live('show-2'));
    expect(screen()).not.toContain('Sent');
    expect(kept()).toBeNull();
    await answer('Coffee');
    expect(answers[1]!.participant).toMatch(UUID);
    expect(answers[1]!.participant).not.toBe(first);
    expect(kept()).toMatchObject({ show: 'show-2', sent: ['drink'], drafts: {} });
  });

  it('sends the show with each answer; refused in a show that is over, it goes again in the next', async () => {
    state = live('show-1');
    await open();
    await answer('Tea');
    expect(answers[0]).toMatchObject({ show: 'show-1', activity: 'drink' });
    const first = answers[0]!.participant;

    // The next question; the presenter clears the responses before the phone hears of it.
    streams.at(-1)!.tell(live('show-1', poll('food')));
    state = live('show-2', poll('food'));
    await answer('Coffee');
    await settle();
    // Refused in the show that is over: the phone asks what is open, and forgets that show.
    expect(answers[1]).toMatchObject({ show: 'show-1', participant: first, activity: 'food' });
    expect(kept()).toBeNull();
    expect(screen()).toBe('Tea or coffee?TeaCoffeeSendThe session started over. Send again.');
    // Sent again, picked as it was: in the next show, with an id of that show's.
    document.querySelector<HTMLButtonElement>('button.send')!.click();
    await settle();
    expect(answers[2]).toMatchObject({ show: 'show-2', activity: 'food' });
    expect(answers[2]!.participant).toMatch(UUID);
    expect(answers[2]!.participant).not.toBe(first);
    expect(screen()).toBe('Sent ✓');
    expect(kept()).toMatchObject({
      show: 'show-2',
      participant: answers[2]!.participant,
      sent: ['food'],
    });
  });

  it('holds the notice on the first screen again in another show, until it is answered there', async () => {
    const answering = () => document.body.classList.contains('answering');
    state = live('show-1');
    await open();
    expect(answering()).toBe(false);
    // Picked, not sent yet: answering.
    document.querySelector<HTMLButtonElement>('button.option')!.click();
    expect(answering()).toBe(true);
    // The responses cleared: the next show isn't answered yet.
    streams.at(-1)!.tell(live('show-2'));
    expect(answering()).toBe(false);
    await answer('Tea');
    expect(answering()).toBe(true);
    // Sent, then cleared: the same.
    streams.at(-1)!.tell(live('show-3'));
    expect(answering()).toBe(false);
    // Opened again with what it kept of a show that is over, sent there: not answering here.
    await answer('Coffee');
    state = live('show-4');
    await open();
    expect(answering()).toBe(false);
    // A form: typing is answering.
    streams
      .at(-1)!
      .tell(
        live('show-4', { id: 'wish', kind: 'text', fields: [{ id: 'w', label: 'W', max: 9 }] }),
      );
    const field = document.querySelector('input')!;
    field.value = 'More';
    field.dispatchEvent(new Event('input'));
    expect(answering()).toBe(true);
  });

  it('forgets it 3 hours after the page was last open, and not while it stays open', async () => {
    state = live('show-1');
    await open();
    await answer('Tea');
    const participant = answers[0]!.participant;

    // Open for four hours: what it keeps lasts on.
    await vi.advanceTimersByTimeAsync(4 * HOUR);
    expect(kept().participant).toBe(participant);
    expect(kept().until).toBeGreaterThan(Date.now() + 3 * HOUR - MINUTE);
    // Closed, and opened again within 3 hours, twice: 3 hours from when it was last open.
    for (let i = 0; i < 2; i++) {
      vi.setSystemTime(Date.now() + 2 * HOUR);
      await open();
      expect(screen()).toBe('Sent ✓');
    }

    // Closed for longer: gone as the page opens, before anything else.
    vi.setSystemTime(Date.now() + 3 * HOUR + MINUTE);
    await open();
    expect(screen()).toBe('Tea or coffee?TeaCoffeeSend');
    expect(kept()).toBeNull();
    await answer('Tea');
    expect(answers[1]!.participant).not.toBe(participant);
  });

  it('removes what earlier versions kept, an id for the deck for good among it', async () => {
    const later = Date.now() + HOUR;
    localStorage.setItem(`tobos:participant:${CODE}`, '6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f');
    localStorage.setItem('tobos:participant:654321', '0b9d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4');
    localStorage.setItem(`tobos:sent:${CODE}:2026-10-13T09:00:00.000Z:drink`, '1');
    localStorage.setItem(`tobos:draft:${CODE}:wish`, '{"w":"x"}');
    const other = (until: number) => JSON.stringify({ show: 's', until, sent: [], drafts: {} });
    localStorage.setItem('tobos:phone:654321', other(Date.now() - 1));
    localStorage.setItem('tobos:phone:111111', other(later));
    localStorage.setItem('tobos:phone:222222', 'not what the page keeps');
    localStorage.setItem('something:else', 'kept');
    await open();
    expect(Object.keys(localStorage).sort()).toEqual(['something:else', 'tobos:phone:111111']);
  });

  it('puts the join code in the objection’s mail, and the id once there is one', async () => {
    const body = () =>
      decodeURIComponent(document.querySelector<HTMLAnchorElement>('a[data-object]')!.href);
    state = live('show-1');
    await open();
    const mail = 'mailto:hey@tobos.ai?subject=Delete my answers&body=Please delete my answers.';
    expect(body()).toBe(`${mail}\r\n\r\nJoin code: ${CODE}`);
    await answer('Tea');
    const id = answers[0]!.participant;
    expect(body()).toBe(`${mail}\r\n\r\nJoin code: ${CODE}\r\nThis phone's random number: ${id}`);
    await open('de');
    expect(body()).toContain(
      `&body=Bitte löschen Sie meine Antworten.\r\n\r\nCode: ${CODE}\r\n` +
        `Zufallszahl dieses Handys: ${id}`,
    );
  });
});
