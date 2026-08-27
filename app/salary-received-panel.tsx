"use client";

import { useState, type FormEvent } from "react";
import { compareSalary, isSalaryCents, parseSalaryCents, type SalaryReceiptDraft } from "./salary-receipts";
import type { SalaryReceiptEntry } from "./salary-receipts-sync";

function amount(cents: number, visible: boolean) {
  return visible ? `SAR ${new Intl.NumberFormat("en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}` : "••••••";
}

export function SalaryReceivedPanel({
  className, workMonth, monthLabel, payMonthLabel, expectedSalary, entry, visible, onToggleVisibility, onSave, onRetry,
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
  onRetry: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const receipt = entry?.pending ?? entry?.receipt;
  const showForm = editing || !receipt;
  const comparison = receipt ? compareSalary(receipt.receivedCents, receipt.expectedCents) : null;
  const loading = !entry || entry.status === "loading";
  const saved = entry?.status === "synced" && !entry.pending;
  const expectedChanged = receipt && receipt.expectedCents !== Math.round(expectedSalary * 100);

  function save(event: FormEvent) {
    event.preventDefault();
    const receivedCents = parseSalaryCents(input);
    if (receivedCents === null) {
      setError("Enter a valid amount of zero or more, with up to 2 decimal places.");
      return;
    }
    const expectedCents = Math.round(expectedSalary * 100);
    if (!isSalaryCents(expectedCents)) {
      setError("Check the salary forecast settings before saving.");
      return;
    }
    onSave(workMonth, { receivedCents, expectedCents });
    setInput("");
    setError("");
    setEditing(false);
  }

  function edit() {
    setInput(receipt ? (receipt.receivedCents / 100).toFixed(2) : "");
    setError("");
    setEditing(true);
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

      {showForm && (
        <form onSubmit={save} className="salary-received-form">
          <label className="field">
            <span>{receipt ? "Update" : "Add"} received salary for {payMonthLabel}</span>
            <span className="salary-received-input">
              <span aria-hidden="true">SAR</span>
              <input type="text" inputMode="decimal" autoComplete="off" maxLength={12}
                aria-label={`Salary received in ${payMonthLabel} (SAR)`} aria-invalid={Boolean(error)}
                placeholder="0.00" value={input} onChange={(event) => { setInput(event.target.value); setError(""); }} />
            </span>
          </label>
          <p className="salary-received-note">Expected salary: {amount(Math.round(expectedSalary * 100), visible)}</p>
          {error && <p className="salary-received-error" role="alert">{error}</p>}
          <div className="salary-received-actions">
            <button type="submit" className="primary-button" disabled={loading}>Save salary</button>
            {receipt && <button type="button" className="secondary-button" onClick={() => { setEditing(false); setInput(""); setError(""); }}>Cancel</button>}
          </div>
        </form>
      )}

      {receipt && comparison && !showForm && (
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
          {expectedChanged && <p className="salary-received-note">The current forecast has changed. Edit and save again to update the comparison.</p>}
          <button type="button" className="secondary-button salary-received-edit" onClick={edit}>Edit received salary</button>
        </>
      )}

      <p className="salary-received-sync" role="status">
        {loading ? "Loading saved salary…" : entry?.status === "conflict"
          ? "Changed on another device. Your entry is kept here; edit and save again to confirm it."
          : saved ? (receipt ? "Saved online · available on other devices" : "Ready to save online")
          : entry?.status === "saving" ? "Saving salary online…"
          : entry?.pending ? (entry.locallySaved ? "Saved on this device · waiting to sync online" : "Not saved yet. Keep this page open and retry.")
          : "Offline · showing the last saved copy"}
      </p>
      {entry?.status === "conflict" && entry.receipt && (
        <p className="salary-received-note">Latest online received amount: {amount(entry.receipt.receivedCents, visible)}</p>
      )}
      {entry?.status === "offline" && <button type="button" className="secondary-button" onClick={onRetry}>Retry sync</button>}
      <p className="salary-received-privacy">Shared calendar: anyone with this site link can view saved salaries.</p>
    </section>
  );
}
