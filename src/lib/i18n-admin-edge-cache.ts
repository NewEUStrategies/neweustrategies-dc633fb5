// Zasoby i18n karty "NES Edge Cache" (/admin/performance?tab=cache).
// Nakładka rejestrowana leniwie przez komponent karty (ten sam chunk trasy),
// żeby słownik nie obciążał bundla wejściowego - wzorzec jak w
// i18n-admin-analytics.ts.
import i18n from "@/lib/i18n";

const pl = {
  adminEdgeCache: {
    tab: "NES Edge Cache",
    title: "NES Edge Cache",
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
    },
    since: "Statystyki od {{date}} (bieżąca instancja).",
    isolateNote:
      "Pamięć jest lokalna dla instancji serwera - po publikacji pozostałe instancje " +
      "odświeżają dokumenty najpóźniej w oknie świeżości (do 3 min).",
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
    tab: "NES Edge Cache",
    title: "NES Edge Cache",
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
    },
    since: "Stats since {{date}} (current instance).",
    isolateNote:
      "Memory is local to a server instance - after publishing, other instances refresh " +
      "documents within the freshness window (up to 3 min).",
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
