// Zasoby i18n karty "NES Edge Cache" (/admin/performance?tab=cache).
// Nakładka rejestrowana leniwie przez komponent karty (ten sam chunk trasy),
// żeby słownik nie obciążał bundla wejściowego - wzorzec jak w
// i18n-admin-analytics.ts.
import i18n from "@/lib/i18n";

const pl = {
  adminEdgeCache: {
    tab: "New European Strategies Edge Cache",
    title: "New European Strategies Edge Cache",
    subtitle:
      "Wbudowany cache dokumentów SSR: anonimowe strony publiczne serwowane z pamięci procesu " +
      "(HIT), z oknem stale-while-revalidate i unieważnianiem przy publikacji.",
    enabled: "Aktywny",
    disabled: "Wyłączony (NES_EDGE_CACHE=off)",
    tiles: {
      hitRatio: "Współczynnik trafień",
      entries: "Dokumenty w pamięci",
      memory: "Pamięć",
      hits: "Trafienia (HIT)",
      stale: "Serwowane stale",
      misses: "Chybienia (MISS)",
      bypass: "Pominięcia (BYPASS)",
      stores: "Zapisy",
      evictions: "Eksmisje LRU",
      purges: "Unieważnienia",
      revalidations: "Odświeżenia w tle",
      revalidationFailures: "Nieudane odświeżenia",
      oversize: "Odrzuty rozmiarowe",
    },
    since: "Statystyki od {{date}} (bieżąca instancja).",
    isolateNote:
      "Pamięć jest lokalna dla instancji serwera - po publikacji pozostałe instancje " +
      "odświeżają dokumenty najpóźniej w oknie świeżości (do 3 min).",
    l2: {
      title: "Warstwa L2 (Cache API, per-colo)",
      active: "Aktywna",
      inactive: "Niedostępna w tym środowisku",
      note:
        "Wpisy współdzielone między instancjami tej samej lokalizacji Cloudflare; " +
        "publikacja unieważnia je natychmiast bumpem wersji klucza.",
      tiles: {
        hits: "Trafienia L2",
        stale: "Stale z L2",
        stores: "Zapisy do L2",
        bumps: "Bumpy wersji",
      },
    },
    diag: {
      title: "Diagnostyka (nagłówki zdejmowane na brzegu)",
      note:
        "Warstwa hostingu usuwa z odpowiedzi nagłówki x-nes-cache i Server-Timing oraz " +
        "nadpisuje Cache-Control, dlatego status cache'a czytamy tu bezpośrednio z serwera - " +
        "z rejestru decyzji i sondy pojedynczej ścieżki.",
      probeLabel: "Sprawdź ścieżkę",
      probePlaceholder: "/analizy",
      probeRun: "Sprawdź",
      probeError: "Nie udało się sprawdzić ścieżki.",
      probeCached: "W cache ({{status}}), wiek {{age}} s, świeże jeszcze {{fresh}} s.",
      probeMiss: "Brak w cache tej instancji (kolejne żądanie zrenderuje i zapisze).",
      probeBypass: "Ścieżka pomijana przez cache (powód: {{reason}}).",
      recentTitle: "Ostatnie decyzje",
      recentEmpty: "Brak decyzji od startu instancji.",
      colTime: "Czas",
      colPath: "Ścieżka",
      colStatus: "Status",
      colDetail: "Szczegóły",
    },
    refresh: "Odśwież",
    purge: "Wyczyść cache tenanta",
    purgeDone_one: "Usunięto {{count}} dokument z cache.",
    purgeDone_few: "Usunięto {{count}} dokumenty z cache.",
    purgeDone_many: "Usunięto {{count}} dokumentów z cache.",
    purgeDone_other: "Usunięto {{count}} dokumentów z cache.",
    purgeError: "Nie udało się wyczyścić cache.",
    loadError: "Nie udało się pobrać statystyk cache.",
  },
};

const en = {
  adminEdgeCache: {
    tab: "New European Strategies Edge Cache",
    title: "New European Strategies Edge Cache",
    subtitle:
      "Built-in SSR document cache: anonymous public pages served from process memory (HIT), " +
      "with a stale-while-revalidate window and purge-on-publish invalidation.",
    enabled: "Active",
    disabled: "Disabled (NES_EDGE_CACHE=off)",
    tiles: {
      hitRatio: "Hit ratio",
      entries: "Documents in memory",
      memory: "Memory",
      hits: "Hits (HIT)",
      stale: "Served stale",
      misses: "Misses (MISS)",
      bypass: "Bypasses (BYPASS)",
      stores: "Stores",
      evictions: "LRU evictions",
      purges: "Purges",
      revalidations: "Background refreshes",
      revalidationFailures: "Failed refreshes",
      oversize: "Oversize rejections",
    },
    since: "Stats since {{date}} (current instance).",
    isolateNote:
      "Memory is local to a server instance - after publishing, other instances refresh " +
      "documents within the freshness window (up to 3 min).",
    l2: {
      title: "L2 layer (Cache API, per-colo)",
      active: "Active",
      inactive: "Unavailable in this environment",
      note:
        "Entries are shared between instances of the same Cloudflare location; " +
        "publishing invalidates them instantly via a key-version bump.",
      tiles: {
        hits: "L2 hits",
        stale: "Stale from L2",
        stores: "L2 stores",
        bumps: "Version bumps",
      },
    },
    diag: {
      title: "Diagnostics (headers stripped at the edge)",
      note:
        "The hosting layer removes x-nes-cache and Server-Timing from responses and overrides " +
        "Cache-Control, so cache status is read straight from the server here - from the " +
        "decision log and a single-path probe.",
      probeLabel: "Check a path",
      probePlaceholder: "/analizy",
      probeRun: "Check",
      probeError: "Failed to check the path.",
      probeCached: "Cached ({{status}}), age {{age}} s, fresh for another {{fresh}} s.",
      probeMiss: "Not cached on this instance (the next request renders and stores it).",
      probeBypass: "Path bypasses the cache (reason: {{reason}}).",
      recentTitle: "Recent decisions",
      recentEmpty: "No decisions since instance start.",
      colTime: "Time",
      colPath: "Path",
      colStatus: "Status",
      colDetail: "Details",
    },
    refresh: "Refresh",
    purge: "Purge tenant cache",
    purgeDone_one: "Removed {{count}} document from the cache.",
    purgeDone_other: "Removed {{count}} documents from the cache.",
    purgeError: "Failed to purge the cache.",
    loadError: "Failed to load cache stats.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
