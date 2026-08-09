# My Calendar

A private, mobile-first calendar with separate **Work** and **Personal** modes. It uses a Google Calendar-inspired month layout, includes ISO week numbers, and needs no login or account.

## Included

- Work and Personal calendar modes
- Sunday-first month grid with week numbers
- Work-roster screenshot import with an editable review before saving
- Automatic Early, Late, Night, RD, extension `(EX)`, and RDOT mapping
- Add, edit, search, and delete events
- All-day events, overnight shifts, start/end times, and notes
- Swipe or use arrows to change months
- Dark and light themes
- JSON backup and restore
- Installable mobile web app with offline app-shell support
- Responsive layout for phones, tablets, and desktop

## Important: where events are saved

Events are stored only in the browser on the device where you create them. There is no server, login, or automatic sync.

Roster screenshots are also read entirely in your browser. The screenshot is not uploaded or saved; only the Work events you approve are stored. Re-importing the same month replaces only that month’s earlier roster-image events, while manual Work events and all Personal events remain.

Use **Menu → Download backup** occasionally. Clearing browser data, changing domains, or moving to another phone can remove local events unless you have a backup.

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
2. Tap **Import roster** in the toolbar or **Menu → Import roster image**.
3. Choose the full monthly roster screenshot with the month title visible.
4. Review every detected day. Correct any highlighted item with its shift picker.
5. Tap **Import days**.

Supported roster codes and output:

| Source code | Calendar title | Time |
| --- | --- | --- |
| `E3-DC` | Early | 07:00–15:30 |
| `L3-DC` | Late | 15:00–23:30 |
| `N3-DC` | Night | 23:00–07:30 next day |
| `WR` | RD | All day |
| `E EX`, `L EX`, `N EX` | Early/Late/Night `(EX)` | Uses the matching start-or-finish extension |
| `E RD`, `L RD`, `N RD` | Early/Late/Night RDOT | Uses the normal shift time |
