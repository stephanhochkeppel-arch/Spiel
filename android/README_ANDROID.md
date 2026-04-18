# Android-Hinweise

Diese App ist als gemeinsame Web-Oberfläche vorbereitet.

## Minimaler Weg

```bash
npm install
npm install @capacitor/core @capacitor/cli
npx cap add android
npx cap sync android
npx cap open android
```

## Wichtiger Punkt

Der schöne App-Teil läuft direkt aus `app/`.
Für den echten Hermes-Core auf Android ist Termux der saubere Weg.
