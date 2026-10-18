(() => {
  const TOKEN_KEY = "realoai.token";
  const HISTORY_KEY = "realoai.history";

  const cfg = window.APP_CONFIG || {};
  const WORKER = (cfg.WORKER_URL || "").replace(/\/+$/, "");
  const configured = WORKER && !/TUO-ACCOUNT/.test(WORKER);
  // Fotogrammi estratti da ogni video. Ogni immagine costa 5 operazioni Sightengine.
  const FRAMES = Math.min(20, Math.max(1, Number(cfg.FRAMES) || 6));
  const FRAME_MAX_SIDE = 1280;
  const IMAGE_MAX_SIDE = 2048;
  const JPEG_QUALITY = 0.88;

  const $ = (id) => document.getElementById(id);
  const el = {
    setupWarn: $("setupWarn"), notice: $("notice"), drop: $("drop"), file: $("file"), dropHint: $("dropHint"),
    picked: $("picked"), preview: $("preview"), previewImg: $("previewImg"), pickedName: $("pickedName"),
    pickedInfo: $("pickedInfo"), change: $("change"), go: $("go"), pickCard: $("pickCard"), status: $("status"),
    statusText: $("statusText"), timer: $("timer"), token: $("token"), tokenSaved: $("tokenSaved"),
    settings: $("settings"), recent: $("recent"), recentCard: $("recentCard"),
  };

  let current = null; // { file: File, kind: "video" | "image", duration?: number }
  let previewUrl = null;

  // ---------- storage sicuro ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  };

  // ---------- avvio ----------
  if (!configured) el.setupWarn.classList.add("show");
  el.dropHint.textContent = `Video di qualsiasi durata o foto · da un video analizzo ${FRAMES} fotogrammi`;

  el.token.value = store.get(TOKEN_KEY) || "";
  let saveTimer;
  el.token.addEventListener("input", () => {
    store.set(TOKEN_KEY, el.token.value.trim());
    clearTimeout(saveTimer);
    el.tokenSaved.textContent = "Salvato";
    saveTimer = setTimeout(() => (el.tokenSaved.textContent = ""), 1500);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  renderHistory();
  handleSharedLaunch();

  // ---------- scelta file ----------
  el.file.addEventListener("change", () => {
    const f = el.file.files && el.file.files[0];
    if (f) pickFile(f);
    el.file.value = "";
  });
  el.change.addEventListener("click", () => el.file.click());

  ["dragenter", "dragover"].forEach((t) =>
    el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) =>
    el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.remove("over"); }));
  el.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) pickFile(f);
  });

  el.go.addEventListener("click", () => current && analyze());

  function kindOf(file) {
    const t = (file.type || "").toLowerCase();
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("image/")) return "image";
    const ext = (file.name || "").toLowerCase().split(".").pop();
    if (["mp4", "mov", "webm", "m4v", "mkv", "3gp"].includes(ext)) return "video";
    if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp"].includes(ext)) return "image";
    return null;
  }

  async function pickFile(file, { autostart = false } = {}) {
    hideNotice();
    const kind = kindOf(file);
    if (!kind) {
      return showNotice("error", "Formato non supportato", "Scegli un video (MP4, MOV, WebM) o una foto (JPG, PNG, WebP, HEIC).");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);

    el.preview.hidden = kind !== "video";
    el.previewImg.hidden = kind !== "image";
    if (kind === "video") {
      el.previewImg.removeAttribute("src");
      el.preview.src = previewUrl;
    } else {
      el.preview.removeAttribute("src");
      el.preview.load();
      el.previewImg.src = previewUrl;
    }

    el.pickedName.textContent = file.name || (kind === "video" ? "video" : "immagine");
    el.pickedInfo.textContent = formatBytes(file.size);
    el.drop.style.display = "none";
    el.picked.classList.add("show");
    current = { file, kind };
    el.go.disabled = true;

    if (kind === "video") {
      const duration = await readDuration(el.preview);
      current.duration = duration;
      el.pickedInfo.textContent = [duration ? formatDuration(duration) : null, formatBytes(file.size), `${FRAMES} fotogrammi`]
        .filter(Boolean).join(" · ");
      if (!duration) {
        return showNotice("error", "Video non leggibile", "Il browser non riesce ad aprire questo video. Prova a esportarlo in MP4 (H.264).");
      }
    } else {
      el.pickedInfo.textContent = `foto · ${formatBytes(file.size)}`;
    }

    el.go.disabled = !configured;
    if (autostart && configured) analyze();
  }

  function readDuration(video) {
    return new Promise((resolve) => {
      const done = () => resolve(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      if (video.readyState >= 1) return done();
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("error", () => resolve(null), { once: true });
      setTimeout(() => resolve(null), 8000);
    });
  }

  // ---------- estrazione fotogrammi nel browser ----------
  async function extractFrames(file, count, onProgress) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    try {
      await once(video, "loadeddata", 15000);
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("durata del video non disponibile");

      const { w, h } = fit(video.videoWidth, video.videoHeight, FRAME_MAX_SIDE);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      const frames = [];
      for (let i = 0; i < count; i++) {
        // fotogrammi distribuiti uniformemente, evitando il primo e l'ultimo istante
        const t = Math.min(duration - 0.05, (duration * (i + 0.5)) / count);
        video.currentTime = Math.max(0, t);
        await once(video, "seeked", 10000);
        ctx.drawImage(video, 0, 0, w, h);
        const blob = await toJpeg(canvas);
        frames.push({ blob, t });
        onProgress && onProgress(i + 1, count);
      }
      return { frames, duration };
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }

  async function prepareImage(file) {
    // Converte in JPEG (gestisce HEIC su iPhone e riduce le foto troppo grandi).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const { w, h } = fit(img.naturalWidth, img.naturalHeight, IMAGE_MAX_SIDE);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return await toJpeg(canvas);
    } catch {
      return file; // se il browser non sa decodificarla, la mando così com'è
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function fit(w, h, max) {
    const k = Math.min(1, max / Math.max(w || max, h || max));
    return { w: Math.max(1, Math.round((w || max) * k)), h: Math.max(1, Math.round((h || max) * k)) };
  }
  function toJpeg(canvas) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("conversione immagine non riuscita"))), "image/jpeg", JPEG_QUALITY));
  }
  function once(target, event, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout in attesa di ${event}`)); }, timeout);
      const ok = () => { cleanup(); resolve(); };
      const ko = () => { cleanup(); reject(new Error("il browser non riesce a leggere il video")); };
      function cleanup() {
        clearTimeout(timer);
        target.removeEventListener(event, ok);
        target.removeEventListener("error", ko);
      }
      target.addEventListener(event, ok, { once: true });
      target.addEventListener("error", ko, { once: true });
    });
  }

  // ---------- contenuto arrivato dal menu Condividi (Android) ----------
  async function handleSharedLaunch() {
    const params = new URLSearchParams(location.search);
    const shared = params.get("shared");
    if (!shared) return;
    history.replaceState(null, "", "./");

    if (shared === "error") {
      return showNotice("error", "Condivisione non riuscita", "Non sono riuscito a ricevere il file. Prova a sceglierlo da qui.");
    }

    try {
      const cache = await caches.open("shared-media");
      const metaRes = await cache.match("./pending-meta");
      if (!metaRes) return;
      const meta = await metaRes.json();
      const fileRes = await cache.match("./pending-file");
      await cache.delete("./pending-meta");
      await cache.delete("./pending-file");

      if (meta.hasFile && fileRes) {
        const blob = await fileRes.blob();
        const file = new File([blob], meta.name || "video.mp4", { type: meta.type || blob.type || "video/mp4" });
        return pickFile(file, { autostart: true });
      }
      showNotice("warn", "Hai condiviso un link, non il file",
        "TikTok, Instagram e YouTube inviano solo l'indirizzo della pagina. Salva il video sul telefono, poi condividi il file da Galleria o File.");
    } catch {
      showNotice("error", "Condivisione non riuscita", "Prova a scegliere il file da qui.");
    }
  }

  // ---------- analisi ----------
  async function analyze() {
    if (!configured || !current) return;
    hideNotice();
    setBusy(true);

    const started = Date.now();
    let phase = "Preparazione…";
    const tick = setInterval(() => {
      el.timer.textContent = `${Math.floor((Date.now() - started) / 1000)} s`;
      el.statusText.textContent = phase;
    }, 300);

    try {
      const form = new FormData();
      const baseName = (current.file.name || "file").replace(/\.[^.]+$/, "");

      if (current.kind === "video") {
        phase = "Estrazione dei fotogrammi…";
        const { frames, duration } = await extractFrames(current.file, FRAMES, (n, tot) => {
          phase = `Estrazione dei fotogrammi ${n}/${tot}…`;
        });
        frames.forEach((f, i) => form.append("frame", f.blob, `${baseName}-${i + 1}.jpg`));
        form.append("interval", String(Math.round((duration / FRAMES) * 10) / 10));
        form.append("name", current.file.name || "video");
      } else {
        phase = "Preparazione dell'immagine…";
        const jpeg = await prepareImage(current.file);
        form.append("media", jpeg, jpeg === current.file ? current.file.name : `${baseName}.jpg`);
        form.append("name", current.file.name || "immagine");
      }

      phase = current.kind === "video" ? `Analisi di ${FRAMES} fotogrammi…` : "Analisi dell'immagine…";
      const headers = {};
      const token = (store.get(TOKEN_KEY) || el.token.value || "").trim();
      if (token) headers["X-Access-Token"] = token;

      const res = await fetch(`${WORKER}/analyze`, { method: "POST", body: form, headers });
      let data;
      try { data = await res.json(); } catch { data = { ok: false, error: `Risposta non valida dal Worker (HTTP ${res.status}).` }; }

      if (res.status === 401) {
        el.settings.open = true;
        el.token.focus();
        throw new Error("Codice di accesso mancante o errato. Inseriscilo qui sotto e riprova.");
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `Errore HTTP ${res.status}`);

      addHistory({ d: data.d, n: data.name, a: data.score, t: Date.now() });
      location.href = `result.html#d=${data.d}`;
    } catch (err) {
      const msg = err instanceof TypeError
        ? "Non riesco a contattare il Worker. Controlla la connessione e l'indirizzo in config.js."
        : err.message;
      showNotice("error", "Analisi non riuscita", msg);
      setBusy(false);
    } finally {
      clearInterval(tick);
    }
  }

  function setBusy(busy) {
    el.status.classList.toggle("show", busy);
    el.pickCard.style.display = busy ? "none" : "";
    el.timer.textContent = "0 s";
  }

  // ---------- cronologia locale ----------
  function readHistory() {
    try { return JSON.parse(store.get(HISTORY_KEY) || "[]"); } catch { return []; }
  }
  function addHistory(item) {
    const list = [item, ...readHistory()].slice(0, 10);
    store.set(HISTORY_KEY, JSON.stringify(list));
  }
  function renderHistory() {
    const list = readHistory();
    if (!list.length) return;
    el.recentCard.hidden = false;
    el.recent.innerHTML = "";
    for (const it of list) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `result.html#d=${it.d}`;
      const pill = document.createElement("span");
      pill.className = `pill ${tone(it.a)}`;
      pill.textContent = `${Math.round(it.a * 100)}%`;
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = it.n || "file";
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(it.t).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
      a.append(pill, nm, when);
      li.append(a);
      el.recent.append(li);
    }
  }

  // ---------- utilità ----------
  function tone(score) {
    return score >= 0.7 ? "tone-ai" : score >= 0.3 ? "tone-unsure" : "tone-real";
  }
  function showNotice(kind, title, text) {
    el.notice.className = `notice show ${kind}`;
    el.notice.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    el.notice.append(b, p);
  }
  function hideNotice() { el.notice.className = "notice"; }
  function formatBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  }
  function formatDuration(s) {
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return m ? `${m} min ${r} s` : `${r} s`;
  }
})();
