import { DB } from "../db/connection.js";
import { getWorkflowDates } from "./times.js";

// When will N tickets be done? Not from estimates, but from the pace the
// project actually had: a Monte Carlo simulation replays days drawn at
// random from the recent past (how many tickets were done on each) until
// the N are done, many thousand times. How many of those runs finished by a
// date is how likely that date is. Weekends and slow weeks are in the drawn
// days, so they are in the forecast too. It assumes the coming weeks look
// like the recent ones, and counts tickets, not their size.

const DAY_MS = 86_400_000;

export const DEFAULT_HISTORY_DAYS = 90;
export const FORECAST_TRIALS = 10_000;
/** A run that takes longer stops: the forecast then says "not within ten years" */
export const MAX_FORECAST_DAYS = 3650;
export const LIKELIHOODS = [50, 85, 95] as const;

export interface Forecast {
  /** Tickets to be done: the open ones, unless given */
  items: number;
  /** The days whose pace the forecast replays: the last ones before today */
  historyDays: number;
  /** Tickets done in those days; without any there is no pace, and no outcomes */
  doneInHistory: number;
  trials: number;
  /** By when the items are done in 50, 85 and 95% of the runs; days and date null when not within MAX_FORECAST_DAYS */
  outcomes: Array<{ likelihood: (typeof LIKELIHOODS)[number]; days: number | null; date: string | null }>;
}

/** A small seeded generator (mulberry32): the same data gives the same forecast */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The days it took in each run to get items done, drawing from daily counts */
export function simulate(daily: number[], items: number, trials: number, random: () => number = seeded(0x5eed)): number[] {
  const runs: number[] = [];
  for (let trial = 0; trial < trials; trial++) {
    let done = 0;
    let days = 0;
    while (done < items && days <= MAX_FORECAST_DAYS) {
      done += daily[Math.floor(random() * daily.length)];
      days++;
    }
    runs.push(days);
  }
  return runs.sort((a, b) => a - b);
}

export function forecastFromDaily(daily: number[], items: number, now: Date, trials: number = FORECAST_TRIALS): Forecast {
  const doneInHistory = daily.reduce((sum, n) => sum + n, 0);
  const base = { items, historyDays: daily.length, doneInHistory, trials };
  if (doneInHistory === 0 && items > 0) return { ...base, outcomes: [] };
  const runs = items === 0 ? [0] : simulate(daily, items, trials);
  const today = Math.floor(now.getTime() / DAY_MS);
  return {
    ...base,
    outcomes: LIKELIHOODS.map((likelihood) => {
      const days = runs[Math.ceil((likelihood / 100) * runs.length) - 1];
      return days > MAX_FORECAST_DAYS
        ? { likelihood, days: null, date: null }
        : { likelihood, days, date: new Date((today + days) * DAY_MS).toISOString().slice(0, 10) };
    }),
  };
}

/** How many tickets were done on each of the last `days` days before now's day (UTC), oldest first */
export function dailyDone(doneAt: number[], days: number, now: Date): number[] {
  const today = Math.floor(now.getTime() / DAY_MS);
  const daily = new Array<number>(days).fill(0);
  for (const at of doneAt) {
    const index = Math.floor(at / DAY_MS) - (today - days);
    if (index >= 0 && index < days) daily[index]++;
  }
  return daily;
}

export async function getForecast(
  db: DB,
  projectId: number,
  options: { items?: number; historyDays?: number; now?: Date } = {}
): Promise<Forecast> {
  const now = options.now ?? new Date();
  const { tickets, doneAt } = await getWorkflowDates(db, projectId);
  const done = [...doneAt.values()].map((at) => new Date(at).getTime());
  const daily = dailyDone(done, options.historyDays ?? DEFAULT_HISTORY_DAYS, now);
  return forecastFromDaily(daily, options.items ?? tickets.length - doneAt.size, now);
}

/** The forecast in a sentence, for the dashboard and the CLI */
export function forecastText(f: Forecast): string {
  const what = `${f.items} ${f.items === 1 ? "ticket" : "tickets"}`;
  if (f.items === 0) return "No open tickets to forecast.";
  if (f.outcomes.length === 0) return `No ticket was done in the last ${f.historyDays} days: there is no pace to forecast ${what} from.`;
  const by = f.outcomes.map((o) => `${o.likelihood}% by ${o.date ?? "(not within ten years)"}`).join(", ");
  return `At the pace of the last ${f.historyDays} days (${f.doneInHistory} done), ${what} will be done: ${by}.`;
}
