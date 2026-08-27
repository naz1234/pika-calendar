"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SalaryReceiptDraft } from "./salary-receipts";
import { SalaryReceiptSync, type SalaryReceiptEntry } from "./salary-receipts-sync";

export function useSalaryReceipts(workMonth: string) {
  const [entries, setEntries] = useState<Record<string, SalaryReceiptEntry>>({});
  const client = useRef<SalaryReceiptSync | null>(null);
  const currentMonth = useRef(workMonth);

  useEffect(() => {
    let active = true;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Cloud saving still works. */ }
    const sync = new SalaryReceiptSync(storage, (next) => { if (active) setEntries(next); });
    client.current = sync;
    const refresh = () => void sync.refresh(currentMonth.current);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const flush = () => void sync.flush();
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 15_000);
    return () => {
      active = false;
      flush();
      client.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    currentMonth.current = workMonth;
    void client.current?.refresh(workMonth);
    return () => { void client.current?.flush(workMonth); };
  }, [workMonth]);

  const save = useCallback((month: string, draft: SalaryReceiptDraft) => client.current?.autosave(month, draft), []);
  const flush = useCallback((month: string) => void client.current?.flush(month), []);
  return { entry: entries[workMonth], save, flush };
}
