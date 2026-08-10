export type RosterChoice =
  | "rd"
  | "early"
  | "late"
  | "night"
  | "early-ex-start"
  | "early-ex-finish"
  | "late-ex-start"
  | "late-ex-finish"
  | "night-ex-start"
  | "night-ex-finish"
  | "early-rdot"
  | "late-rdot"
  | "night-rdot";

export type RosterChoiceOption = {
  value: RosterChoice;
  label: string;
};

export type RosterEventDetails = {
  title: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
};

export type RosterInference = {
  choice: RosterChoice | "";
  warning: string;
};

export type RosterInferenceInput = {
  rawCode: string;
  times?: string | readonly string[];
  barKind?: string | null;
};

export type RosterShiftTone = "early" | "late" | "night" | "rest";

export const ROSTER_CHOICE_OPTIONS: readonly RosterChoiceOption[] = [
  { value: "rd", label: "RD" },
  { value: "early", label: "Early" },
  { value: "early-ex-start", label: "Early (EX) - starts 03:00" },
  { value: "early-ex-finish", label: "Early (EX) - ends 19:00" },
  { value: "early-rdot", label: "Early RDOT" },
  { value: "late", label: "Late" },
  { value: "late-ex-start", label: "Late (EX) - starts 11:00" },
  { value: "late-ex-finish", label: "Late (EX) - ends 03:00 next day" },
  { value: "late-rdot", label: "Late RDOT" },
  { value: "night", label: "Night" },
  { value: "night-ex-start", label: "Night (EX) - starts 19:00" },
  { value: "night-ex-finish", label: "Night (EX) - ends 11:00 next day" },
  { value: "night-rdot", label: "Night RDOT" },
] as const;

const CHOICE_DETAILS: Readonly<Record<RosterChoice, RosterEventDetails>> = {
  rd: {
    title: "RD",
    allDay: true,
    startTime: "",
    endTime: "",
    endsNextDay: false,
  },
  early: {
    title: "Early",
    allDay: false,
    startTime: "07:00",
    endTime: "15:30",
    endsNextDay: false,
  },
  late: {
    title: "Late",
    allDay: false,
    startTime: "15:00",
    endTime: "23:30",
    endsNextDay: false,
  },
  night: {
    title: "Night",
    allDay: false,
    startTime: "23:00",
    endTime: "07:30",
    endsNextDay: true,
  },
  "early-ex-start": {
    title: "Early (EX)",
    allDay: false,
    startTime: "03:00",
    endTime: "15:30",
    endsNextDay: false,
  },
  "early-ex-finish": {
    title: "Early (EX)",
    allDay: false,
    startTime: "07:00",
    endTime: "19:00",
    endsNextDay: false,
  },
  "late-ex-start": {
    title: "Late (EX)",
    allDay: false,
    startTime: "11:00",
    endTime: "23:30",
    endsNextDay: false,
  },
  "late-ex-finish": {
    title: "Late (EX)",
    allDay: false,
    startTime: "15:00",
    endTime: "03:00",
    endsNextDay: true,
  },
  "night-ex-start": {
    title: "Night (EX)",
    allDay: false,
    startTime: "19:00",
    endTime: "07:30",
    endsNextDay: true,
  },
  "night-ex-finish": {
    title: "Night (EX)",
    allDay: false,
    startTime: "23:00",
    endTime: "11:00",
    endsNextDay: true,
  },
  "early-rdot": {
    title: "Early RDOT",
    allDay: false,
    startTime: "07:00",
    endTime: "15:30",
    endsNextDay: false,
  },
  "late-rdot": {
    title: "Late RDOT",
    allDay: false,
    startTime: "15:00",
    endTime: "23:30",
    endsNextDay: false,
  },
  "night-rdot": {
    title: "Night RDOT",
    allDay: false,
    startTime: "23:00",
    endTime: "07:30",
    endsNextDay: true,
  },
};

const CHECKMARKS = /[\u221a\u2713\u2714\u2611]\ufe0f?/gu;
const OCR_SEPARATORS = /[\s\-\u2010-\u2015\u2212_./\\|:;,]+/gu;

/**
 * Converts the short code at the top of a roster cell to a stable form.
 * Unknown codes are still returned in a compact uppercase form so callers can
 * show the OCR result during manual review.
 */
export function normalizeRosterCode(rawCode: string): string {
  const compact = String(rawCode ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(CHECKMARKS, "")
    .replace(OCR_SEPARATORS, "")
    .replace(/[^A-Z0-9]/gu, "");

  const standard = compact.match(/([ELN])3[D0O][C0O]/u);
  if (standard) return `${standard[1]}3-DC`;

  // A small checkmark followed by L3-DC can be read as 7130C: the checkmark
  // becomes 7, L becomes 1, and D becomes 0. Keep this correction narrow so
  // unrelated or ambiguous roster codes still require manual review.
  if (/^[7V]?[1I]3[D0O][C0O]$/u.test(compact)) return "L3-DC";

  const extension = compact.match(/([ELN])EX/u);
  if (extension) return `${extension[1]} EX`;

  const restDayOvertime = compact.match(/([ELN])RD/u);
  if (restDayOvertime) return `${restDayOvertime[1]} RD`;

  if (/(?:^|[^A-Z])WR(?:$|[^A-Z])/u.test(compact) || compact === "WR") return "WR";
  if (compact === "RD") return "RD";

  return compact;
}

/** Returns the visual group for canonical roster titles without styling unrelated events. */
export function rosterShiftTone(title: string): RosterShiftTone | "" {
  const normalized = String(title ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
  if (normalized === "rd") return "rest";

  const shift = normalized.match(/^(early|late|night)(?: \(ex\)| rdot)?$/u);
  return (shift?.[1] as RosterShiftTone | undefined) ?? "";
}

/** Returns a compact, readable label for an event in narrow month cells. */
export function mobileEventCode(title: string): string {
  const tone = rosterShiftTone(title);
  if (tone === "rest") return "RD";
  if (tone === "early") return "ES";
  if (tone === "late") return "LS";
  if (tone === "night") return "NS";

  const normalized = String(title ?? "").normalize("NFKC").trim();
  if (/^(?:annual leave|al)$/iu.test(normalized)) return "AL";

  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [firstWord = "", secondWord = ""] = words;
  if (secondWord) {
    return `${Array.from(firstWord)[0]}${Array.from(secondWord)[0]}`.toUpperCase();
  }

  return Array.from(firstWord || "EV").slice(0, 2).join("").toUpperCase();
}

/** Extracts 24-hour clock values from noisy OCR text, including O/0 swaps. */
export function extractRosterTimes(rawText: string): string[] {
  const normalized = String(rawText ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/O/gu, "0")
    .replace(/[\uff1a\ufe55]/gu, ":");
  const times: string[] = [];
  const timePattern = /(?:^|[^0-9])(?:(0?[0-9]|1[0-9]|2[0-3])\s*[:.;]\s*([0-5][0-9])|((?:[01][0-9]|2[0-3])([0-5][0-9])))(?![0-9])/gu;

  for (const match of normalized.matchAll(timePattern)) {
    const hour = match[1] ?? match[3]?.slice(0, 2);
    const minute = match[2] ?? match[4];
    if (hour !== undefined && minute !== undefined) {
      times.push(`${String(Number(hour)).padStart(2, "0")}:${minute}`);
    }
  }

  return times;
}

function normalizedInputTimes(rawCode: string, times: string | readonly string[] | undefined) {
  const values = typeof times === "string" ? [times] : [...(times ?? [])];
  return new Set([
    ...extractRosterTimes(rawCode),
    ...values.flatMap((value) => extractRosterTimes(value)),
  ]);
}

function inferExtension(
  shift: "early" | "late" | "night",
  times: ReadonlySet<string>,
): RosterInference {
  const markers = {
    early: { start: "03:00", finish: "19:00" },
    late: { start: "11:00", finish: "03:00" },
    night: { start: "19:00", finish: "11:00" },
  } as const;
  const marker = markers[shift];
  const hasStartExtension = times.has(marker.start);
  const hasFinishExtension = times.has(marker.finish);

  if (hasStartExtension !== hasFinishExtension) {
    return {
      choice: `${shift}-ex-${hasStartExtension ? "start" : "finish"}` as RosterChoice,
      warning: "",
    };
  }

  const values = [...times];
  if (values.length >= 2) {
    const expected = {
      early: {
        start: [["03:00", "15:30"]],
        finish: [["07:00", "19:00"]],
      },
      late: {
        start: [["11:00", "23:30"]],
        finish: [["15:00", "03:00"]],
      },
      night: {
        start: [["19:00", "07:30"], ["19:00", "07:00"]],
        finish: [["23:00", "11:00"]],
      },
    } as const;
    const distance = (left: string, right: string) => {
      const leftDigits = left.replace(/\D/gu, "");
      const rightDigits = right.replace(/\D/gu, "");
      return [...leftDigits].reduce(
        (total, character, index) => total + (character === rightDigits[index] ? 0 : 1),
        Math.abs(leftDigits.length - rightDigits.length),
      );
    };
    const score = (pairs: readonly (readonly [string, string])[]) => Math.min(
      ...pairs.map(([start, finish]) => distance(values[0], start) + distance(values[1], finish)),
    );
    const startScore = score(expected[shift].start);
    const finishScore = score(expected[shift].finish);
    if (Math.min(startScore, finishScore) <= 3 && Math.abs(startScore - finishScore) >= 2) {
      return {
        choice: `${shift}-ex-${startScore < finishScore ? "start" : "finish"}` as RosterChoice,
        warning: "",
      };
    }
  }

  const label = `${shift[0].toUpperCase()}${shift.slice(1)} (EX)`;
  return {
    choice: "",
    warning: `Could not tell whether ${label} extends the start or finish. Choose an extension option.`,
  };
}

export function inferRosterChoice({
  rawCode,
  times,
  barKind,
}: RosterInferenceInput): RosterInference {
  if (String(barKind ?? "").trim().toLowerCase().includes("green")) {
    return { choice: "rd", warning: "" };
  }

  const code = normalizeRosterCode(rawCode);
  if (code === "WR" || code === "RD") return { choice: "rd", warning: "" };
  if (code === "E3-DC") return { choice: "early", warning: "" };
  if (code === "L3-DC") return { choice: "late", warning: "" };
  if (code === "N3-DC") return { choice: "night", warning: "" };
  if (code === "E RD") return { choice: "early-rdot", warning: "" };
  if (code === "L RD") return { choice: "late-rdot", warning: "" };
  if (code === "N RD") return { choice: "night-rdot", warning: "" };

  const extractedTimes = normalizedInputTimes(rawCode, times);
  if (code === "E EX") return inferExtension("early", extractedTimes);
  if (code === "L EX") return inferExtension("late", extractedTimes);
  if (code === "N EX") return inferExtension("night", extractedTimes);

  return {
    choice: "",
    warning: "Could not recognize this roster code. Choose a shift manually.",
  };
}

export function choiceToEvent(choice: RosterChoice): RosterEventDetails {
  return { ...CHOICE_DETAILS[choice] };
}

function assertWholeNumber(value: number, name: string) {
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be a whole number.`);
}

export function makeMonthKey(year: number, month: number): string {
  assertWholeNumber(year, "Year");
  assertWholeNumber(month, "Month");
  if (year < 1000 || year > 9999) throw new RangeError("Year must have four digits.");
  if (month < 1 || month > 12) throw new RangeError("Month must be between 1 and 12.");
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1000 || month < 1 || month > 12) return null;
  return { year, month };
}

function numberOfDays(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function makeDateKey(year: number, month: number, day: number): string {
  const monthValue = makeMonthKey(year, month);
  assertWholeNumber(day, "Day");
  if (day < 1 || day > numberOfDays(year, month)) {
    throw new RangeError("Day is outside the selected month.");
  }
  return `${monthValue}-${String(day).padStart(2, "0")}`;
}

export function dateKeyFromMonthKey(value: string, day: number): string {
  const parsed = parseMonthKey(value);
  if (!parsed) throw new RangeError("Month key must use YYYY-MM format.");
  return makeDateKey(parsed.year, parsed.month, day);
}

export function isDateKeyInMonth(value: string, expectedMonthKey: string): boolean {
  const month = parseMonthKey(expectedMonthKey);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!month || !match) return false;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const day = Number(match[3]);
  return (
    year === month.year &&
    monthNumber === month.month &&
    day >= 1 &&
    day <= numberOfDays(year, monthNumber)
  );
}

export const monthKey = makeMonthKey;
export const dateKey = makeDateKey;
