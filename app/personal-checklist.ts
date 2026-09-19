export const CHECKLIST_CATEGORIES = [
  { id: "house", label: "House" },
  { id: "kids", label: "Kids / School" },
  { id: "personal", label: "Personal" },
  { id: "other", label: "Other" },
] as const;

export type ChecklistCategory = typeof CHECKLIST_CATEGORIES[number]["id"];
export type ChecklistTask = {
  id: string;
  title: string;
  notes: string;
  category: ChecklistCategory;
  done: boolean;
  deleted: boolean;
  createdAt: string;
};
export type ChecklistDraft = Pick<ChecklistTask, "title" | "notes" | "category">;
export type ChecklistChanges = Partial<ChecklistDraft & Pick<ChecklistTask, "done" | "deleted">>;
export type ChecklistMutation = { id: string } & (
  { task: ChecklistTask } | { taskId: string; changes: ChecklistChanges }
);

export function isChecklistMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,100}$/u.test(value);
}

export function isChecklistChanges(value: unknown): value is ChecklistChanges {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const changes = value as ChecklistChanges;
  return Object.keys(changes).length > 0 &&
    Object.keys(changes).every((key) => ["title", "notes", "category", "done", "deleted"].includes(key)) &&
    (changes.title === undefined || (typeof changes.title === "string" && changes.title.trim().length > 0 && changes.title.length <= 200)) &&
    (changes.notes === undefined || (typeof changes.notes === "string" && changes.notes.length <= 2000)) &&
    (changes.category === undefined || CHECKLIST_CATEGORIES.some(({ id }) => id === changes.category)) &&
    (changes.done === undefined || typeof changes.done === "boolean") &&
    (changes.deleted === undefined || typeof changes.deleted === "boolean");
}

export function isChecklistTask(value: unknown): value is ChecklistTask {
  if (!value || typeof value !== "object") return false;
  const task = value as ChecklistTask;
  return isId(task.id) && typeof task.title === "string" && typeof task.notes === "string" &&
    CHECKLIST_CATEGORIES.some(({ id }) => id === task.category) &&
    typeof task.done === "boolean" && typeof task.deleted === "boolean" &&
    typeof task.createdAt === "string" && Number.isFinite(Date.parse(task.createdAt)) &&
    isChecklistChanges({ title: task.title, notes: task.notes, category: task.category });
}

export function isChecklistTasks(value: unknown): value is ChecklistTask[] {
  return Array.isArray(value) && value.length <= 2000 && value.every(isChecklistTask) &&
    new Set(value.map((task) => task.id)).size === value.length;
}

export function isChecklistMutation(value: unknown): value is ChecklistMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as ChecklistMutation;
  return isId(mutation.id) && ("task" in mutation
    ? isChecklistTask(mutation.task)
    : isId(mutation.taskId) && isChecklistChanges(mutation.changes));
}

/** Replay field changes on the latest list, retaining deletions across stale devices. */
export function applyChecklistMutations(tasks: readonly ChecklistTask[], mutations: readonly ChecklistMutation[]) {
  const result = new Map(tasks.map((task) => [task.id, task]));
  for (const mutation of mutations) {
    if ("task" in mutation) {
      // Retrying an acknowledged creation must not replace later edits or deletions.
      if (!result.has(mutation.task.id)) result.set(mutation.task.id, mutation.task);
    } else {
      const previous = result.get(mutation.taskId);
      if (previous) result.set(previous.id, { ...previous, ...mutation.changes });
    }
  }
  return [...result.values()];
}
