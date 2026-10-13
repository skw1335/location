import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { clearSharedPayloads, useIncomingShare } from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  applySubcategories,
  CATEGORIES,
  connectList,
  createSubcategory,
  deleteSubcategory,
  getCategories,
  getLists,
  getPlaces,
  type Overview,
  type OverridePatch,
  type Place,
  type PlaceFilter,
  refreshLists,
  type SavedList,
  setOverride,
} from "./src/api";
import { directionsUrl } from "./src/maps";
import { connectLinkFrom, findMapsLink } from "./src/share";

const EMPTY_OVERVIEW: Overview = {
  builtIn: [],
  subcategories: [],
  cuisines: [],
  suggestions: { subcategories: {}, cuisines: [] },
};

const dollars = (price: number | null) => (price ? "$".repeat(price) : null);

/**
 * The main way in is Maps' own share sheet (see the incoming-share effect in
 * App): open a list, tap Share, pick this app. Pasting the link is the
 * fallback — for web, and for anyone who copied it already.
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
        your own — tap Share, and pick this app.
      </Text>
      <Text style={[styles.body, { color: t.dim }]}>
        You only do this once per list. After that it stays in sync on its own.
      </Text>
      <Text style={[styles.body, { color: t.dim }]}>Or copy the link and paste it here:</Text>

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

      {/* What the iOS Shortcut should open (see app/SHORTCUT.md). In Expo Go it
          carries the Mac's address, so it changes when the network does. */}
      <Text style={[styles.tag, { color: t.dim, marginTop: 24 }]} selectable>
        Shortcut link: {Linking.createURL("connect")}?url=
      </Text>
    </View>
  );
}

function PlaceRow({
  place,
  onPress,
  onLongPress,
}: {
  place: Place;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  const distance =
    place.metres === null
      ? null
      : place.metres < 1000
        ? `${place.metres} m`
        : `${(place.metres / 1000).toFixed(1)} km`;
  // Food should always say what kind; flag the ones that don't yet.
  const cuisine = place.cuisine ?? (place.category === "food" ? "cuisine?" : null);
  const facts = [place.category, cuisine, dollars(place.price), place.listName]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { borderTopColor: t.line }]}
    >
      <View style={styles.grow}>
        <Text style={[styles.name, { color: t.text }]}>{place.name}</Text>
        <Text style={[styles.tag, { color: t.dim }]}>{facts}</Text>
        {place.subcategories.length > 0 && (
          <Text style={[styles.tag, { color: t.text }]}>{place.subcategories.join(" · ")}</Text>
        )}
      </View>
      {distance && (
        <View>
          <Text style={[styles.dist, { color: t.text }]}>{distance}</Text>
          <Text style={[styles.tag, { color: t.dim, textAlign: "right" }]}>
            {place.walkMinutes} min walk
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  dashed,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** For ideas that don't exist yet — tapping creates them. */
  dashed?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.chip,
        {
          borderColor: t.line,
          borderStyle: dashed ? "dashed" : "solid",
          backgroundColor: selected ? t.text : "transparent",
        },
      ]}
    >
      <Text style={{ color: selected ? t.bg : t.text }}>{label}</Text>
    </Pressable>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {children}
    </ScrollView>
  );
}

/**
 * Two rows: the categories, and — once one is picked — the user's
 * subcategories inside it (plus cuisines, for food). So "food" then "lunch
 * special" is how you find a lunch special.
 */
function Filters({
  overview,
  filter,
  onFilter,
}: {
  overview: Overview;
  filter: PlaceFilter;
  onFilter: (f: PlaceFilter) => void;
}) {
  const total = overview.builtIn.reduce((n, c) => n + c.count, 0);
  const within = filter.category
    ? [
        ...overview.subcategories
          .filter((c) => c.parent === filter.category && c.count > 0)
          .map((c) => ({ key: "subcategory" as const, ...c })),
        ...(filter.category === "food"
          ? overview.cuisines.map((c) => ({ key: "cuisine" as const, ...c }))
          : []),
      ]
    : [];
  // Tapping the selected one again widens back to the whole category.
  const narrow = (key: "cuisine" | "subcategory", name: string) =>
    onFilter({ category: filter.category, ...(filter[key] === name ? {} : { [key]: name }) });

  return (
    <View style={styles.filters}>
      <ChipRow>
        <Chip label={`all ${total}`} selected={!filter.category} onPress={() => onFilter({})} />
        {overview.builtIn.map(({ name, count }) => (
          <Chip
            key={name}
            label={`${name} ${count}`}
            selected={filter.category === name}
            onPress={() => onFilter({ category: name })}
          />
        ))}
      </ChipRow>
      {within.length > 0 && (
        <ChipRow>
          {within.map((d) => (
            <Chip
              key={`${d.key}:${d.name}`}
              label={`${d.name} ${d.count}`}
              selected={filter[d.key] === d.name}
              onPress={() => narrow(d.key, d.name)}
            />
          ))}
        </ChipRow>
      )}
    </View>
  );
}

/** A text box for adding a label that isn't among the suggestions. */
function AddLabel({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string) => void }) {
  const t = useTheme();
  const [label, setLabel] = useState("");
  const submit = () => {
    if (!label.trim()) return;
    onAdd(label.trim().toLowerCase());
    setLabel("");
  };
  return (
    <View style={styles.inline}>
      <TextInput
        value={label}
        onChangeText={setLabel}
        onSubmitEditing={submit}
        placeholder={placeholder}
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        maxLength={40}
        returnKeyType="done"
        style={[styles.input, styles.grow, { color: t.text, borderColor: t.line, marginTop: 0 }]}
      />
      <Pressable
        onPress={submit}
        disabled={!label.trim()}
        style={[styles.button, { borderColor: t.line, opacity: label.trim() ? 1 : 0.4 }]}
      >
        <Text style={{ color: t.text }}>Add</Text>
      </Pressable>
    </View>
  );
}

/**
 * Long-press a place to fill in what the app can't know: what it is to *you*
 * ("date spot", "gatekeep this"), what a restaurant serves, what it costs.
 * Edits apply as you tap and the sheet stays open.
 *
 * A Modal rather than Alert, because Alert is a no-op on react-native-web.
 */
function PlaceSheet({
  place,
  overview,
  onClose,
  onOverride,
  onApply,
  onCreate,
  onDelete,
  onHide,
}: {
  place: Place | null;
  overview: Overview;
  onClose: () => void;
  onOverride: (patch: OverridePatch) => void;
  /** Sets exactly which subcategories the place carries. */
  onApply: (names: string[]) => void;
  /** Makes a new subcategory of the place's category, then applies it. */
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
  onHide: () => void;
}) {
  const t = useTheme();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => setConfirmDelete(null), [place?.id]);

  if (!place) return null;

  const applied = new Set(place.subcategories);
  const mine = overview.subcategories.filter((c) => c.parent === place.category);
  const ideas = overview.suggestions.subcategories[place.category] ?? [];
  const cuisineOptions = [
    ...new Set([...(place.cuisine ? [place.cuisine] : []), ...overview.suggestions.cuisines]),
  ];
  const toggle = (name: string) =>
    onApply(applied.has(name) ? place.subcategories.filter((n) => n !== name) : [...applied, name]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps inside the sheet so only the backdrop closes it. */}
        <Pressable style={[styles.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={[styles.h2, { color: t.text }]}>{place.name}</Text>

            <Text style={[styles.label, { color: t.dim }]}>Category</Text>
            <View style={styles.chipGrid}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  selected={place.category === c}
                  onPress={() => onOverride({ category: c })}
                />
              ))}
              {place.categorySource === "override" && (
                <Chip label="↺ automatic" selected={false} onPress={() => onOverride({ category: null })} />
              )}
            </View>

            <Text style={[styles.label, { color: t.dim }]}>Your {place.category} subcategories</Text>
            <View style={styles.chipGrid}>
              {mine.map((c) => (
                <Chip
                  key={c.name}
                  label={c.name}
                  selected={applied.has(c.name)}
                  onPress={() => toggle(c.name)}
                  onLongPress={() => setConfirmDelete(c.name)}
                />
              ))}
              {ideas.map((name) => (
                <Chip
                  key={`idea:${name}`}
                  label={`+ ${name}`}
                  selected={false}
                  dashed
                  onPress={() => onCreate(name)}
                />
              ))}
            </View>
            {confirmDelete && (
              <View style={styles.inline}>
                <Text style={[styles.body, styles.grow, { color: t.text }]}>
                  Delete “{confirmDelete}” from every place?
                </Text>
                <Pressable
                  onPress={() => {
                    onDelete(confirmDelete);
                    setConfirmDelete(null);
                  }}
                  style={[styles.button, { borderColor: t.line }]}
                >
                  <Text style={{ color: t.text }}>Delete</Text>
                </Pressable>
                <Pressable onPress={() => setConfirmDelete(null)} style={styles.cancel}>
                  <Text style={{ color: t.dim }}>Keep</Text>
                </Pressable>
              </View>
            )}
            <AddLabel placeholder={`New ${place.category} subcategory`} onAdd={onCreate} />

            {place.category === "food" && (
              <>
                <Text style={[styles.label, { color: t.dim }]}>
                  {place.cuisine ? "Cuisine" : "Cuisine · needed"}
                </Text>
                <View style={styles.chipGrid}>
                  {cuisineOptions.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      selected={place.cuisine === c}
                      // Tapping the one you picked un-picks it; Google's answer stays put.
                      onPress={() =>
                        place.cuisine !== c
                          ? onOverride({ cuisine: c })
                          : place.cuisineSource === "override" && onOverride({ cuisine: null })
                      }
                    />
                  ))}
                  {place.cuisineSource === "override" && (
                    <Chip label="↺ automatic" selected={false} onPress={() => onOverride({ cuisine: null })} />
                  )}
                </View>
                {place.cuisineSource === "google" && (
                  <Text style={[styles.tag, { color: t.dim }]}>From Google Maps</Text>
                )}
                <AddLabel placeholder="Another cuisine" onAdd={(c) => onOverride({ cuisine: c })} />

                <Text style={[styles.label, { color: t.dim }]}>Price</Text>
                <View style={styles.chipGrid}>
                  {[1, 2, 3, 4].map((p) => (
                    <Chip
                      key={p}
                      label={"$".repeat(p)}
                      selected={place.price === p}
                      onPress={() => onOverride({ price: place.price === p ? null : p })}
                    />
                  ))}
                </View>
              </>
            )}

            <Pressable onPress={onHide} style={[styles.button, { borderColor: t.line }]}>
              <Text style={{ color: t.text }}>Hide this place</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={{ color: t.text, fontWeight: "600" }}>Done</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function App() {
  const t = useTheme();
  const [lists, setLists] = useState<SavedList[] | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [filter, setFilter] = useState<PlaceFilter>({});
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Place | null>(null);
  const [hidden, setHidden] = useState<Place | null>(null);

  /**
   * The whole app is sorted by where you're standing, so keep it current as you
   * walk. Updates only arrive while the app is open (Expo's watch is
   * foreground-only), which is exactly when the order matters.
   */
  useEffect(() => {
    let watch: Location.LocationSubscription | null = null;
    let cancelled = false;
    const moveTo = (pos: Location.LocationObject) =>
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });

    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        setStatus("Location denied — places won't be sorted by distance.");
        return;
      }

      // Sort straight away from wherever the phone last was, if recent; the
      // watch below corrects it within a second or two.
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      if (last && !cancelled) moveTo(last);

      const sub = await Location.watchPositionAsync(
        // Half a block. Each update re-sorts via the API, so finer than this
        // buys nothing on foot and costs a request.
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
        moveTo,
      );
      // Unmounted while the watch was starting: stop it rather than leak it.
      if (cancelled) sub.remove();
      else watch = sub;
    })();

    return () => {
      cancelled = true;
      watch?.remove();
    };
  }, []);

  /** Reads from the server's cache only — never waits on Google. */
  const load = useCallback(async () => {
    try {
      const [nextLists, nextPlaces, nextOverview] = await Promise.all([
        getLists(),
        getPlaces(coords ?? undefined, filter),
        getCategories(),
      ]);
      setLists(nextLists);
      setPlaces(nextPlaces);
      setOverview(nextOverview);
      // Keep an open sheet in step with the server — e.g. after "automatic",
      // which only the server can resolve. It may be filtered out; then keep ours.
      setEditing((open) => (open ? (nextPlaces.find((p) => p.id === open.id) ?? open) : open));

      // An edit can empty the selected filter; widen back out rather than show nothing.
      const has = (list: Array<{ name: string; count: number }>, name?: string) =>
        !name || list.some((c) => c.name === name && c.count > 0);
      if (!has(nextOverview.builtIn, filter.category)) setFilter({});
      else if (
        !has(
          nextOverview.subcategories.filter((c) => c.parent === filter.category),
          filter.subcategory,
        ) ||
        !has(nextOverview.cuisines, filter.cuisine)
      ) {
        setFilter(filter.category ? { category: filter.category } : {});
      }
    } catch (err) {
      setStatus(`Can't reach the API — is it running? (${String(err)})`);
      setLists([]);
    }
  }, [coords, filter]);

  useEffect(() => {
    load();
  }, [load]);

  // The sync effect below outlives any single `load`, so it reads the latest one.
  const loadRef = useRef(load);
  loadRef.current = load;

  /**
   * Stale-while-revalidate: the cached view is already on screen, so this only
   * redraws when a list actually changed in Maps.
   */
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const { changed } = await refreshLists();
      if (changed) await loadRef.current();
    } catch {
      // Offline or API down — the cached view stays, which is the point.
    } finally {
      setSyncing(false);
    }
  }, []);

  // On open, and every time the app comes back to the foreground.
  useEffect(() => {
    sync();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => sub.remove();
  }, [sync]);

  // The undo offer for a hidden place goes away on its own.
  useEffect(() => {
    if (!hidden) return;
    const timer = setTimeout(() => setHidden(null), 6000);
    return () => clearTimeout(timer);
  }, [hidden]);

  const handleConnect = async (url: string) => {
    setBusy(true);
    setStatus("Fetching…");
    try {
      const result = await connectList(url);
      setStatus(`Added ${result.count} places from "${result.name}".`);
      setAdding(false);
      await load();
    } catch (err) {
      setStatus(String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * A list shared from Google Maps' share sheet lands here: connect it straight
   * away, no link ever shown. Cleared once taken so a relaunch doesn't add it
   * twice; the ref covers the render between taking it and the clear landing.
   */
  const { sharedPayloads } = useIncomingShare();
  const handledShare = useRef<string | null>(null);
  const connectShared = (url: string | null) => {
    if (!url || url === handledShare.current) return;
    handledShare.current = url;
    // Show the connect screen so the "Fetching…" and result are visible.
    setAdding(true);
    handleConnect(url);
  };
  useEffect(() => {
    const url = findMapsLink(sharedPayloads);
    if (url) clearSharedPayloads();
    connectShared(url);
    // connectShared is recreated each render; the payloads are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedPayloads]);

  // The free stand-in for the share extension: an iOS Shortcut in the share
  // sheet opens `…/connect?url=<what Maps shared>` (see app/SHORTCUT.md).
  const deepLink = Linking.useLinkingURL();
  useEffect(() => {
    connectShared(connectLinkFrom(deepLink));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  /**
   * Applies an edit to the open sheet immediately, then persists it. The list
   * reloads afterwards so filters and counts catch up.
   */
  const edit = async (local: Partial<Place>, save: () => Promise<unknown>) => {
    setEditing((p) => (p ? { ...p, ...local } : p));
    try {
      await save();
      await load();
    } catch (err) {
      setStatus(String(err));
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
  const emptyMessage =
    filter.category
      ? "Nothing here yet."
      : "No places yet. The list connected, but nothing was extracted from it — that's the parser, not you.";

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      {showOnboarding ? (
        <Onboarding onConnect={handleConnect} busy={busy} status={status} />
      ) : (
        <FlatList
          data={places}
          keyExtractor={(p) => `${p.listName}:${p.id}`}
          renderItem={({ item }) => (
            <PlaceRow
              place={item}
              // Tap to go: Google Maps does the directions. Long-press to edit.
              onPress={() =>
                Linking.openURL(directionsUrl(item)).catch((err) => setStatus(String(err)))
              }
              onLongPress={() => setEditing(item)}
            />
          )}
          contentContainerStyle={styles.pad}
          ListHeaderComponent={
            <View>
              <View style={styles.header}>
                <Text style={[styles.h1, { color: t.text }]}>Nearby</Text>
                <Pressable onPress={() => setAdding(true)}>
                  <Text style={{ color: t.dim }}>+ list</Text>
                </Pressable>
              </View>
              <Filters overview={overview} filter={filter} onFilter={setFilter} />
            </View>
          }
          ListEmptyComponent={
            <Text style={[styles.body, { color: t.dim }]}>{emptyMessage}</Text>
          }
          refreshing={syncing}
          onRefresh={async () => {
            await sync();
            await load();
          }}
        />
      )}

      {hidden && (
        <View style={[styles.toast, { backgroundColor: t.text }]}>
          <Text style={{ color: t.bg, flex: 1 }} numberOfLines={1}>
            Hid {hidden.name}
          </Text>
          <Pressable
            onPress={() => {
              edit({}, () => setOverride(hidden.id, { hidden: false }));
              setHidden(null);
            }}
          >
            <Text style={{ color: t.bg, fontWeight: "600" }}>Undo</Text>
          </Pressable>
        </View>
      )}

      <PlaceSheet
        place={editing}
        overview={overview}
        onClose={() => setEditing(null)}
        onOverride={(patch) => {
          if (!editing) return;
          const local: Partial<Place> = {};
          if (patch.category !== undefined) {
            // Subcategories belong to the old category; the reload brings back any
            // the new one already had. "Automatic" can't be shown until the server
            // answers, so only an explicit category is applied locally.
            local.subcategories = [];
            if (patch.category) Object.assign(local, { category: patch.category, categorySource: "override" });
          }
          if (patch.cuisine) Object.assign(local, { cuisine: patch.cuisine, cuisineSource: "override" });
          if (patch.price !== undefined) local.price = patch.price;
          edit(local, () => setOverride(editing.id, patch));
        }}
        onApply={(names) => {
          if (!editing) return;
          const id = editing.id;
          edit({ subcategories: names }, () => applySubcategories(id, names));
        }}
        onCreate={(name) => {
          if (!editing) return;
          const { id, category, subcategories } = editing;
          const names = [...new Set([...subcategories, name])];
          edit({ subcategories: names }, async () => {
            await createSubcategory(category, name);
            await applySubcategories(id, names);
          });
        }}
        onDelete={(name) => {
          if (!editing) return;
          const { category, subcategories } = editing;
          edit({ subcategories: subcategories.filter((n) => n !== name) }, () =>
            deleteSubcategory(category, name),
          );
        }}
        onHide={() => {
          if (!editing) return;
          const place = editing;
          setEditing(null);
          setHidden(place);
          edit({}, () => setOverride(place.id, { hidden: true }));
        }}
      />
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
  h2: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginTop: 8 },
  button: { borderWidth: 1, borderRadius: 10, padding: 12, alignItems: "center" },
  status: { fontSize: 13, marginTop: 4 },
  row: { flexDirection: "row", gap: 16, paddingVertical: 12, borderTopWidth: 1 },
  grow: { flex: 1 },
  name: { fontSize: 16 },
  tag: { fontSize: 12, marginTop: 2 },
  dist: { fontSize: 15, textAlign: "right" },
  filters: { gap: 8, marginBottom: 4 },
  chips: { gap: 8 },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  sheetBody: { gap: 12 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "85%",
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cancel: { alignItems: "center", padding: 8 },
  inline: { flexDirection: "row", gap: 8, alignItems: "center" },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
