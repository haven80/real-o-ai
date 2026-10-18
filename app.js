(() => {
  const MAX_SECONDS = 60; // limite dell'analisi sincrona di Sightengine
  const MAX_BYTES = 95 * 1024 * 1024; // limite di upload dei Worker Cloudflare (piano gratuito: 100 MB)
  const TOKEN_KEY = "realoai.token";
  const HISTORY_KEY = "realoai.history";

  const cfg = window.APP_CONFIG || {};
  const WORKER = (cfg.WORKER_URL || "").replace(/\/+$/, "");
  const configured = WORKER && !/TUO-ACCOUNT/.test(WORKER);

  const $ = (id) => document.getElementById(id);
  const el = {
    setupWarn: $("setupWarn"), notice: $("notice"), drop: $("drop"), file: $("file"),
    picked: $("picked"), preview: $("preview"), pickedName: $("pickedName"), pickedInfo: $("pickedInfo"),
    change: $("change"), go: $("go"), pickCard: $("pickCard"), status: $("status"),
    statusText: $("statusText"), timer: $("timer"), token: $("token"), tokenSaved: $("tokenSaved"),
    settings: $("settings"), recent: $("recent"), recentCard: $("recentCard"),
  };

  let current = null; // { file?: File, url?: string, duration?: number }
  let previewUrl = null;

  // ---------- storage sicuro ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  };

  // ---------- avvio ----------
  if (!configured) el.setupWarn.classList.add("show");

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

  async function pickFile(file, { autostart = false } = {}) {
    hideNotice();
    if (file.type && !file.type.startsWith("video/")) {
      return showNotice("error", "Questo non è un video", "Scegli un file video (MP4, MOV o WebM).");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    el.preview.src = previewUrl;
    el.pickedName.textContent = file.name || "video";
    el.pickedInfo.textContent = formatBytes(file.size);
    el.drop.style.display = "none";
    el.picked.classList.add("show");
    current = { file };
    el.go.disabled = true;

    const duration = await readDuration(el.preview);
    current.duration = duration;
    el.pickedInfo.textContent = [duration ? formatDuration(duration) : null, formatBytes(file.size)].filter(Boolean).join(" · ");

    if (file.size > MAX_BYTES) {
      return showNotice("error", "Video troppo pesante", `Il limite è circa ${formatBytes(MAX_BYTES)}. Accorcialo o riducine la qualità.`);
    }
    if (duration && duration > MAX_SECONDS + 0.5) {
      return showNotice("error", "Video troppo lungo", `Dura ${formatDuration(duration)}: l'analisi rapida accetta video fino a 1 minuto. Taglia il pezzo che ti interessa e riprova.`);
    }
    el.go.disabled = !configured;
    if (autostart && configured) analyze();
  }

  function readDuration(video) {
    return new Promise((resolve) => {
      const done = () => resolve(Number.isFinite(video.duration) ? video.duration : null);
      if (video.readyState >= 1) return done();
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("error", () => resolve(null), { once: true });
      setTimeout(() => resolve(null), 4000);
    });
  }

  // ---------- contenuto arrivato dal menu Condividi (Android) ----------
  async function handleSharedLaunch() {
    const params = new URLSearchParams(location.search);
    const shared = params.get("shared");
    if (!shared) return;
    history.replaceState(null, "", "./");

    if (shared === "error") {
      return showNotice("error", "Condivisione non riuscita", "Non sono riuscito a ricevere il video. Prova a sceglierlo da qui.");
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

      const link = meta.url || (meta.text.match(/https?:\/\/\S+/) || [])[0] || "";
      if (link && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(link)) {
        current = { url: link };
        el.drop.style.display = "none";
        el.picked.classList.add("show");
        el.preview.removeAttribute("src");
        el.pickedName.textContent = link.split("/").pop().split("?")[0];
        el.pickedInfo.textContent = "link diretto";
        el.go.disabled = !configured;
        return;
      }
      showNotice("warn", "Hai condiviso un link, non il video",
        "TikTok, Instagram e YouTube inviano solo l'indirizzo della pagina. Salva il video sul telefono, poi condividi il file da Galleria o File.");
    } catch {
      showNotice("error", "Condivisione non riuscita", "Prova a scegliere il video da qui.");
    }
  }

  // ---------- analisi ----------
  async function analyze() {
    if (!configured) return;
    hideNotice();
    setBusy(true);

    const form = new FormData();
    if (current.file) form.append("media", current.file, current.file.name || "video.mp4");
    else form.append("url", current.url);

    const headers = {};
    const token = (store.get(TOKEN_KEY) || el.token.value || "").trim();
    if (token) headers["X-Access-Token"] = token;

    const started = Date.now();
    const messages = [
      [0, "Invio del video…"],
      [4, "Estrazione dei fotogrammi…"],
      [9, "Analisi dei fotogrammi con il modello genai…"],
      [25, "Quasi fatto: i video lunghi richiedono più tempo…"],
    ];
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      el.timer.textContent = `${s} s`;
      el.statusText.textContent = messages.filter(([t]) => s >= t).pop()[1];
    }, 500);

    try {
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
      nm.textContent = it.n || "video";
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
