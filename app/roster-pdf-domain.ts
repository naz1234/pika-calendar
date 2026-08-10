import type { RosterObservation } from "./roster-reader";

export type PositionedPdfText = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const WEEKDAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupRows(values: number[]) {
  const groups: number[][] = [];
  [...values].sort((left, right) => right - left).forEach((value) => {
    const group = groups.find((candidate) => Math.abs(median(candidate) - value) <= 3);
    if (group) group.push(value);
    else groups.push([value]);
  });
  return groups.map(median).sort((left, right) => right - left);
}

function normalizedCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/(?:^|\s)(WR|[ELN]3\s*[-/]?\s*D[C0]|[ELN]\s*[-/]?\s*(?:EX|RD))(?:$|\s)/);
  return match?.[1].trim().replace(/\s+/g, " ") ?? "";
}

function extractPdfTimes(text: string) {
  const matches = text.match(/\b(?:[01]?\d|2[0-3])[:.]?[0-5]\d\+?\b/g) ?? [];
  const times: string[] = [];
  matches.forEach((match) => {
    const digits = match.replace(/\D/g, "");
    const time = `${digits.slice(0, -2).padStart(2, "0")}:${digits.slice(-2)}`;
    if (!times.includes(time)) times.push(time);
  });
  return times.slice(0, 2);
}

function columnBounds(items: readonly PositionedPdfText[]) {
  const weekdayItems = WEEKDAY_NAMES.map((weekday) =>
    items.find((item) => item.str.trim().toUpperCase() === weekday),
  );
  if (weekdayItems.some((item) => !item)) {
    throw new Error("The PDF weekday columns could not be read. Export the monthly IVU.plan view again.");
  }
  const centers = weekdayItems.map((item) => (item as PositionedPdfText).x + (item as PositionedPdfText).width / 2);
  const boundaries = [centers[0] - (centers[1] - centers[0]) / 2];
  for (let index = 0; index < centers.length - 1; index += 1) {
    boundaries.push((centers[index] + centers[index + 1]) / 2);
  }
  boundaries.push(centers[6] + (centers[6] - centers[5]) / 2);
  return boundaries;
}

export function parseIvuPlanTextItems(
  items: readonly PositionedPdfText[],
  year: number,
  monthIndex: number,
): RosterObservation[] {
  const pageText = items.map((item) => item.str).join(" ").toUpperCase();
  if (!pageText.includes("DUTY SCHEDULE FOR")) {
    throw new Error("This is not an IVU.plan duty schedule PDF.");
  }

  const weekdayY = median(
    items
      .filter((item) => WEEKDAY_NAMES.includes(item.str.trim().toUpperCase()))
      .map((item) => item.y),
  );
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const dayItems = new Map<number, PositionedPdfText>();
  items.forEach((item) => {
    const value = item.str.trim();
    if (!/^\d{1,2}$/.test(value) || item.y >= weekdayY - 2) return;
    const day = Number(value);
    if (day < 1 || day > daysInMonth || dayItems.has(day)) return;
    dayItems.set(day, item);
  });
  if (dayItems.size !== daysInMonth) {
    throw new Error(`The PDF calendar grid is incomplete (${dayItems.size} of ${daysInMonth} dates found).`);
  }

  const boundaries = columnBounds(items);
  const rows = groupRows([...dayItems.values()].map((item) => item.y));
  if (rows.length < 4 || rows.length > 6) {
    throw new Error("The PDF calendar rows could not be identified.");
  }

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const label = dayItems.get(day) as PositionedPdfText;
    const centerX = label.x + label.width / 2;
    const column = boundaries.findIndex((right, boundaryIndex) =>
      boundaryIndex > 0 && centerX < right,
    ) - 1;
    const row = rows.reduce(
      (best, value, rowIndex) => Math.abs(value - label.y) < Math.abs(rows[best] - label.y) ? rowIndex : best,
      0,
    );
    const lowerY = row < rows.length - 1 ? rows[row + 1] + 2 : 0;
    const leftX = boundaries[Math.max(0, column)];
    const rightX = boundaries[Math.min(7, Math.max(0, column) + 1)];
    const cellItems = items
      .filter((item) => {
        const itemCenter = item.x + item.width / 2;
        return itemCenter >= leftX && itemCenter < rightX && item.y < label.y - 1 && item.y > lowerY;
      })
      .sort((left, right) => right.y - left.y || left.x - right.x);
    const rawText = cellItems.map((item) => item.str.trim()).filter(Boolean).join(" ");
    const rawCode = cellItems.map((item) => normalizedCode(item.str)).find(Boolean) ?? normalizedCode(rawText);
    const times = extractPdfTimes(rawText);

    return {
      day,
      rawCode,
      rawText,
      times,
      barKind: rawCode === "WR" ? "green" : rawCode ? "blue" : "none",
      confidence: rawCode ? 100 : 0,
    };
  });
}
