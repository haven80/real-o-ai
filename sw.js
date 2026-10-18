// Service worker: rende il sito installabile e riceve i video condivisi (Android).
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const SHARED = "shared-media";
const SHELL_FILES = ["./", "./index.html", "./result.html", "./style.css", "./app.js", "./result.js", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 1) Video condiviso dal menu "Condividi" di Android
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(handleShare(e.request));
    return;
  }

  // 2) File del sito: rete prima, cache se offline
  if (e.request.method === "GET" && url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
  }
});

async function handleShare(request) {
  const base = new URL("./", self.location.href);
  try {
    const form = await request.formData();
    const file = form.get("media");
    const cache = await caches.open(SHARED);
    await cache.delete("./pending-file");
    await cache.delete("./pending-meta");

    const meta = {
      title: form.get("title") || "",
      text: form.get("text") || "",
      url: form.get("url") || "",
      hasFile: false,
    };

    if (file && typeof file === "object" && file.size > 0) {
      meta.hasFile = true;
      meta.name = file.name || "video.mp4";
      meta.type = file.type || "video/mp4";
      await cache.put("./pending-file", new Response(file, { headers: { "Content-Type": meta.type } }));
    }
    await cache.put("./pending-meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
    return Response.redirect(new URL("./?shared=1", base).href, 303);
  } catch (err) {
    return Response.redirect(new URL("./?shared=error", base).href, 303);
  }
}
