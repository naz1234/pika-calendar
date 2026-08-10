import type { RosterEventDetails } from "./roster-domain";

export type CalendarKind = "work" | "personal";

export type RosterEventSource = {
  type: "roster-image";
  rosterMonth: string;
  key: string;
  rawCode: string;
};

export type CalendarEventRecord = {
  id: string;
  calendar: CalendarKind;
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  endsNextDay?: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  source?: RosterEventSource;
};

export type PreparedRosterEntry = {
  details: RosterEventDetails;
  date: string;
  key: string;
  rawCode: string;
};

export type RosterMergeResult = {
  events: CalendarEventRecord[];
  importedCount: number;
  skippedManualDuplicates: number;
};

/** Returns user-visible remarks while hiding untouched roster import metadata. */
export function eventDisplayRemark(
  event: Pick<CalendarEventRecord, "notes" | "source">,
): string {
  const remark = event.notes.trim();
  if (!remark) return "";

  const importedNote = event.source?.type === "roster-image"
    ? `Imported from roster image · ${event.source.rawCode}`
    : "";
  return remark === importedNote ? "" : remark;
}

function sameShift(event: CalendarEventRecord, entry: PreparedRosterEntry) {
  return (
    event.date === entry.date &&
    event.title.trim().toLowerCase() === entry.details.title.toLowerCase() &&
    event.allDay === entry.details.allDay &&
    event.startTime === entry.details.startTime &&
    event.endTime === entry.details.endTime &&
    Boolean(event.endsNextDay) === entry.details.endsNextDay
  );
}

export function mergeRosterMonthEvents(
  current: readonly CalendarEventRecord[],
  prepared: readonly PreparedRosterEntry[],
  rosterMonth: string,
  timestamp: string,
): RosterMergeResult {
  const previousRoster = new Map(
    current
      .filter((event) => event.source?.type === "roster-image" && event.source.rosterMonth === rosterMonth)
      .map((event) => [event.source?.key ?? "", event]),
  );
  const preserved = current.filter(
    (event) => !(event.source?.type === "roster-image" && event.source.rosterMonth === rosterMonth),
  );
  const manualWork = preserved.filter(
    (event) => event.calendar === "work" && !event.source && event.date.startsWith(`${rosterMonth}-`),
  );
  const reservedIds = new Set(preserved.map((event) => event.id));
  const imported: CalendarEventRecord[] = [];
  let skippedManualDuplicates = 0;

  prepared.forEach((entry) => {
    if (manualWork.some((event) => sameShift(event, entry))) {
      skippedManualDuplicates += 1;
      return;
    }
    const previous = previousRoster.get(entry.key);
    let id = previous?.id ?? `roster-${entry.date}`;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `roster-${entry.date}-${suffix}`;
      suffix += 1;
    }
    reservedIds.add(id);
    imported.push({
      id,
      calendar: "work",
      title: entry.details.title,
      date: entry.date,
      allDay: entry.details.allDay,
      startTime: entry.details.startTime,
      endTime: entry.details.endTime,
      endsNextDay: entry.details.endsNextDay,
      notes: `Imported from roster image · ${entry.rawCode}`,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      source: {
        type: "roster-image",
        rosterMonth,
        key: entry.key,
        rawCode: entry.rawCode,
      },
    });
  });

  return {
    events: [...preserved, ...imported],
    importedCount: imported.length,
    skippedManualDuplicates,
  };
}
