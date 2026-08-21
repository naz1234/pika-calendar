export type ShiftSummaryEvent = {
  calendar: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  endsNextDay?: boolean;
  source?: { type?: string };
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

export type ManualSalaryEstimateInput = {
  salaryWithLaundry: number;
  extensionDays: number;
  rdotDays: number;
};

export type ManualSalaryEstimate = ManualSalaryEstimateInput & {
  basicSalary: number;
  overtimeHours: number;
  expectedOvertime: number;
  expectedSalary: number;
};

const EXTENSION_TITLE = /^(?:early|late|night) \(ex\)$/u;
const RDOT_TITLE = /^(?:early|late|night) rdot$/u;
const NIGHT_TITLE = /^night(?: \(ex\)| rdot)?$/u;
const DEFAULT_BASIC_SALARY = 15_000;
export const DEFAULT_SALARY_WITH_LAUNDRY = 15_100;
const DEFAULT_NIGHT_ALLOWANCE_RATE = 45;
const NORMAL_SHIFT_HOURS = 8.5;
const MONTHLY_BASE_HOURS = 192;
const OVERTIME_MULTIPLIER = 1.5;
const DEFAULT_LAUNDRY_ALLOWANCE = DEFAULT_SALARY_WITH_LAUNDRY - DEFAULT_BASIC_SALARY;
const EXTENSION_OVERTIME_HOURS = 3.5;

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

function nonNegativeNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

/**
 * Estimates salary from manually entered overtime-day counts.
 *
 * Extension days use 3.5 overtime hours and RDOT days use one normal
 * 8.5-hour shift. The overtime rate uses the salary amount less the app's
 * standard SAR 100 laundry allowance, matching the monthly forecast defaults.
 */
export function calculateManualSalaryEstimate(
  input: ManualSalaryEstimateInput,
): ManualSalaryEstimate {
  const salaryWithLaundry = roundCurrency(nonNegativeNumber(input.salaryWithLaundry));
  const extensionDays = nonNegativeNumber(input.extensionDays);
  const rdotDays = nonNegativeNumber(input.rdotDays);
  const basicSalary = roundCurrency(Math.max(0, salaryWithLaundry - DEFAULT_LAUNDRY_ALLOWANCE));
  const overtimeHours = Math.round(
    ((extensionDays * EXTENSION_OVERTIME_HOURS) + (rdotDays * NORMAL_SHIFT_HOURS)) * 10,
  ) / 10;
  const expectedOvertime = roundCurrency(
    basicSalary > 0 ? (basicSalary / MONTHLY_BASE_HOURS * OVERTIME_MULTIPLIER) * overtimeHours : 0,
  );

  return {
    salaryWithLaundry,
    extensionDays,
    rdotDays,
    basicSalary,
    overtimeHours,
    expectedOvertime,
    expectedSalary: roundCurrency(salaryWithLaundry + expectedOvertime),
  };
}

/** Counts night work and overtime categories for one month. Categories may overlap. */
export function countMonthlyWorkShifts(
  events: readonly ShiftSummaryEvent[],
  monthKey: string,
): MonthlyShiftSummary {
  const summary: MonthlyShiftSummary = { night: 0, extensions: 0, rdot: 0 };
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(monthKey)) return summary;

  events.forEach((event) => {
    if (!belongsToWorkMonth(event, monthKey)) return;
    const title = normalizedTitle(event.title);

    if (NIGHT_TITLE.test(title)) summary.night += 1;
    if (EXTENSION_TITLE.test(title)) summary.extensions += 1;
    if (RDOT_TITLE.test(title)) summary.rdot += 1;
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
      let durationHours = eventDurationHours(event);

      // Older roster imports mapped the 19:00 Night extension to 07:30 even
      // though IVU.plan and Railog use 07:00. Keep saved calendars accurate
      // before the user has a chance to re-import that month.
      if (
        title === "night (ex)" &&
        event.source?.type === "roster-image" &&
        event.startTime === "19:00" &&
        event.endTime === "07:30"
      ) {
        durationHours = Math.max(0, durationHours - 0.5);
      }

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
