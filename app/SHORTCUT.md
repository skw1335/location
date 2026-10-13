# "Add to location" Shortcut

The free stand-in for a share extension, which needs the $99 Apple Developer
Program. It puts **Add to location** in Google Maps' share sheet; tapping it
opens the app with the list, and the app connects it.

## Set up (once, on the iPhone)

1. Open the **location** app's connect screen (tap **+ list**) and note the
   **Shortcut link** at the bottom, e.g.
   `exp://192.168.68.243:8081/--/connect?url=` in Expo Go, or
   `location://connect?url=` in a real build.
2. Open **Shortcuts** → **+** → name it **Add to location**.
3. Tap the **ⓘ** (details) → turn on **Show in Share Sheet**. Set it to
   receive **URLs** and **Text**.
4. Add the action **URL Encode** — input: *Shortcut Input*.
5. Add the action **Text** — type the Shortcut link from step 1, then insert
   the *URL Encoded Text* variable straight after `url=`.
6. Add the action **Open URLs** — input: the *Text* from step 5.

## Use

Google Maps → **You** → **Saved** → open a list → **Share** → **Add to
location**. The app opens, shows "Fetching…", then the places.

Maps sometimes shares a sentence with the link in it rather than a bare link;
the app digs the link out either way.

## Expo Go caveat

In Expo Go the link contains the Mac's Wi-Fi address and Metro's port. If the
Mac gets a new address, update the Text action in step 5 with the new link
from the connect screen. A real build uses `location://`, which never changes.
