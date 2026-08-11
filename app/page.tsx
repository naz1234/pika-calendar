/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- modal containers trap Tab focus */
"use client";

import {
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SHARED_SYNC_SECRET,
  SyncConflictError,
  decryptCalendarEvents,
  fetchRemoteCalendar,
  mergeSharedCalendarEvents,
  saveRemoteCalendar,
} from "./calendar-sync";
import {
  ROSTER_CHOICE_OPTIONS,
  choiceToEvent,
  inferRosterChoice,
  makeDateKey as makeRosterDateKey,
  makeMonthKey,
  mobileEventCode,
  normalizeRosterCode,
  rosterShiftRunPosition,
  rosterShiftTone,
  type RosterChoice,
} from "./roster-domain";
import {
  eventDisplayRemark,
  mergeRosterMonthEvents,
  type CalendarEventRecord,
  type CalendarKind,
} from "./roster-merge";
import type { RosterBarKind, RosterProgress } from "./roster-reader";
import {
  calculateMonthlyExpectedSalary,
  countMonthlyWorkShifts,
  type MonthlySalaryForecast,
  type MonthlyShiftSummary as MonthlyShiftCounts,
} from "./shift-summary";

type Theme = "dark" | "light";
type CalendarEvent = CalendarEventRecord;
type SyncStatus = "connecting" | "synced" | "offline";

type EventDraft = Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "source">;

type RosterReviewRow = {
  day: number;
  rawCode: string;
  times: string[];
  barKind: RosterBarKind;
  confidence: number;
  choice: RosterChoice | "";
  warning: string;
};

type RosterDialogState = {
  stage: "reading" | "review" | "error";
  fileName: string;
  fileKind: "image" | "pdf";
  previewUrl: string;
  progress: RosterProgress;
  error: string;
  year?: number;
  monthIndex?: number;
  rows: RosterReviewRow[];
};

const STORAGE_KEY = "daymark-calendar-v1";
const SETTINGS_KEY = "daymark-settings-v1";
const SHARED_SYNC_MIGRATION_KEY = "daymark-shared-sync-migrated-v2";
const STATIC_DATE = new Date(2000, 0, 1);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function isoWeekNumber(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function monthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function eventTimeLabel(event: CalendarEvent) {
  if (event.allDay) return "All day";
  if (!event.startTime) return "Time not set";
  const formatTime = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(2020, 0, 1, hour, minute));
  };
  const end = event.endTime ? `–${formatTime(event.endTime)}` : "";
  return `${formatTime(event.startTime)}${end}${event.endsNextDay ? " (+1 day)" : ""}`;
}

function shiftToneClass(title: string) {
  const tone = rosterShiftTone(title);
  return tone ? ` shift-event shift-${tone}` : "";
}

function eventShiftClass(event: CalendarEvent) {
  return event.calendar === "work" ? shiftToneClass(event.title) : "";
}

function formatSar(value: number) {
  return new Intl.NumberFormat("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function MonthlyShiftSummary({
  className,
  monthLabel,
  salaryMonthLabel,
  summary,
  salaryForecast,
}: {
  className: string;
  monthLabel: string;
  salaryMonthLabel: string;
  summary: MonthlyShiftCounts;
  salaryForecast: MonthlySalaryForecast;
}) {
  return (
    <section className={`monthly-shift-summary ${className}`} aria-label={`${monthLabel} Work shift summary`}>
      <div className="monthly-summary-heading">
        <div>
          <p className="eyebrow">Monthly Work summary</p>
          <h2>{monthLabel}</h2>
        </div>
        <span>3 categories</span>
      </div>
      <dl className="monthly-summary-counts">
        <div className="monthly-summary-stat summary-night">
          <dt>
            <span className="summary-stat-icon" aria-hidden="true">N</span>
            <span className="summary-stat-label">Night shifts<small>Regular Night</small></span>
          </dt>
          <dd>{summary.night}</dd>
        </div>
        <div className="monthly-summary-stat summary-extension">
          <dt>
            <span className="summary-stat-icon" aria-hidden="true">EX</span>
            <span className="summary-stat-label">Extensions<small>All shift types</small></span>
          </dt>
          <dd>{summary.extensions}</dd>
        </div>
        <div className="monthly-summary-stat summary-rdot">
          <dt>
            <span className="summary-stat-icon" aria-hidden="true">OT</span>
            <span className="summary-stat-label">RDOT<small>Rest-day overtime</small></span>
          </dt>
          <dd>{summary.rdot}</dd>
        </div>
      </dl>
      <div className="monthly-salary-card">
        <div className="monthly-salary-title">
          <span className="monthly-salary-icon" aria-hidden="true">SAR</span>
          <span>Expected salary<small>{salaryMonthLabel} pay forecast</small></span>
        </div>
        <strong className="monthly-salary-amount">SAR {formatSar(salaryForecast.expectedSalary)}</strong>
        <div className="monthly-salary-breakdown" aria-label="Expected salary breakdown">
          <span>Salary + laundry<strong>SAR {formatSar(salaryForecast.salaryWithLaundry)}</strong></span>
          <span>Night allowance<strong>SAR {formatSar(salaryForecast.nightAllowance)}</strong></span>
          <span>{salaryForecast.overtimeHours.toFixed(1)} overtime hours<strong>SAR {formatSar(salaryForecast.expectedOvertime)}</strong></span>
        </div>
      </div>
    </section>
  );
}

function sortEvents(a: CalendarEvent, b: CalendarEvent) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.startTime.localeCompare(b.startTime);
}

function validImportedEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CalendarEvent>;
  const dateIsReal =
    /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? "") &&
    dateKey(parseDateKey(item.date ?? "")) === item.date;
  const validTime = (time: string | undefined) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "");
  const timestampsAreReal =
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    Number.isFinite(Date.parse(item.updatedAt));
  const sourceIsValid =
    item.source === undefined ||
    (
      item.source !== null &&
      typeof item.source === "object" &&
      item.source.type === "roster-image" &&
      /^\d{4}-\d{2}$/.test(item.source.rosterMonth) &&
      typeof item.source.key === "string" && item.source.key.length > 0 &&
      typeof item.source.rawCode === "string"
    );
  return (
    typeof item.id === "string" && item.id.trim().length > 0 &&
    (item.calendar === "work" || item.calendar === "personal") &&
    typeof item.title === "string" && item.title.trim().length > 0 &&
    dateIsReal &&
    typeof item.allDay === "boolean" &&
    typeof item.startTime === "string" &&
    typeof item.endTime === "string" &&
    (item.allDay || (validTime(item.startTime) && validTime(item.endTime))) &&
    (item.endsNextDay === undefined || typeof item.endsNextDay === "boolean") &&
    typeof item.notes === "string" &&
    timestampsAreReal &&
    sourceIsValid
  );
}

function cleanCalendarEvents(value: unknown) {
  if (!Array.isArray(value)) return null;
  const clean = value.filter(validImportedEvent);
  if (clean.length !== value.length || new Set(clean.map((event) => event.id)).size !== clean.length) {
    return null;
  }
  return clean;
}

function markSharedMigrationComplete() {
  try {
    localStorage.setItem(SHARED_SYNC_MIGRATION_KEY, "1");
  } catch {
    // Sync remains available when a browser blocks local storage.
  }
}

export default function Home() {
  const [now, setNow] = useState(STATIC_DATE);
  const todayKey = dateKey(now);
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [activeCalendar, setActiveCalendar] = useState<CalendarKind>("work");
  const [theme, setTheme] = useState<Theme>("dark");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [syncReady, setSyncReady] = useState(false);
  const [syncRetry, setSyncRetry] = useState(0);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<{ id?: string; draft: EventDraft } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [rosterDialog, setRosterDialog] = useState<RosterDialogState | null>(null);
  const pointerStart = useRef<number | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const rosterInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const rosterCloseButton = useRef<HTMLButtonElement>(null);
  const rosterRun = useRef(0);
  const rosterReaderBusy = useRef(false);
  const eventsRef = useRef<CalendarEvent[]>([]);
  const syncVersion = useRef(0);
  const lastSyncedEvents = useRef("");
  const syncWriteBusy = useRef(false);
  const sharedMigrationPending = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const editorTitleInput = useRef<HTMLInputElement>(null);
  const menuCloseButton = useRef<HTMLButtonElement>(null);
  const editorIsOpen = editor !== null;

  const closeRosterDialog = useCallback(() => {
    rosterRun.current += 1;
    setRosterDialog((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    requestAnimationFrame(() => menuTrigger.current?.focus());
  }, []);

  const connectToSync = useCallback(async (localEvents: CalendarEvent[], shouldMigrateLocal: boolean) => {
    setSyncReady(false);
    setSyncStatus("connecting");
    sharedMigrationPending.current = shouldMigrateLocal && localEvents.length > 0;
    try {
      let remote = await fetchRemoteCalendar();
      let nextEvents = localEvents;
      if (remote) {
        const decrypted = await decryptCalendarEvents(SHARED_SYNC_SECRET, remote.payload);
        const clean = cleanCalendarEvents(decrypted);
        if (!clean) throw new Error("The synced calendar data is invalid.");
        const remoteSerialized = JSON.stringify(clean);
        nextEvents = shouldMigrateLocal ? mergeSharedCalendarEvents(clean, localEvents) : clean;
        syncVersion.current = remote.version;
        lastSyncedEvents.current = remoteSerialized;
        sharedMigrationPending.current = shouldMigrateLocal && JSON.stringify(nextEvents) !== remoteSerialized;
        if (shouldMigrateLocal && !sharedMigrationPending.current) {
          markSharedMigrationComplete();
        }
      } else {
        try {
          const saved = await saveRemoteCalendar(localEvents, 0);
          syncVersion.current = saved.version;
          lastSyncedEvents.current = JSON.stringify(localEvents);
          markSharedMigrationComplete();
          sharedMigrationPending.current = false;
        } catch (error) {
          if (!(error instanceof SyncConflictError)) throw error;
          remote = await fetchRemoteCalendar();
          if (!remote) throw error;
          const decrypted = await decryptCalendarEvents(SHARED_SYNC_SECRET, remote.payload);
          const clean = cleanCalendarEvents(decrypted);
          if (!clean) throw new Error("The synced calendar data is invalid.");
          const remoteSerialized = JSON.stringify(clean);
          nextEvents = shouldMigrateLocal ? mergeSharedCalendarEvents(clean, localEvents) : clean;
          syncVersion.current = remote.version;
          lastSyncedEvents.current = remoteSerialized;
          sharedMigrationPending.current = shouldMigrateLocal && JSON.stringify(nextEvents) !== remoteSerialized;
          if (shouldMigrateLocal && !sharedMigrationPending.current) {
            markSharedMigrationComplete();
          }
        }
      }
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSyncReady(true);
      setSyncStatus("synced");
      return true;
    } catch {
      setSyncReady(true);
      setSyncStatus("offline");
      return false;
    }
  }, []);

  const days = useMemo(() => monthDays(view.year, view.month), [view]);
  const visibleEvents = useMemo(
    () => events.filter((event) => event.calendar === activeCalendar),
    [events, activeCalendar],
  );
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    visibleEvents.forEach((event) => {
      const current = grouped.get(event.date) ?? [];
      current.push(event);
      grouped.set(event.date, current.sort(sortEvents));
    });
    return grouped;
  }, [visibleEvents]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(view.year, view.month, 1));
  const selectedLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parseDateKey(selectedDate));
  const monthlyShiftSummary = useMemo(
    () => countMonthlyWorkShifts(events, `${view.year}-${pad(view.month + 1)}`),
    [events, view.month, view.year],
  );
  const monthlySalaryForecast = useMemo(
    () => calculateMonthlyExpectedSalary(events, `${view.year}-${pad(view.month + 1)}`),
    [events, view.month, view.year],
  );
  const salaryMonthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(view.year, view.month + 1, 1));

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleEvents
      .filter((event) => {
        if (!query) return event.date >= todayKey;
        return `${event.title} ${event.notes}`.toLowerCase().includes(query);
      })
      .sort(sortEvents)
      .slice(0, 12);
  }, [searchQuery, todayKey, visibleEvents]);

  const rosterSummary = useMemo(() => {
    if (rosterDialog?.stage !== "review") return [];
    const counts = new Map<string, number>();
    rosterDialog.rows.forEach((row) => {
      if (!row.choice) return;
      const title = choiceToEvent(row.choice).title;
      counts.set(title, (counts.get(title) ?? 0) + 1);
    });
    return [...counts.entries()];
  }, [rosterDialog]);
  const unresolvedRosterDays = rosterDialog?.stage === "review"
    ? rosterDialog.rows.filter((row) => !row.choice).length
    : 0;
  const rosterStage = rosterDialog?.stage;
  const rosterReviewMonth = rosterDialog?.stage === "review" &&
    rosterDialog.year !== undefined && rosterDialog.monthIndex !== undefined
    ? makeMonthKey(rosterDialog.year, rosterDialog.monthIndex + 1)
    : "";
  const rosterReviewMonthLabel = rosterDialog?.stage === "review" &&
    rosterDialog.year !== undefined && rosterDialog.monthIndex !== undefined
    ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
      new Date(rosterDialog.year, rosterDialog.monthIndex, 1),
    )
    : "";
  const existingRosterCount = rosterReviewMonth
    ? events.filter((event) => event.source?.type === "roster-image" && event.source.rosterMonth === rosterReviewMonth).length
    : 0;
  const manualWorkCount = rosterReviewMonth
    ? events.filter((event) => event.calendar === "work" && !event.source && event.date.startsWith(`${rosterReviewMonth}-`)).length
    : 0;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const currentDate = new Date();
      setNow(currentDate);
      setView({ year: currentDate.getFullYear(), month: currentDate.getMonth() });
      setSelectedDate(dateKey(currentDate));
      let localEvents: CalendarEvent[] = [];
      try {
        const storedEvents = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        localEvents = cleanCalendarEvents(storedEvents) ?? [];
        eventsRef.current = localEvents;
        setEvents(localEvents);
        const storedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
        if (storedSettings.calendar === "work" || storedSettings.calendar === "personal") {
          setActiveCalendar(storedSettings.calendar);
        }
        if (storedSettings.theme === "dark" || storedSettings.theme === "light") {
          setTheme(storedSettings.theme);
        }
      } catch {
        // Ignore malformed device storage and start with a clean calendar.
      }
      setHydrated(true);

      let shouldMigrateLocal = true;
      try {
        shouldMigrateLocal = localStorage.getItem(SHARED_SYNC_MIGRATION_KEY) !== "1";
      } catch {
        // Browsers that block local storage still connect to the shared calendar.
      }
      void connectToSync(localEvents, shouldMigrateLocal);

      if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [connectToSync]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      queueMicrotask(() => {
        setToast("Events could not be saved on this device");
        setAnnouncement("Events could not be saved on this device");
      });
    }
  }, [events, hydrated]);

  useEffect(() => {
    if (!hydrated || !syncReady) return;
    const serialized = JSON.stringify(events);
    if (serialized === lastSyncedEvents.current || syncWriteBusy.current) return;

    const timeout = window.setTimeout(() => {
      const snapshot = events;
      syncWriteBusy.current = true;
      setSyncStatus("connecting");
      void (async () => {
        try {
          let saved;
          try {
            saved = await saveRemoteCalendar(snapshot, syncVersion.current);
          } catch (error) {
            if (!(error instanceof SyncConflictError)) throw error;
            if (syncVersion.current === 0) {
              const remote = await fetchRemoteCalendar();
              if (!remote) throw error;
              const decrypted = await decryptCalendarEvents(SHARED_SYNC_SECRET, remote.payload);
              const clean = cleanCalendarEvents(decrypted);
              if (!clean) throw new Error("Invalid synced calendar");
              const nextEvents = sharedMigrationPending.current
                ? mergeSharedCalendarEvents(clean, snapshot)
                : clean;
              syncVersion.current = remote.version;
              lastSyncedEvents.current = JSON.stringify(clean);
              eventsRef.current = nextEvents;
              setEvents(nextEvents);
              if (JSON.stringify(nextEvents) === lastSyncedEvents.current && sharedMigrationPending.current) {
                markSharedMigrationComplete();
                sharedMigrationPending.current = false;
              }
              setSyncStatus("synced");
              return;
            }
            syncVersion.current = error.currentVersion;
            saved = await saveRemoteCalendar(snapshot, syncVersion.current);
          }
          syncVersion.current = saved.version;
          lastSyncedEvents.current = serialized;
          if (sharedMigrationPending.current) {
            markSharedMigrationComplete();
            sharedMigrationPending.current = false;
          }
          setSyncStatus("synced");
        } catch {
          setSyncStatus("offline");
        } finally {
          syncWriteBusy.current = false;
          if (lastSyncedEvents.current !== JSON.stringify(eventsRef.current)) {
            setSyncRetry((value) => value + 1);
          }
        }
      })();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [events, hydrated, syncReady, syncRetry]);

  useEffect(() => {
    if (!syncReady) return;
    const refreshFromCloud = async () => {
      const local = JSON.stringify(eventsRef.current);
      if (syncWriteBusy.current || local !== lastSyncedEvents.current) return;
      try {
        const remote = await fetchRemoteCalendar();
        if (!remote || remote.version <= syncVersion.current) {
          setSyncStatus("synced");
          return;
        }
        const decrypted = await decryptCalendarEvents(SHARED_SYNC_SECRET, remote.payload);
        const clean = cleanCalendarEvents(decrypted);
        if (!clean) throw new Error("Invalid synced calendar");
        syncVersion.current = remote.version;
        lastSyncedEvents.current = JSON.stringify(clean);
        eventsRef.current = clean;
        setEvents(clean);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("offline");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshFromCloud();
    };
    const onOnline = () => {
      setSyncRetry((value) => value + 1);
      void refreshFromCloud();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const refreshTimer = window.setInterval(() => void refreshFromCloud(), 15_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.clearInterval(refreshTimer);
    };
  }, [syncReady]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ calendar: activeCalendar, theme }));
    } catch {
      queueMicrotask(() => {
        setToast("Preferences could not be saved");
        setAnnouncement("Preferences could not be saved");
      });
    }
    document.documentElement.dataset.theme = theme;
  }, [activeCalendar, hydrated, theme]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSearchOpen(false);
      setEditor(null);
      setAgendaOpen(false);
      if (rosterDialog) closeRosterDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeRosterDialog, rosterDialog]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!editorIsOpen) return;
    const frame = requestAnimationFrame(() => editorTitleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editorIsOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() => menuCloseButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);

  useEffect(() => {
    if (!rosterStage) return;
    const frame = requestAnimationFrame(() => rosterCloseButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [rosterStage]);

  useEffect(() => {
    let midnightTimer = 0;
    const refreshDate = () => setNow(new Date());
    const scheduleMidnightRefresh = () => {
      const current = new Date();
      const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      midnightTimer = window.setTimeout(() => {
        refreshDate();
        scheduleMidnightRefresh();
      }, nextMidnight.getTime() - current.getTime() + 1000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshDate();
    };
    scheduleMidnightRefresh();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(midnightTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    setAnnouncement(message);
  }

  function changeMonth(amount: number) {
    const next = new Date(view.year, view.month + amount, 1);
    const preferredDay = parseDateKey(selectedDate).getDate();
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    const nextSelection = new Date(next.getFullYear(), next.getMonth(), Math.min(preferredDay, lastDay));
    setView({ year: next.getFullYear(), month: next.getMonth() });
    setSelectedDate(dateKey(nextSelection));
    const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(next);
    setAnnouncement(`Showing ${label}`);
  }

  function chooseMonth(value: string) {
    const [year, month] = value.split("-").map(Number);
    if (!year || month < 1 || month > 12) return;
    const preferredDay = parseDateKey(selectedDate).getDate();
    const lastDay = new Date(year, month, 0).getDate();
    const nextSelection = new Date(year, month - 1, Math.min(preferredDay, lastDay));
    setView({ year, month: month - 1 });
    setSelectedDate(dateKey(nextSelection));
    const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(nextSelection);
    setAnnouncement(`Showing ${label}`);
  }

  function chooseDay(day: Date) {
    const key = dateKey(day);
    setSelectedDate(key);
    setAgendaOpen(true);
    if (day.getMonth() !== view.month || day.getFullYear() !== view.year) {
      setView({ year: day.getFullYear(), month: day.getMonth() });
    }
  }

  function focusDay(key: string) {
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus();
    });
  }

  function handleDayKey(event: KeyboardEvent<HTMLButtonElement>, day: Date) {
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -1;
    if (event.key === "ArrowRight") delta = 1;
    if (event.key === "ArrowUp") delta = -7;
    if (event.key === "ArrowDown") delta = 7;
    if (!delta) return;
    event.preventDefault();
    const next = addDays(day, delta);
    setSelectedDate(dateKey(next));
    if (next.getMonth() !== view.month || next.getFullYear() !== view.year) {
      setView({ year: next.getFullYear(), month: next.getMonth() });
    }
    focusDay(dateKey(next));
  }

  function openCreate(forDate = selectedDate) {
    setEditorError("");
    setEditor({
      draft: {
        calendar: activeCalendar,
        title: "",
        date: forDate,
        allDay: false,
        startTime: "09:00",
        endTime: "10:00",
        endsNextDay: false,
        notes: "",
      },
    });
    setAgendaOpen(false);
  }

  function openEdit(event: CalendarEvent) {
    setEditorError("");
    setEditor({
      id: event.id,
      draft: {
        calendar: event.calendar,
        title: event.title,
        date: event.date,
        allDay: event.allDay,
        startTime: event.startTime,
        endTime: event.endTime,
        endsNextDay: event.endsNextDay ?? false,
        notes: event.notes,
      },
    });
  }

  function saveEvent(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (!editor) return;
    const title = editor.draft.title.trim();
    if (!title) {
      setEditorError("Add a title before saving.");
      return;
    }
    if (
      !editor.draft.allDay &&
      editor.draft.endTime <= editor.draft.startTime &&
      !editor.draft.endsNextDay
    ) {
      setEditorError("The end is earlier than the start. Mark it as ending the next day.");
      return;
    }
    const timestamp = new Date().toISOString();
    if (editor.id) {
      setEvents((current) =>
        current.map((event) =>
          event.id === editor.id
            ? { ...event, ...editor.draft, title, updatedAt: timestamp }
            : event,
        ),
      );
      showToast("Event updated");
    } else {
      const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
      setEvents((current) => [
        ...current,
        { ...editor.draft, id, title, createdAt: timestamp, updatedAt: timestamp },
      ]);
      showToast("Event added");
    }
    const savedDate = editor.draft.date;
    const savedCalendar = editor.draft.calendar;
    const saved = parseDateKey(savedDate);
    setSelectedDate(savedDate);
    setActiveCalendar(savedCalendar);
    setView({ year: saved.getFullYear(), month: saved.getMonth() });
    setEditor(null);
  }

  function deleteEvent() {
    if (!editor?.id || !window.confirm("Delete this event?")) return;
    setEvents((current) => current.filter((event) => event.id !== editor.id));
    setEditor(null);
    showToast("Event deleted");
  }

  function openEventFromSearch(event: CalendarEvent) {
    const date = parseDateKey(event.date);
    setView({ year: date.getFullYear(), month: date.getMonth() });
    setSelectedDate(event.date);
    setSearchOpen(false);
    setAgendaOpen(true);
  }

  function exportBackup() {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), events }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daymark-backup-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
    showToast("Backup downloaded");
  }

  async function importBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed.events;
      if (!Array.isArray(imported)) throw new Error("Invalid backup");
      const cleanEvents = imported.filter(validImportedEvent);
      if (!cleanEvents.length && imported.length) throw new Error("Invalid backup");
      if (new Set(cleanEvents.map((event) => event.id)).size !== cleanEvents.length) {
        throw new Error("Duplicate event IDs");
      }
      if (
        events.length > 0 &&
        !window.confirm(`Replace your current ${events.length} event${events.length === 1 ? "" : "s"} with ${cleanEvents.length} from this backup?`)
      ) {
        return;
      }
      setEvents(cleanEvents);
      setMenuOpen(false);
      showToast(`${cleanEvents.length} event${cleanEvents.length === 1 ? "" : "s"} imported`);
    } catch {
      showToast("Could not import that backup");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }

  function chooseRosterFile() {
    if (rosterReaderBusy.current) {
      showToast("Finishing the previous scan. Try again in a moment.");
      return;
    }
    setActiveCalendar("work");
    rosterInput.current?.click();
  }

  async function importRosterFile(file: File) {
    if (rosterReaderBusy.current) {
      showToast("Finishing the previous scan. Try again in a moment.");
      if (rosterInput.current) rosterInput.current.value = "";
      return;
    }
    rosterReaderBusy.current = true;
    if (rosterDialog?.previewUrl) URL.revokeObjectURL(rosterDialog.previewUrl);
    const previewUrl = URL.createObjectURL(file);
    const fileKind = file.type.toLowerCase() === "application/pdf" || /\.pdf$/iu.test(file.name)
      ? "pdf"
      : "image";
    const runId = rosterRun.current + 1;
    rosterRun.current = runId;
    setMenuOpen(false);
    setActiveCalendar("work");
    setRosterDialog({
      stage: "reading",
      fileName: file.name,
      fileKind,
      previewUrl,
      progress: { label: fileKind === "pdf" ? "Opening IVU.plan PDF" : "Opening screenshot", percent: 1 },
      error: "",
      rows: [],
    });

    try {
      const readRosterFile = fileKind === "pdf"
        ? (await import("./roster-pdf-reader")).readRosterPdf
        : (await import("./roster-reader")).readRosterImage;
      const scan = await readRosterFile(
        file,
        (progress) => {
          if (rosterRun.current !== runId) return;
          setRosterDialog((current) => current && current.previewUrl === previewUrl
            ? { ...current, progress }
            : current);
        },
        () => rosterRun.current !== runId,
      );
      if (rosterRun.current !== runId) return;
      const rows = scan.observations.map((observation) => {
        const inference = inferRosterChoice(observation);
        return {
          day: observation.day,
          rawCode: normalizeRosterCode(observation.rawCode) || observation.rawCode || "Unreadable",
          times: observation.times,
          barKind: observation.barKind,
          confidence: observation.confidence,
          choice: inference.choice,
          warning: inference.warning,
        } satisfies RosterReviewRow;
      });
      setRosterDialog({
        stage: "review",
        fileName: file.name,
        fileKind,
        previewUrl,
        progress: { label: "Ready to review", percent: 100 },
        error: "",
        year: scan.year,
        monthIndex: scan.monthIndex,
        rows,
      });
      setAnnouncement(`Roster ${fileKind === "pdf" ? "PDF" : "image"} read. Review ${rows.length} days before importing.`);
    } catch (error) {
      if (rosterRun.current !== runId) return;
      const message = error instanceof Error ? error.message : "The roster file could not be read.";
      setRosterDialog({
        stage: "error",
        fileName: file.name,
        fileKind,
        previewUrl,
        progress: { label: "Could not read roster file", percent: 0 },
        error: message,
        rows: [],
      });
      setAnnouncement(message);
    } finally {
      rosterReaderBusy.current = false;
      if (rosterInput.current) rosterInput.current.value = "";
    }
  }

  function updateRosterChoice(day: number, choice: RosterChoice | "") {
    setRosterDialog((current) => {
      if (current?.stage !== "review") return current;
      return {
        ...current,
        rows: current.rows.map((row) => row.day === day
          ? { ...row, choice, warning: choice ? "" : "Choose the correct roster entry." }
          : row),
      };
    });
  }

  function applyRosterImport() {
    if (
      rosterDialog?.stage !== "review" ||
      rosterDialog.year === undefined ||
      rosterDialog.monthIndex === undefined ||
      rosterDialog.rows.some((row) => !row.choice)
    ) return;

    const year = rosterDialog.year;
    const monthIndex = rosterDialog.monthIndex;
    const rosterMonth = makeMonthKey(year, monthIndex + 1);
    const timestamp = new Date().toISOString();
    const prepared = rosterDialog.rows.map((row) => {
      const details = choiceToEvent(row.choice as RosterChoice);
      const date = makeRosterDateKey(year, monthIndex + 1, row.day);
      const key = `roster:${date}`;
      const rawCode = row.rawCode === "Unreadable" ? "Manual review" : row.rawCode;
      return { details, date, key, rawCode };
    });

    const mergeResult = mergeRosterMonthEvents(events, prepared, rosterMonth, timestamp);
    setEvents(mergeResult.events);

    setActiveCalendar("work");
    setView({ year, month: monthIndex });
    setSelectedDate(makeRosterDateKey(year, monthIndex + 1, 1));
    closeRosterDialog();
    const skipped = mergeResult.skippedManualDuplicates
      ? `; ${mergeResult.skippedManualDuplicates} matching manual event${mergeResult.skippedManualDuplicates === 1 ? " was" : "s were"} kept`
      : "";
    showToast(`${mergeResult.importedCount} Work roster event${mergeResult.importedCount === 1 ? "" : "s"} imported${skipped}`);
  }

  function clearCalendar() {
    if (!events.length || !window.confirm("Delete all Work and Personal events from the shared calendar on every device?")) return;
    setEvents([]);
    setMenuOpen(false);
    showToast("Calendar cleared");
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerStart.current = event.clientX;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointerStart.current === null) return;
    const difference = event.clientX - pointerStart.current;
    pointerStart.current = null;
    if (Math.abs(difference) < 55) return;
    changeMonth(difference > 0 ? -1 : 1);
  }

  function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!hydrated) {
    return (
      <main className="calendar-app" data-calendar="work">
        <div className="app-loading" role="status">
          <span className="loading-mark" aria-hidden="true"><i>8</i></span>
          <strong>My Calendar</strong>
          <span>Opening your private calendar…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="calendar-app" data-calendar={activeCalendar}>
      <header className="topbar">
        <div className="topbar-main">
          <button
            ref={menuTrigger}
            className="icon-button menu-button"
            onClick={() => {
              setSettingsOpen(false);
              setMenuOpen(true);
            }}
            aria-label="Open menu"
          >
            <span className="menu-glyph" aria-hidden="true"><i /><i /><i /></span>
          </button>

          <label className="month-title">
            <span aria-hidden="true">{monthLabel}</span>
            <input
              className="month-title-input"
              type="month"
              value={`${view.year}-${pad(view.month + 1)}`}
              onChange={(event) => chooseMonth(event.currentTarget.value)}
              aria-label={`Choose month. Currently ${monthLabel}`}
            />
          </label>

          <button className="icon-button search-button" onClick={() => setSearchOpen(true)} aria-label="Search events">
            <span className="search-glyph" aria-hidden="true" />
          </button>
        </div>

        <div className="calendar-toolbar">
          <div className="calendar-switcher" role="group" aria-label="Calendar mode">
            {(["work", "personal"] as CalendarKind[]).map((kind) => (
              <button
                key={kind}
                className={activeCalendar === kind ? "active" : ""}
                onClick={() => setActiveCalendar(kind)}
                aria-pressed={activeCalendar === kind}
              >
                {kind === "work" ? "Work" : "Personal"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <input
        ref={rosterInput}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
        onChange={(event) => event.target.files?.[0] && importRosterFile(event.target.files[0])}
      />

      <div className="main-content">
        <div className="month-card" role="grid" aria-label={`${monthLabel} calendar`}>
          <div className="weekday-strip" role="row">
            <div className="week-gutter-title" role="columnheader"><span>WK</span></div>
            {WEEKDAYS.map((day, index) => (
              <div className="weekday" role="columnheader" key={day} aria-label={day}>
                <span className="weekday-full">{day.slice(0, 3)}</span>
                <span className="weekday-short">{SHORT_WEEKDAYS[index]}</span>
              </div>
            ))}
          </div>

          <div
            className="month-grid"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {Array.from({ length: 6 }, (_, weekIndex) => {
              const week = days.slice(weekIndex * 7, weekIndex * 7 + 7);
              return (
                <div className="week-row" role="row" key={dateKey(week[0])}>
                  <div className="week-number" role="rowheader" aria-label={`Week ${isoWeekNumber(addDays(week[0], 1))}`}>
                    {isoWeekNumber(addDays(week[0], 1))}
                  </div>
                  {week.map((day, dayIndex) => {
                    const key = dateKey(day);
                    const dayEvents = eventsByDate.get(key) ?? [];
                    const previousDayEvents = eventsByDate.get(dateKey(addDays(day, -1))) ?? [];
                    const nextDayEvents = eventsByDate.get(dateKey(addDays(day, 1))) ?? [];
                    const isToday = key === todayKey;
                    const isSelected = key === selectedDate;
                    const isOutside = day.getMonth() !== view.month;
                    const spokenDate = new Intl.DateTimeFormat("en", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }).format(day);
                    return (
                      <div
                        className={`day-cell${isOutside ? " outside" : ""}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
                        role="gridcell"
                        aria-selected={isSelected}
                        key={key}
                      >
                        <button
                          className="day-hit"
                          data-date={key}
                          onClick={() => chooseDay(day)}
                          onDoubleClick={() => openCreate(key)}
                          onKeyDown={(event) => handleDayKey(event, day)}
                          tabIndex={isSelected ? 0 : -1}
                          aria-label={`${spokenDate}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                        >
                          <span className="day-number">{day.getDate()}</span>
                        </button>
                        <div className="cell-events">
                          {dayEvents.slice(0, 3).map((calendarEvent, eventIndex) => {
                            const remark = eventDisplayRemark(calendarEvent);
                            const shiftClass = eventShiftClass(calendarEvent);
                            const isShift = Boolean(shiftClass);
                            const run = rosterShiftRunPosition(
                              calendarEvent,
                              previousDayEvents[eventIndex],
                              nextDayEvents[eventIndex],
                              dayIndex,
                            );
                            const runClass = isShift
                              ? `${run.continuesPrevious ? " event-run-continues-previous" : " event-run-start"}${run.continuesNext ? " event-run-continues-next" : " event-run-end"}`
                              : "";
                            const showShiftLabel = !isShift || !run.continuesPrevious;
                            return (
                              <button
                                key={calendarEvent.id}
                                className={`event-chip${shiftClass}${runClass}`}
                                onClick={() => openEdit(calendarEvent)}
                                aria-label={`${calendarEvent.title}, ${eventTimeLabel(calendarEvent)}${remark ? `, Remark: ${remark}` : ""}`}
                              >
                                <span className={`mobile-event-summary${remark ? " has-remark" : ""}`} aria-hidden="true">
                                  <span className="mobile-event-code">{showShiftLabel ? mobileEventCode(calendarEvent.title) : ""}</span>
                                  {remark && <span className="mobile-remark-indicator">!</span>}
                                </span>
                                <span className="event-title">{isShift ? (showShiftLabel ? mobileEventCode(calendarEvent.title) : "") : calendarEvent.title}</span>
                              </button>
                            );
                          })}
                          {dayEvents.length > 1 && (
                            <button className="mobile-more-events" onClick={() => chooseDay(day)} aria-label={`Show ${dayEvents.length} events`}>
                              +{dayEvents.length - 1}
                            </button>
                          )}
                          {dayEvents.length > 3 && (
                            <button className="more-events" onClick={() => chooseDay(day)}>
                              +{dayEvents.length - 3} more
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {activeCalendar === "work" && (
          <MonthlyShiftSummary
            className="summary-mobile"
            monthLabel={monthLabel}
            salaryMonthLabel={salaryMonthLabel}
            summary={monthlyShiftSummary}
            salaryForecast={monthlySalaryForecast}
          />
        )}

        <aside className={`agenda-panel${agendaOpen ? " open" : ""}`} aria-label={`Agenda for ${selectedLabel}`}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="agenda-header">
            <div>
              <p className="eyebrow">{activeCalendar} agenda</p>
              <h2>{selectedLabel}</h2>
            </div>
            <button className="close-button agenda-close" onClick={() => setAgendaOpen(false)} aria-label="Close agenda">×</button>
          </div>
          <div className="agenda-list">
            {selectedEvents.length ? (
              selectedEvents.map((calendarEvent) => {
                const remark = eventDisplayRemark(calendarEvent);
                return (
                  <button className={`agenda-event${eventShiftClass(calendarEvent)}`} key={calendarEvent.id} onClick={() => openEdit(calendarEvent)}>
                    <span className="agenda-time">{eventTimeLabel(calendarEvent)}</span>
                    <span className="agenda-event-body">
                      <strong>{calendarEvent.title}</strong>
                      {remark && (
                        <span className="agenda-note">
                          <span className="agenda-note-label">Remark</span>
                          <span className="agenda-note-text">{remark}</span>
                        </span>
                      )}
                    </span>
                    <span className="event-arrow" aria-hidden="true">›</span>
                  </button>
                );
              })
            ) : (
              <div className="empty-agenda">
                <span className="empty-orbit" aria-hidden="true"><i /></span>
                <h3>Your day is clear</h3>
                <p>Add a {activeCalendar} event or enjoy the open space.</p>
              </div>
            )}
          </div>
          {activeCalendar === "work" && (
            <MonthlyShiftSummary
              className="summary-desktop"
              monthLabel={monthLabel}
              salaryMonthLabel={salaryMonthLabel}
              summary={monthlyShiftSummary}
              salaryForecast={monthlySalaryForecast}
            />
          )}
          <button className="agenda-add" onClick={() => openCreate(selectedDate)}>Add event</button>
        </aside>
      </div>

      {agendaOpen && <button className="mobile-scrim" onClick={() => setAgendaOpen(false)} aria-label="Close agenda" />}

      {menuOpen && (
        <div className="overlay menu-overlay">
          <button className="overlay-dismiss" onClick={() => setMenuOpen(false)} aria-label="Close calendar menu" />
          <aside className="menu-drawer" role="dialog" aria-modal="true" aria-label="Calendar menu" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="menu-header">
              <div className="brand-mark" aria-hidden="true"><span>{now.getDate()}</span></div>
              <div>
                <strong>My Calendar</strong>
                <span>{syncStatus === "synced" ? "Shared calendar is up to date" :
                  syncStatus === "connecting" ? "Saving shared changes…" : "Offline — showing the last saved copy"}</span>
              </div>
              <button ref={menuCloseButton} className="close-button" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
            </div>
            {activeCalendar === "work" && (
              <div className="menu-section">
                <p className="menu-label">Work roster</p>
                <button className="menu-row roster-menu-row" onClick={chooseRosterFile}>
                  <span><strong>Import roster file</strong><small>Use a screenshot or IVU.plan PDF</small></span>
                  <span aria-hidden="true">↑</span>
                </button>
              </div>
            )}
            <div className="menu-section settings-section">
              <button
                className={`menu-row settings-toggle${settingsOpen ? " open" : ""}`}
                onClick={() => setSettingsOpen((current) => !current)}
                aria-expanded={settingsOpen}
                aria-controls="calendar-settings-panel"
              >
                <span><strong>Settings</strong><small>Appearance, sync, backups, and data</small></span>
                <span className="settings-chevron" aria-hidden="true">›</span>
              </button>
              {settingsOpen && (
                <div id="calendar-settings-panel" className="settings-panel">
                  <div className="settings-group">
                    <p className="menu-label">Appearance</p>
                    <div className="theme-toggle" role="group" aria-label="Appearance">
                      <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Dark</button>
                      <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Light</button>
                    </div>
                  </div>
                  <div className="settings-group">
                    <p className="menu-label">Your data</p>
                    <div className="menu-row sync-menu-row" role="status">
                      <span><strong>Automatic shared sync</strong><small>The same calendar opens in every browser and phone</small></span>
                      <span className={`sync-dot ${syncStatus}`} aria-label={`Sync status: ${syncStatus}`} />
                    </div>
                    <button className="menu-row" onClick={exportBackup}><span>Download backup</span><span aria-hidden="true">↓</span></button>
                    <button className="menu-row" onClick={() => importInput.current?.click()}><span>Import backup</span><span aria-hidden="true">↑</span></button>
                    <input
                      ref={importInput}
                      className="visually-hidden"
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => event.target.files?.[0] && importBackup(event.target.files[0])}
                    />
                    <button className="menu-row danger" onClick={clearCalendar}><span>Clear calendar data</span><span aria-hidden="true">×</span></button>
                  </div>
                  <p className="device-note">
                    This is a public shared calendar. Anyone with the site URL can view, add, edit, or delete events. Roster files never leave your device.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {searchOpen && (
        <div className="overlay centered-overlay">
          <button className="overlay-dismiss" onClick={() => setSearchOpen(false)} aria-label="Close search" />
          <section className="dialog search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="dialog-header">
              <div><p className="eyebrow">{activeCalendar} calendar</p><h2 id="search-title">Find an event</h2></div>
              <button className="close-button" onClick={() => setSearchOpen(false)} aria-label="Close search">×</button>
            </div>
            <label className="search-field">
              <span className="visually-hidden">Search titles and notes</span>
              <span className="search-glyph" aria-hidden="true" />
              <input ref={searchInput} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search titles and notes" />
            </label>
            <p className="result-label">{searchQuery ? "Results" : "Upcoming"}</p>
            <div className="search-results">
              {searchResults.length ? searchResults.map((calendarEvent) => (
                <button key={calendarEvent.id} className={`search-result${eventShiftClass(calendarEvent)}`} onClick={() => openEventFromSearch(calendarEvent)}>
                  <span className="result-date">
                    <strong>{parseDateKey(calendarEvent.date).getDate()}</strong>
                    <span>{new Intl.DateTimeFormat("en", { month: "short" }).format(parseDateKey(calendarEvent.date))}</span>
                  </span>
                  <span className="result-copy"><strong>{calendarEvent.title}</strong><span>{eventTimeLabel(calendarEvent)}</span></span>
                  <span aria-hidden="true">›</span>
                </button>
              )) : (
                <div className="empty-results"><p>No matching events</p><span>Try another phrase or add a new event.</span></div>
              )}
            </div>
          </section>
        </div>
      )}

      {rosterDialog && (
        <div className="overlay centered-overlay roster-overlay">
          <button className="overlay-dismiss" onClick={closeRosterDialog} aria-label="Close roster importer" />
          <section
            className="dialog roster-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-dialog-title"
            tabIndex={-1}
            onKeyDown={trapDialogFocus}
          >
            <div className="dialog-header roster-dialog-header">
              <div>
                <p className="eyebrow">Work calendar</p>
                <h2 id="roster-dialog-title">
                  {rosterDialog.stage === "reading" ? "Reading your roster" :
                    rosterDialog.stage === "review" ? `Review ${rosterReviewMonthLabel}` :
                      "Try another roster file"}
                </h2>
              </div>
              <button ref={rosterCloseButton} className="close-button" onClick={closeRosterDialog} aria-label="Close roster importer">×</button>
            </div>

            <div className="roster-dialog-body">
              <div className="roster-preview-card">
                {rosterDialog.fileKind === "pdf" ? (
                  <div className="roster-pdf-preview" aria-label="Uploaded IVU.plan PDF">
                    <span aria-hidden="true">PDF</span>
                    <strong>IVU.plan duty schedule</strong>
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    <img src={rosterDialog.previewUrl} alt="Uploaded roster screenshot preview" />
                  </>
                )}
                <span>{rosterDialog.fileName}</span>
              </div>

              {rosterDialog.stage === "reading" && (
                <div className="roster-reading" role="status" aria-live="polite">
                  <span className="roster-scan-mark" aria-hidden="true"><i /></span>
                  <strong>{rosterDialog.progress.label}</strong>
                  <progress max="100" value={rosterDialog.progress.percent}>{rosterDialog.progress.percent}%</progress>
                  <p>{rosterDialog.progress.percent}% · The file stays on this device.</p>
                </div>
              )}

              {rosterDialog.stage === "error" && (
                <div className="roster-error" role="alert">
                  <strong>We could not read this roster.</strong>
                  <p>{rosterDialog.error}</p>
                  <p>Use a full monthly screenshot, or export the monthly duty schedule directly from IVU.plan.</p>
                  <button className="primary-button" onClick={chooseRosterFile}>Choose another file</button>
                </div>
              )}

              {rosterDialog.stage === "review" && rosterDialog.year !== undefined && rosterDialog.monthIndex !== undefined && (
                <div className="roster-review">
                  <div className="roster-review-intro">
                    <div>
                      <span className="review-check" aria-hidden="true">✓</span>
                      <p><strong>{rosterDialog.rows.length} days found</strong><span>Check the results, then import to Work.</span></p>
                    </div>
                    <span className="local-badge">On-device</span>
                  </div>

                  <div className="roster-summary" aria-label="Detected roster summary">
                    {rosterSummary.map(([title, count]) => (
                      <span className={shiftToneClass(title).trim() || undefined} key={title}><strong>{count}</strong> {title}</span>
                    ))}
                  </div>

                  <p className="roster-impact">
                    {existingRosterCount
                      ? `This replaces ${existingRosterCount} previously imported ${rosterReviewMonthLabel} roster event${existingRosterCount === 1 ? "" : "s"}. `
                      : `This adds a new ${rosterReviewMonthLabel} roster. `}
                    {manualWorkCount} manual Work event{manualWorkCount === 1 ? "" : "s"} in this month will stay.
                  </p>

                  {unresolvedRosterDays > 0 && (
                    <p className="roster-warning" role="alert">
                      Choose a shift for {unresolvedRosterDays} highlighted day{unresolvedRosterDays === 1 ? "" : "s"} before importing.
                    </p>
                  )}

                  <div className="roster-review-list">
                    {rosterDialog.rows.map((row) => {
                      const details = row.choice ? choiceToEvent(row.choice) : null;
                      const dateLabel = new Intl.DateTimeFormat("en", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      }).format(new Date(rosterDialog.year as number, rosterDialog.monthIndex as number, row.day));
                      const timeLabel = details?.allDay
                        ? "All day"
                        : details
                          ? `${details.startTime}–${details.endTime}${details.endsNextDay ? " next day" : ""}`
                          : "Needs review";
                      return (
                        <label className={`roster-review-row${row.choice ? "" : " unresolved"}${details ? shiftToneClass(details.title) : ""}`} key={row.day}>
                          <span className="roster-date"><strong>{row.day}</strong><span>{dateLabel}</span></span>
                          <span className="roster-detection">
                            <span>{row.rawCode}</span>
                            <small>{row.times.length ? row.times.join(" · ") : row.barKind === "green" ? "Rest day" : "Code detected"}</small>
                          </span>
                          <span className="roster-choice-field">
                            <span className="visually-hidden">Shift for {dateLabel}</span>
                            <select
                              value={row.choice}
                              onChange={(event) => updateRosterChoice(row.day, event.target.value as RosterChoice | "")}
                              aria-invalid={!row.choice}
                            >
                              <option value="">Choose shift</option>
                              {ROSTER_CHOICE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <small>{timeLabel}</small>
                          </span>
                          {row.warning && <span className="row-warning">{row.warning}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="roster-actions">
              <button className="secondary-button" onClick={closeRosterDialog}>Cancel</button>
              {rosterDialog.stage === "review" && (
                <button className="primary-button" onClick={applyRosterImport} disabled={unresolvedRosterDays > 0}>
                  Import {rosterDialog.rows.length} days
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {editor && (
        <div className="overlay centered-overlay editor-overlay">
          <button className="overlay-dismiss" onClick={() => setEditor(null)} aria-label="Close event editor" />
          <form className="dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title" tabIndex={-1} onKeyDown={trapDialogFocus} onSubmit={saveEvent}>
            <div className="dialog-header">
              <div><p className="eyebrow">{editor.id ? "Edit details" : "New event"}</p><h2 id="editor-title">{editor.id ? editor.draft.title || "Untitled event" : "Add to your calendar"}</h2></div>
              <button type="button" className="close-button" onClick={() => setEditor(null)} aria-label="Close event editor">×</button>
            </div>
            <label className="field title-field"><span>Title</span><input ref={editorTitleInput} value={editor.draft.title} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, title: event.target.value } })} placeholder="What is happening?" maxLength={80} required /></label>
            <div className="field-row">
              <label className="field"><span>Date</span><input type="date" value={editor.draft.date} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, date: event.target.value } })} required /></label>
              <label className="field"><span>Calendar</span><select value={editor.draft.calendar} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, calendar: event.target.value as CalendarKind } })}><option value="work">Work</option><option value="personal">Personal</option></select></label>
            </div>
            <label className="all-day-toggle"><input type="checkbox" checked={editor.draft.allDay} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, allDay: event.target.checked, endsNextDay: event.target.checked ? false : editor.draft.endsNextDay } })} /><span>All-day event</span></label>
            {!editor.draft.allDay && (
              <>
                <div className="field-row">
                  <label className="field"><span>Starts</span><input type="time" value={editor.draft.startTime} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, startTime: event.target.value } })} required /></label>
                  <label className="field"><span>Ends</span><input type="time" value={editor.draft.endTime} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, endTime: event.target.value } })} required /></label>
                </div>
                <label className="all-day-toggle next-day-toggle"><input type="checkbox" checked={editor.draft.endsNextDay ?? false} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, endsNextDay: event.target.checked } })} /><span>Ends the next day</span></label>
              </>
            )}
            <label className="field"><span>Notes <em>optional</em></span><textarea value={editor.draft.notes} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, notes: event.target.value } })} placeholder="Add a location, reminder, or detail" rows={3} maxLength={500} /></label>
            {editorError && <p className="form-error" role="alert">{editorError}</p>}
            <div className="editor-actions">
              {editor.id && <button type="button" className="delete-button" onClick={deleteEvent}>Delete</button>}
              <button type="button" className="secondary-button" onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" className="primary-button">Save event</button>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
    </main>
  );
}
