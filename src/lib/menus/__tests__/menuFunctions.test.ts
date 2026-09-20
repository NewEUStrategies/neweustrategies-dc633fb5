// Orkiestracja server fn menu: odczyt publiczny i zapis chroniony.
//
// Do 18.08.2026 cały plik miał 0% - bo ciała siedziały w `.handler(...)`,
// a `createServerFn` nie da się wywołać bez kontekstu żądania frameworka.
// Ciała są teraz zwykłymi funkcjami z wstrzykiwanym klientem, więc da się
// sprawdzić to, co naprawdę boli:
//
//   * ODCZYT: uszkodzony wiersz (`mega_config` z JSONB) nie może wywrócić SSR
//     nagłówka, odpowiedź bez osadzonych pozycji nie może zabrać CAŁEGO menu,
//     a samych połączeń do bazy ma być JEDNO (osadzenie PostgREST) na JEDNYM
//     współdzielonym kliencie anon,
//   * ZAPIS: bramka roli, KOLEJNOŚĆ wstawiania (klucz obcy w tej samej partii)
//     i to, że payload bez rodzica nie tworzy sierot w bazie.
//
// Reguły egzekwowane w bazie (RLS, izolacja tenanta) zostają pgTAP-owi.
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import { DEFAULT_MEGA_CONFIG, type MenuItemInput, type SaveMenuInput } from "../types";

// Atrapa fabryki klienta - wyłącznie po to, żeby POLICZYĆ jej wywołania.
// Wszystkie pozostałe przypadki wstrzykują własny łańcuch i tej atrapy nie
// dotykają.
const domyslny = vi.hoisted(() => ({ created: 0, stub: null as SupabaseFromStub | null }));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseFromStub: makeStub } = await import("@/test/supabase/chain");
  const stub = makeStub();
  domyslny.stub = stub;
  return {
    createClient: () => {
      domyslny.created += 1;
      return { from: stub.from };
    },
  };
});

import { fetchMenuWithItems, listMenuSummaries, saveMenuItems } from "../menu.functions";

function readClient() {
  const stub = supabaseFromStub();
  return { stub, client: { from: stub.from } as never };
}

function menuRow(over: Record<string, unknown> = {}) {
  return { id: "menu-1", key: "main", name: "Główne", ...over };
}

function itemRow(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    menu_id: "menu-1",
    parent_id: null,
    position: 0,
    item_type: "custom",
    ref_id: null,
    label_pl: "Blog",
    label_en: "Blog",
    href: "/blog",
    target: "_self",
    css_class: "",
    visibility: "all" as const,
    icon: null,
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
    ...over,
  };
}

describe("listMenuSummaries", () => {
  it("zwraca listę menu posortowaną po kluczu", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", ok([menuRow(), menuRow({ id: "m2", key: "footer" })]));

    const menus = await listMenuSummaries(client);
    expect(menus.map((m) => m.key)).toEqual(["main", "footer"]);
    expect(stub.lastChain("menus")?.argsOf("order")).toEqual(["key"]);
  });

  it("błąd odczytu daje pustą listę, nie wyjątek na ekranie administratora", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", fail("permission denied", "42501"));
    expect(await listMenuSummaries(client)).toEqual([]);
  });

  it("brak wierszy to pusta lista", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(null));
    expect(await listMenuSummaries(client)).toEqual([]);
  });
});

describe("fetchMenuWithItems", () => {
  it("scala menu z pozycjami JEDNYM zapytaniem (osadzenie PostgREST)", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(menuRow({ menu_items: [itemRow()] })));

    const menu = await fetchMenuWithItems("main", client);
    expect(menu).toMatchObject({ id: "menu-1", key: "main", name: "Główne" });
    expect(menu?.items).toHaveLength(1);

    // LICZBA POŁĄCZEŃ JEST KONTRAKTEM. Do 20.09.2026 leciały dwa zapytania
    // równolegle (menu + pozycje przez inner join), czyli dwa z sześciu
    // równoległych gniazd Workera - a menu `main` i `footer` grzane razem
    // w loaderze ROOTA brały cztery, dokładnie w t0 pierwszej fali.
    expect(stub.chains).toHaveLength(1);
    expect(stub.chainsFor("menu_items")).toHaveLength(0);

    const c = stub.lastChain("menus")!;
    expect(c.argsOf("eq")).toEqual(["key", "main"]);
    expect(c.has("maybeSingle")).toBe(true);
  });

  it("osadzenie niesie WSZYSTKIE kolumny, które czyta normalizacja", async () => {
    // Zgubiona kolumna w osadzeniu nie jest błędem PostgREST - po prostu nie
    // wraca, a normalizacja podstawia wartość domyślną. Ikona albo
    // `mega_config` znikają wtedy po cichu z nawigacji.
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(menuRow({ menu_items: [] })));
    await fetchMenuWithItems("main", client);

    const select = String(stub.lastChain("menus")!.argsOf("select")?.[0]);
    const embed = select.slice(select.indexOf("menu_items("));
    for (const kolumna of [
      "id",
      "menu_id",
      "parent_id",
      "position",
      "item_type",
      "ref_id",
      "label_pl",
      "label_en",
      "href",
      "target",
      "css_class",
      "visibility",
      "icon",
      "mega_enabled",
      "mega_config",
    ]) {
      expect(embed).toContain(kolumna);
    }
  });

  it("sortowanie jest zaadresowane do ZASOBU OSADZONEGO, nie do wierszy menu", async () => {
    // Bez `referencedTable` PostgREST posortowałby menu (jeden wiersz), a
    // pozycje wróciłyby w kolejności fizycznej - nawigacja poprzestawiana.
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(menuRow({ menu_items: [] })));
    await fetchMenuWithItems("main", client);
    expect(stub.lastChain("menus")!.argsOf("order")).toEqual([
      "position",
      { referencedTable: "menu_items" },
    ]);
  });

  it("nieistniejące menu daje `null` (nagłówek pokazuje wtedy stan pusty)", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(null));
    expect(await fetchMenuWithItems("nie-ma", client)).toBeNull();
  });

  it("błąd odczytu daje `null`, a nie wyjątek w renderze SSR", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", fail("boom"));
    expect(await fetchMenuWithItems("main", client)).toBeNull();
  });

  it("osadzenie w kształcie INNYM niż tablica nie wywraca nagłówka", async () => {
    // Po scaleniu w jedno zapytanie nie ma już osobnej gałęzi „błąd pozycji".
    // Została jedna realna granica: odpowiedź bez tablicy `menu_items` (RLS
    // przycięło zasób osadzony albo ktoś zmienił nazwę osadzenia). Menu ma się
    // wtedy wyrenderować puste, a nie zniknąć razem z resztą chrome.
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(menuRow({ menu_items: null })));
    expect(await fetchMenuWithItems("main", client)).toEqual({
      id: "menu-1",
      key: "main",
      name: "Główne",
      items: [],
    });
  });

  it("normalizuje pola, których baza nie gwarantuje", async () => {
    const { stub, client } = readClient();
    stub.setResponse(
      "menus",
      ok(
        menuRow({
          menu_items: [
            itemRow({
              parent_id: null,
              position: null,
              label_pl: null,
              label_en: null,
              href: null,
              target: null,
              css_class: null,
              icon: null,
              mega_enabled: null,
            }),
          ],
        }),
      ),
    );

    const [item] = (await fetchMenuWithItems("main", client))!.items;
    expect(item).toMatchObject({
      position: 0,
      label_pl: "",
      label_en: "",
      href: "",
      target: "_self",
      css_class: "",
      visibility: "all" as const,
      icon: "",
      mega_enabled: false,
    });
  });

  it("USZKODZONY `mega_config` schodzi na domyślny zamiast wywrócić SSR", async () => {
    // To jest kolumna JSONB - mógł ją zapisać starszy panel albo ręczny UPDATE.
    // Wyjątek tutaj przewraca render CAŁEJ strony, nie jednego panelu.
    const { stub, client } = readClient();
    stub.setResponse(
      "menus",
      ok(menuRow({ menu_items: [itemRow({ mega_config: { columns_per_row: "dużo" } })] })),
    );

    const [item] = (await fetchMenuWithItems("main", client))!.items;
    expect(item.mega_config).toEqual(DEFAULT_MEGA_CONFIG);
  });

  it("menu bez pozycji daje pustą listę", async () => {
    const { stub, client } = readClient();
    stub.setResponse("menus", ok(menuRow({ menu_items: [] })));
    expect((await fetchMenuWithItems("main", client))!.items).toEqual([]);
  });
});

/* ----------------------------- zapis chroniony ---------------------------- */

interface WriteRecorder {
  client: never;
  inserts: unknown[][];
  deletes: unknown[];
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
}

function writeClient(options: {
  roles?: { admin?: boolean; editor?: boolean };
  rpcError?: string;
  menu?: SupabaseResult;
  deleteError?: string;
  insertError?: string;
}): WriteRecorder {
  const inserts: unknown[][] = [];
  const deletes: unknown[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const roles = options.roles ?? { admin: true };

  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (options.rpcError) return Promise.resolve(fail(options.rpcError));
      const role = String(args._role);
      return Promise.resolve(ok(role === "admin" ? Boolean(roles.admin) : Boolean(roles.editor)));
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(options.menu ?? ok({ id: "menu-1", tenant_id: "t1" })),
        }),
      }),
      delete: () => ({
        eq: (_col: string, value: unknown) => {
          deletes.push({ table, value });
          return Promise.resolve(options.deleteError ? fail(options.deleteError) : { error: null });
        },
      }),
      insert: (rows: unknown[]) => {
        inserts.push(rows);
        return Promise.resolve(options.insertError ? fail(options.insertError) : { error: null });
      },
    }),
  };

  return { client: client as never, inserts, deletes, rpcCalls };
}

function input(items: Partial<MenuItemInput>[]): SaveMenuInput {
  return {
    menu_key: "main",
    items: items.map((it, idx) => ({
      local_id: `l${idx}`,
      parent_local_id: null,
      position: idx,
      item_type: "custom",
      ref_id: null,
      label_pl: `Pozycja ${idx}`,
      label_en: "",
      href: "/",
      target: "_self",
      css_class: "",
      visibility: "all" as const,
      icon: "",
      mega_enabled: false,
      mega_config: DEFAULT_MEGA_CONFIG,
      ...it,
    })),
  };
}

let counter = 0;
const makeId = () => `uuid-${++counter}`;

beforeEach(() => {
  counter = 0;
});

describe("saveMenuItems - bramka roli", () => {
  it("administrator przechodzi", async () => {
    const rec = writeClient({ roles: { admin: true } });
    await expect(saveMenuItems(rec.client, "u1", input([]), makeId)).resolves.toEqual({
      ok: true,
    });
    expect(rec.rpcCalls.map((c) => c.args._role)).toEqual(["admin", "editor"]);
  });

  it("redaktor też przechodzi", async () => {
    const rec = writeClient({ roles: { admin: false, editor: true } });
    await expect(saveMenuItems(rec.client, "u1", input([]), makeId)).resolves.toEqual({
      ok: true,
    });
  });

  it("czytelnik NIE przechodzi i nie dotyka bazy", async () => {
    // Bramka jest przed jakimkolwiek zapisem: odrzucone żądanie nie może
    // skasować pozycji, zanim RLS powie „nie".
    const rec = writeClient({ roles: { admin: false, editor: false } });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /Forbidden: staff role required/,
    );
    expect(rec.deletes).toEqual([]);
    expect(rec.inserts).toEqual([]);
  });
});

describe("saveMenuItems - przebieg zapisu", () => {
  it("nieistniejące menu przerywa zapis z czytelnym komunikatem", async () => {
    const rec = writeClient({ menu: ok(null) });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /Menu 'main' nie istnieje/,
    );
    expect(rec.deletes).toEqual([]);
  });

  it("błąd odczytu menu przerywa zapis", async () => {
    const rec = writeClient({ menu: fail("timeout") });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /menu lookup: timeout/,
    );
  });

  it("błąd kasowania starych pozycji przerywa zapis PRZED wstawieniem nowych", async () => {
    // Inaczej menu miałoby stare i nowe pozycje naraz - podwójną nawigację.
    const rec = writeClient({ deleteError: "deadlock detected" });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /delete items: deadlock detected/,
    );
    expect(rec.inserts).toEqual([]);
  });

  it("pusty payload czyści menu i kończy się bez wstawiania", async () => {
    const rec = writeClient({});
    await expect(saveMenuItems(rec.client, "u1", input([]), makeId)).resolves.toEqual({
      ok: true,
    });
    expect(rec.deletes).toHaveLength(1);
    expect(rec.inserts).toEqual([]);
  });

  it("błąd wstawiania jest propagowany z nazwą kroku", async () => {
    const rec = writeClient({ insertError: "violates foreign key" });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /insert items: violates foreign key/,
    );
  });

  it("wstawia POZIOMAMI: najpierw rodzice, potem dzieci", async () => {
    // Klucz obcy sprawdzany jest per wiersz, więc dziecko wstawione razem
    // z rodzicem w jednej partii wywala zapis. Kolejność JEST kontraktem.
    const rec = writeClient({});
    await saveMenuItems(
      rec.client,
      "u1",
      input([
        { local_id: "root", parent_local_id: null },
        { local_id: "kid", parent_local_id: "root" },
        { local_id: "grand", parent_local_id: "kid" },
      ]),
      makeId,
    );

    expect(rec.inserts).toHaveLength(3);
    const levels = rec.inserts.map((batch) =>
      (batch as { id: string; parent_id: string | null }[]).map((r) => r.parent_id),
    );
    expect(levels[0]).toEqual([null]);
    const rootId = (rec.inserts[0] as { id: string }[])[0].id;
    expect(levels[1]).toEqual([rootId]);
  });

  it("hierarchia przechodzi na NOWE identyfikatory, nie na klientowe", async () => {
    const rec = writeClient({});
    await saveMenuItems(
      rec.client,
      "u1",
      input([
        { local_id: "root", parent_local_id: null },
        { local_id: "kid", parent_local_id: "root" },
      ]),
      makeId,
    );
    const root = (rec.inserts[0] as { id: string }[])[0];
    const kid = (rec.inserts[1] as { parent_id: string }[])[0];
    expect(root.id).toBe("uuid-1");
    expect(kid.parent_id).toBe("uuid-1");
  });

  it("SIEROTA zapisuje się na najwyższym poziomie, a nie z martwym `parent_id`", async () => {
    // Mapowanie `local_id -> uuid` nie zna rodzica spoza payloadu, więc
    // `parent_id` wychodzi `null`. Zgadza się to z tym, co edytor pokazuje po
    // poprawce z 18.08.2026: pozycja stoi u góry drzewa i tam też ląduje.
    // Komentarz przy tym kodzie twierdził coś przeciwnego („nigdy nie zostanie
    // wstawiony") - ten test jest teraz źródłem prawdy.
    const rec = writeClient({});
    await saveMenuItems(
      rec.client,
      "u1",
      input([
        { local_id: "root", parent_local_id: null },
        { local_id: "sierota", parent_local_id: "duch" },
      ]),
      makeId,
    );
    const wszystkie = rec.inserts.flat() as { id: string; parent_id: string | null }[];
    expect(wszystkie).toHaveLength(2);
    expect(wszystkie.every((r) => r.parent_id === null)).toBe(true);
    // Jedna partia - obie pozycje są na tym samym poziomie.
    expect(rec.inserts).toHaveLength(1);
  });

  it("przenosi całą treść pozycji do wiersza", async () => {
    const rec = writeClient({});
    await saveMenuItems(
      rec.client,
      "u1",
      input([
        {
          local_id: "a",
          item_type: "category",
          ref_id: "22222222-2222-2222-2222-222222222222",
          label_pl: "Analizy",
          label_en: "Analyses",
          href: "/analizy",
          target: "_blank",
          css_class: "wyróżniony",
          icon: "star",
          mega_enabled: true,
        },
      ]),
      makeId,
    );
    expect((rec.inserts[0] as Record<string, unknown>[])[0]).toMatchObject({
      menu_id: "menu-1",
      item_type: "category",
      ref_id: "22222222-2222-2222-2222-222222222222",
      label_pl: "Analizy",
      label_en: "Analyses",
      href: "/analizy",
      target: "_blank",
      css_class: "wyróżniony",
      icon: "star",
      mega_enabled: true,
    });
  });

  it("błąd RPC bramki roli nie przepuszcza zapisu", async () => {
    const rec = writeClient({ rpcError: "function has_role does not exist" });
    await expect(saveMenuItems(rec.client, "u1", input([{}]), makeId)).rejects.toThrow(
      /Forbidden: staff role required/,
    );
  });

  it("domyślny generator identyfikatorów daje UUID-y", async () => {
    const rec = writeClient({});
    await saveMenuItems(rec.client, "u1", input([{ local_id: "a" }]));
    const row = (rec.inserts[0] as { id: string }[])[0];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("kontrakt walidatora zapisu", () => {
  it("payload przechodzi przez schemat, więc pozycja bez nazwy nie dojdzie do bazy", async () => {
    const { saveMenuInputSchema } = await import("../types");
    const parsed = saveMenuInputSchema.safeParse({
      menu_key: "main",
      items: [{ local_id: "a", parent_local_id: null, position: 0, item_type: "custom" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("nieznany typ pozycji też odpada na walidacji", async () => {
    const { saveMenuInputSchema } = await import("../types");
    expect(
      saveMenuInputSchema.safeParse({
        menu_key: "main",
        items: [
          {
            local_id: "a",
            parent_local_id: null,
            position: 0,
            item_type: "widget",
            ref_id: null,
            label_pl: "X",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

// Import server fn wciąga `@tanstack/react-start`; sprawdzamy tylko, że moduł
// eksportuje obwoluty (samo wywołanie wymaga kontekstu żądania).
describe("obwoluty server fn", () => {
  it("moduł wystawia listMenus, getMenuWithItems i saveMenu", async () => {
    const mod = await import("../menu.functions");
    expect(typeof mod.listMenus).toBe("function");
    expect(typeof mod.getMenuWithItems).toBe("function");
    expect(typeof mod.saveMenu).toBe("function");
  });
});

// Zamknięcie: atrapa nie może cicho przepuszczać tabel, których test nie
// zaplanował - inaczej „brak wiersza" udawałby poprawny odczyt.
describe("higiena atrapy", () => {
  it("niezaplanowana tabela zwraca błąd, nie pustkę", async () => {
    const { client } = readClient();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchMenuWithItems("main", client)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// Klient anon był budowany PRZY KAŻDYM wywołaniu, a menu jest grzane w loaderze
// ROOTA na każdej trasie z chrome - czyli `createClient` biegł na każde
// chybienie w `edgeTtlCache`, dwa razy (main + footer). Na Workers czas CPU
// jest zasobem bilowanym, więc to jest oszczędność realna, choć nie w latencji.
describe("klient anon: jeden egzemplarz na izolat", () => {
  it("DRUGI odczyt menu NIE buduje kolejnego klienta", async () => {
    const stub = domyslny.stub!;
    stub.reset();
    stub.setResponse("menus", ok(menuRow({ menu_items: [] })));

    await fetchMenuWithItems("main");
    const poPierwszym = domyslny.created;
    await fetchMenuWithItems("footer");

    // Przyrost, nie wartość bezwzględna: singleton żyje na poziomie MODUŁU,
    // więc licznik zależałby od kolejności bloków w pliku.
    expect(domyslny.created).toBe(poPierwszym);
    expect(stub.chainsFor("menus")).toHaveLength(2);
  });
});
