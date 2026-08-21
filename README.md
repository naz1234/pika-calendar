# My Calendar

A mobile-first shared calendar with separate **Work** and **Personal** modes. It uses a Google Calendar-inspired month layout, includes ISO week numbers, and needs no login or account.

## Included

- Work and Personal calendar modes
- Sunday-first month grid with week numbers
- Work-roster screenshot or IVU.plan PDF import with an editable review before saving
- Automatic Early, Late, Night, RD, extension `(EX)`, and RDOT mapping
- Distinct Early, Late, Night, and RD colors in the calendar, agenda, and search
- Consecutive matching shifts join into one continuous ES, LS, NS, or RD bar
- Scrollable monthly Work summary for all Night shifts, extensions, and RDOT
- Expected salary forecast using the monthly Night allowance and overtime hours, hidden by default behind an eye toggle
- Add, edit, search, and delete events
- All-day events, overnight shifts, start/end times, and notes
- Swipe left or right to change months, or tap the centered month to use the device picker
- Dark and light themes
- JSON backup and restore
- Automatic public shared sync across normal, private/incognito, and other browsers
- Installable mobile web app with offline app-shell support
- Responsive layout for phones, tablets, and desktop

## Important: this is a public shared calendar

Events are cached in the browser so the calendar keeps working offline. With the D1 binding configured, the app automatically loads and saves one shared calendar. Open the normal site URL in any browser, including private/incognito mode, to see the same events—no setup link is required.

Anyone with the site URL can view, add, edit, or delete every Work and Personal event. There is no login or per-user calendar. Use this mode only when that public access is acceptable.

Roster screenshots and PDFs are still read entirely in your browser. The source file is not uploaded or saved; only the Work events you approve enter the shared calendar. Re-importing the same month replaces only that month’s earlier roster-import events, while manual Work events and all Personal events remain.

Use **Menu → Download backup** occasionally as an extra recovery copy.

## Upload to GitHub

1. Extract the ZIP file on your computer.
2. Create a new empty GitHub repository.
3. Upload the **extracted files and folders** to the repository root. Do not upload only the ZIP as one file.
4. Commit the uploaded files.

The repository root should contain `app`, `public`, `package.json`, and this README.

## Connect to Cloudflare Pages

Create a new Pages project from the GitHub repository and use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist/client` |
| Root directory | `/` |
| Node version | `22.23.2` |

The project includes `.node-version`, but setting the Cloudflare environment variable `NODE_VERSION` to `22.23.2` is also safe.

After Cloudflare finishes the first deployment, open the Pages URL on your phone. In Safari or Chrome, use **Add to Home Screen** if you want it to behave more like an app.

## Configure automatic shared sync on Cloudflare Pages

The calendar continues to work from its offline browser cache when this setup is omitted, but browsers cannot share events. To enable automatic shared sync:

1. In Cloudflare, create a D1 database named `pika-calendar`.
2. Open the database console and run the SQL from the generated file in `drizzle/`.
3. In the Pages project, add a **D1 database binding** named `DB` for Production and Preview, pointing to that database.
4. Redeploy the Pages project so the root `functions/` directory is activated.

Cloudflare Pages discovers the routes in `functions/api/` automatically. Do not move `functions/` into `dist/client`.

## Use automatic shared sync

1. Redeploy the Pages project after adding the `DB` binding.
2. Open the normal calendar URL on the browser that already has your roster. Its existing device events are copied into the shared calendar once.
3. Open that same normal URL on another phone or in private/incognito mode. The shared events load automatically.

## Run locally (optional)

Requires Node.js 22.23.2.

```bash
npm install
npm run dev
```

Open the local address shown in the terminal.

## Verify a production build

```bash
npm test
```

The generated static site is written to `dist/client`.

## Import a Work roster

1. Switch to **Work**.
2. Tap **Import roster** in the toolbar or **Menu → Import roster file**.
3. Choose the full monthly roster screenshot with the month title visible, or an exported IVU.plan monthly duty-schedule PDF.
4. Review every detected day. Correct any highlighted item with its shift picker.
5. Tap **Import days**.

Supported input formats:

- IVU.plan Portal monthly duty-schedule PDF with selectable text
- PNG, JPG, or WebP full-month roster screenshot

Supported roster codes and output:

| Source code | Calendar title | Time |
| --- | --- | --- |
| `E3-DC` | Early | 07:00–15:30 |
| `L3-DC` | Late | 15:00–23:30 |
| `N3-DC` | Night | 23:00–07:30 next day |
| `WR` | RD | All day |
| `E EX`, `L EX`, `N EX` | Early/Late/Night `(EX)` | Uses the matching start-or-finish extension |
| `E RD`, `L RD`, `N RD` | Early/Late/Night RDOT | Uses the normal shift time |
