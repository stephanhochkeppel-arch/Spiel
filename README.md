# Hermes Window

Hermes Window ist eine schöne, ChatGPT-ähnliche Oberfläche für **Android** und **Windows**, die als gemeinsame Web-App gebaut ist und sich später an einen echten **Hermes Agent** oder jeden anderen **OpenAI-kompatiblen Endpoint** anhängen lässt.

## Durchgang 1

Dieser erste Ausbau enthält bereits:

- schöne Chat-Oberfläche im Stil moderner Chat-Apps
- responsive für Mobil und Desktop
- Sessions links in der Sidebar
- Schnellaktionen wie Recherche, Code, Automationen, Skills
- Aktivitäts- und Statusbereich
- lokaler Mock-Agent für sofortige Nutzung
- optionaler Proxy zu einem echten OpenAI-kompatiblen Backend
- Vorlagen für **Capacitor (Android)** und **Tauri (Windows)**
- Setup-Skripte für Hermes auf **Termux** und **WSL2**

## Wichtiger Realitätscheck

Dieses Projekt enthält **nicht** den kompletten offiziellen Hermes-Quellcode als vendorten Dump. Stattdessen ist es eine **eigene App-Schicht**, die rechtlich sauber vorbereitet ist und sich an Hermes anhängen kann. So bleibt die Oberfläche kontrollierbar und schön.

Wenn du die offizielle Hermes-Installation dazunehmen willst, benutze die beiliegenden Skripte:

- `scripts/setup-hermes-termux.sh`
- `scripts/setup-hermes-wsl.ps1`

## Schnellstart

```bash
npm install
cp .env.example .env
npm start
```

Dann im Browser öffnen:

```text
http://localhost:8787
```

## Mock-Modus

Ohne weitere Konfiguration läuft die App sofort mit einem lokalen Demo-Agenten.

## Echter Agenten-Modus

Wenn du einen OpenAI-kompatiblen Endpoint hast, setze in `.env`:

```env
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8000
OPENAI_COMPAT_API_KEY=dein_key
OPENAI_COMPAT_MODEL=dein_modell
OPENAI_COMPAT_PREFIX=/v1
```

Danach leitet der Server Chat-Anfragen an den echten Endpoint weiter.

## Android

1. Node installieren
2. Android Studio installieren
3. Im Projekt ausführen:

```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Die Web-Dateien liegen direkt im Ordner `app/`, daher ist keine zusätzliche Frontend-Build-Pipeline nötig.

## Windows

1. Rust installieren
2. WebView2 sicherstellen
3. Tauri-CLI installieren
4. Dann:

```bash
npm install
cargo install tauri-cli
cargo tauri dev
```

## Projektstruktur

```text
app/                schöne Oberfläche
backend/            Express-Server + Proxy
src-tauri/          Windows-Desktop-Hülle
scripts/            Install- und Hilfsskripte
android/            Android-Hinweise
windows/            Windows-Hinweise
```

## Hermes-Bezug

Dieses Projekt orientiert sich an öffentlich dokumentierten Hermes-Fähigkeiten wie:

- Android über Termux
- Windows über WSL2
- OpenAI-kompatibler API-Server
- Skills, Memory, Automationen, Tools

Die offizielle Hermes-Lizenz ist MIT. Siehe `NOTICE_HERMES.md` und `LICENSE_HERMES_MIT.txt`.
