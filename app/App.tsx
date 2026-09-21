import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { connectList, getLists, getPlaces, type Place, type SavedList } from "./src/api";

/**
 * Onboarding is paste-a-link for now. The real flow registers the app as a
 * share target so Maps' share sheet hands the link over directly — two taps,
 * no URL ever visible. See SPEC.md → Deferred.
 */
function Onboarding({
  onConnect,
  busy,
  status,
}: {
  onConnect: (url: string) => void;
  busy: boolean;
  status: string;
}) {
  const t = useTheme();
  const [url, setUrl] = useState("");

  return (
    <View style={styles.pad}>
      <Text style={[styles.h1, { color: t.text }]}>Connect your saved places</Text>
      <Text style={[styles.body, { color: t.dim }]}>
        In Google Maps, open a list you've saved — Favorites, Want to go, or one of
        your own — then tap Share and copy the link.
      </Text>
      <Text style={[styles.body, { color: t.dim }]}>
        You only do this once per list. After that it stays in sync on its own.
      </Text>

      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="Paste the share link"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: t.text, borderColor: t.line }]}
      />

      <Pressable
        onPress={() => onConnect(url.trim())}
        disabled={busy || !url.trim()}
        style={[styles.button, { borderColor: t.line, opacity: busy || !url.trim() ? 0.4 : 1 }]}
      >
        <Text style={{ color: t.text }}>{busy ? "Connecting…" : "Connect"}</Text>
      </Pressable>

      {status ? <Text style={[styles.status, { color: t.dim }]}>{status}</Text> : null}
    </View>
  );
}

function PlaceRow({ place }: { place: Place }) {
  const t = useTheme();
  const distance =
    place.metres === null
      ? null
      : place.metres < 1000
        ? `${place.metres} m`
        : `${(place.metres / 1000).toFixed(1)} km`;

  return (
    <View style={[styles.row, { borderTopColor: t.line }]}>
      <View style={styles.grow}>
        <Text style={[styles.name, { color: t.text }]}>{place.name}</Text>
        <Text style={[styles.tag, { color: t.dim }]}>{place.listName}</Text>
      </View>
      {distance && (
        <View>
          <Text style={[styles.dist, { color: t.text }]}>{distance}</Text>
          <Text style={[styles.tag, { color: t.dim, textAlign: "right" }]}>
            {place.walkMinutes} min walk
          </Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const t = useTheme();
  const [lists, setLists] = useState<SavedList[] | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);

  // Ask for location up front — the whole app is sorted by it.
  useEffect(() => {
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        setStatus("Location denied — places won't be sorted by distance.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextLists, nextPlaces] = await Promise.all([
        getLists(),
        getPlaces(coords ?? undefined),
      ]);
      setLists(nextLists);
      setPlaces(nextPlaces);
    } catch (err) {
      setStatus(`Can't reach the API — is it running? (${String(err)})`);
      setLists([]);
    }
  }, [coords]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async (url: string) => {
    setBusy(true);
    setStatus("Fetching…");
    try {
      const result = await connectList(url);
      setStatus(`Added ${result.count} places from "${result.name}".`);
      setAdding(false);
      await refresh();
    } catch (err) {
      setStatus(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (lists === null) {
    return (
      <SafeAreaView style={[styles.fill, styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const showOnboarding = lists.length === 0 || adding;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      {showOnboarding ? (
        <Onboarding onConnect={handleConnect} busy={busy} status={status} />
      ) : (
        <FlatList
          data={places}
          keyExtractor={(p) => `${p.listName}:${p.id}`}
          renderItem={({ item }) => <PlaceRow place={item} />}
          contentContainerStyle={styles.pad}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={[styles.h1, { color: t.text }]}>Nearby</Text>
              <Pressable onPress={() => setAdding(true)}>
                <Text style={{ color: t.dim }}>+ list</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <Text style={[styles.body, { color: t.dim }]}>
              No places yet. The list connected, but nothing was extracted from it —
              that's the parser, not you.
            </Text>
          }
          refreshing={busy}
          onRefresh={refresh}
        />
      )}
    </SafeAreaView>
  );
}

function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    bg: dark ? "#000" : "#fff",
    text: dark ? "#fff" : "#111",
    dim: dark ? "#888" : "#777",
    line: dark ? "#222" : "#e5e5e5",
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  pad: { padding: 20, gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  h1: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginTop: 8 },
  button: { borderWidth: 1, borderRadius: 10, padding: 12, alignItems: "center" },
  status: { fontSize: 13, marginTop: 4 },
  row: { flexDirection: "row", gap: 16, paddingVertical: 12, borderTopWidth: 1 },
  grow: { flex: 1 },
  name: { fontSize: 16 },
  tag: { fontSize: 12, marginTop: 2 },
  dist: { fontSize: 15, textAlign: "right" },
});
