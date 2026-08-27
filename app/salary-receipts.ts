export type SalaryReceiptDraft = {
  receivedCents: number;
  expectedCents: number;
};

export type SalaryReceipt = SalaryReceiptDraft & {
  version: number;
  updatedAt: string;
};

export const MAX_SALARY_CENTS = 99_999_999_999;

export function isWorkMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

export function salaryPayMonth(workMonth: string) {
  if (!isWorkMonth(workMonth)) throw new Error("Invalid work month.");
  const [year, month] = workMonth.split("-").map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
}

export function isSalaryCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SALARY_CENTS;
}

export function isSalaryReceiptDraft(value: unknown): value is SalaryReceiptDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SalaryReceiptDraft>;
  return isSalaryCents(draft.receivedCents) && isSalaryCents(draft.expectedCents);
}

/** Parse decimal money without floating-point comparison errors or treating blank as zero. */
export function parseSalaryCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return isSalaryCents(cents) ? cents : null;
}

export function compareSalary(receivedCents: number, expectedCents: number) {
  const differenceCents = receivedCents - expectedCents;
  return {
    status: differenceCents < 0 ? "Short" : differenceCents > 0 ? "Exceed" : "Match",
    differenceCents,
  } as const;
}

export function isSalaryReceipt(value: unknown): value is SalaryReceipt {
  if (!isSalaryReceiptDraft(value)) return false;
  const receipt = value as SalaryReceipt;
  return Number.isSafeInteger(receipt.version) && receipt.version > 0 &&
    typeof receipt.updatedAt === "string" && Number.isFinite(Date.parse(receipt.updatedAt));
}
