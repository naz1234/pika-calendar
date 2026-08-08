# My Calendar

A private, mobile-first calendar with separate **Work** and **Personal** modes. It uses a Google Calendar-inspired month layout, includes ISO week numbers, and needs no login or account.

## Included

- Work and Personal calendar modes
- Sunday-first month grid with week numbers
- Add, edit, search, and delete events
- All-day events, start/end times, and notes
- Swipe or use arrows to change months
- Dark and light themes
- JSON backup and restore
- Installable mobile web app with offline app-shell support
- Responsive layout for phones, tablets, and desktop

## Important: where events are saved

Events are stored only in the browser on the device where you create them. There is no server, login, or automatic sync.

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
