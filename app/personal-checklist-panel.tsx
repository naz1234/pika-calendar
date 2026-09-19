"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CHECKLIST_CATEGORIES, type ChecklistCategory, type ChecklistDraft,
  type ChecklistMutation, type ChecklistTask,
} from "./personal-checklist";
import type { ChecklistEntry } from "./personal-checklist-sync";

function Icon({ name }: { name: ChecklistCategory | "edit" | "delete" | "plus" }) {
  const paths = {
    house: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21V12h6v9" /></>,
    kids: <><path d="m5 8 7-5 7 5v13H5ZM9 21v-6h6v6M2 12h3m14 0h3M2 12v9h20v-9" /><path d="M12 8v3m-1.5-1.5h3" /></>,
    personal: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    other: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" /></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function TaskEditor({ task, onSave, onCancel }: {
  task: ChecklistTask | null;
  onSave: (draft: ChecklistDraft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [category, setCategory] = useState<ChecklistCategory>(task?.category ?? "personal");
  const [error, setError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => { titleInput.current?.focus(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("Enter a task name."); titleInput.current?.focus(); return; }
    try { onSave({ title: title.trim(), notes: notes.trim(), category }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this task."); }
  }

  return (
    <form className="checklist-editor" onSubmit={submit} aria-label={task ? "Edit checklist task" : "New checklist task"}>
      <h3>{task ? "Edit task" : "New task"}</h3>
      <label>Task<input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What do you need to do?" maxLength={200} required /></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as ChecklistCategory)}>
        {CHECKLIST_CATEGORIES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label className="checklist-editor-notes">Note <span>(optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a little detail…" maxLength={2000} rows={2} /></label>
      {error && <p className="checklist-error" role="alert">{error}</p>}
      <div className="checklist-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="checklist-primary" type="submit">{task ? "Save changes" : "Add task"}</button>
      </div>
    </form>
  );
}

export function PersonalChecklistPanel({ month, monthLabel, entry, onChange }: {
  month: string;
  monthLabel: string;
  entry?: ChecklistEntry;
  onChange: (month: string, mutation: ChecklistMutation) => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [editor, setEditor] = useState<{ task: ChecklistTask | null } | null>(null);
  const [deletedTask, setDeletedTask] = useState<ChecklistTask | null>(null);
  const [error, setError] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const tasks = (entry?.tasks ?? []).filter((task) => !task.deleted);
  const done = tasks.filter((task) => task.done).length;
  const visible = tasks.filter((task) => filter === "all" || task.done === (filter === "done"));
  const status = entry?.status ?? "loading";
  const statusText = status === "synced" ? "Saved online" : status === "saving" ? "Saving…" : status === "loading" ? "Connecting…"
    : entry?.locallySaved ? "Offline · saved on this device" : "Not saved · keep this page open";

  function change(mutation: ChecklistMutation) {
    onChange(month, mutation);
    setError("");
  }

  function update(task: ChecklistTask, changes: Extract<ChecklistMutation, { taskId: string }>["changes"]) {
    try { change({ id: crypto.randomUUID(), taskId: task.id, changes }); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this task."); return false; }
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => (editorTrigger.current?.isConnected ? editorTrigger.current : addButton.current)?.focus());
  }

  function save(draft: ChecklistDraft) {
    if (editor?.task) {
      change({ id: crypto.randomUUID(), taskId: editor.task.id, changes: draft });
    } else {
      change({ id: crypto.randomUUID(), task: { ...draft, id: crypto.randomUUID(), done: false, deleted: false, createdAt: new Date().toISOString() } });
      setFilter("all");
    }
    closeEditor();
  }

  return (
    <section className="personal-checklist" aria-label={`Personal checklist for ${monthLabel}`}>
      <div className="checklist-heading">
        <div><p className="checklist-eyebrow">Personal checklist</p><h2>{monthLabel}</h2></div>
        <button ref={addButton} className="checklist-add checklist-primary" type="button" onClick={(event) => {
          editorTrigger.current = event.currentTarget;
          setEditor({ task: null });
        }} aria-label="Add checklist task" aria-expanded={Boolean(editor)}><Icon name="plus" /><span>Add task</span></button>
      </div>
      <div className="checklist-summary"><span>{done} / {tasks.length} done</span><span className="checklist-save-status" role="status">{statusText}</span></div>
      <div className="checklist-progress" role="progressbar" aria-label="Checklist completion" aria-valuemin={0} aria-valuemax={tasks.length || 1} aria-valuenow={done}>
        <span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} />
      </div>
      <div className="checklist-filters" role="group" aria-label="Filter checklist tasks">
        {(["all", "pending", "done"] as const).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
          {value === "all" ? "All" : value === "pending" ? "Pending" : "Done"}<span>{value === "all" ? tasks.length : value === "pending" ? tasks.length - done : done}</span>
        </button>)}
      </div>
      {editor && <TaskEditor key={editor.task?.id ?? "new"} task={editor.task} onSave={save} onCancel={closeEditor} />}
      {error && <p role="alert" className="checklist-error">{error}</p>}
      {deletedTask && <div className="checklist-undo" role="status"><span>Deleted “{deletedTask.title}”</span><button type="button" onClick={() => {
        if (update(deletedTask, { deleted: false })) setDeletedTask(null);
      }}>Undo</button></div>}
      {!tasks.length && <p className="checklist-empty">Your month, one task at a time. Tap <strong>Add task</strong> to start.</p>}
      {tasks.length > 0 && !visible.length && <p className="checklist-empty">{filter === "pending" ? "All done! No pending tasks." : "No completed tasks yet."}</p>}
      <div className="checklist-groups">
        {CHECKLIST_CATEGORIES.map(({ id, label }) => {
          const groupTasks = tasks.filter((task) => task.category === id);
          const shown = visible.filter((task) => task.category === id);
          if (!shown.length && (tasks.length > 0 || filter !== "all")) return null;
          return <section className="checklist-group" aria-label={`${label} tasks`} key={id}>
            <div className="checklist-group-heading"><span className="checklist-category-icon"><Icon name={id} /></span><div><h3>{label}</h3><p>{groupTasks.filter((task) => task.done).length} / {groupTasks.length} done</p></div></div>
            {shown.length ? <ul className="checklist-tasks">{shown.map((task) => <li className={`checklist-task${task.done ? " is-done" : ""}`} key={task.id}>
              <input className="checklist-checkbox" type="checkbox" checked={task.done} onChange={(event) => update(task, { done: event.target.checked })} aria-label={`Mark ${task.title} as ${task.done ? "pending" : "done"}`} />
              <div className="checklist-task-copy"><strong>{task.title}</strong>{task.notes && <p>{task.notes}</p>}</div>
              <span className="checklist-task-status">{task.done ? "Done" : "Pending"}</span>
              <div className="checklist-task-actions">
                <button type="button" aria-label={`Edit ${task.title}`} onClick={(event) => { editorTrigger.current = event.currentTarget; setEditor({ task }); }}><Icon name="edit" /></button>
                <button type="button" className="checklist-delete" aria-label={`Delete ${task.title}`} onClick={() => {
                  if (update(task, { deleted: true })) { setDeletedTask(task); addButton.current?.focus(); }
                }}><Icon name="delete" /></button>
              </div>
            </li>)}</ul> : <p className="checklist-group-empty">No tasks yet</p>}
          </section>;
        })}
      </div>
    </section>
  );
}
