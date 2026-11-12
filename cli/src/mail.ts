/**
 * `tobos mail` (TOB-423): the agent's door onto the person's inboxes, as Mail's MCP server is a
 * chat's. Each command is one of Mail's tools, which Mail's API answers at its own origin
 * (`mail.tobos.ai/api/<tool>`): the server this machine is logged in to says where that is, and
 * only says it to an account Mail is open to. Connecting an inbox, disconnecting it and sending
 * are the person's, on Mail's pages; `send` only asks.
 */
import { readFileSync } from 'node:fs';
import { api } from './api.ts';
import type { Args } from './commands.ts';
import { CliError, type Output } from './out.ts';

/** A message as `search` lists it. */
type Listed = {
  inbox: string;
  id: string;
  from: string;
  subject?: string;
  date: string;
  unread: boolean;
  snippet?: string;
  withheld?: string;
};

/** A message as `read` gives it. */
type Read = Listed & {
  to?: string;
  cc?: string;
  text?: string;
  attachments?: { name: string; type: string; size: number }[];
};

/** One of Mail's tools, at Mail's origin. */
async function call<T = Record<string, unknown>>(tool: string, body: object): Promise<T> {
  const me = await api<{ email: string; mail?: string }>('/api/me');
  if (!me.mail)
    throw new CliError(
      `Tobos Mail isn’t open to ${me.email}: it is in closed beta. The person asks for access at tobos.ai.`,
    );
  return api<T>(`/api/${tool}`, { server: me.mail, mail: true, body });
}

/** An option given once, several times, or not at all, as a list. */
const list = (value: string | boolean | string[] | undefined): string[] =>
  value === undefined || typeof value === 'boolean' ? [] : ([] as string[]).concat(value);

const inboxOf = (args: Args) =>
  typeof args.values.inbox === 'string' ? { inbox: args.values.inbox } : {};

/** One line of a list: what a person scans for. */
const line = (m: Listed) =>
  [
    m.unread ? '•' : ' ',
    m.id.padEnd(17),
    m.date.slice(0, 22).padEnd(22),
    m.from.slice(0, 30).padEnd(30),
    m.withheld ? '(withheld: a code or a sign-in link)' : (m.subject ?? ''),
  ].join(' ');

/** A message as a person reads one: its headers, then its text. */
const shown = (m: Read) =>
  [
    `From: ${m.from}`,
    m.to && `To: ${m.to}`,
    m.cc && `Cc: ${m.cc}`,
    m.subject !== undefined && `Subject: ${m.subject}`,
    `Date: ${m.date}`,
    `Id: ${m.id} in ${m.inbox}`,
    ...(m.attachments ?? []).map((a) => `Attachment: ${a.name} (${a.type}, ${a.size} bytes)`),
    '',
    m.withheld ?? m.text ?? '',
  ]
    .filter((l) => l !== undefined && l !== false)
    .join('\n');

/** The body of a draft: --text, or what comes on stdin. */
function draftText(args: Args): string {
  if (typeof args.values.text === 'string') return args.values.text;
  if (process.stdin.isTTY) throw new CliError('Give the draft’s text with --text, or on stdin.');
  return readFileSync(0, 'utf8');
}

const COMMANDS: Record<string, (out: Output, args: Args, rest: string[]) => Promise<void>> = {
  async inboxes(out) {
    const answer = await call<{
      inboxes: { address: string; paused?: boolean }[];
      connect: string;
    }>('inboxes', {});
    out.result(answer, () =>
      answer.inboxes.length
        ? answer.inboxes.map((i) => `${i.address}${i.paused ? '  (paused)' : ''}`).join('\n')
        : `No inbox is connected: the person connects one at ${answer.connect}`,
    );
  },

  async search(out, args, rest) {
    const query = rest.join(' ');
    const answer = await call<{
      messages: Listed[];
      next?: string | Record<string, string>;
      failed?: { inbox: string; message: string }[];
    }>('search', {
      ...(query ? { query } : {}),
      ...inboxOf(args),
      ...(list(args.values.label).length ? { labels: list(args.values.label) } : {}),
      ...(typeof args.values.max === 'string' ? { max: Number(args.values.max) } : {}),
      ...(typeof args.values.page === 'string' ? { page: args.values.page } : {}),
    });
    // Where more is, by `--page` (with its inbox, when every inbox was searched), and which
    // inboxes went unsearched, so that "Nothing found" is never said of one that wasn't.
    const next =
      typeof answer.next === 'string'
        ? [`More: --page ${answer.next}`]
        : Object.entries(answer.next ?? {}).map(
            ([inbox, page]) => `More in ${inbox}: --inbox ${inbox} --page ${page}`,
          );
    const failed = (answer.failed ?? []).map((f) => `Not searched, ${f.inbox}: ${f.message}`);
    out.result(answer, () =>
      [
        answer.messages.length ? answer.messages.map(line).join('\n') : 'Nothing found.',
        ...next,
        ...failed,
      ].join('\n'),
    );
  },

  async read(out, args, rest) {
    const thread = args.values.thread;
    const draft = args.values.draft;
    const asked =
      typeof thread === 'string'
        ? { thread }
        : typeof draft === 'string'
          ? { draft }
          : rest[0]
            ? { message: rest[0] }
            : undefined;
    if (!asked) throw new CliError('Name a message, or --thread <id>, or --draft <id>.');
    const answer = await call<Read & { messages?: Read[] }>('read', { ...asked, ...inboxOf(args) });
    out.result(answer, () =>
      answer.messages ? answer.messages.map(shown).join('\n\n') : shown(answer),
    );
  },

  async labels(out, args) {
    const answer = await call<{ labels: { id: string; name: string }[] }>('labels', inboxOf(args));
    out.result(answer, () =>
      answer.labels.map((l) => (l.id === l.name ? l.id : `${l.name}  (${l.id})`)).join('\n'),
    );
  },

  async sort(out, args, rest) {
    if (rest.length === 0) throw new CliError('Name the messages to sort, by their ids.');
    const { values } = args;
    const add = [
      ...list(values.add),
      ...(values.unread ? ['UNREAD'] : []),
      ...(values.star ? ['STARRED'] : []),
    ];
    const remove = [
      ...list(values.remove),
      ...(values.archive ? ['INBOX'] : []),
      ...(values.read ? ['UNREAD'] : []),
    ];
    const trash = values.trash ? true : values.untrash ? false : undefined;
    const answer = await call('sort', {
      messages: rest,
      ...(add.length ? { add } : {}),
      ...(remove.length ? { remove } : {}),
      ...(trash === undefined ? {} : { trash }),
      ...inboxOf(args),
    });
    out.result(answer, () => `Sorted ${rest.length} message${rest.length === 1 ? '' : 's'}.`);
  },

  async drafts(out, args) {
    const answer = await call<{ drafts: { draft: string; to?: string; subject?: string }[] }>(
      'drafts',
      inboxOf(args),
    );
    out.result(answer, () =>
      answer.drafts.length
        ? answer.drafts
            .map(
              (d) =>
                `${d.draft.padEnd(20)} ${(d.to ?? '').slice(0, 30).padEnd(30)} ${d.subject ?? ''}`,
            )
            .join('\n')
        : 'No drafts.',
    );
  },

  async draft(out, args) {
    const { values } = args;
    const answer = await call<{ draft: string; inbox: string }>('draft', {
      text: draftText(args),
      ...(list(values.to).length ? { to: list(values.to) } : {}),
      ...(list(values.cc).length ? { cc: list(values.cc) } : {}),
      ...(list(values.bcc).length ? { bcc: list(values.bcc) } : {}),
      ...(typeof values.subject === 'string' ? { subject: values.subject } : {}),
      ...(typeof values.reply === 'string' ? { reply: values.reply } : {}),
      ...(typeof values.draft === 'string' ? { draft: values.draft } : {}),
      ...inboxOf(args),
    });
    out.result(
      answer,
      () =>
        `Drafted ${answer.draft} in ${answer.inbox}: not sent. \`tobos mail send ${answer.draft}\` asks the person to send it.`,
    );
  },

  async discard(out, args, rest) {
    if (!rest[0]) throw new CliError('Name the draft to delete.');
    const answer = await call('discard', { draft: rest[0], ...inboxOf(args) });
    out.result(answer, () => `Deleted the draft ${rest[0]}.`);
  },

  async send(out, args, rest) {
    if (!rest[0]) throw new CliError('Name the draft to send.');
    const answer = await call<{ approve: string }>('send', { draft: rest[0], ...inboxOf(args) });
    out.result(
      answer,
      () =>
        `Asked to send ${rest[0]}: it waits for the person’s Send at ${answer.approve}. Tell them.`,
    );
  },
};

export async function mail(out: Output, args: Args) {
  const [command, ...rest] = args.positionals;
  const run = command ? COMMANDS[command] : undefined;
  if (!run)
    throw new CliError(
      `\`tobos mail\` takes one of ${Object.keys(COMMANDS).join(', ')}. \`tobos help\` says what each does.`,
    );
  await run(out, args, rest);
}
