# ReelType

ReelType è una demo SaaS che genera sottotitoli dinamici, sincronizzati parola
per parola, per video verticali. Tutta l'elaborazione avviene nel browser:
nessun video viene caricato su un server e non serve una chiave API.

## Funzioni

- caricamento di video MP4, MOV e WebM senza un limite applicativo di durata;
- caricamento e gestione di più video nello stesso progetto;
- trascrizione automatica con Whisper eseguito nel browser;
- WebGPU quando disponibile, con fallback WebAssembly;
- timestamp per ogni parola ed effetto karaoke;
- evidenziazione tramite colore o box arrotondato;
- posizionamento e ridimensionamento diretto dei sottotitoli sull'anteprima;
- posizione, dimensione, colori, maiuscolo e preset grafici;
- esportazione del video elaborato direttamente dal browser.

## Requisiti

- Node.js 22.13 o successivo;
- Chrome o Edge aggiornato consigliati per WebGPU;
- connessione internet al primo utilizzo, necessaria per scaricare il modello;
- memoria sufficiente per decodificare il video nel browser.

## Avvio locale

```bash
npm install
npm run dev
```

Apri `http://localhost:3000`.

## Verifica della build

```bash
npm run build
```

## Come funziona

Il browser estrae l'audio dal video, lo converte a 16 kHz mono e lo invia a un
Web Worker. Il worker carica `onnx-community/whisper-tiny` tramite
Transformers.js, genera il testo e restituisce i timestamp delle singole parole.
Il modello viene memorizzato nella cache del browser dopo il primo download.

## Privacy e costi

La trascrizione non usa backend, API a consumo o account esterni. Il video resta
sul dispositivo dell'utente. Il modello Whisper viene scaricato dal repository
pubblico Hugging Face al primo utilizzo.

## Pubblicazione

Il progetto è pronto per essere inserito in un repository GitHub. Prima della
pubblicazione controlla `git status`, scegli una licenza e verifica le condizioni
del servizio di hosting. Il piano Vercel Hobby è indicato solo per progetti
personali e non commerciali.

Non sono richieste variabili d'ambiente o chiavi segrete.
