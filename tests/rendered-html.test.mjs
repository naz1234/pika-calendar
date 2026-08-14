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
  assert.match(html, /rel="apple-touch-icon"[^>]*href="\/icons\/calendar-apple-180\.png"/i);
  assert.match(html, /viewport-fit=cover/i);
  assert.match(html, /property="og:image"/i);
  assert.match(html, /My Calendar/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
});

test("ships automatic shared sync, roster import, and installable app assets", async () => {
  const [manifestText, packageText, source, styles, mergeSource, shiftSummarySource, pdfReaderSource, pdfDomainSource, syncSource, sharedApiSource, legacyApiSource, schemaSource, serviceWorker] = await Promise.all([
    readFile(path.join(clientRoot, "manifest.webmanifest"), "utf8"),
    readFile(path.join(projectRoot, "package.json"), "utf8"),
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
  const packageJson = JSON.parse(packageText);

  assert.equal(manifest.name, "My Calendar");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 4);
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => ({ src, sizes, purpose })),
    [
      { src: "/icons/calendar-192.png", sizes: "192x192", purpose: "any" },
      { src: "/icons/calendar-512.png", sizes: "512x512", purpose: "any" },
      { src: "/icons/calendar-maskable-192.png", sizes: "192x192", purpose: "maskable" },
      { src: "/icons/calendar-maskable-512.png", sizes: "512x512", purpose: "maskable" },
    ],
  );
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
  assert.match(source, />IVU Website</);
  assert.match(source, /href="https:\/\/riy\.ivu-cloud\.com\/mbweb\/main\/matter\/desktop\/main-menu"/);
  assert.match(source, /target="_blank"[\s\S]*?rel="noopener noreferrer"/);
  assert.match(source, /Download the original roster PDF/);
  assert.match(styles, /\.menu-link[\s\S]*?text-decoration: none;/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /roster-image/);
  assert.doesNotMatch(source, /roster-upload-button|upload-glyph/);
  assert.match(source, /agenda-note/);
  assert.match(source, />Remark</);
  assert.match(styles, /\.agenda-note-text/);
  assert.match(source, /eventDisplayRemark/);
  assert.match(source, /dayHasRemark/);
  assert.match(source, /day-remark-dot/);
  assert.match(styles, /\.day-remark-dot\s*\{[^}]*background: var\(--remark-dot\)/s);
  assert.match(styles, /\.mobile-event-summary\s*\{[^}]*border:/s);
  assert.match(source, /className=\{`day-cell\$\{primaryShiftClass\}/);
  assert.match(styles, /\.day-cell\s*\{[^}]*margin:\s*2px;[^}]*border-radius:\s*9px;[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.day-cell\.shift-event\s*\{[^}]*background: var\(--event-fill\)/s);
  assert.match(source, /className="shift-legend" aria-label="Shift legend"/);
  assert.match(source, /LS Late[\s\S]*NS Night[\s\S]*RD Rest[\s\S]*Remark/);
  assert.match(styles, /\.month-swipe-viewport\s*\{[^}]*width:\s*calc\(100% - 24px\);[^}]*max-width:\s*440px;[^}]*border-radius:\s*16px;/s);
  assert.match(styles, /\.month-grid\s*\{[^}]*grid-template-rows:\s*repeat\(6, clamp\(42px, 11\.2vw, 48px\)\);[^}]*gap:\s*4px;/s);
  assert.match(styles, /\.month-swipe-track > \.month-card\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.cell-events\s*\{[^}]*top:\s*25px;/s);
  assert.match(styles, /\.event-chip\s*\{[^}]*height:\s*14px;/s);
  assert.match(styles, /\.shift-legend\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s);
  assert.match(styles, /\.event-chip\.shift-event\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.event-chip\.shift-event \.mobile-event-code[^}]*text-align: left/s);
  assert.match(styles, /\.agenda-event\.shift-event\s*\{[^}]*background: var\(--event-fill\)/s);
  assert.match(source, /eventShiftClass/);
  assert.match(source, /Monthly Work summary/);
  assert.match(source, /summary-mobile/);
  assert.match(source, /summary-desktop/);
  assert.match(styles, /\.monthly-shift-summary/);
  assert.match(styles, /\.main-content\s*\{[^}]*display: block;[^}]*overflow: visible;/s);
  assert.match(styles, /@media \(min-width: 900px\)[\s\S]*?\.main-content\s*\{[^}]*display: grid;/);
  assert.match(shiftSummarySource, /countMonthlyWorkShifts/);
  assert.match(shiftSummarySource, /calculateMonthlyExpectedSalary/);
  assert.match(source, /Expected salary/);
  assert.match(source, /salaryMonthLabel/);
  assert.match(source, /salary-breakdown-icon/);
  assert.match(source, /salary-icon-wallet/);
  assert.match(source, /salary-icon-night/);
  assert.match(source, /salary-icon-overtime/);
  assert.match(styles, /\.salary-icon-wallet::before/);
  assert.match(styles, /\.salary-icon-night::before/);
  assert.match(styles, /\.salary-icon-overtime::before/);
  assert.match(source, /All amounts are estimates based on current data\./);
  assert.match(source, />3 categories</);
  assert.doesNotMatch(source, /shift-code-legend|SHIFT_CODE_LEGEND/);
  assert.match(styles, /\.monthly-salary-card/);
  assert.match(styles, /\.summary-mobile\.monthly-shift-summary\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.summary-mobile \.monthly-summary-stat\s*\{[^}]*border-right:\s*1px solid var\(--grid-soft\);[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.summary-mobile \.monthly-salary-breakdown\s*\{[^}]*border-radius:\s*14px;[^}]*background:/s);
  assert.match(styles, /\.summary-mobile \.salary-estimate-note\s*\{[^}]*display:\s*flex;/s);
  assert.match(source, /mobileEventCode/);
  assert.match(source, /mobile-event-code/);
  assert.match(source, /rosterShiftModifier/);
  assert.match(source, /className=\{`shift-modifier-badge modifier-\$\{shiftModifier\}`\}/);
  assert.match(source, /const baseShiftCode = shiftModifier \? `\$\{eventCode\.charAt\(0\)\}S` : eventCode/);
  assert.match(styles, /\.shift-modifier-badge\s*\{[^}]*border-radius:\s*999px;/s);
  assert.match(styles, /\.modifier-extension\s*\{[^}]*color:\s*var\(--shift-early-ink\);/s);
  assert.match(styles, /\.modifier-rdot\s*\{[^}]*color:\s*var\(--shift-rest-ink\);/s);
  assert.doesNotMatch(styles, /\.event-chip\.shift-event\.shift-extension\s*\{[^}]*border-style:\s*dashed;/s);
  assert.doesNotMatch(styles, /\.event-chip\.shift-event\.shift-rdot\s*\{[^}]*border-width:\s*2px;/s);
  assert.match(styles, /\.summary-mobile \.monthly-summary-stat\s*\{[^}]*min-height:\s*148px;/s);
  assert.match(styles, /\.summary-mobile \.monthly-summary-stat small\s*\{[^}]*font-size:\s*0\.64rem;/s);
  assert.doesNotMatch(source, /rosterShiftRunPosition/);
  assert.doesNotMatch(source, /event-run-continues-previous/);
  assert.doesNotMatch(source, /event-run-continues-next/);
  assert.doesNotMatch(styles, /event-run-continues/);
  assert.doesNotMatch(source, /mobile-remark-indicator|mobile-event-summary\$\{remark/);
  assert.doesNotMatch(source, /chip-dot/);
  assert.match(pdfReaderSource, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(pdfReaderSource, /import "pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs"/);
  assert.doesNotMatch(pdfReaderSource, /GlobalWorkerOptions|pdfWorkerUrl|\?url/);
  assert.equal(packageJson.dependencies["pdfjs-dist"], "5.4.624");
  assert.match(pdfReaderSource, /typeof file\.arrayBuffer === "function"/);
  assert.match(pdfReaderSource, /new FileReader\(\)/);
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
    assert.match(styles, new RegExp(`--shift-${tone}-bg`));
  }
  assert.match(styles, /:root,[\s\S]*?--remark-dot:\s*#ffc247;/);
  assert.match(styles, /:root\[data-theme="light"\][\s\S]*?--remark-dot:\s*#e6a20d;/);
  assert.match(serviceWorker, /my-calendar-v13/);
  assert.match(serviceWorker, /includeUncontrolled: true/);
  assert.match(serviceWorker, /try[\s\S]*?await client\.navigate\(client\.url\);[\s\S]*?catch/);
  assert.match(serviceWorker, /client\.navigate\(client\.url\)/);
  assert.match(source, /controllerchange/);
  assert.match(source, /updateViaCache: "none"/);
  assert.match(source, /pageshow/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /registration\.update\(\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/api\/"\)/);

  await Promise.all([
    access(path.join(clientRoot, "icons", "calendar-192.png")),
    access(path.join(clientRoot, "icons", "calendar-512.png")),
    access(path.join(clientRoot, "icons", "calendar-maskable-192.png")),
    access(path.join(clientRoot, "icons", "calendar-maskable-512.png")),
    access(path.join(clientRoot, "icons", "calendar-apple-180.png")),
    access(path.join(clientRoot, "og.png")),
    access(path.join(clientRoot, "_headers")),
    access(path.join(clientRoot, "ocr", "worker.min.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-simd-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "core", "tesseract-core-relaxedsimd-lstm.wasm.js")),
    access(path.join(clientRoot, "ocr", "lang", "eng.traineddata.gz")),
  ]);

  const staticAssets = await readdir(path.join(clientRoot, "_next", "static"), { recursive: true });
  const pdfAsset = staticAssets.find((asset) => /roster-pdf-reader-.+\.js$/i.test(asset));
  assert.ok(pdfAsset);
  const pdfBundle = await readFile(path.join(clientRoot, "_next", "static", pdfAsset), "utf8");
  assert.match(pdfBundle, /5\.4\.624/);
  assert.doesNotMatch(pdfBundle, /6\.2\.108/);
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
  assert.match(source, /className="day-hit"[\s\S]*?onClick=\{\(\) => chooseDay\(day\)\}/);
  assert.match(source, /className="agenda-add"[\s\S]*?openCreate\(selectedDate\)/);
  assert.doesNotMatch(source, /floating-add/);
  assert.doesNotMatch(styles, /\.floating-add/);
  assert.doesNotMatch(source, /monthPickerOpen|month-picker-dialog|month-dialog|Show month|Close month picker|className="today-button"|className="month-navigation"|aria-label="Previous month"|aria-label="Next month"|mode-dot|small-caret/);
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.match(source, /onPointerMove=\{handlePointerMove\}/);
  assert.match(source, /onPointerUp=\{handlePointerUp\}/);
  assert.match(source, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(source, /swipeMonths\.map\(\(panel\) =>/);
  assert.match(source, /positionMonthTrack\(gesture\.offset, false\)/);
  assert.match(source, /translate3d\(calc\(-33\.333333% \+ \$\{offset\}px\), 0, 0\)/);
  assert.match(source, /Math\.abs\(gesture\.offset\) >= Math\.min\(72, width \* 0\.2\)/);
  assert.match(source, /resetMonthTrack\(true\)/);
  assert.match(source, /flushSync\(\(\) => changeMonth\(amount\)\)/);
  assert.doesNotMatch(source, /monthMotion|month-slide-/);
  assert.match(styles, /\.topbar-main\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 44px;/s);
  assert.match(styles, /\.calendar-app\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;/s);
  assert.match(styles, /@media \(max-width: 899px\)[\s\S]*?\.calendar-app\s*\{[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s);
  assert.match(styles, /\.calendar-app::-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s);
  assert.match(styles, /\.topbar\s*\{[^}]*padding:\s*max\(10px, env\(safe-area-inset-top\)\)[^}]*8px/s);
  assert.match(styles, /\.calendar-toolbar\s*\{[^}]*margin-top:\s*4px;/s);
  assert.match(styles, /@media \(min-width: 900px\)[\s\S]*?\.calendar-app\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.month-title-input\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*opacity:\s*0;/s);
  assert.doesNotMatch(styles, /\.month-dialog/);
  assert.match(styles, /\.month-grid\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(styles, /\.month-card\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\);[^}]*min-height:\s*100%;/s);
  assert.match(styles, /\.month-grid\s*\{[^}]*grid-template-rows:\s*repeat\(6, minmax\(62px, 1fr\)\);/s);
  assert.match(styles, /\.month-swipe-viewport\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*overflow:\s*hidden;[^}]*touch-action:\s*pan-y;/s);
  assert.match(styles, /\.month-swipe-track\s*\{[^}]*display:\s*flex;[^}]*width:\s*300%;[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*transform:\s*translate3d\(-33\.333333%, 0, 0\);[^}]*will-change:\s*transform;/s);
  assert.match(styles, /\.month-swipe-track > \.month-card\s*\{[^}]*flex:\s*0 0 33\.333333%;[^}]*width:\s*33\.333333%;[^}]*height:\s*100%;[^}]*min-height:\s*100%;/s);
  assert.doesNotMatch(styles, /month-slide-from-|\.month-card\.month-slide-/);
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
