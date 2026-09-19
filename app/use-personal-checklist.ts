"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChecklistMutation } from "./personal-checklist";
import { PersonalChecklistSync, type ChecklistEntry } from "./personal-checklist-sync";

export function usePersonalChecklist(month: string) {
  const [entries, setEntries] = useState<Record<string, ChecklistEntry>>({});
  const client = useRef<PersonalChecklistSync | null>(null);
  const currentMonth = useRef(month);

  useEffect(() => {
    let active = true;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Cloud saving remains available. */ }
    const sync = new PersonalChecklistSync(storage, (next) => { if (active) setEntries(next); });
    client.current = sync;
    const refresh = () => void sync.refresh(currentMonth.current);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(visible, 15_000);
    return () => {
      active = false;
      client.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    currentMonth.current = month;
    void client.current?.refresh(month);
  }, [month]);

  const change = useCallback((targetMonth: string, mutation: ChecklistMutation) => {
    if (!client.current) throw new Error("Checklist is still loading. Try again in a moment.");
    void client.current.change(targetMonth, mutation);
  }, []);
  return { entry: entries[month], change };
}
