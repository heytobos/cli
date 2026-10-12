import { stripTypeScriptTypes } from 'node:module';

/**
 * TypeScript → JavaScript by replacing types with whitespace, so positions stay where they were.
 * Node's stripper is marked experimental; its warning is not for our users.
 */
export function stripTypes(source: string): string {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('stripTypeScriptTypes')) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(source, { mode: 'strip' });
  } finally {
    process.emitWarning = emit;
  }
}
