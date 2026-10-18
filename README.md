# Real o AI?

Condividi un video dal telefono e scopri quanto è probabile che sia generato con l'intelligenza artificiale. Il punteggio arriva dal modello `genai` di [Sightengine](https://sightengine.com/docs/ai-generated-video-detection).

```
Telefono ──video──▶ Worker Cloudflare (custodisce le chiavi) ──▶ Sightengine
   ▲                          │
   └──── pagina risultato ◀───┘  (su GitHub Pages)
```

- **Sito** (questa cartella): pagine statiche su GitHub Pages, installabile come app.
- **Worker** (`worker/`): piccolo proxy gratuito su Cloudflare. Tiene nascoste le chiavi Sightengine e blocca chi non ha il tuo codice di accesso.
- **Android**: il sito installato compare nel menu *Condividi*.
- **iPhone**: un Comando Rapido invia il video e apre la pagina risultato.

Limiti: video **fino a 1 minuto**, circa 95 MB. Con 1 fotogramma ogni 2 secondi, un video di 30 s consuma **circa 15 operazioni** Sightengine.

---

## 1. Chiavi Sightengine

1. Crea un account su <https://dashboard.sightengine.com/signup>.
2. Nel pannello, sezione **API keys**, copia `api_user` e `api_secret`.
3. Prima di proseguire controlla nel pannello che il tuo piano includa l'analisi **video** (alcune fonti indicano che il piano gratuito potrebbe non includerla).

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

## 5. iPhone: Comando Rapido

Le web app su iPhone non possono ricevere contenuti condivisi, quindi si usa un Comando Rapido che parla direttamente con il Worker.

1. Apri **Comandi Rapidi** → **+** → chiamalo **Real o AI?**
2. Tocca l'icona **ⓘ** in basso → attiva **Mostra nel foglio di condivisione**. In *Ricevi*, lascia solo **Contenuti multimediali** (o *Video*).
3. Aggiungi le azioni, in quest'ordine:

   1. **Ottieni contenuti dell'URL**
      - URL: `https://real-o-ai.TUO-ACCOUNT.workers.dev/analyze`
      - Mostra altro → **Metodo**: `POST`
      - **Intestazioni**: chiave `X-Access-Token`, valore = il tuo `ACCESS_TOKEN`
      - **Corpo richiesta**: `Modulo` → aggiungi campo di tipo **File**, chiave `media`, valore = variabile **Input comando rapido**
   2. **Ottieni valore dizionario** → chiave `resultUrl` in *Contenuti dell'URL*
   3. **Se** *Valore dizionario* **ha un valore**
      - **Apri URL** → *Valore dizionario*
   4. **Altrimenti**
      - **Ottieni valore dizionario** → chiave `error` in *Contenuti dell'URL*
      - **Mostra risultato** → *Valore dizionario*
   5. **Fine Se**

4. Usalo da **Foto** (o da qualsiasi app che condivide un video): *Condividi* → **Real o AI?** Dopo qualche secondo Safari apre la pagina con il punteggio.

Suggerimento: se i video sono pesanti, aggiungi come prima azione **Codifica contenuti multimediali** (dimensione 1280×720) e usa il suo risultato come valore del campo `media`. L'invio sarà più veloce e il risultato non cambia in modo significativo.

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
