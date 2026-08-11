import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const clientRoot = path.join(projectRoot, "dist", "client");

test("exports a deployable static calendar", async () => {
  const html = await readFile(path.join(clientRoot, "index.html"), "utf8");

  assert.match(html, /<title>My Calendar<\/title>/i);
  assert.match(html, /mobile-first Work and Personal calendar/i);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/i);
  assert.match(html, /viewport-fit=cover/i);
  assert.match(html, /property="og:image"/i);
  assert.match(html, /My Calendar/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
});

test("ships automatic shared sync, roster import, and installable app assets", async () => {
  const [manifestText, source, styles, mergeSource, shiftSummarySource, pdfReaderSource, pdfDomainSource, syncSource, sharedApiSource, legacyApiSource, schemaSource, serviceWorker] = await Promise.all([
    readFile(path.join(clientRoot, "manifest.webmanifest"), "utf8"),
    readFile(path.join(projectRoot, "app", "page.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
    readFile(path.join(projectRoot, "app", "roster-merge.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "shift-summary.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "roster-pdf-reader.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "roster-pdf-domain.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "calendar-sync.ts"), "utf8"),
    readFile(path.join(projectRoot, "functions", "api", "shared-calendar.ts"), "utf8"),
    readFile(path.join(projectRoot, "functions", "api", "calendar.ts"), "utf8"),
    readFile(path.join(projectRoot, "db", "schema.ts"), "utf8"),
    readFile(path.join(clientRoot, "sw.js"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.name, "My Calendar");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 2);
  assert.match(mergeSource, /"work" \| "personal"/);
  assert.match(source, /isoWeekNumber/);
  assert.match(source, /localStorage/);
  assert.match(source, /Download backup/);
  assert.match(source, /Automatic shared sync/);
  assert.match(source, /This is a public shared calendar/);
  assert.match(source, />Settings</);
  assert.match(source, /aria-expanded=\{settingsOpen\}/);
  assert.match(source, /calendar-settings-panel/);
  assert.match(styles, /\.settings-toggle/);
  assert.doesNotMatch(source, /Enable private sync|Copy private sync link/);
  assert.match(source, /Import roster file/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /roster-image/);
  assert.doesNotMatch(source, /roster-upload-button|upload-glyph/);
  assert.match(source, /agenda-note/);
  assert.match(source, />Remark</);
  assert.match(styles, /\.agenda-note-text/);
  assert.match(source, /eventDisplayRemark/);
  assert.match(source, /mobile-remark-indicator/);
  assert.match(styles, /\.mobile-event-summary\.has-remark/);
  assert.match(styles, /\.mobile-event-summary\s*\{[^}]*border:/s);
  assert.match(styles, /\.event-chip\.shift-event\s*\{[^}]*background: var\(--event-fill\)/s);
  assert.match(styles, /\.event-chip\.shift-event\.event-run-continues-previous/);
  assert.match(styles, /\.event-chip\.shift-event \.mobile-event-code[^}]*text-align: left/s);
  assert.match(styles, /\.agenda-event\.shift-event\s*\{[^}]*background: var\(--event-fill\)/s);
  assert.match(source, /eventShiftClass/);
  assert.match(source, /Monthly Work summary/);
  assert.match(source, /summary-mobile/);
  assert.match(source, /summary-desktop/);
  assert.match(styles, /\.monthly-shift-summary/);
  assert.match(shiftSummarySource, /countMonthlyWorkShifts/);
  assert.match(source, /mobileEventCode/);
  assert.match(source, /mobile-event-code/);
  assert.match(source, /rosterShiftRunPosition/);
  assert.match(source, /event-run-continues-previous/);
  assert.match(source, /event-run-continues-next/);
  assert.doesNotMatch(source, /chip-dot/);
  assert.match(pdfReaderSource, /pdfjs-dist/);
  assert.match(pdfReaderSource, /readRosterPdf/);
  assert.match(pdfDomainSource, /parseIvuPlanTextItems/);
  assert.match(syncSource, /AES-GCM/);
  assert.match(syncSource, /pika-calendar-public-sync-000001/);
  assert.match(syncSource, /\/api\/shared-calendar/);
  assert.match(sharedApiSource, /pika-calendar-public-shared-v2/);
  assert.doesNotMatch(sharedApiSource, /searchParams\.get\("id"\)/);
  assert.match(legacyApiSource, /searchParams\.get\("id"\)/);
  assert.match(schemaSource, /sqliteTable\("calendars"/);
  for (const tone of ["early", "late", "night", "rest"]) {
    assert.match(styles, new RegExp(`--shift-${tone}-ink`));
  }
  assert.match(serviceWorker, /my-calendar-v8/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/api\/"\)/);

  await Promise.all([
    access(path.join(clientRoot, "icons", "calendar-192.png")),
    access(path.join(clientRoot, "icons", "calendar-512.png")),
    access(path.join(clientRoot, "og.png")),
    access(path.join(clientRoot, "_headers")),
    access(path.join(clientRoot, "ocr", "worker.min.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-simd-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-relaxedsimd-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "lang", "eng.traineddata.gz")),
  ]);

  const staticAssets = await readdir(path.join(clientRoot, "_next", "static"), { recursive: true });
  assert.ok(staticAssets.some((asset) => /pdf\.worker\.min\..+\.mjs$/i.test(asset)));
  assert.ok(staticAssets.some((asset) => /roster-pdf-reader-.+\.js$/i.test(asset)));
});

test("calculates ISO week numbers across year boundaries", async () => {
  const source = await readFile(path.join(projectRoot, "app", "page.tsx"), "utf8");
  const match = source.match(/function isoWeekNumber\(date: Date\) \{[\s\S]*?\n\}/);
  assert.ok(match, "isoWeekNumber helper should be present");
  const runnable = match[0].replace("date: Date", "date");
  const isoWeekNumber = Function(`return (${runnable})`)();

  assert.equal(isoWeekNumber(new Date(2020, 11, 28)), 53);
  assert.equal(isoWeekNumber(new Date(2021, 0, 3)), 53);
  assert.equal(isoWeekNumber(new Date(2021, 0, 4)), 1);
  assert.equal(isoWeekNumber(new Date(2026, 7, 3)), 32);
});

test("uses the centered swipe-first calendar header", async () => {
  const [source, styles] = await Promise.all([
    readFile(path.join(projectRoot, "app", "page.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
  ]);

  assert.match(source, /<label className="month-title">[\s\S]*?className="month-title-input"[\s\S]*?type="month"[\s\S]*?onChange=\{\(event\) => chooseMonth\(event\.currentTarget\.value\)\}/);
  assert.match(source, /function chooseMonth\(value: string\)[\s\S]*?setView\(\{ year, month: month - 1 \}\)[\s\S]*?setSelectedDate\(dateKey\(nextSelection\)\)/);
  assert.match(source, /className="icon-button search-button"[\s\S]*?aria-label="Search events"[\s\S]*?className="search-glyph"/);
  assert.match(source, /className="calendar-switcher"[\s\S]*?aria-label="Calendar mode"[\s\S]*?setActiveCalendar\(kind\)[\s\S]*?aria-pressed=\{activeCalendar === kind\}/);
  assert.doesNotMatch(source, /monthPickerOpen|month-picker-dialog|month-dialog|Show month|Close month picker|className="today-button"|className="month-navigation"|aria-label="Previous month"|aria-label="Next month"|mode-dot|small-caret/);
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.match(source, /onPointerUp=\{handlePointerUp\}/);
  assert.match(source, /changeMonth\(difference > 0 \? -1 : 1\)/);
  assert.match(styles, /\.topbar-main\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 44px;/s);
  assert.match(styles, /\.month-title-input\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*opacity:\s*0;/s);
  assert.doesNotMatch(styles, /\.month-dialog/);
  assert.match(styles, /\.month-grid\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(styles, /\.calendar-switcher button\.active\s*\{[^}]*background:\s*var\(--header-accent\);/s);
});

test("references only files present in the exported site", async () => {
  const html = await readFile(path.join(clientRoot, "index.html"), "utf8");
  const references = [
    ...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="(\/[^"]+)"/gi),
  ].map((match) => match[1].split("?")[0]);

  assert.ok(references.length > 0);
  await Promise.all(
    [...new Set(references)].map((reference) =>
      access(path.join(clientRoot, reference.replace(/^\//, ""))),
    ),
  );
});
