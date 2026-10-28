import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verbsAppendix } from '@tobos/deck/verbs';
import { request } from './api.ts';
import { CliError } from './out.ts';

/**
 * How to work in a copy with this CLI: the harness's door to the five verbs (verbs.ts), which the
 * format itself doesn't name, as it is the same for every door.
 */
export const WORKING = `# Working on a deck

You work in a copy of the deck, from \`tobos pull <id>\` or \`tobos new\`, with no git: the server keeps
the versions. Every push is live: every open preview follows within a second, so the person
watches the deck take shape.

1. Change \`deck.json\`, the scenes and whatever else the step needs.
2. \`tobos check\`: fix every error it reports.
3. \`tobos render <scene>/<beat>\` pushes what changed and writes a PNG of that beat; \`--film\`
   writes frames through its animation. Look at each one.
4. \`tobos push -m "what changed"\`. \`render\` and \`open\` push the same way when the copy has
   changed, and \`-m\` names that push too.

A step is done when every beat it changed has been rendered and looked at.

\`.tobos/\` holds this file and the version the copy is of: leave it be. A push leaves out what
is in \`.tobos/\`, \`.git/\`, \`sources/\` and \`node_modules/\` at the copy's top.

${verbsAppendix('cli')}

`;

/**
 * The format guide, as this server has it, in the working copy's .tobos/, after how to work in
 * the copy (WORKING). Everything else an agent needs is in the deck itself: its master, and the
 * master's guide.
 */
export async function writeFormatGuide(root: string, server: string): Promise<void> {
  const dir = join(root, '.tobos');
  mkdirSync(dir, { recursive: true });
  const format = await request('/api/format', { anonymous: true, server });
  if (!format.ok)
    throw new CliError(`Couldn't fetch the format guide from ${server} (${format.status}).`);
  writeFileSync(join(dir, 'FORMAT.md'), WORKING + (await format.text()));
}
