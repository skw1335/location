import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "location.userKey";

/**
 * An opaque per-device key, minted once and kept in the keychain. It isn't
 * identity — it proves nothing about who you are — it just partitions the
 * server cache so one device can't read another's places. When real sign-in
 * lands, the account id takes this slot.
 *
 * SecureStore has no web implementation, so the web build falls back to
 * localStorage. Same shape, weaker storage — fine for a dev target.
 */
async function read(): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(KEY, value);
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

let cached: Promise<string> | null = null;

export function userKey(): Promise<string> {
  cached ??= (async () => {
    const existing = await read();
    if (existing) return existing;
    const minted = randomUUID();
    await write(minted);
    return minted;
  })();
  return cached;
}
