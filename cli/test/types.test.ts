import { describe, expect, it } from 'vitest';
import { parseMachineOutput } from '../src/types.ts';

describe('check --types', () => {
  it("reads svelte-check's machine output, leaving out .tobos/", () => {
    const output = [
      '1791405 START "/deck"',
      '1791405 ERROR "scenes/a.svelte" 24:9 "Type \'string\' is not assignable to type \'number\'."',
      '1791405 WARNING "/deck/lib/x.ts" 3:1 "Unused \\"y\\".\\nMore detail"',
      '1791405 ERROR ".tobos/types/present/index.d.ts" 1:1 "not the deck\'s problem"',
      '1791405 COMPLETED 10 FILES 2 ERRORS 1 WARNINGS',
    ].join('\n');
    expect(parseMachineOutput(output, '/deck')).toEqual([
      {
        file: 'scenes/a.svelte',
        line: 24,
        column: 9,
        rule: 'types',
        message: "Type 'string' is not assignable to type 'number'.",
        severity: 'error',
      },
      {
        file: 'lib/x.ts',
        line: 3,
        column: 1,
        rule: 'types',
        message: 'Unused "y".',
        severity: 'warning',
      },
    ]);
  });
});
