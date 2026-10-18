(() => {
  const $ = (id) => document.getElementById(id);
  const data = decode(new URLSearchParams(location.hash.slice(1)).get("d"));
  if (!data) return;

  $("empty").style.display = "none";
  $("result").hidden = false;

  const score = clamp(data.a);
  const peak = clamp(data.m);
  const v = verdict(score);
  const color = getComputedStyle(document.documentElement).getPropertyValue(v.cssVar).trim();

  document.title = `${Math.round(score * 100)}% AI · ${data.n || "video"}`;

  // anello
  const ring = $("ring");
  const C = 2 * Math.PI * 52;
  ring.style.stroke = color;
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C}`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = `${C * (1 - score)}`;
  }));
  countUp($("pct"), Math.round(score * 100));

  $("verdict").textContent = v.label;
  $("verdict").style.color = color;
  $("verdictSub").textContent = v.sub;
  $("filename").textContent = data.n || "";
  if (data.t) {
    $("when").textContent = new Date(data.t * 1000).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  $("peak").textContent = `${Math.round(peak * 100)}%`;
  const nFrames = (data.f || []).length;
  const single = nFrames <= 1;
  $("frames").textContent = nFrames || "—";
  $("interval").textContent = data.i ? `${String(data.i).replace(".", ",")} s` : "—";
  if (single) {
    $("chartCard").hidden = true;
    $("statPeak").hidden = true;
    $("statInterval").hidden = true;
    $("framesLabel").textContent = "Tipo";
    $("frames").textContent = "immagine";
  }
  $("ops").textContent = data.o ?? "—";

  drawChart($("chart"), data.f || [], data.i || 1);

  $("share").addEventListener("click", async () => {
    const url = location.href;
    const text = `${v.label}: ${Math.round(score * 100)}% di probabilità che sia generato con l'AI.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Real o AI?", text, url });
      } else {
        await navigator.clipboard.writeText(url);
        $("share").textContent = "Link copiato";
        setTimeout(() => ($("share").textContent = "Condividi"), 1800);
      }
    } catch { /* condivisione annullata */ }
  });

  // ---------- funzioni ----------
  function decode(d) {
    if (!d) return null;
    try {
      const b64 = d.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      return typeof obj.a === "number" ? obj : null;
    } catch {
      return null;
    }
  }

  function verdict(s) {
    if (s >= 0.7) return { label: "Probabilmente AI", sub: "Forti segnali di generazione artificiale.", cssVar: "--ai" };
    if (s >= 0.3) return { label: "Incerto", sub: "Segnali contrastanti: guarda il grafico e valuta con prudenza.", cssVar: "--unsure" };
    return { label: "Probabilmente reale", sub: "Nessun segnale forte di generazione artificiale.", cssVar: "--real" };
  }

  function countUp(node, target) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const set = (n) => { node.firstChild.nodeValue = String(n); };
    if (reduce) return set(target);
    const t0 = performance.now();
    const dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      set(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function drawChart(svg, scores, interval) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 520, H = 170, padL = 34, padR = 6, padT = 8, padB = 22;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const iw = W - padL - padR, ih = H - padT - padB;
    const y = (v) => padT + ih * (1 - v);
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };

    for (const g of [0, 0.5, 1]) {
      add("line", { class: g === 0.5 ? "thr" : "grid", x1: padL, x2: W - padR, y1: y(g), y2: y(g) });
      add("text", { x: padL - 6, y: y(g) + 4, "text-anchor": "end" }, `${g * 100}%`);
    }
    if (!scores.length) return;

    const slot = iw / scores.length;
    const bw = Math.max(2, Math.min(22, slot - 3));
    const css = getComputedStyle(document.documentElement);
    scores.forEach((s, i) => {
      const v = clamp(s);
      const x = padL + slot * i + (slot - bw) / 2;
      const h = Math.max(2, ih * v);
      const col = css.getPropertyValue(verdict(v).cssVar).trim();
      const r = add("rect", { x, y: padT + ih - h, width: bw, height: h, rx: Math.min(4, bw / 2), fill: col });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${fmtTime(i * interval)} · ${Math.round(v * 100)}%`;
      r.append(t);
    });

    const ticks = Math.min(scores.length, 5);
    for (let k = 0; k < ticks; k++) {
      const i = ticks === 1 ? 0 : Math.round((k * (scores.length - 1)) / (ticks - 1));
      const x = padL + slot * i + slot / 2;
      add("text", { x, y: H - 6, "text-anchor": "middle" }, fmtTime(i * interval));
    }
  }

  function fmtTime(sec) {
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function clamp(x) { return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; }
})();
