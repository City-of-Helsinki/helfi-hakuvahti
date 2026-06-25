export interface ParsedArgs {
  [key: string]: string | true;
}

/**
 * Minimal CLI argument parser covering the subset of minimist we use:
 * `--key=value` (string) and boolean flags (`--flag`). Callers that need a
 * number convert the string value themselves.
 */
export default function parseArgs(args: string[]): ParsedArgs {
  const argv: ParsedArgs = {};

  for (const arg of args) {
    if (!arg.startsWith('--')) {
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      // --key=value
      argv[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      // boolean flag (--flag)
      argv[arg.slice(2)] = true;
    }
  }

  return argv;
}

/**
 * Read a flag's value as a string, returning undefined when the flag is unset
 * or was given as a bare boolean flag (`--flag` without `=value`).
 */
export function stringArg(argv: ParsedArgs, key: string): string | undefined {
  const value = argv[key];
  return typeof value === 'string' ? value : undefined;
}
