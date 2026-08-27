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
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 15_000);
    return () => {
      active = false;
      client.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    currentMonth.current = workMonth;
    void client.current?.refresh(workMonth);
  }, [workMonth]);

  const save = useCallback((month: string, draft: SalaryReceiptDraft) => client.current?.save(month, draft), []);
  const retry = useCallback(() => void client.current?.refresh(currentMonth.current), []);
  return { entry: entries[workMonth], save, retry };
}
