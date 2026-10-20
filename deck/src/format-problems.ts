import type { Problem } from './types.ts';

/**
 * Problems as compiler-style lines: `scenes/a.svelte:3:5 error beats: …`. With a `limit`, the
 * first that many, and a line saying how many more there are.
 */
export function formatProblems(problems: Problem[], limit = Infinity): string {
  const lines = problems.slice(0, limit).map((p) => {
    const where = p.line ? `${p.file}:${p.line}${p.column ? `:${p.column}` : ''}` : p.file;
    return `${where} ${p.severity} ${p.rule}: ${p.message}`;
  });
  const more = problems.length - lines.length;
  if (more > 0) lines.push(`… and ${more} more: \`tobos check\` lists them all.`);
  return lines.join('\n');
}
