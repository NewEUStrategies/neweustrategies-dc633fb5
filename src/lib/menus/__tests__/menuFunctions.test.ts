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
//   * ZAPIS: całe drzewo JEDNYM wywołaniem `save_menu_items` (jedna
//     transakcja - stare pozycje nie znikają bez nowych), zero dostępu do
//     tabel z aplikacji, komunikaty z wyjątków funkcji i odświeżenie migawki
//     wyłącznie po udanym zapisie; plus kontrakt samej migracji.
//
// Reguły egzekwowane w bazie (RLS, izolacja tenanta, wycofanie zapisu
// przerwanego w połowie) zostają pgTAP-owi.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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

import {
  fetchMenuWithItems,
  listMenuSummaries,
  menuCacheKey,
  saveMenuItems,
} from "../menu.functions";

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

// Do 02.10.2026 zapis był łańcuchem osobnych żądań (bramka `has_role` x2 ->
// odczyt menu -> `delete` wszystkich pozycji -> `insert` poziomami BFS), każde
// we własnej transakcji - błąd w połowie zostawiał menu PUSTE albo OBCIĘTE,
// publicznie. Teraz całe drzewo idzie jednym RPC `save_menu_items`, więc te
// testy pilnują KONTRAKTU TRANSPORTU: jedno wywołanie, zero dostępu do tabel
// z aplikacji, czytelne komunikaty z wyjątków funkcji i odświeżenie migawki
// wyłącznie po udanym zapisie. Reguły drzewa (mapowanie `local_id -> uuid`,
// sierota na najwyższym poziomie, wycofanie całości po błędzie w połowie)
// mieszkają teraz w bazie i przybija je pgTAP
// (`supabase/tests/menu_items_save_atomic_test.sql`).

interface WriteRecorder {
  client: never;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  /** Każda próba sięgnięcia po tabelę - zapis menu NIE ma prawa tego robić. */
  tables: string[];
}

function writeClient(result: SupabaseResult = ok(0)): WriteRecorder {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const tables: string[] = [];

  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(result);
    },
    // Atrapa NIE udaje tabel: osobny `delete`/`insert` z aplikacji to dokładnie
    // ten nieatomowy przebieg, który był defektem - ma się wywrócić na teście.
    from: (table: string) => {
      tables.push(table);
      throw new Error(`zapis menu sięgnął po tabelę '${table}' z pominięciem RPC`);
    },
  };

  return { client: client as never, rpcCalls, tables };
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

const noInvalidate = () => Promise.resolve();

describe("saveMenuItems - zapis atomowy", () => {
  it("całe drzewo idzie JEDNYM wywołaniem RPC, bez osobnego delete/insert na tabeli", async () => {
    // Sedno defektu: skasowanie starych pozycji i wstawienie nowych muszą być
    // jedną transakcją. Z aplikacji da się to zapewnić wyłącznie jednym
    // wywołaniem funkcji bazy - każde dodatkowe żądanie to osobny commit.
    const rec = writeClient(ok(3));
    await expect(
      saveMenuItems(
        rec.client,
        input([
          { local_id: "root", parent_local_id: null },
          { local_id: "kid", parent_local_id: "root" },
          { local_id: "grand", parent_local_id: "kid" },
        ]),
        noInvalidate,
      ),
    ).resolves.toEqual({ ok: true });

    expect(rec.rpcCalls.map((c) => c.fn)).toEqual(["save_menu_items"]);
    expect(rec.tables).toEqual([]);
  });

  it("hierarchię wysyła jako `local_id`/`parent_local_id` - UUID nadaje baza w tej samej transakcji", async () => {
    // Gdyby aplikacja nadawała identyfikatory sama, kusiłoby wstawianie
    // poziomami - czyli znowu kilka transakcji. Payload ma dojść do funkcji
    // w kształcie z edytora, bez `id`/`parent_id` dopisanych po drodze.
    const rec = writeClient(ok(2));
    const payload = input([
      { local_id: "root", parent_local_id: null },
      { local_id: "kid", parent_local_id: "root" },
    ]);
    await saveMenuItems(rec.client, payload, noInvalidate);

    const args = rec.rpcCalls[0].args;
    expect(args.p_menu_key).toBe("main");
    expect(args.p_items).toEqual(payload.items);
    for (const item of args.p_items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty("id");
      expect(item).not.toHaveProperty("parent_id");
    }
  });

  it("SIEROTA idzie do bazy z `parent_local_id` bez zmian - najwyższy poziom nadaje funkcja", async () => {
    // Reguła „sierota ląduje u góry drzewa" (zgodna z edytorem od 18.08.2026)
    // mieszka teraz w `save_menu_items`; aplikacja nie może jej „naprawiać"
    // po swojemu, bo dwie implementacje rozjadą się przy pierwszej korekcie.
    const rec = writeClient(ok(2));
    await saveMenuItems(
      rec.client,
      input([
        { local_id: "root", parent_local_id: null },
        { local_id: "sierota", parent_local_id: "duch" },
      ]),
      noInvalidate,
    );
    const items = rec.rpcCalls[0].args.p_items as MenuItemInput[];
    expect(items.map((it) => it.parent_local_id)).toEqual([null, "duch"]);
  });

  it("pusty payload też idzie przez RPC - wyczyszczenie menu to ta sama transakcja", async () => {
    const rec = writeClient(ok(0));
    await expect(saveMenuItems(rec.client, input([]), noInvalidate)).resolves.toEqual({
      ok: true,
    });
    expect(rec.rpcCalls).toHaveLength(1);
    expect(rec.rpcCalls[0].args.p_items).toEqual([]);
    expect(rec.tables).toEqual([]);
  });

  it("przenosi całą treść pozycji do payloadu", async () => {
    const rec = writeClient(ok(1));
    await saveMenuItems(
      rec.client,
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
          visibility: "auth",
          icon: "star",
          mega_enabled: true,
        },
      ]),
      noInvalidate,
    );
    expect((rec.rpcCalls[0].args.p_items as Record<string, unknown>[])[0]).toMatchObject({
      local_id: "a",
      item_type: "category",
      ref_id: "22222222-2222-2222-2222-222222222222",
      label_pl: "Analizy",
      label_en: "Analyses",
      href: "/analizy",
      target: "_blank",
      css_class: "wyróżniony",
      visibility: "auth",
      icon: "star",
      mega_enabled: true,
      mega_config: DEFAULT_MEGA_CONFIG,
    });
  });
});

describe("saveMenuItems - komunikaty błędów", () => {
  it("odmowa bramki roli w bazie daje czytelny „Forbidden”", async () => {
    // Bramka admin/editor siedzi w funkcji (1:1 z politykami RLS), więc
    // odrzucone żądanie nie dotyka pozycji ANI razu - nie ma już okna między
    // sprawdzeniem roli a zapisem.
    const rec = writeClient(fail("forbidden: staff role required", "42501"));
    await expect(saveMenuItems(rec.client, input([{}]), noInvalidate)).rejects.toThrow(
      /Forbidden: staff role required/,
    );
    expect(rec.tables).toEqual([]);
  });

  it("brak EXECUTE (42501 z PostgREST) to ta sama odmowa", async () => {
    const rec = writeClient(fail("permission denied for function save_menu_items", "42501"));
    await expect(saveMenuItems(rec.client, input([{}]), noInvalidate)).rejects.toThrow(
      /Forbidden: staff role required/,
    );
  });

  it("nieistniejące menu przerywa zapis z czytelnym komunikatem", async () => {
    const rec = writeClient(fail("menu_not_found", "P0002"));
    await expect(saveMenuItems(rec.client, input([{}]), noInvalidate)).rejects.toThrow(
      /Menu 'main' nie istnieje/,
    );
  });

  it("błąd w połowie drzewa jest propagowany z nazwą kroku (a baza wycofała całość)", async () => {
    const rec = writeClient(
      fail('new row for relation "menu_items" violates check constraint', "23514"),
    );
    await expect(saveMenuItems(rec.client, input([{}]), noInvalidate)).rejects.toThrow(
      /save menu: new row for relation "menu_items" violates check constraint/,
    );
  });

  it("brak funkcji w bazie (kod wdrożony przed migracją) NIE kasuje menu", async () => {
    // Stary przebieg najpierw kasował, potem wstawiał. Teraz brak RPC kończy
    // się błędem ZANIM cokolwiek zostanie zmienione - menu zostaje jak było.
    const rec = writeClient(
      fail("Could not find the function public.save_menu_items(p_items, p_menu_key)", "PGRST202"),
    );
    await expect(saveMenuItems(rec.client, input([{}]), noInvalidate)).rejects.toThrow(
      /save menu: Could not find the function/,
    );
    expect(rec.tables).toEqual([]);
  });
});

describe("saveMenuItems - odświeżenie migawki menu", () => {
  it("udany zapis unieważnia migawkę pod TYM SAMYM kluczem, pod którym czyta getMenuWithItems", async () => {
    // Bez tego edytor po „Zapisz" i powrocie na ekran wczytywał STARE menu
    // z `edgeTtlCache` tego izolatu (60 s), a kolejny zapis cofał zmiany.
    const rec = writeClient(ok(1));
    const invalidate = vi.fn(() => Promise.resolve());
    await saveMenuItems(rec.client, input([{}]), invalidate);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(menuCacheKey("main"));
    expect(menuCacheKey("main")).toBe("menu-with-items:main");
  });

  it("nieudany zapis NIE unieważnia migawki - stare menu jest nadal prawdą", async () => {
    const rec = writeClient(fail("boom"));
    const invalidate = vi.fn(() => Promise.resolve());
    await expect(saveMenuItems(rec.client, input([{}]), invalidate)).rejects.toThrow();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("domyślne unieważnienie nie wywraca zapisu poza kontekstem żądania", async () => {
    const rec = writeClient(ok(1));
    await expect(saveMenuItems(rec.client, input([{}]))).resolves.toEqual({ ok: true });
  });

  it("porażka unieważnienia NIE zamienia zatwierdzonego zapisu w błąd", async () => {
    // Baza już zatwierdziła nowe menu. Komunikat „błąd zapisu" kazałby
    // redaktorowi szukać problemu, którego nie ma.
    const rec = writeClient(ok(1));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      saveMenuItems(rec.client, input([{}]), () => Promise.reject(new Error("cache down"))),
    ).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("pozycje pominięte przez bazę (pierścień rodziców) zostawiają ślad w logu", async () => {
    // Pierścień nie jest osiągalny z korzenia, więc ani edytor, ani `SiteMenu`
    // go nie pokazują i baza go nie zapisuje - ale nie po cichu.
    const rec = writeClient(ok(1));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveMenuItems(
      rec.client,
      input([
        { local_id: "root", parent_local_id: null },
        { local_id: "a", parent_local_id: "b" },
        { local_id: "b", parent_local_id: "a" },
      ]),
      noInvalidate,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pominięto 2"));
    warn.mockRestore();
  });

  it("komplet zapisanych pozycji nie loguje niczego", async () => {
    const rec = writeClient(ok(2));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveMenuItems(rec.client, input([{}, {}]), noInvalidate);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* -------------------------- kontrakt funkcji bazy ------------------------- */

// Zapis stoi teraz na `save_menu_items`, więc to, co dotąd pilnował kod
// aplikacji (bramka, zakres tenanta, komplet pól), musi być przybite w SQL-u.
// Pełne zachowanie (wycofanie po błędzie w połowie, izolacja tenantów,
// mapowanie hierarchii) sprawdza pgTAP na prawdziwym Postgresie; tu - bez bazy -
// pilnujemy rzeczy, które rozjeżdżają się po cichu przy edycji migracji.
const MIGRACJA_ZAPISU = "supabase/migrations/20261002190000_save_menu_items_atomic.sql";

function functionBody(): string {
  const sql = readFileSync(MIGRACJA_ZAPISU, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.save_menu_items");
  const bodyStart = sql.indexOf("AS $$", start);
  const bodyEnd = sql.indexOf("$$;", bodyStart);
  return sql.slice(bodyStart, bodyEnd);
}

describe("save_menu_items - kontrakt migracji", () => {
  const sql = readFileSync(MIGRACJA_ZAPISU, "utf8");
  const body = functionBody();

  it("SECURITY DEFINER z przypiętym search_path", () => {
    const header = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.save_menu_items"));
    expect(header).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  });

  it("bramka roli 1:1 z politykami RLS: admin albo editor", () => {
    expect(body).toContain("public.has_role(v_uid, 'admin'::public.app_role)");
    expect(body).toContain("public.has_role(v_uid, 'editor'::public.app_role)");
  });

  it("menu rozstrzygane w tenancie DOMOWYM, nigdy z nagłówka hosta", () => {
    // `public_tenant_id()` w SECURITY DEFINER razem z `has_role` = admin
    // tenanta A zapisuje menu tenanta B, podrabiając host.
    expect(body).toContain("v_tenant := public.current_tenant_id()");
    expect(body).toMatch(/WHERE m\.tenant_id = v_tenant\s+AND m\.key = p_menu_key\s+FOR UPDATE/);
    expect(body).not.toMatch(/public_tenant_id|request_public_host/);
  });

  it("kasowanie i wstawianie są w JEDNYM ciele funkcji, bez własnego COMMIT", () => {
    const del = body.indexOf("DELETE FROM public.menu_items");
    const ins = body.indexOf("INSERT INTO public.menu_items");
    expect(del).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(del);
    expect(body).not.toMatch(/\bCOMMIT\b/i);
  });

  it("KAŻDE pole pozycji z walidatora jest zapisywane - nowe pole nie zniknie po cichu", async () => {
    // Pole dodane do `menuItemInputSchema`, ale nie do INSERT-u, nie jest
    // błędem bazy: jsonb po prostu niesie klucz, którego nikt nie czyta.
    const { menuItemInputSchema } = await import("../types");
    const persisted = Object.keys(menuItemInputSchema.shape).filter(
      (k) => k !== "local_id" && k !== "parent_local_id",
    );
    const columns = body.slice(
      body.indexOf("INSERT INTO public.menu_items ("),
      body.indexOf(")", body.indexOf("INSERT INTO public.menu_items (")),
    );
    for (const field of persisted) {
      expect(columns).toContain(field);
      expect(body).toMatch(new RegExp(`t\\.item ->>? '${field}'`));
    }
  });

  it("sufit partii w bazie jest tym samym sufitem co w walidatorze", async () => {
    const { saveMenuInputSchema } = await import("../types");
    expect(body).toContain("jsonb_array_length(p_items) > 500");
    expect(
      saveMenuInputSchema.safeParse(input(Array.from({ length: 500 }, () => ({})))).success,
    ).toBe(true);
    expect(
      saveMenuInputSchema.safeParse(input(Array.from({ length: 501 }, () => ({})))).success,
    ).toBe(false);
  });

  it("anon nie ma EXECUTE, authenticated ma", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_menu_items\(text, jsonb\) FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.save_menu_items\(text, jsonb\) TO authenticated;/,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.save_menu_items[^;]*\banon\b/);
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
