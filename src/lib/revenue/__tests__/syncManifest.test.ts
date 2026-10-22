// MANIFEST SYNCHRONIZACJI HUBA - sprawdzany z kodem w obie strony (SPEC §3.1).
//
// Manifest jest danymi, które łatwo napisać i trudno utrzymać: nazwa tabeli
// z literówką, trasa przemianowana w module, zdarzenie bez reguły albo dwa
// ekrany piszące tę samą kolumnę nie oblewają niczego - aż diagnostyka huba
// narysuje mapę systemu, która nie istnieje. Ten plik wiąże każdy wpis
// z czterema źródłami prawdy: `types.ts` (tabele i kolumny), `routeTree.gen.ts`
// (ekrany-właściciele), katalogiem szyny i mapą inwalidacji (zdarzenia
// i klucze, Z ZAREJESTROWANYM rozszerzeniem panelu - hub czyta oba) oraz
// manifestami wycinków (pisarze, których jeszcze nie ma).
//
// `metrics` są w TRYBIE ŚCISŁYM od I9 (Z-S6-11, Z-S7-03): każdy wpis należy
// do rejestru huba S6, każde zdarzenie bytu unieważnia dziedzinę każdego jego
// wskaźnika (mapa grupa → dziedzina `METRIC_GROUP_DOMAINS`), a każdy wskaźnik
// huba ma byt albo jawny powód, dla którego go nie ma. Braki reguł szyny,
// które ten tryb wykrył, stoją w zapadce `PENDING_BUS_RULES` (pliku
// współdzielonego mapy nie zmienia wycinek - dopisuje integrator).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { QueryKey } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applicationInboxKeys } from "@/lib/clubs/adminApplicationsInbox";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { DOMAIN_EVENT_TYPES, type DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { HUB_METRIC_IDS, METRIC_GROUP, type MetricId } from "@/lib/analytics/semantic/metrics";
import { journeyKeys } from "@/lib/journeys/keys";
import { revenueKeys, type RevenueDomain } from "@/lib/revenue/keys";
import {
  HUB_ENTITY_IDS,
  HUB_METRICS_WITHOUT_ENTITY,
  HUB_SYNC_MANIFEST,
  JOURNEY_STATS_METRICS,
  METRIC_GROUP_DOMAINS,
  type HubEntity,
  type HubEntityId,
} from "@/lib/revenue/syncManifest";

/* ------------------------------------------------------- źródła prawdy */

/** Tabele `public` z typów generowanych: nazwa → kolumny wiersza. */
function publicTables(): Map<string, Set<string>> {
  const source = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const schema = source.slice(source.indexOf("  public: {"));
  const tables = schema.slice(schema.indexOf("    Tables: {"), schema.indexOf("    Views: {"));
  const out = new Map<string, Set<string>>();
  for (const match of tables.matchAll(/^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm)) {
    out.set(match[1], new Set([...match[2].matchAll(/^ {10}([a-z0-9_]+)\??:/gm)].map((m) => m[1])));
  }
  return out;
}

/** Pełne ścieżki tras z drzewa generowanego przez wtyczkę routera. */
function routeFullPaths(): Set<string> {
  const source = readFileSync("src/routeTree.gen.ts", "utf8");
  return new Set([...source.matchAll(/fullPath: '([^']+)'/g)].map((match) => match[1]));
}

/** Funkcje SQL zdefiniowane w migracjach (stan przed hubem i po nim). */
function sqlFunctions(): Set<string> {
  const dir = join("supabase", "migrations");
  const out = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    for (const match of sql.matchAll(/FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)) {
      out.add(match[1].toLowerCase());
    }
  }
  return out;
}

const TABLES = publicTables();
const ROUTES = routeFullPaths();
const SQL_FUNCTIONS = sqlFunctions();

/* ---------------------------------------------------------- pomocnicze */

const TENANT = "11111111-1111-4111-a111-111111111111";

function eventOf(type: string): DomainEventRow {
  return {
    id: "22222222-2222-4222-a222-222222222222",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: "33333333-3333-4333-a333-333333333333",
    event_type: type,
    payload: { event_id: "e1", lead_id: "l1", club_id: "c1", entity_type: "post", entity_id: "p1" },
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

function isPrefix(prefix: QueryKey, key: QueryKey): boolean {
  return prefix.length <= key.length && prefix.every((part, index) => Object.is(key[index], part));
}

/** Klucze dotykają tego samego poddrzewa cache: jeden jest prefiksem drugiego. */
function related(a: QueryKey, b: QueryKey): boolean {
  return isPrefix(a, b) || isPrefix(b, a);
}

function isPanelKey(key: QueryKey): boolean {
  return key[0] === "admin-revenue" || (key[0] === "admin" && key[1] === "journeys");
}

const entities = HUB_SYNC_MANIFEST.map((entity) => [entity.id, entity] as const);

/** Dziedziny huba, pod którymi żyje wskaźnik (pusta lista dla wskaźników ścieżek). */
function metricDomains(metric: MetricId): readonly RevenueDomain[] {
  if ((JOURNEY_STATS_METRICS as readonly MetricId[]).includes(metric)) return [];
  return METRIC_GROUP_DOMAINS[METRIC_GROUP[metric]];
}

/** Prefiksy cache wskaźnika: dziedziny jego grupy najemcy albo drzewo ścieżek. */
function metricPrefixes(metric: MetricId): QueryKey[] {
  if ((JOURNEY_STATS_METRICS as readonly MetricId[]).includes(metric)) return [journeyKeys.root()];
  return metricDomains(metric).map((domain) => revenueKeys.domainTenant(domain, TENANT));
}

/**
 * ZAPADKA (I9): reguły szyny, których brak wykrył tryb ścisły `metrics`.
 * Mapa inwalidacji (`eventInvalidationMap.admin.ts`) jest plikiem
 * współdzielonym - regułę dopisuje integrator, a wtedy test niżej każe zdjąć
 * wpis stąd (lista zamknięta, jak `PENDING_MANIFEST_WRITERS` szybkich napraw).
 *   * `newsletter_subscriber` → `email`: zapis, potwierdzenie i wypis
 *     zmieniają przyrost listy, potwierdzenia DOI i wypisy w karcie Zdrowie
 *     poczty, a reguły odświeżają dziś tylko Lejek (`funK`);
 *   * `provider_subscription` → `economics` (LTV, LTV/CAC, zwrot CAC, R40
 *     liczą się z księgi MRR) i `funnel` (konwersja okresu próbnego) - ruch
 *     subskrypcji odświeża dziś tylko dziedziny księgi MRR (`mrrK`).
 */
const PENDING_BUS_RULES: Readonly<Partial<Record<HubEntityId, readonly RevenueDomain[]>>> = {
  newsletter_subscriber: ["email"],
  provider_subscription: ["economics", "funnel"],
};

let unregister: () => void = () => undefined;
beforeAll(() => {
  unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
});
afterAll(() => unregister());

/* --------------------------------------------------------------- testy */

describe("manifest synchronizacji huba - kształt", () => {
  it("po jednym wpisie na byt, w kolejności `HUB_ENTITY_IDS`", () => {
    expect(HUB_SYNC_MANIFEST.map((entity) => entity.id)).toEqual([...HUB_ENTITY_IDS]);
  });

  it("parser typów i drzewa tras widzi realne dane (kanarek)", () => {
    // Pusty parser zrobiłby z każdej asercji niżej pętlę po niczym.
    expect(TABLES.size).toBeGreaterThan(200);
    expect(TABLES.get("membership_tiers")?.has("rank")).toBe(true);
    expect(ROUTES.has("/admin/membership")).toBe(true);
  });

  it.each(entities)("%s: każdy byt ma tabelę, pisarza, klucz i zdarzenie", (_id, entity) => {
    expect(entity.tables.length).toBeGreaterThan(0);
    expect(entity.writers.length).toBeGreaterThan(0);
    expect(entity.keys.length).toBeGreaterThan(0);
    expect(entity.events.length).toBeGreaterThan(0);
    for (const key of entity.keys) expect(key.length).toBeGreaterThan(0);
  });
});

describe("manifest ⇄ baza", () => {
  it.each(entities)("%s: tabele istnieją w `types.ts`", (_id, entity) => {
    expect(entity.tables.filter((table) => !TABLES.has(table))).toEqual([]);
  });

  it.each(entities)("%s: kolumny właścicieli istnieją w tabelach bytu", (_id, entity) => {
    const columns = new Set(entity.tables.flatMap((table) => [...(TABLES.get(table) ?? [])]));
    const unknown = entity.owners.flatMap((owner) =>
      (owner.columns ?? []).filter((column) => !columns.has(column)),
    );
    expect(unknown).toEqual([]);
  });

  it.each(entities)("%s: kolumny dwóch właścicieli są rozłączne", (_id, entity) => {
    // Jeden właściciel kolumny: dwa ekrany zapisujące to samo pole to dwa
    // źródła prawdy i wyścig zapisów (defekt `benefits` z briefu 02).
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const owner of entity.owners) {
      for (const column of owner.columns ?? []) {
        const previous = seen.get(column);
        if (previous !== undefined) clashes.push(`${column}: ${previous} i ${owner.to}`);
        seen.set(column, owner.to);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("manifest ⇄ trasy i pisarze", () => {
  it.each(entities)("%s: trasy właścicieli istnieją w `routeTree.gen.ts`", (_id, entity) => {
    const missing = entity.owners
      .map((owner) => owner.to)
      .filter((to) => !ROUTES.has(to) && !ROUTES.has(`${to}/`));
    expect(missing).toEqual([]);
  });

  it.each(entities)("%s: parametry trasy są kompletne", (_id, entity) => {
    for (const owner of entity.owners) {
      const params = [...owner.to.matchAll(/\$([A-Za-z]+)/g)].map((match) => match[1]);
      const given = Object.keys(owner.params ?? {});
      // Trasa z `$param` bez wartości to ekran-właściciel „dowolnego" rekordu
      // (edytor wpisu, karta klubu) - wtedy params pomijamy w całości.
      if (given.length > 0) expect(given.sort()).toEqual(params.sort());
    }
  });

  // TRYB ŚCISŁY PISARZY (I9): wszystkie wycinki S1-S8 są dowiezione, więc
  // pisarz musi ISTNIEĆ - plik z eksportem albo funkcja SQL w migracjach.
  // Dawna furtka („należy do manifestu wycinka, który go dowiezie") ukryła
  // P24: `bulkUpdateCrmTasks` z SPEC nigdy nie powstał (Z-S7-02).
  it.each(entities)("%s: pisarz istnieje (eksport w pliku albo funkcja SQL)", (_id, entity) => {
    const orphans: string[] = [];
    for (const writer of entity.writers) {
      if (writer.kind === "rpc" || writer.kind === "trigger") {
        if (!SQL_FUNCTIONS.has(writer.ref)) orphans.push(writer.ref);
        continue;
      }
      const [path, exported] = writer.ref.split("#");
      const source = existsSync(path) ? readFileSync(path, "utf8") : null;
      const present =
        source !== null &&
        (exported === undefined ||
          new RegExp(`export (?:const|async function|function) ${exported}\\b`).test(source));
      if (!present) orphans.push(writer.ref);
    }
    expect(orphans).toEqual([]);
  });
});

describe("manifest ⇄ szyna zdarzeń (z zarejestrowanym rozszerzeniem panelu)", () => {
  const catalog = new Set<string>(DOMAIN_EVENT_TYPES);

  it.each(entities)("%s: zdarzenia są w katalogu szyny", (_id, entity) => {
    expect(entity.events.filter((type) => !catalog.has(type))).toEqual([]);
  });

  it.each(entities)(
    "%s: każde zdarzenie unieważnia co najmniej jeden klucz bytu",
    (_id, entity: HubEntity) => {
      // Dwukierunkowość: manifest mówi „ten byt żyje pod tymi kluczami",
      // mapa mówi „to zdarzenie unieważnia te klucze" - oba muszą się spotkać.
      const silent = entity.events.filter((type) => {
        const keys = invalidationKeysFor(eventOf(type), { userId: "u1" });
        return !keys.some((key) => entity.keys.some((own) => related(own, key)));
      });
      expect(silent).toEqual([]);
    },
  );

  it.each(entities.filter(([, entity]) => entity.hubTabs.length > 0))(
    "%s: byt widoczny w hubie odświeża hub przy każdym swoim zdarzeniu",
    (_id, entity) => {
      const silent = entity.events.filter(
        (type) => !invalidationKeysFor(eventOf(type), { userId: "u1" }).some(isPanelKey),
      );
      expect(silent).toEqual([]);
    },
  );
});

describe("literały w manifeście = klucze fabryk modułów", () => {
  it('`["event-registrations"]` = `registrationKeys.all`', () => {
    const entity = HUB_SYNC_MANIFEST.find((e) => e.id === "event_registration");
    expect(entity?.keys).toContainEqual([...registrationKeys.all]);
  });

  it('`["admin", "club-applications"]` = `applicationInboxKeys.all`', () => {
    const entity = HUB_SYNC_MANIFEST.find((e) => e.id === "club_application");
    expect(entity?.keys).toContainEqual([...applicationInboxKeys.all]);
  });
});

describe("manifest ⇄ wskaźniki huba (tryb ścisły `metrics`, I9)", () => {
  const hubMetrics = new Set<MetricId>(HUB_METRIC_IDS);
  const fed = new Set(HUB_SYNC_MANIFEST.flatMap((entity) => entity.metrics));

  it.each(entities)("%s: wskaźniki należą do rejestru huba, bez powtórzeń", (_id, entity) => {
    expect(entity.metrics.filter((metric) => !hubMetrics.has(metric))).toEqual([]);
    expect(new Set(entity.metrics).size).toBe(entity.metrics.length);
  });

  it("każda grupa wskaźników huba ma dziedzinę (poza ruchem, który nie jest hubem)", () => {
    for (const metric of HUB_METRIC_IDS) {
      expect(metricPrefixes(metric).length, metric).toBeGreaterThan(0);
    }
    expect(METRIC_GROUP_DOMAINS.traffic).toEqual([]);
  });

  it.each(entities.filter(([, entity]) => entity.metrics.length > 0))(
    "%s: każde zdarzenie unieważnia dziedzinę każdego wskaźnika bytu",
    (id, entity) => {
      const pending = new Set(PENDING_BUS_RULES[id] ?? []);
      const silent: string[] = [];
      for (const type of entity.events) {
        const keys = invalidationKeysFor(eventOf(type), { userId: "u1" });
        for (const metric of entity.metrics) {
          const reached = metricPrefixes(metric).some((prefix) =>
            keys.some((key) => related(prefix, key)),
          );
          // Zapadka: brak dopuszczony WYŁĄCZNIE dla dziedziny czekającej na
          // regułę integratora - inny brak to czerwień.
          const waits = metricDomains(metric).some((domain) => pending.has(domain));
          if (!reached && !waits) silent.push(`${type} → ${metric}`);
        }
      }
      expect(silent).toEqual([]);
    },
  );

  it.each(Object.entries(PENDING_BUS_RULES))(
    "%s: wpis zapadki jest aktualny (regułę dopisuje integrator - wtedy zdejmij wpis)",
    (id, domains) => {
      const entity = HUB_SYNC_MANIFEST.find((e) => e.id === id);
      expect(entity, id).toBeDefined();
      for (const domain of domains ?? []) {
        // Dziedzina musi należeć do wskaźnika bytu (inaczej wpis niczego nie tłumaczy)…
        expect(
          entity!.metrics.some((metric) => metricDomains(metric).includes(domain)),
          `${id}: żaden wskaźnik nie żyje w dziedzinie ${domain}`,
        ).toBe(true);
        // …i reguła wciąż nie istnieje dla co najmniej jednego zdarzenia.
        const prefix = revenueKeys.domainTenant(domain, TENANT);
        const covered = entity!.events.every((type) =>
          invalidationKeysFor(eventOf(type), { userId: "u1" }).some((key) => related(prefix, key)),
        );
        expect(covered, `zdejmij ${id} → ${domain} z PENDING_BUS_RULES`).toBe(false);
      }
    },
  );

  it("każdy wskaźnik huba ma byt w manifeście albo jawny powód, że go nie ma", () => {
    const exempt = new Set<MetricId>(HUB_METRICS_WITHOUT_ENTITY);
    expect(HUB_METRIC_IDS.filter((metric) => !fed.has(metric) && !exempt.has(metric))).toEqual([]);
    // Wskaźnik zasilany bytem nie może jednocześnie udawać „bez bytu".
    expect([...exempt].filter((metric) => fed.has(metric))).toEqual([]);
    expect([...exempt].filter((metric) => !hubMetrics.has(metric))).toEqual([]);
  });
});
