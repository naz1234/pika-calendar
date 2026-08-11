export type ShiftSummaryEvent = {
  calendar: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  endsNextDay?: boolean;
};

export type MonthlyShiftSummary = {
  night: number;
  extensions: number;
  rdot: number;
};

export type MonthlySalaryForecast = {
  salaryWithLaundry: number;
  overtimeHours: number;
  nightAllowance: number;
  expectedOvertime: number;
  expectedSalary: number;
};

export type SalaryForecastSettings = {
  basicSalary?: number;
  salaryWithLaundry?: number;
  nightAllowanceRate?: number;
};

const EXTENSION_TITLE = /^(?:early|late|night) \(ex\)$/u;
const RDOT_TITLE = /^(?:early|late|night) rdot$/u;
const DEFAULT_BASIC_SALARY = 15_000;
const DEFAULT_SALARY_WITH_LAUNDRY = 15_100;
const DEFAULT_NIGHT_ALLOWANCE_RATE = 45;
const NORMAL_SHIFT_HOURS = 8.5;
const MONTHLY_BASE_HOURS = 192;
const OVERTIME_MULTIPLIER = 1.5;

function normalizedTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/gu, " ");
}

function belongsToWorkMonth(event: ShiftSummaryEvent, monthKey: string) {
  return event.calendar === "work" && event.date.startsWith(`${monthKey}-`);
}

function parseTimeMinutes(value = "") {
  const match = /^(\d{2}):([0-5]\d)$/u.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  return hours <= 23 ? (hours * 60) + Number(match[2]) : null;
}

function eventDurationHours(event: ShiftSummaryEvent) {
  const startMinutes = parseTimeMinutes(event.startTime);
  let endMinutes = parseTimeMinutes(event.endTime);
  if (startMinutes === null || endMinutes === null) return 0;
  if (event.endsNextDay || endMinutes < startMinutes) endMinutes += 24 * 60;
  return Math.round(((endMinutes - startMinutes) / 60) * 10) / 10;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Counts the three requested, mutually exclusive Work-roster categories for one month. */
export function countMonthlyWorkShifts(
  events: readonly ShiftSummaryEvent[],
  monthKey: string,
): MonthlyShiftSummary {
  const summary: MonthlyShiftSummary = { night: 0, extensions: 0, rdot: 0 };
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monthKey)) return summary;

  events.forEach((event) => {
    if (!belongsToWorkMonth(event, monthKey)) return;
    const title = normalizedTitle(event.title);

    if (title === "night") summary.night += 1;
    else if (EXTENSION_TITLE.test(title)) summary.extensions += 1;
    else if (RDOT_TITLE.test(title)) summary.rdot += 1;
  });

  return summary;
}

/** Uses the Railog Overtime formula to forecast the following month's salary. */
export function calculateMonthlyExpectedSalary(
  events: readonly ShiftSummaryEvent[],
  monthKey: string,
  settings: SalaryForecastSettings = {},
): MonthlySalaryForecast {
  const basicSalary = Number.isFinite(settings.basicSalary)
    ? Math.max(0, Number(settings.basicSalary))
    : DEFAULT_BASIC_SALARY;
  const salaryWithLaundry = Number.isFinite(settings.salaryWithLaundry)
    ? Math.max(0, Number(settings.salaryWithLaundry))
    : DEFAULT_SALARY_WITH_LAUNDRY;
  const nightAllowanceRate = Number.isFinite(settings.nightAllowanceRate)
    ? Math.max(0, Number(settings.nightAllowanceRate))
    : DEFAULT_NIGHT_ALLOWANCE_RATE;
  const validMonth = /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monthKey);
  const shiftSummary = countMonthlyWorkShifts(events, monthKey);
  let overtimeHours = 0;

  if (validMonth) {
    events.forEach((event) => {
      if (!belongsToWorkMonth(event, monthKey)) return;
      const title = normalizedTitle(event.title);
      const durationHours = eventDurationHours(event);

      if (EXTENSION_TITLE.test(title)) {
        overtimeHours += Math.max(0, durationHours - NORMAL_SHIFT_HOURS);
      } else if (RDOT_TITLE.test(title)) {
        overtimeHours += durationHours;
      }
    });
  }

  overtimeHours = Math.round(overtimeHours * 10) / 10;
  const nightAllowance = roundCurrency(shiftSummary.night * nightAllowanceRate);
  const expectedOvertime = roundCurrency(
    basicSalary > 0 ? (basicSalary / MONTHLY_BASE_HOURS * OVERTIME_MULTIPLIER) * overtimeHours : 0,
  );

  return {
    salaryWithLaundry,
    overtimeHours,
    nightAllowance,
    expectedOvertime,
    expectedSalary: roundCurrency(salaryWithLaundry + nightAllowance + expectedOvertime),
  };
}
