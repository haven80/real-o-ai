/**
 * Real o AI? — proxy Cloudflare Worker per Sightengine
 *
 * Custodisce le chiavi Sightengine (mai esposte nel sito), riceve un video,
 * lo inoltra all'endpoint sincrono di Sightengine (modello "genai") e
 * restituisce un riepilogo con il punteggio + il link alla pagina risultato.
 *
 * Variabili d'ambiente (Settings → Variables and Secrets del Worker):
 *   SE_API_USER     (secret)   api_user di Sightengine
 *   SE_API_SECRET   (secret)   api_secret di Sightengine
 *   ACCESS_TOKEN    (secret)   codice di accesso personale (consigliato)
 *   SITE_URL        (testo)    es. https://tuonome.github.io/real-o-ai/
 *   ALLOWED_ORIGIN  (testo)    es. https://tuonome.github.io  (opzionale, default *)
 *   INTERVAL        (testo)    secondi tra un fotogramma e l'altro: 0.5,1,2,3,4,5 (default 2)
 *
 * Endpoint:
 *   GET  /          → stato
 *   POST /analyze   → multipart/form-data con campo "media" (file video o immagine)
 *                     oppure campo "url" (link DIRETTO a un file video)
 *                     oppure più campi "frame" (fotogrammi JPEG estratti dal browser,
 *                     + "interval" e "name"): funziona anche con il piano gratuito.
 *                     Codice di accesso: header "X-Access-Token" o campo "token".
 */

const SE_SYNC_URL = "https://api.sightengine.com/1.0/video/check-sync.json";
const SE_IMAGE_URL = "https://api.sightengine.com/1.0/check.json";
const VALID_INTERVALS = ["0.5", "1", "2", "3", "4", "5"];
const MAX_FRAMES = 60;
const IMAGE_CONCURRENCY = 3;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const { pathname } = new URL(request.url);

    if (request.method === "GET" && (pathname === "/" || pathname === "")) {
      return json({ ok: true, service: "real-o-ai", version: 2, images: true, configured: Boolean(env.SE_API_USER && env.SE_API_SECRET) }, 200, cors);
    }

    if (request.method !== "POST" || pathname !== "/analyze") {
      return json({ ok: false, error: "Endpoint non trovato. Usa POST /analyze." }, 404, cors);
    }

    if (!env.SE_API_USER || !env.SE_API_SECRET) {
      return json({ ok: false, error: "Worker non configurato: mancano SE_API_USER / SE_API_SECRET." }, 500, cors);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: "Richiesta non valida: serve un invio multipart/form-data." }, 400, cors);
    }

    // Codice di accesso: evita che chiunque trovi l'URL e consumi il tuo credito.
    if (env.ACCESS_TOKEN) {
      const token = request.headers.get("X-Access-Token") || form.get("token") || "";
      if (!timingSafeEqual(String(token).trim(), env.ACCESS_TOKEN)) {
        return json({ ok: false, error: "Codice di accesso mancante o errato." }, 401, cors);
      }
    }

    const media = form.get("media");
    const url = (form.get("url") || "").toString().trim();
    const hasFile = isFile(media);
    const frameFiles = form.getAll("frame").filter(isFile).slice(0, MAX_FRAMES);
    const isImage = hasFile && String(media.type || "").startsWith("image/");

    // Modalità immagini (piano gratuito): fotogrammi estratti dal browser, o una singola immagine.
    if (frameFiles.length || isImage) {
      const images = frameFiles.length ? frameFiles : [media];
      const step = Number(form.get("interval")) || 2;
      const name = String(form.get("name") || (hasFile ? media.name : "") || "immagine").slice(0, 80);
      let se;
      try {
        se = await analyzeImages(images, env, step);
      } catch (e) {
        return json({ ok: false, error: `Sightengine: ${e.message}`, code: e.code ?? null }, 502, cors);
      }
      return respond(summarize(se, { name, interval: frameFiles.length ? step : 0 }), env, cors);
    }

    if (!hasFile && !url) {
      return json({ ok: false, error: "Nessun video ricevuto. Invia un file nel campo \"media\"." }, 400, cors);
    }

    const interval = VALID_INTERVALS.includes(String(env.INTERVAL)) ? String(env.INTERVAL) : "2";

    const seForm = new FormData();
    seForm.append("models", "genai");
    seForm.append("interval", interval);
    seForm.append("api_user", env.SE_API_USER);
    seForm.append("api_secret", env.SE_API_SECRET);

    let name;
    let seRequest;
    if (hasFile) {
      name = media.name || "video.mp4";
      seForm.append("media", media, name);
      seRequest = fetch(SE_SYNC_URL, { method: "POST", body: seForm });
    } else {
      name = url.split("/").pop().split("?")[0] || "video";
      // Con un URL, Sightengine scarica il video da sé (deve essere un link diretto al file).
      const params = new URLSearchParams({
        stream_url: url,
        models: "genai",
        interval,
        api_user: env.SE_API_USER,
        api_secret: env.SE_API_SECRET,
      });
      seRequest = fetch(`${SE_SYNC_URL}?${params}`, { method: "GET" });
    }

    let se;
    try {
      const res = await seRequest;
      se = await res.json();
    } catch (e) {
      return json({ ok: false, error: "Sightengine non ha risposto correttamente. Riprova tra poco." }, 502, cors);
    }

    if (se.status !== "success") {
      const msg = se.error?.message || "Errore sconosciuto";
      return json({ ok: false, error: `Sightengine: ${msg}`, code: se.error?.code ?? null }, 502, cors);
    }

    return respond(summarize(se, { name, interval: Number(interval) }), env, cors);
  },
};

function respond(result, env, cors) {
  const d = encodeResult(result);
  const site = (env.SITE_URL || "").replace(/\/?$/, "/");
  return json({ ok: true, ...result, d, resultUrl: env.SITE_URL ? `${site}result.html#d=${d}` : null }, 200, cors);
}

/**
 * Analizza una o più immagini con il modello genai per immagini (incluso nel piano gratuito).
 * Restituisce un oggetto con la stessa forma della risposta video, così il resto del codice non cambia.
 */
async function analyzeImages(images, env, step) {
  const results = new Array(images.length);
  let next = 0;
  async function worker() {
    while (next < images.length) {
      const i = next++;
      const f = new FormData();
      f.append("media", images[i], images[i].name || `frame-${i}.jpg`);
      f.append("models", "genai");
      f.append("api_user", env.SE_API_USER);
      f.append("api_secret", env.SE_API_SECRET);
      const res = await fetch(SE_IMAGE_URL, { method: "POST", body: f });
      const body = await res.json().catch(() => ({}));
      if (body.status !== "success") {
        const err = new Error(body.error?.message || "risposta non valida");
        err.code = body.error?.code;
        throw err;
      }
      results[i] = body;
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, images.length) }, worker));
  return {
    status: "success",
    request: { operations: results.reduce((n, r) => n + (r.request?.operations ?? 1), 0) },
    data: {
      frames: results.map((r, i) => ({ info: { position: i * step }, type: { ai_generated: r.type?.ai_generated ?? 0 } })),
    },
  };
}

function isFile(v) {
  return v && typeof v === "object" && "arrayBuffer" in v && v.size > 0;
}

/** Riduce la risposta Sightengine a un riepilogo compatto. */
export function summarize(se, { name, interval }) {
  const frames = (se.data?.frames || [])
    .map((f) => ({
      t: Number(f.info?.position ?? 0),
      s: clamp01(Number(f.type?.ai_generated ?? 0)),
    }))
    .sort((a, b) => a.t - b.t);

  const scores = frames.map((f) => f.s);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const max = scores.length ? Math.max(...scores) : 0;

  return {
    name,
    score: round2(avg), // punteggio principale: media dei fotogrammi
    peak: round2(max), // fotogramma più sospetto
    frames: frames.length,
    interval,
    operations: se.request?.operations ?? null,
    perFrame: scores.map(round2),
    analyzedAt: Math.round(Date.now() / 1000),
  };
}

/** Codifica il risultato in base64url per passarlo nell'hash della pagina risultato. */
export function encodeResult(r) {
  const compact = {
    v: 1,
    n: r.name.slice(0, 80),
    a: r.score,
    m: r.peak,
    i: r.interval,
    o: r.operations,
    f: r.perFrame,
    t: r.analyzedAt,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round2 = (x) => Math.round(x * 100) / 100;
