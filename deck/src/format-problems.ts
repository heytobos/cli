import type { Problem } from './types.ts';

/** Problems as compiler-style lines: `scenes/a.svelte:3:5 error beats: …` */
export function formatProblems(problems: Problem[]): string {
  return problems
    .map((p) => {
      const where = p.line ? `${p.file}:${p.line}${p.column ? `:${p.column}` : ''}` : p.file;
      return `${where} ${p.severity} ${p.rule}: ${p.message}`;
    })
    .join('\n');
}
