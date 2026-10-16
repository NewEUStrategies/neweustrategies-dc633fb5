// Definicje pól własnych wpisu - zapytania i czyste pomocniki.
//
// Zapis definicji to DWA zapytania o jednoznacznej semantyce, nie upsert po
// (tenant_id, key), który nie odróżniał dodania od nadpisania cudzej definicji
// ani edycji od wskrzeszenia usuniętej (lista na ekranie bywa sprzed minut):
//   1. DODANIE to INSERT jawnych kolumn; 23505 z `UNIQUE (tenant_id, key)` to
//      odmowa `key_taken`, a nie wyjątek. `id` nie jedzie w ładunku.
//   2. EDYCJA to UPDATE po `id` samych etykiet, ikony i pozycji z prośbą
//      o zmienione wiersze. Klucz i tenant nie jadą w ładunku - edycja nie
//      zmienia tożsamości wiersza. Zero wierszy ma DWIE przyczyny, bo UPDATE
//      po cichu pomija też wiersze, których RLS nie pozwala zmienić (autor
//      czyta listę publicznego tenanta, a zapis to polityka admina/redaktora):
//      jedno sprawdzenie istnienia - wyłącznie na tej ścieżce - daje odmowę
//      `forbidden`, gdy wiersz widać, a `deleted`, gdy go nie ma.
// Atrapa klienta (`@/test/supabase`) widzi wyłącznie to, co kod wysłał do
// PostgREST - RLS i unikalność egzekwuje baza.
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SupabaseFromStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return { supabase: { from: fromStub.from } };
});

import { fail, ok } from "@/test/supabase";
import {
  addCustomMetaDef,
  buildCustomMetaItems,
  deleteCustomMetaDef,
  listCustomMetaDefs,
  metaLabel,
  updateCustomMetaDef,
  type CustomMetaDef,
} from "../customMeta";

const TABLE = "post_custom_meta_defs";
const db = () => sb.from as SupabaseFromStub;
const lastCalls = () => db().lastChain(TABLE)?.calls;

beforeEach(() => db().reset());

const defs: CustomMetaDef[] = [
  {
    id: "1",
    tenant_id: "t",
    key: "prep_time",
    label_pl: "Czas przygotowania",
    label_en: "Prep time",
    icon: "Clock",
    position: 1,
  },
  {
    id: "2",
    tenant_id: "t",
    key: "difficulty",
    label_pl: "Trudność",
    label_en: "Difficulty",
    icon: "Award",
    position: 2,
  },
  {
    id: "3",
    tenant_id: "t",
    key: "servings",
    label_pl: "Porcje",
    label_en: "Servings",
    icon: "Users",
    position: 3,
  },
];

describe("buildCustomMetaItems", () => {
  it("returns empty when values null/undefined", () => {
    expect(buildCustomMetaItems(defs, null)).toEqual([]);
    expect(buildCustomMetaItems(defs, undefined)).toEqual([]);
  });
  it("preserves definition order and skips empty/missing", () => {
    const items = buildCustomMetaItems(defs, {
      difficulty: "Łatwa",
      prep_time: "30 min",
      missing: "x",
      servings: "  ",
    });
    expect(items.map((i) => i.def.key)).toEqual(["prep_time", "difficulty"]);
    expect(items[0].value).toBe("30 min");
  });
  it("trims values", () => {
    const items = buildCustomMetaItems(defs, { prep_time: "  30 min  " });
    expect(items[0].value).toBe("30 min");
  });
});

describe("metaLabel", () => {
  it("returns PL label by default and falls back to EN/key", () => {
    expect(metaLabel(defs[0], "pl")).toBe("Czas przygotowania");
    expect(metaLabel({ ...defs[0], label_pl: "" }, "pl")).toBe("Prep time");
    expect(metaLabel({ ...defs[0], label_pl: "", label_en: "" }, "pl")).toBe("prep_time");
  });
  it("returns EN label when lang=en", () => {
    expect(metaLabel(defs[1], "en")).toBe("Difficulty");
  });
  it("falls back EN -> PL -> key when lang=en", () => {
    expect(metaLabel({ ...defs[1], label_en: "" }, "en")).toBe("Trudność");
    expect(metaLabel({ ...defs[1], label_en: "", label_pl: "" }, "en")).toBe("difficulty");
  });
});

describe("listCustomMetaDefs", () => {
  it("czyta definicje TENANTA w kolejności pozycji, a przy remisie - klucza", async () => {
    db().setResponse(TABLE, ok([defs[0]]));

    await expect(listCustomMetaDefs("t")).resolves.toEqual([defs[0]]);
    expect(lastCalls()).toEqual([
      { method: "select", args: ["id, tenant_id, key, label_pl, label_en, icon, position"] },
      { method: "order", args: ["position", { ascending: true }] },
      { method: "order", args: ["key", { ascending: true }] },
      { method: "eq", args: ["tenant_id", "t"] },
    ]);
  });

  it("bez tenanta (strona publiczna) nie zawęża zapytania, a brak danych to pusta lista", async () => {
    db().setResponse(TABLE, ok(null));

    await expect(listCustomMetaDefs(null)).resolves.toEqual([]);
    expect(db().lastChain(TABLE)?.has("eq")).toBe(false);
  });

  it("błąd odczytu leci wyjątkiem - nie udaje pustej listy", async () => {
    db().setResponse(TABLE, fail("permission denied for table post_custom_meta_defs"));

    await expect(listCustomMetaDefs("t")).rejects.toThrow("permission denied");
  });
});

describe("addCustomMetaDef", () => {
  const fresh: Omit<CustomMetaDef, "id"> = {
    tenant_id: "t",
    key: "servings",
    label_pl: "Porcje",
    label_en: "Servings",
    icon: "Users",
    position: 40,
  };

  it("WSTAWIA wiersz zwykłym INSERT - bez upsertu, który nadpisałby cudzą definicję", async () => {
    db().setResponse(TABLE, ok(null));

    await expect(addCustomMetaDef(fresh)).resolves.toEqual({ ok: true });
    expect(lastCalls()).toEqual([{ method: "insert", args: [fresh] }]);
  });

  it("szerszy obiekt (cały wiersz z `id`) NIE przemyca `id` do wstawienia", async () => {
    // Wstawienie z `id` usuniętego wiersza to znowu wskrzeszenie.
    db().setResponse(TABLE, ok(null));
    const row: CustomMetaDef = defs[0];

    await addCustomMetaDef(row);
    expect(db().lastChain(TABLE)?.argsOf("insert")).toEqual([
      {
        tenant_id: "t",
        key: "prep_time",
        label_pl: "Czas przygotowania",
        label_en: "Prep time",
        icon: "Clock",
        position: 1,
      },
    ]);
  });

  it("23505 (klucz zajęty w międzyczasie) to odmowa `key_taken`, a nie wyjątek", async () => {
    db().setResponse(
      TABLE,
      fail(
        'duplicate key value violates unique constraint "post_custom_meta_defs_tenant_id_key_key"',
        "23505",
      ),
    );

    await expect(addCustomMetaDef(fresh)).resolves.toEqual({ ok: false, reason: "key_taken" });
  });

  it("inny błąd (RLS) leci wyjątkiem w oryginalnej postaci", async () => {
    db().setResponse(TABLE, fail("new row violates row-level security policy", "42501"));

    await expect(addCustomMetaDef(fresh)).rejects.toMatchObject({
      message: "new row violates row-level security policy",
      code: "42501",
    });
  });
});

describe("updateCustomMetaDef", () => {
  const patch = { label_pl: "Czas", label_en: "Time", icon: "Star", position: 5 };

  it("zmienia po `id` same etykiety, ikonę i pozycję i prosi o zmienione wiersze", async () => {
    db().setResponse(TABLE, ok([{ id: "1" }]));

    await expect(updateCustomMetaDef("1", patch)).resolves.toEqual({ ok: true });
    expect(lastCalls()).toEqual([
      { method: "update", args: [patch] },
      { method: "eq", args: ["id", "1"] },
      { method: "select", args: ["id"] },
    ]);
    // Udany zapis to jedno zapytanie - sprawdzenie istnienia tylko po odmowie.
    expect(db().chainsFor(TABLE)).toHaveLength(1);
  });

  it("klucz, tenant i `id` z szerszego obiektu NIE trafiają do ładunku", async () => {
    // Zmieniony klucz osierociłby wartości we wpisach, a tenant z ładunku
    // przeniósłby wiersz - tożsamość wiersza wyznacza wyłącznie filtr `id`.
    db().setResponse(TABLE, ok([{ id: "1" }]));
    const wider: CustomMetaDef = { ...defs[0], key: "inny_klucz", tenant_id: "obcy" };

    await updateCustomMetaDef("1", wider);
    expect(db().lastChain(TABLE)?.argsOf("update")).toEqual([
      { label_pl: "Czas przygotowania", label_en: "Prep time", icon: "Clock", position: 1 },
    ]);
  });

  it("ZERO zmienionych wierszy, a wiersza już nie ma, to odmowa `deleted` - UPDATE niczego nie wstawia", async () => {
    db().setResponse(TABLE, (chain) => (chain.has("update") ? ok([]) : ok(null)));

    await expect(updateCustomMetaDef("1", patch)).resolves.toEqual({
      ok: false,
      reason: "deleted",
    });
    expect(
      db()
        .chainsFor(TABLE)
        .map((c) => c.calls),
    ).toEqual([
      [
        { method: "update", args: [patch] },
        { method: "eq", args: ["id", "1"] },
        { method: "select", args: ["id"] },
      ],
      [
        { method: "select", args: ["id"] },
        { method: "eq", args: ["id", "1"] },
        { method: "maybeSingle", args: [] },
      ],
    ]);
  });

  it("ZERO zmienionych wierszy, choć wiersz WIDAĆ, to odmowa `forbidden`, a nie „usunięta”", async () => {
    // RLS nie zgłasza błędu przy UPDATE - pomija wiersz. Autor dostawał więc
    // „usunięta w międzyczasie” (i czyszczony formularz) dla definicji, która
    // dalej stoi na liście; upsert sprzed zmiany kończył się prawdziwym 42501.
    db().setResponse(TABLE, (chain) => (chain.has("update") ? ok([]) : ok({ id: "1" })));

    await expect(updateCustomMetaDef("1", patch)).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("błąd sprawdzenia po odmowie leci wyjątkiem - przyczyny nie zgadujemy", async () => {
    db().setResponse(TABLE, (chain) => (chain.has("update") ? ok([]) : fail("fetch failed")));

    await expect(updateCustomMetaDef("1", patch)).rejects.toThrow("fetch failed");
  });

  it("błąd zapisu leci wyjątkiem", async () => {
    db().setResponse(TABLE, fail("permission denied for table post_custom_meta_defs", "42501"));

    await expect(updateCustomMetaDef("1", patch)).rejects.toThrow("permission denied");
  });
});

describe("deleteCustomMetaDef", () => {
  it("usuwa DOKŁADNIE wskazany wiersz", async () => {
    db().setResponse(TABLE, ok(null));

    await expect(deleteCustomMetaDef("2")).resolves.toBeUndefined();
    expect(lastCalls()).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["id", "2"] },
    ]);
  });

  it("błąd usuwania leci wyjątkiem", async () => {
    db().setResponse(TABLE, fail("foreign key violation", "23503"));

    await expect(deleteCustomMetaDef("2")).rejects.toThrow("foreign key violation");
  });
});
