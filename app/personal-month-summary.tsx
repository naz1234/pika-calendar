"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type PersonalEvent = {
  id: string;
  calendar: "work" | "personal";
  title: string;
  date: string;
  endDate?: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  endsNextDay?: boolean;
};

const STORAGE_KEY = "daymark-calendar-v1";

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseEvents() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [] as PersonalEvent[];
    return stored.filter((event): event is PersonalEvent =>
      Boolean(event) &&
      event.calendar === "personal" &&
      typeof event.id === "string" &&
      typeof event.title === "string" &&
      isValidDate(event.date) &&
      (event.endDate === undefined || isValidDate(event.endDate)) &&
      typeof event.allDay === "boolean" &&
      typeof event.startTime === "string" &&
      typeof event.endTime === "string",
    );
  } catch {
    return [] as PersonalEvent[];
  }
}

function overlapsMonth(event: PersonalEvent, monthKey: string) {
  const monthStart = `${monthKey}-01`;
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const end = event.endDate ?? event.date;
  return event.date <= monthEnd && end >= monthStart;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hour, minute));
}

function eventTime(event: PersonalEvent) {
  if (event.allDay) return "All day";
  if (!event.startTime) return "Time not set";
  const end = event.endTime ? `–${formatTime(event.endTime)}` : "";
  return `${formatTime(event.startTime)}${end}${event.endsNextDay ? " (+1 day)" : ""}`;
}

export function PersonalMonthSummary() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [events, setEvents] = useState<PersonalEvent[]>([]);

  useEffect(() => {
    const refresh = () => {
      const details = document.querySelector<HTMLElement>(".personal-day-details");
      const monthInput = document.querySelector<HTMLInputElement>(".month-title-input");
      setTarget(details);
      setMonthKey(monthInput?.value ?? "");
      setEvents(parseEvents());
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "class"] });
    const timer = window.setInterval(refresh, 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const monthEvents = useMemo(() => {
    if (!monthKey) return [];
    return events
      .filter((event) => overlapsMonth(event, monthKey))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [events, monthKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, PersonalEvent[]>();
    monthEvents.forEach((event) => {
      const existing = map.get(event.date) ?? [];
      existing.push(event);
      map.set(event.date, existing);
    });
    return [...map.entries()];
  }, [monthEvents]);

  if (!target || !monthKey) return null;

  return createPortal(
    <section
      aria-label={`Personal summary for ${monthKey}`}
      style={{
        marginTop: 18,
        padding: "18px 18px 20px",
        border: "1px solid rgba(47, 111, 78, 0.28)",
        borderRadius: 22,
        background: "linear-gradient(145deg, rgba(247, 250, 239, 0.98), rgba(241, 247, 232, 0.94))",
        boxShadow: "0 14px 32px rgba(32, 63, 45, 0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "#34704d" }}>
            Personal summary
          </p>
          <h3 style={{ margin: "5px 0 0", fontSize: 24, lineHeight: 1.15, color: "#203449" }}>
            {new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(`${monthKey}-01T00:00:00`))}
          </h3>
        </div>
        <span style={{ flexShrink: 0, padding: "7px 10px", borderRadius: 999, background: "#e2f0df", color: "#2d6849", fontSize: 12, fontWeight: 800 }}>
          {monthEvents.length} {monthEvents.length === 1 ? "event" : "events"}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div style={{ padding: "16px 14px", borderRadius: 16, background: "rgba(255,255,255,0.62)", color: "#6d786f", fontSize: 14 }}>
          No Personal events this month.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {grouped.map(([date, dayEvents]) => (
            <div key={date} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, alignItems: "start", padding: "11px 12px", borderRadius: 15, background: "rgba(255,255,255,0.68)", border: "1px solid rgba(69, 100, 77, 0.12)" }}>
              <strong style={{ color: "#63706a", fontSize: 13, paddingTop: 2 }}>{formatDay(date)}</strong>
              <div style={{ display: "grid", gap: 7 }}>
                {dayEvents.map((event) => (
                  <div key={event.id} style={{ minWidth: 0 }}>
                    <div style={{ color: "#203449", fontSize: 15, fontWeight: 750, lineHeight: 1.25, overflowWrap: "anywhere" }}>{event.title}</div>
                    <div style={{ marginTop: 2, color: "#718078", fontSize: 12 }}>{eventTime(event)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>,
    target,
  );
}
