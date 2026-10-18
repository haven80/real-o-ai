# Real o AI?

Condividi un video o una foto dal telefono e scopri quanto è probabile che sia generato con l'intelligenza artificiale. Il punteggio arriva dal modello `genai` di [Sightengine](https://sightengine.com/docs/ai-generated-video-detection).

```
Telefono ──video──▶ Worker Cloudflare (custodisce le chiavi) ──▶ Sightengine
   ▲                          │
   └──── pagina risultato ◀───┘  (su GitHub Pages)
```

- **Sito** (questa cartella): pagine statiche su GitHub Pages, installabile come app.
- **Worker** (`worker/`): piccolo proxy gratuito su Cloudflare. Tiene nascoste le chiavi Sightengine e blocca chi non ha il tuo codice di accesso.
- **Android**: il sito installato compare nel menu *Condividi*.
- **iPhone**: il sito aggiunto alla schermata Home; per le foto anche un Comando Rapido.

**Come funziona col piano gratuito.** Sightengine non include l'analisi video nel piano gratuito, quindi il browser estrae **6 fotogrammi** distribuiti sul video e li manda come immagini. Ogni immagine costa **5 operazioni**: un video = 30 operazioni, una foto = 5. Con le 2.000 operazioni gratuite al mese (max 500 al giorno) sono circa **66 video al mese, 16 al giorno**. Il numero di fotogrammi si cambia con `FRAMES` in `config.js`. I video possono avere qualsiasi durata.

---

## 1. Chiavi Sightengine

1. Crea un account su <https://dashboard.sightengine.com/signup>.
2. Nel pannello, sezione **API keys**, copia `api_user` e `api_secret`.
3. Il piano gratuito basta: il sito usa il rilevatore di immagini. L'analisi video nativa richiede un piano a pagamento.

## 2. Worker Cloudflare (senza installare nulla)

1. Crea un account gratuito su <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Create Worker**, chiamalo `real-o-ai`, poi **Deploy**.
3. **Edit code**: cancella tutto, incolla il contenuto di `worker/worker.js`, poi **Deploy**.
4. **Settings → Variables and Secrets → Add**:

   | Nome | Tipo | Valore |
   |---|---|---|
   | `SE_API_USER` | Secret | il tuo `api_user` |
   | `SE_API_SECRET` | Secret | il tuo `api_secret` |
   | `ACCESS_TOKEN` | Secret | una parola d'ordine lunga, inventata da te |
   | `SITE_URL` | Text | `https://TUO-UTENTE.github.io/real-o-ai/` |
   | `ALLOWED_ORIGIN` | Text | `https://TUO-UTENTE.github.io` |
   | `INTERVAL` | Text | `2` (secondi tra un fotogramma e l'altro: 0.5, 1, 2, 3, 4, 5) |

5. Apri l'indirizzo del Worker (es. `https://real-o-ai.TUO-ACCOUNT.workers.dev`): deve rispondere `"configured":true`.

> In alternativa, da terminale: `cd worker && npx wrangler deploy`, poi `npx wrangler secret put SE_API_USER` (e così per gli altri secret). I valori di testo sono in `wrangler.toml`.

## 3. Sito su GitHub Pages

1. Crea un repository pubblico chiamato `real-o-ai`.
2. Carica **tutti** i file di questa cartella (compresi `icons/`, `worker/` e il file nascosto `.nojekyll`).
3. Modifica `config.js` e metti l'indirizzo del tuo Worker:
   ```js
   window.APP_CONFIG = { WORKER_URL: "https://real-o-ai.TUO-ACCOUNT.workers.dev" };
   ```
4. **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, cartella `/ (root)`.
5. Dopo un minuto il sito è su `https://TUO-UTENTE.github.io/real-o-ai/`.
6. Aprilo, tocca **Codice di accesso** e inserisci il tuo `ACCESS_TOKEN` (resta salvato sul dispositivo).

La cartella `worker/` pubblicata sul sito non contiene segreti: le chiavi esistono solo nelle impostazioni del Worker.

## 4. Android: condividi → Real o AI?

1. Apri il sito in **Chrome** → menu **⋮ → Installa app** (o *Aggiungi a schermata Home*).
2. Inserisci il codice di accesso una volta.
3. Da **Galleria / Google Foto / File**: *Condividi* → **Real o AI?** L'analisi parte da sola e si apre la pagina con il punteggio.

Se l'app non compare subito nel menu Condividi, apri il sito una volta dall'icona installata e riprova.

## 5. iPhone

Le web app su iPhone non possono ricevere contenuti dal menu *Condividi*, quindi:

1. Apri il sito in **Safari** → **Condividi → Aggiungi alla schermata Home**.
2. Apri l'icona, inserisci il codice di accesso una volta.
3. Tocca **Scegli un video o una foto** e prendilo dalla libreria.

**Comando Rapido (solo foto).** Con il piano gratuito di Sightengine il Worker accetta solo immagini, e i Comandi Rapidi non sanno estrarre i fotogrammi da un video. Per le foto puoi però creare un comando da usare dal menu *Condividi*:

1. **Comandi Rapidi** → **+** → chiamalo **Real o AI?** → **ⓘ** → attiva **Mostra nel foglio di condivisione**, in *Ricevi* lascia solo **Immagini**.
2. Azioni, in ordine:
   1. **Converti immagine** → in **JPEG**
   2. **Ottieni contenuti dell'URL**
      - URL: indirizzo del tuo Worker + `/analyze`
      - **Metodo** `POST` · **Intestazioni**: `X-Access-Token` = il tuo `ACCESS_TOKEN`
      - **Corpo richiesta** `Modulo` → campo **File**, chiave `media`, valore = *Immagine convertita*
   3. **Ottieni valore dizionario** → chiave `resultUrl`
   4. **Se** *Valore dizionario* **ha un valore** → **Apri URL**; **Altrimenti** → **Ottieni valore dizionario** chiave `error` → **Mostra risultato**; **Fine Se**

Con un piano Sightengine a pagamento il Worker accetta anche il video intero nel campo `media` (analisi video nativa).

## Video da TikTok, Instagram, YouTube

Condividere direttamente da queste app invia il **link alla pagina**, non il video. Salva prima il video sul telefono (o registra lo schermo), poi condividi il file. Funzionano anche i link **diretti** a un file `.mp4`/`.mov`/`.webm`.

## Come leggere il punteggio

- Il numero grande è la **media** dei fotogrammi analizzati; il "fotogramma più sospetto" è il valore massimo.
- ≥ 70% → *Probabilmente AI* · 30–70% → *Incerto* · < 30% → *Probabilmente reale*. Le soglie sono in `result.js` (`verdict`) e `app.js` (`tone`).
- Il modello cerca video **interamente generati** (Sora, Veo, Kling, Runway, Pika…). Un video vero con un volto sostituito può risultare "reale": per quello Sightengine ha un modello `deepfake` separato (aggiungibile nel Worker, raddoppia le operazioni).
- È una stima statistica, non una prova.

## Privacy

- Il sito non conserva i video. Il Worker li inoltra a Sightengine e non li salva.
- Il risultato è codificato nel link stesso (`result.html#d=…`): condividendo il link condividi solo punteggio e nome del file.
- Le analisi recenti restano solo nel browser del dispositivo.

## File

| File | Cosa fa |
|---|---|
| `index.html`, `app.js` | caricamento, ricezione dei video condivisi, invio al Worker |
| `result.html`, `result.js` | pagina risultato con punteggio e grafico |
| `sw.js`, `manifest.webmanifest` | installazione come app e menu Condividi su Android |
| `config.js` | indirizzo del Worker (unico file da modificare) |
| `worker/worker.js` | proxy Cloudflare verso Sightengine |
| `worker/wrangler.toml` | configurazione per chi usa la riga di comando |
