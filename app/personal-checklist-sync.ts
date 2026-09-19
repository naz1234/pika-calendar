import {
  applyChecklistMutations, isChecklistMonth, isChecklistMutation, isChecklistTasks,
  type ChecklistMutation, type ChecklistTask,
} from "./personal-checklist";

const PREFIX = "pika-personal-checklist-v1:";
export type ChecklistEntry = {
  tasks: ChecklistTask[];
  pending: ChecklistMutation[];
  status: "loading" | "saving" | "synced" | "offline";
  locallySaved: boolean;
};

/** Independent month rows and a persisted operation queue leave calendar events untouched. */
export class PersonalChecklistSync {
  private entries: Record<string, ChecklistEntry> = {};
  private busy = new Map<string, Promise<void>>();

  constructor(
    private storage: Storage | undefined,
    private notify: (entries: Record<string, ChecklistEntry>) => void,
    private request: typeof fetch = fetch,
  ) {
    try {
      for (let index = 0; index < (storage?.length ?? 0); index++) {
        const key = storage?.key(index);
        if (key?.startsWith(PREFIX) && isChecklistMonth(key.slice(PREFIX.length))) this.load(key.slice(PREFIX.length));
      }
    } catch { /* Cloud saving still works when device storage is unavailable. */ }
  }

  private load(month: string) {
    if (this.entries[month]) return this.entries[month];
    const entry: ChecklistEntry = { tasks: [], pending: [], status: "loading", locallySaved: false };
    try {
      const cached = JSON.parse(this.storage?.getItem(`${PREFIX}${month}`) ?? "null");
      if (cached && isChecklistTasks(cached.tasks) && Array.isArray(cached.pending) && cached.pending.every(isChecklistMutation)) {
        entry.tasks = cached.tasks;
        entry.pending = cached.pending;
        entry.locallySaved = true;
      }
    } catch { /* Ignore invalid cache data for this month only. */ }
    this.entries[month] = entry;
    return entry;
  }

  private publish(month: string) {
    const entry = this.entries[month];
    try {
      if (!this.storage) throw new Error("Device storage unavailable");
      this.storage.setItem(`${PREFIX}${month}`, JSON.stringify({ tasks: entry.tasks, pending: entry.pending }));
      entry.locallySaved = true;
    } catch { entry.locallySaved = false; }
    this.notify(Object.fromEntries(Object.entries(this.entries).map(([key, value]) => [key, { ...value }])));
  }

  change(month: string, mutation: ChecklistMutation) {
    if (!isChecklistMonth(month) || !isChecklistMutation(mutation)) throw new Error("Invalid checklist change.");
    const entry = this.load(month);
    const next = applyChecklistMutations(entry.tasks, [mutation]);
    if (!isChecklistTasks(next)) throw new Error("This month's checklist is full.");
    entry.tasks = next;
    entry.pending = [...entry.pending, mutation];
    entry.status = "saving";
    this.publish(month);
    return this.sync(month);
  }

  async refresh(month: string) {
    if (!isChecklistMonth(month)) return;
    const months = new Set([month, ...Object.keys(this.entries).filter((key) => this.entries[key].pending.length)]);
    await Promise.all([...months].map((key) => this.sync(key)));
  }

  private sync(month: string): Promise<void> {
    const active = this.busy.get(month);
    if (active) return active;
    const task = this.run(month).finally(() => this.busy.delete(month));
    this.busy.set(month, task);
    return task;
  }

  private async run(month: string) {
    const entry = this.load(month);
    this.publish(month);
    try {
      let conflicts = 0;
      do {
        const url = `/api/personal-checklist?month=${month}`;
        const response = await this.request(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error("Checklist unavailable");
        const remote = await response.json() as { tasks?: unknown; version?: unknown };
        if (!isChecklistTasks(remote.tasks) || !Number.isSafeInteger(remote.version) || Number(remote.version) < 0) {
          throw new Error("Invalid checklist response");
        }
        const pending = [...entry.pending];
        const merged = applyChecklistMutations(remote.tasks, pending);
        // Include edits made during the request, and never show an old server copy over them.
        entry.tasks = merged;
        if (!pending.length) break;
        entry.status = "saving";
        this.publish(month);
        const saved = await this.request(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: merged, expectedVersion: remote.version }),
          signal: AbortSignal.timeout(15_000),
        });
        if (saved.status === 409 && ++conflicts < 5) continue;
        if (!saved.ok) throw new Error("Checklist save unavailable");
        const acknowledged = new Set(pending.map((mutation) => mutation.id));
        entry.pending = entry.pending.filter((mutation) => !acknowledged.has(mutation.id));
        this.publish(month);
      } while (entry.pending.length);
      entry.status = "synced";
    } catch {
      entry.status = "offline";
    } finally {
      this.publish(month);
    }
  }
}
