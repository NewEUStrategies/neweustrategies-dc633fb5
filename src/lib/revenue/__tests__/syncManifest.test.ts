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
// `metrics` są w trybie NIEŚCISŁYM: rejestr wskaźników huba powstaje w S6,
// a I9 włącza regułę „byt zasilający metrykę unieważnia jej dziedzinę".
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { QueryKey } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUB_FUNCTION_OWNERS, sliceOfPath } from "@/lib/ci/hubDelivery";
import { applicationInboxKeys } from "@/lib/clubs/adminApplicationsInbox";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { DOMAIN_EVENT_TYPES, type DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { HUB_ENTITY_IDS, HUB_SYNC_MANIFEST, type HubEntity } from "@/lib/revenue/syncManifest";

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

  it.each(entities)(
    "%s: pisarz istnieje albo należy do manifestu wycinka, który go dowiezie",
    (_id, entity) => {
      const orphans: string[] = [];
      for (const writer of entity.writers) {
        if (writer.kind === "rpc" || writer.kind === "trigger") {
          if (!SQL_FUNCTIONS.has(writer.ref) && !(writer.ref in HUB_FUNCTION_OWNERS)) {
            orphans.push(writer.ref);
          }
          continue;
        }
        const [path, exported] = writer.ref.split("#");
        const source = existsSync(path) ? readFileSync(path, "utf8") : null;
        const present =
          source !== null &&
          (exported === undefined ||
            new RegExp(`export (?:const|async function|function) ${exported}\\b`).test(source));
        if (!present && sliceOfPath(path) === null) orphans.push(writer.ref);
      }
      expect(orphans).toEqual([]);
    },
  );
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
