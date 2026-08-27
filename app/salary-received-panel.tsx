"use client";

import { useState } from "react";
import { compareSalary, isSalaryCents, parseSalaryCents, type SalaryReceiptDraft } from "./salary-receipts";
import type { SalaryReceiptEntry } from "./salary-receipts-sync";

function amount(cents: number, visible: boolean) {
  return visible ? `SAR ${new Intl.NumberFormat("en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}` : "••••••";
}

export function SalaryReceivedPanel({
  className, workMonth, monthLabel, payMonthLabel, expectedSalary, entry, visible, onToggleVisibility, onSave, onBlur,
}: {
  className: string;
  workMonth: string;
  monthLabel: string;
  payMonthLabel: string;
  expectedSalary: number;
  entry?: SalaryReceiptEntry;
  visible: boolean;
  onToggleVisibility: () => void;
  onSave: (month: string, draft: SalaryReceiptDraft) => void;
  onBlur: (month: string) => void;
}) {
  const [input, setInput] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const receipt = entry?.pending ?? entry?.receipt;
  const inputValue = input ?? (receipt ? (receipt.receivedCents / 100).toFixed(2) : "");
  const inputHidden = Boolean(receipt && !visible && !focused);
  const comparison = receipt ? compareSalary(receipt.receivedCents, receipt.expectedCents) : null;
  const loading = !entry || entry.status === "loading";
  const saved = entry?.status === "synced" && !entry.pending;
  const expectedChanged = receipt && receipt.expectedCents !== Math.round(expectedSalary * 100);

  function change(value: string) {
    setInput(value);
    setError("");
    if (!value.trim()) return;
    const receivedCents = parseSalaryCents(value);
    if (receivedCents === null) {
      setError("Enter an amount of zero or more with up to 2 decimal places. The last valid amount is unchanged.");
      return;
    }
    const expectedCents = Math.round(expectedSalary * 100);
    if (!isSalaryCents(expectedCents)) {
      setError("Check the salary forecast settings before entering an amount.");
      return;
    }
    onSave(workMonth, { receivedCents, expectedCents });
  }

  return (
    <section className={`salary-received-panel ${className}`} aria-label={`${payMonthLabel} salary received`}>
      <div className="salary-received-heading">
        <div>
          <p className="eyebrow">Salary received</p>
          <h2>{payMonthLabel}</h2>
          <p>For your {monthLabel} work calendar</p>
        </div>
        <button type="button" className="salary-visibility-toggle" onClick={onToggleVisibility}
          aria-label={visible ? "Hide received salary amounts" : "Show received salary amounts"} aria-pressed={visible}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="2.5" />
            {!visible && <path d="m4 4 16 16" />}
          </svg>
        </button>
      </div>

      <div className="salary-received-form">
        <label className="field">
          <span>Received salary for {payMonthLabel}</span>
          <span className="salary-received-input">
            <span aria-hidden="true">SAR</span>
            <input type="text" inputMode="decimal" autoComplete="off" maxLength={12}
              aria-label={`Salary received in ${payMonthLabel} (SAR)`} aria-invalid={Boolean(error)}
              placeholder={inputHidden ? "••••••" : "0.00"} value={inputHidden ? "" : inputValue}
              onChange={(event) => change(event.target.value)}
              onFocus={() => { setFocused(true); setInput(inputValue); }}
              onBlur={() => { onBlur(workMonth); setFocused(false); setInput(null); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          </span>
        </label>
        <p className="salary-received-note">Saves and syncs automatically after you stop typing.</p>
        {!receipt && <p className="salary-received-note">Expected salary: {amount(Math.round(expectedSalary * 100), visible)}</p>}
        {error && <p className="salary-received-error" role="alert">{error}</p>}
      </div>

      {receipt && comparison && (
        <>
          <dl className="salary-received-values">
            <div><dt>Received salary</dt><dd aria-label={visible ? undefined : "Salary amount hidden"}>{amount(receipt.receivedCents, visible)}</dd></div>
            <div><dt>Expected at save</dt><dd aria-label={visible ? undefined : "Salary amount hidden"}>{amount(receipt.expectedCents, visible)}</dd></div>
          </dl>
          <div className={`salary-comparison salary-comparison-${comparison.status.toLowerCase()}`} role="status">
            <strong>{comparison.status}</strong>
            <span>{comparison.status === "Match" ? "Matches expected salary" : `${amount(Math.abs(comparison.differenceCents), visible)} ${comparison.status === "Short" ? "below" : "above"} expected`}</span>
          </div>
          <p className="salary-received-note">Compared with the {monthLabel} forecast saved with this amount.</p>
          {expectedChanged && <p className="salary-received-note">The forecast has changed. Re-enter the received amount to update the comparison.</p>}
        </>
      )}

      <p className="salary-received-sync" role="status">
        {loading ? "Loading saved salary…" : entry?.status === "conflict"
          ? "Changed on another device. Your entry is kept here; re-enter the amount to confirm your change."
          : saved ? (receipt ? "Saved online · available on other devices" : "Ready to save automatically")
          : entry?.status === "saving" ? "Saving salary automatically…"
          : entry?.pending ? (entry.locallySaved ? "Saved on this device · sync will retry automatically" : "Not saved yet. Keep this page open; sync will retry automatically.")
          : "Sync unavailable · retrying automatically"}
      </p>
      {entry?.status === "conflict" && entry.receipt && (
        <p className="salary-received-note">Latest online received amount: {amount(entry.receipt.receivedCents, visible)}</p>
      )}
      <p className="salary-received-privacy">Shared calendar: anyone with this site link can view saved salaries.</p>
    </section>
  );
}
