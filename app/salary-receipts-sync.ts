import { isSalaryReceipt, isSalaryReceiptDraft, isWorkMonth, type SalaryReceipt, type SalaryReceiptDraft } from "./salary-receipts";

const STORAGE_PREFIX = "pika-salary-received-v1:";
type PendingReceipt = SalaryReceiptDraft & { expectedVersion: number; id: string };
export type SalaryReceiptEntry = {
  receipt: SalaryReceipt | null;
  pending: PendingReceipt | null;
  status: "loading" | "saving" | "synced" | "offline" | "conflict";
  locallySaved: boolean;
};

/** Each work month has its own server row and offline queue; event sync cannot overwrite it. */
export class SalaryReceiptSync {
  private entries: Record<string, SalaryReceiptEntry> = {};
  private busy = new Set<string>();

  constructor(
    private storage: Storage | undefined,
    private notify: (entries: Record<string, SalaryReceiptEntry>) => void,
    private request: typeof fetch = fetch,
  ) {
    try {
      for (let index = 0; index < (storage?.length ?? 0); index += 1) {
        const key = storage?.key(index);
        if (key?.startsWith(STORAGE_PREFIX) && isWorkMonth(key.slice(STORAGE_PREFIX.length))) {
          this.load(key.slice(STORAGE_PREFIX.length));
        }
      }
    } catch {
      // Online saving still works if this browser does not allow device storage.
    }
  }

  private load(month: string) {
    if (this.entries[month]) return this.entries[month];
    const entry: SalaryReceiptEntry = { receipt: null, pending: null, status: "loading", locallySaved: false };
    try {
      const cached = JSON.parse(this.storage?.getItem(`${STORAGE_PREFIX}${month}`) ?? "null");
      if (cached) {
        entry.receipt = isSalaryReceipt(cached.receipt) ? cached.receipt : null;
        if (isSalaryReceiptDraft(cached.pending) && Number.isSafeInteger(cached.pending.expectedVersion) &&
          cached.pending.expectedVersion >= 0 && typeof cached.pending.id === "string") {
          entry.pending = cached.pending;
        }
        entry.status = cached.status === "conflict" && entry.pending ? "conflict" : "loading";
        entry.locallySaved = true;
      }
    } catch {
      // Ignore malformed cached entries, without discarding any other month.
    }
    this.entries[month] = entry;
    return entry;
  }

  private publish(month: string) {
    const entry = this.entries[month];
    try {
      if (!this.storage) throw new Error("Device storage unavailable");
      this.storage.setItem(`${STORAGE_PREFIX}${month}`, JSON.stringify(entry));
      entry.locallySaved = true;
    } catch {
      entry.locallySaved = false;
    }
    this.notify(Object.fromEntries(Object.entries(this.entries).map(([key, value]) => [key, { ...value }])));
  }

  save(month: string, draft: SalaryReceiptDraft) {
    if (!isWorkMonth(month) || !isSalaryReceiptDraft(draft)) throw new Error("Invalid received salary.");
    const entry = this.load(month);
    entry.pending = { ...draft, expectedVersion: entry.receipt?.version ?? 0, id: crypto.randomUUID() };
    entry.status = "saving";
    this.publish(month); // Persist the queue before starting the network request.
    return this.sync(month);
  }

  async refresh(month: string) {
    if (!isWorkMonth(month)) return;
    const months = new Set([month, ...Object.keys(this.entries).filter((key) => this.entries[key].pending)]);
    await Promise.all([...months].map((key) => this.sync(key)));
  }

  private async read(month: string) {
    const response = await this.request(`/api/salary-receipts?month=${month}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Salary sync unavailable");
    const receipt: unknown = await response.json();
    if (!isSalaryReceipt(receipt)) throw new Error("Invalid saved salary");
    return receipt;
  }

  private acknowledge(entry: SalaryReceiptEntry, pending: PendingReceipt, receipt: SalaryReceipt) {
    entry.receipt = receipt;
    if (entry.pending?.id === pending.id) entry.pending = null;
    else if (entry.pending) entry.pending.expectedVersion = receipt.version;
  }

  private async sync(month: string) {
    if (this.busy.has(month)) return;
    const entry = this.load(month);
    if (entry.status === "conflict") {
      this.publish(month);
      return;
    }
    this.busy.add(month);
    entry.status = entry.pending ? "saving" : entry.status;
    this.publish(month);
    try {
      // A new edit made while a save is in flight is sent after its predecessor.
      do {
        const pending = entry.pending;
        if (pending) {
          const response = await this.request(`/api/salary-receipts?month=${month}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receivedCents: pending.receivedCents, expectedCents: pending.expectedCents, expectedVersion: pending.expectedVersion }),
          });
          if (response.status === 409) {
            const current = await this.read(month);
            // A successful write whose response was lost is safe to acknowledge on retry.
            if (current && current.receivedCents === pending.receivedCents && current.expectedCents === pending.expectedCents) {
              this.acknowledge(entry, pending, current);
            } else {
              entry.receipt = current;
              entry.status = "conflict";
              return;
            }
          } else {
            if (!response.ok) throw new Error("Salary sync unavailable");
            const receipt: unknown = await response.json();
            if (!isSalaryReceipt(receipt)) throw new Error("Invalid saved salary");
            this.acknowledge(entry, pending, receipt);
          }
        } else {
          const current = await this.read(month);
          entry.receipt = current;
          // An edit started while loading must be reviewed if its base was stale.
        }
      } while (entry.pending);
      entry.status = "synced";
    } catch {
      entry.status = "offline";
    } finally {
      this.busy.delete(month);
      this.publish(month);
    }
  }
}
