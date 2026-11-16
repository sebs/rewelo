import { esc } from "./html.js";
import type { FlowPoint, FlowWindow } from "./flow.js";

// The cumulative flow diagram as inline SVG, drawn the way DevOps Infinity
// draws its own: three overlapping filled lines, all tickets at the back,
// started ones in front of them and done ones in front, and a y axis that
// starts a little below the lowest done count, so the bands fill the chart
// rather than the history below them. No script: each day's counts are a
// tooltip (an SVG title), which works wherever the page is shown.

export const FLOW_SERIES = [
  { key: "arrived", label: "Arrived", description: "every ticket created" },
  { key: "started", label: "Started", description: "in progress or done" },
  { key: "done", label: "Done", description: "holding state:done" },
] as const;

const WIDTH = 720;
const HEIGHT = 260;
const MARGIN = { top: 14, right: 16, bottom: 30, left: 44 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
/** The y axis starts this far below the lowest done count, as in DevOps Infinity */
const BELOW_DONE = 3;
const X_LABELS = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 3", or "Nov 3, 2026" */
function dayLabel(date: string, withYear: boolean): string {
  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}${withYear ? `, ${year}` : ""}`;
}

/** A round step for about four gridlines over range: 1, 2 or 5 times a power of ten */
function niceStep(range: number): number {
  const raw = Math.max(range / 4, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** What the window shows, in a sentence: the chart's accessible name and its caption */
export function flowSummary(window: FlowWindow): string {
  const { points, start, days } = window;
  const last = points[points.length - 1];
  const period = days > 0 ? `Last ${days} days` : `Since ${dayLabel(points[0].date, true)}`;
  return (
    `${period}: ${last.arrived - start.arrived} arrived, ${last.started - start.started} started, ` +
    `${last.done - start.done} done. At the end, ${last.started - last.done} in progress ` +
    `and ${last.arrived - last.started} not started.`
  );
}

/** The window's diagram; it needs at least one point */
export function flowChartSvg(window: FlowWindow): string {
  const { points } = window;
  const lowestDone = Math.min(...points.map((p) => p.done));
  const highest = Math.max(...points.map((p) => p.arrived));
  const floor = Math.max(lowestDone - BELOW_DONE, 0);
  const step = niceStep(highest - floor);
  const bottom = Math.floor(floor / step) * step;
  const top = Math.max(bottom + step, Math.ceil(highest / step) * step);

  // A single day is drawn across the whole plot
  const x = (i: number) =>
    points.length === 1 ? MARGIN.left + (i === 0 ? 0 : PLOT_WIDTH) : MARGIN.left + (i * PLOT_WIDTH) / (points.length - 1);
  const y = (count: number) => MARGIN.top + PLOT_HEIGHT * (1 - (count - bottom) / (top - bottom));
  const drawn: FlowPoint[] = points.length === 1 ? [points[0], points[0]] : points;
  const lastX = x(drawn.length - 1);

  const grid: string[] = [];
  for (let count = bottom; count <= top; count += step) {
    const at = round(y(count));
    grid.push(
      `<line class="grid" x1="${MARGIN.left}" y1="${at}" x2="${MARGIN.left + PLOT_WIDTH}" y2="${at}"/>` +
        `<text class="tick" x="${MARGIN.left - 6}" y="${round(at + 4)}" text-anchor="end">${count}</text>`
    );
  }

  const withYear = points[0].date.slice(0, 4) !== points[points.length - 1].date.slice(0, 4);
  const labelled = [...new Set(Array.from({ length: X_LABELS }, (_, k) => Math.round((k * (points.length - 1)) / (X_LABELS - 1))))];
  const xLabels = labelled.map((i) => {
    const anchor = points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
    const at = points.length === 1 ? MARGIN.left + PLOT_WIDTH / 2 : x(i);
    return `<text class="tick" x="${round(at)}" y="${HEIGHT - 10}" text-anchor="${anchor}">${esc(dayLabel(points[i].date, withYear))}</text>`;
  });

  const series = FLOW_SERIES.map(({ key }) => {
    const line = drawn.map((p, i) => `${i === 0 ? "M" : "L"}${round(x(i))} ${round(y(p[key]))}`).join("");
    const base = round(y(bottom));
    return (
      `<path class="area ${key}" d="M${MARGIN.left} ${base}L${line.slice(1)}L${round(lastX)} ${base}Z"/>` +
      `<path class="line ${key}" d="${line}"/>`
    );
  });

  // Each day's column shows its counts on hover
  const hits = points.map((p, i) => {
    const left = i === 0 ? MARGIN.left : (x(i - 1) + x(i)) / 2;
    const right = i === points.length - 1 ? MARGIN.left + PLOT_WIDTH : (x(i) + x(i + 1)) / 2;
    return (
      `<rect class="hit" x="${round(left)}" y="${MARGIN.top}" width="${round(right - left)}" height="${PLOT_HEIGHT}">` +
      `<title>${esc(`${p.date}: ${p.arrived} arrived, ${p.started} started, ${p.done} done`)}</title></rect>`
    );
  });

  return (
    `<svg class="cfd" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(`Cumulative flow. ${flowSummary(window)}`)}">` +
    grid.join("") +
    series.join("") +
    xLabels.join("") +
    hits.join("") +
    `</svg>`
  );
}
