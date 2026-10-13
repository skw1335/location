# location

Your saved Google Maps places, sorted by how far you have to walk. Tap one to
open it in Google Maps. Design and status: [SPEC.md](SPEC.md). Ideas:
[FEATURES.md](FEATURES.md).

## Run it

Needs [Bun](https://bun.sh) and [OrbStack](https://orbstack.dev) (for Docker).

```sh
docker compose up -d           # database (needs OrbStack running)
cd api && bun run dev          # API on :3000
cd app && bunx expo start      # then open exp://<mac-ip>:8081 on the phone
```

First time only: `bun install` in both `api/` and `app/`.

## On the iPhone

1. Same Wi-Fi as the Mac; install **Expo Go** from the App Store.
2. Open `exp://<mac-ip>:8081` in Safari (or scan the QR code `expo start`
   prints). Get the IP with `ipconfig getifaddr en0`.
3. Connect a list: paste its share link, or set up the share-sheet Shortcut
   in [app/SHORTCUT.md](app/SHORTCUT.md).

## Tests

```sh
cd api && bun test   # needs the database up
cd app && bun test
```
