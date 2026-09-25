import { Command } from "commander";
import { ValidationError } from "../validation/strings.js";

/** --project, on every command that works on one project */
export const PROJECT_OPTION = ["--project <name>", "project name (falls back to .rewelo.json)"] as const;

// Option values as commander hands them to an action: camelCase names; an
// option with a default, a repeatable one ([]) or a required one is always set.
// Each action states its own; these are the groups several share.
export interface ProjectOptions {
  project?: string;
}
export interface ScoreOptions {
  benefit?: number;
  penalty?: number;
  estimate?: number;
  risk?: number;
}
export interface WeightOptions {
  w1?: number;
  w2?: number;
  w3?: number;
  w4?: number;
}

/** A repeatable option's values, in order (default: []) */
export const collect = (value: string, previous: string[]) => [...previous, value];

// Commander invokes an option's coercion callback as fn(value, previousValue),
// so passing bare `parseInt` makes the option's default value act as the radix
// (e.g. `--top 12` with default 5 => parseInt("12", 5) === 7). Always parse
// base 10 and reject non-integers.
function parseIntOption(value: string): number {
  // The whole value must be an integer: parseInt alone reads "1.5" as 1
  // and "3abc" as 3.
  const n = /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new ValidationError(`"${value}" is not a valid integer`);
  }
  return n;
}

// For count-like options (limit/offset/top) a negative value is nonsensical
// and previously produced confusing results (e.g. `--limit -3` sliced from the
// end, showing "2 of 5").
export function parseNonNegativeIntOption(value: string): number {
  const n = parseIntOption(value);
  if (n < 0) {
    throw new ValidationError(`"${value}" must be 0 or greater`);
  }
  return n;
}

// Scores must be exact integers. `parseInt` would silently accept lossy input
// (8.5 -> 8, "13xyz" -> 13, "0x8" -> 8) before Fibonacci validation ever ran,
// so validate the raw string is a plain integer first.
export function parseScoreOption(value: string): number {
  // Written as CSV import requires: plain digits, no sign, no leading zeros
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new ValidationError(`Score "${value}" must be a whole number without sign or leading zeros`);
  }
  return parseInt(value, 10);
}

// `parseFloat` returns NaN for non-numeric input, which then flows silently
// into weight/threshold calculations (producing NaN output or zero results).
// Require a finite number instead.
export function parseFloatOption(value: string): number {
  // The whole value must be a plain decimal: parseFloat reads "2abc" as 2,
  // and Number accepts "0x10" (16) and "1e2"
  const n = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    throw new ValidationError(`"${value}" is not a valid number`);
  }
  return n;
}

// For single-value options commander keeps the last of repeated values
// (--title D --title E created E, --w1 1 --w1 2 used 2); refuse the
// repetition instead. Repeatable options (--tag) collect into an array.
export function refuseRepeatedOptions(cmd: Command): void {
  for (const option of cmd.options) {
    if (!(option.required || option.optional) || option.variadic || Array.isArray(option.defaultValue)) continue;
    const parse = option.parseArg;
    let given = false;
    option.argParser((value: string, previous: unknown) => {
      // cmd.error, not InvalidArgumentError: that blames the value ("argument
      // 'a.db' is invalid"), while the problem is the repetition
      if (given) cmd.error(`error: option '${option.flags}' was given more than once`, { code: "rw.optionRepeated" });
      given = true;
      return parse ? parse(value, previous) : value;
    });
  }
  cmd.commands.forEach(refuseRepeatedOptions);
}
