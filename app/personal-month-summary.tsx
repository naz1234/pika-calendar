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
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
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

function sameEvents(a: PersonalEvent[], b: PersonalEvent[]) {
  if (a.length !== b.length) return false;
  return a.every((event, index) => JSON.stringify(event) === JSON.stringify(b[index]));
}

export function PersonalMonthSummary() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [events, setEvents] = useState<PersonalEvent[]>([]);

  useEffect(() => {
    const refresh = () => {
      const details = document.querySelector<HTMLElement>(".personal-day-details");
      const monthInput = document.querySelector<HTMLInputElement>(".month-title-input");
      const nextMonth = monthInput?.value ?? "";
      const nextEvents = parseEvents();

      setTarget((current) => (current === details ? current : details));
      setMonthKey((current) => (current === nextMonth ? current : nextMonth));
      setEvents((current) => (sameEvents(current, nextEvents) ? current : nextEvents));
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
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

  const [year, month] = monthKey.split("-").map(Number);

  return createPortal(
    <section
      aria-label={`Personal summary for ${monthKey}`}
      style={{
        marginTop: 16,
        padding: "15px 15px 17px",
        border: "1px solid rgba(47, 111, 78, 0.28)",
        borderRadius: 19,
        background: "linear-gradient(145deg, rgba(247, 250, 239, 0.98), rgba(241, 247, 232, 0.94))",
        boxShadow: "0 10px 24px rgba(32, 63, 45, 0.07)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#34704d" }}>
            Personal summary
          </p>
          <h3 style={{ margin: "4px 0 0", fontSize: 22, lineHeight: 1.15, color: "#203449" }}>
            {new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1))}
          </h3>
        </div>
        <span style={{ flexShrink: 0, padding: "6px 9px", borderRadius: 999, background: "#e2f0df", color: "#2d6849", fontSize: 11, fontWeight: 800 }}>
          {monthEvents.length} {monthEvents.length === 1 ? "event" : "events"}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div style={{ padding: "15px 14px", borderRadius: 15, background: "rgba(255,255,255,0.62)", color: "#6d786f", fontSize: 14 }}>
          No Personal events this month.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {grouped.map(([date, dayEvents]) => (
            <div key={date} style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 12, alignItems: "start", minHeight: 62, padding: "14px 14px", borderRadius: 17, background: "rgba(255,255,255,0.72)", border: "1px solid rgba(69, 100, 77, 0.12)" }}>
              <strong style={{ color: "#63706a", fontSize: 13, paddingTop: 2 }}>{formatDay(date)}</strong>
              <div style={{ display: "grid", gap: 8 }}>
                {dayEvents.map((event) => (
                  <div key={event.id} style={{ minWidth: 0 }}>
                    <div style={{ color: "#203449", fontSize: 15, fontWeight: 750, lineHeight: 1.3, overflowWrap: "anywhere" }}>{event.title}</div>
                    <div style={{ marginTop: 3, color: "#718078", fontSize: 12 }}>{eventTime(event)}</div>
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
