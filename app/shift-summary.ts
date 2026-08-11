export type ShiftSummaryEvent = {
  calendar: string;
  title: string;
  date: string;
};

export type MonthlyShiftSummary = {
  night: number;
  extensions: number;
  rdot: number;
};

const EXTENSION_TITLE = /^(?:early|late|night) \(ex\)$/u;
const RDOT_TITLE = /^(?:early|late|night) rdot$/u;

/** Counts the three requested, mutually exclusive Work-roster categories for one month. */
export function countMonthlyWorkShifts(
  events: readonly ShiftSummaryEvent[],
  monthKey: string,
): MonthlyShiftSummary {
  const summary: MonthlyShiftSummary = { night: 0, extensions: 0, rdot: 0 };
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monthKey)) return summary;

  events.forEach((event) => {
    if (event.calendar !== "work" || !event.date.startsWith(`${monthKey}-`)) return;
    const title = event.title.trim().toLowerCase().replace(/\s+/gu, " ");

    if (title === "night") summary.night += 1;
    else if (EXTENSION_TITLE.test(title)) summary.extensions += 1;
    else if (RDOT_TITLE.test(title)) summary.rdot += 1;
  });

  return summary;
}
