const CACHE_PREFIX = "my-calendar-v";
const CACHE_NAME = "my-calendar-v45";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icons/calendar-192.png",
  "/icons/calendar-512.png",
  "/icons/calendar-maskable-192.png",
  "/icons/calendar-maskable-512.png",
  "/icons/calendar-apple-180.png",
  "/og.png"
];

async function precacheApp() {
  const pageResponse = await fetch(new Request("/", { cache: "reload" }));
  if (!pageResponse.ok) throw new Error("Could not fetch the app shell");
  const html = await pageResponse.clone().text();
  const builtAssets = [...html.matchAll(/(?:href|src)="(\/_next\/[^"]+)"/g)]
    .map((match) => match[1]);
  const paths = [...new Set([...APP_SHELL, ...builtAssets])];
  const cache = await caches.open(CACHE_NAME);
  await cache.put("/", pageResponse);
  await cache.addAll(paths);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApp().then(() => self.skipWaiting()));
});

async function activateApp() {
  const keys = await caches.keys();
  const isUpgrade = keys.some((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
  await self.clients.claim();

  if (isUpgrade) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      if (typeof client.navigate !== "function") return;
      try {
        await client.navigate(client.url);
      } catch {
        // Some iOS PWA clients cannot navigate while backgrounded. Activation
        // must still finish so the repaired cache controls their next launch.
      }
    }));
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(activateApp());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
