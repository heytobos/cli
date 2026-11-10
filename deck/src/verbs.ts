/**
 * The five verbs every door has (ADR 0005), said once: what each does, what it takes, and how the
 * CLI spells it. MCP's tools take their descriptions and schemas from here (mcp-tools.ts), and the
 * chat guide its list of them; the CLI its help (main.ts) and the copy's guide its list of
 * commands (format.ts). Each door's appendix is `verbsAppendix`.
 */

/** A field, as JSON Schema says it. */
type Field = { description?: string; [key: string]: unknown };

export interface Verb {
  /** What it does, the same at every door. */
  does: string;
  /** What it takes, as JSON Schema: what MCP's tool takes, besides the deck for those on one. */
  input: { properties: Record<string, Field>; required: readonly string[] };
  /** The CLI's commands for it: each one's usage, and what it does there. */
  cli: readonly { usage: string; does: string }[];
  /** What a chat is told besides `does`. */
  chat?: string;
}

const FOLDER_PATH = 'A folder’s path from the root, such as `/Courses/AI 101`; `/` is the root.';
const REV = { type: 'string', description: 'A version of the deck; its latest if left out.' };

/**
 * A changeset (ADR 0005), what `write` takes, as JSON Schema: what MCP's `write` takes besides its
 * deck. The server reads one by the same rules (`readChangeset` in write.ts).
 */
const CHANGESET_SCHEMA = {
  type: 'object',
  properties: {
    outline: {
      type: 'array',
      description:
        'Changes to the deck’s outline (its chapters and scenes in order, their titles, which are hidden), which Tobos holds, not a file, made with the files or alone (`files` empty): at once, no version. Each one of: `{"op": "place", "scene": id, "title"?, "hidden"?, "to"}`, a scene file into the outline, as a new one shows nowhere until placed; `{"op": "move", "scenes": [ids], "to"}`; `{"op": "hide", "scenes": [ids], "hidden": true|false}`; `{"op": "rename", "scene": id, "title"}`; `{"op": "remove", "scenes": [ids]}`, out of the outline, its file kept; `{"op": "title", "title"}`, the deck’s; `{"op": "addChapter", "chapter": id, "title", "before"?}`, `renameChapter`, `moveChapter` (`"before"`: a chapter, or null for last), `removeChapter` (an empty one). `to` is `{"after": id}`, `{"before": id}` or `{"chapter": id, "at": "start"|"end"}`. One that names what is gone is refused as a conflict, with the outline as it is.',
      items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] },
    },
    base: {
      type: ['string', 'null'],
      description:
        'The version the files were read at: the `rev` that a read, `new` or the last write gave. If the deck changed since, Tobos merges: only lines both changed differently are a conflict.',
    },
    message: {
      type: 'string',
      description: 'What the change does, as a commit message says: needed unless `dry`.',
    },
    dry: {
      type: 'boolean',
      description:
        'Check it, and land no version: what the check says of the deck as it would be. A file from the web for media/ is still fetched and stored, so the check sees it. Its answer is no version to write on.',
    },
    files: {
      type: 'object',
      description:
        'Each path to change: its new text in full; `{"patch": [{"find", "replace"}]}` to change part of it, each `find` once in the file as it is now; for a file in media/, `{"url"}`, the address of a file on the web, which Tobos fetches, or `{"base64"}` or `{"hash"}` of an upload; or null to delete it. Only Tobos writes media.json, from what goes into media/.',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              patch: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { find: { type: 'string' }, replace: { type: 'string' } },
                  required: ['find', 'replace'],
                  additionalProperties: false,
                },
              },
            },
            required: ['patch'],
            additionalProperties: false,
          },
          ...(['url', 'base64', 'hash'] as const).map((key) => ({
            type: 'object',
            properties: { [key]: { type: 'string' } },
            required: [key],
            additionalProperties: false,
          })),
          { type: 'null' },
        ],
      },
    },
  },
  required: ['base', 'files'],
} as const;

export const VERBS = {
  list: {
    does: 'The decks the person works on, by id: their own, and those shared with them that they may present or change. Each with its title, your level on it and whose it is, whether it is View only (beyond the decks its owner’s plan keeps editable: it takes no change), when it last changed, its address in Tobos, and, for the person’s own, its folder. With a path, what that folder holds: its folders, then its decks, a shortcut to a deck shared with the person marked as one, with its owner.',
    input: { properties: { path: { type: 'string', description: FOLDER_PATH } }, required: [] },
    cli: [
      {
        usage: 'tobos ls [/path]',
        does: 'your decks, by id, with your level on each, whose it is and its folder; with a path, what that folder holds',
      },
    ],
  },
  read: {
    does: 'A deck’s files at a version, its latest unless another is named, with that version, `rev`, to write on; and its outline as it is now, its chapters and scenes in order, which Tobos holds, not a file, with the scene files it doesn’t place.',
    input: {
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'The files to read, such as `scenes/intro.svelte`, or `master/`.',
        },
        rev: REV,
        since: {
          type: 'string',
          description: 'Reading media/: a version you read, for only the files added since then.',
        },
      },
      required: [],
    },
    cli: [
      { usage: 'tobos pull <id> [dir]', does: 'a working copy of a deck, into ./<id> or dir' },
      {
        usage: 'tobos pull',
        does: 'the latest version into the copy, merged with your changes; a conflict is left between <<<<<<< and >>>>>>> to resolve',
      },
      {
        usage: 'tobos outline',
        does: 'the deck’s outline: its chapters and scenes in order, and the scene files it doesn’t place',
      },
    ],
    chat: 'Without `paths`, lists its files with their sizes; with them, gives each file’s text, many in one call (a path ending in `/` reads every file under it). Reading media/ (`paths: ["media/"]`) shows its pictures, video and sound instead: each file’s name, type and size, when it was added and by whom, and contact sheets to see what they show, with the address of the deck’s page where the person drops files. With `since`, only the files added since that version. Paths of files in media/ show just those, one alone as large as the sheet. A picture the person gave you in the chat reaches you, not Tobos: give them the address of the deck’s page that reading media/ gives, where they drop it.',
  },
  write: {
    does: 'Changes a deck’s files as one version, live at once, made on the version they were read at: Tobos merges what changed since, checks the deck as it would be, and saves nothing, saying why, if the check refuses it or someone changed the same lines. Dry, it only checks. With `outline`, it changes the deck’s outline too, or alone.',
    input: {
      properties: { ...CHANGESET_SCHEMA.properties },
      required: CHANGESET_SCHEMA.required,
    },
    cli: [
      {
        usage: 'tobos push [-m "what changed"]',
        does: 'the copy’s changes as one version, media uploaded',
      },
      {
        usage: 'tobos check [--types]',
        does: 'the same, dry: the server’s check, nothing saved; --types adds TypeScript’s view, here',
      },
      {
        usage: 'tobos outline <op> …',
        does: 'the outline changed at once, no push: place, move, hide, show, rename, remove, title, chapter (tobos help says each)',
      },
    ],
    chat: 'Each file’s text in full, a patch of part of it, a file on the web for media/, or null to delete it. All or nothing, so put everything a step needs into one call: a new scene’s file and the `outline` change that places it.',
  },
  new: {
    does: 'Makes a deck in the person’s account, with its first version, `rev`: one title scene, and the design of the deck it starts from, its master, the master’s media and the packages it imports. Tobos standard unless another deck is named, such as the person’s own house style (ask which when they have several). To use another deck’s scenes too, read them and write them like any file.',
    input: {
      properties: {
        title: { type: 'string', description: 'The title of the talk.' },
        from: {
          type: 'string',
          description:
            'The id of the deck whose design to start from, one you may edit or present.',
        },
      },
      required: ['title'],
    },
    chat: 'Gives the deck’s id, its first version, `rev`, its files, and its address in Tobos; `list` gives the ids of the decks to start from.',
    cli: [
      {
        usage: 'tobos new "Title" [--from <id>] [--dir dir]',
        does: 'a deck with the design of another (Tobos standard unless --from); pulled into ./<id> or dir (--no-pull: only made)',
      },
    ],
  },
  move: {
    does: 'Moves the person’s decks, a deck by its id or title, and folders, by path, with all that is in them, into a folder, made with the folders on its path if there are none. A deck shared with the person moves as its one shortcut in their folders, made by its first move; the deck stays its owner’s, where they keep it. With `name`, renames one folder where it is instead; with nothing to move, makes the folder at `to`. A folder stays when a move empties it: only the person deletes one, on the web. Refused, with nothing changed, if one isn’t there, if a title is two decks’ (name that one by its id), if the folder has one of a moved folder’s name already, if a folder would go into itself, or if a folder to make or a new name is there already.',
    input: {
      properties: {
        decks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Decks to move, each by its id or title.',
        },
        folders: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Folders to move, each by its path, with all that is in them; or, with `name`, the one folder to rename.',
        },
        to: {
          type: 'string',
          description: `Where they go, or with nothing to move, the folder to make. ${FOLDER_PATH}`,
        },
        name: {
          type: 'string',
          description:
            'The new name of the one folder in `folders`, renamed where it is, with no decks and no `to`.',
        },
      },
      required: [],
    },
    cli: [
      {
        usage: 'tobos mv <deck or /folder>… </path>',
        does: 'move decks and folders into that folder, made if there is none; a folder a move empties stays',
      },
      { usage: 'tobos mv </folder> --name <name>', does: 'rename a folder where it is' },
      { usage: 'tobos mkdir </path>', does: 'make an empty folder, and those on its path' },
    ],
  },
} as const satisfies Record<string, Verb>;

export type VerbName = keyof typeof VERBS;

/**
 * The five verbs as a door's appendix, in Markdown: the CLI's commands, for a working copy's
 * guide, or the tools and what each does, for the chat guide.
 */
export function verbsAppendix(door: 'cli' | 'chat'): string {
  const verbs = Object.entries(VERBS as Record<VerbName, Verb>);
  return door === 'chat'
    ? verbs.map(([name, verb]) => `- \`${name}\`: ${verb.does}`).join('\n')
    : verbs.flatMap(([, verb]) => verb.cli.map((c) => `- \`${c.usage}\`: ${c.does}`)).join('\n');
}
