const CACHE_NAME = "my-calendar-v11";
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

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
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
