// MAGAZYN SZABLONÓW SEKCJI - najemca z sesji, rozróżnialne porażki, obcięcie
// listy i wyścig odpowiedzi (kontrakty wprowadzone 2026-10-18).
//
// Siostrzany templates.test.ts pilnuje kształtu zapytań i bramki jakości
// wierszy. Ten plik dowodzi tego, co DOSZŁO przy naprawie dawnych `it.fails`:
//   1. BEZ NAJEMCY NIC NIE LECI. Zanim `useCurrentTenantId` zwróci najemcę,
//      ani odczyt, ani zapis nie dotyka bazy - a zapisy mówią „nie" wynikiem
//      (`null` / `false`), zamiast trafić w obszar roboczy, którego kod nie zna.
//   2. PORAŻKA JEST WYNIKIEM, NIE CISZĄ. `update`/`remove` oddają `false`
//      przy odmowie i wtedy NIE przeładowują listy; `true` przy sukcesie.
//   3. OBCIĘCIE JEST SYGNAŁEM. Pobieramy limit+1 wierszy: dodatkowy wiersz
//      nie trafia na ekran, tylko podnosi `truncated`.
//   4. STAN BŁĘDU JEST CHWILOWY. Udany `reload` po odmowie czyści `error`.
//   5. WYŚCIG MIĘDZY NAJEMCAMI. Spóźniona odpowiedź dla poprzedniego najemcy
//      nie nadpisuje listy nowego - inaczej redakcja widziałaby cudze szablony.
//
// Granice: atrapujemy wyłącznie klienta Supabase (wspólna atrapa łańcucha
// z @/test/supabase) i hook najemcy (jego droga do `profiles` ma własny test).
// `cloneSection` i bramka `toTemplate` są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
  /** Podmiana `from` tylko tam, gdzie odpowiedź trzeba zatrzymać w locie. */
  fromOverride: null as ((table: string) => unknown) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (h.fromOverride) return h.fromOverride(table);
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "user-9" } } }, error: null }),
    },
  },
}));

vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabase";
import type { SectionNode } from "@/lib/builder/types";
import {
  SECTION_TEMPLATES_LIMIT,
  TEMPLATE_REVISIONS_LIMIT,
  useSectionTemplates,
  useTemplateRevisions,
} from "@/lib/builder/templates";

const TPL = "builder_templates";
const REV = "builder_template_revisions";
const TENANT = "11111111-1111-4111-8111-111111111111";
const INNY_TENANT = "22222222-2222-4222-8222-222222222222";

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return h.db;
}

const sec = (id = "sec-1"): SectionNode => ({ id, kind: "section", children: [] });

const tplRow = (id: string) => ({
  id,
  name: `Szablon ${id}`,
  data: sec(`sec-${id}`),
  created_at: "2026-08-22T10:00:00.000Z",
  created_by: null,
});

const revRow = (id: string) => ({ ...tplRow(id), template_id: "t1", note: null });

/** Odpowiedź tabeli szablonów rozdzielana po ogniwie: lista albo zapis. */
function respond(parts: { list?: SupabaseResult; write?: SupabaseResult }): void {
  db().setResponse(TPL, (chain: RecordedChain) => {
    if (chain.has("insert")) return parts.write ?? ok({ id: "t-nowy" });
    if (chain.has("update") || chain.has("delete")) return parts.write ?? ok(null);
    return parts.list ?? ok([]);
  });
}

const eqArgs = (chain: RecordedChain | undefined) =>
  (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);

/** Łańcuchy odczytu listy (bez zapisów). */
const listChains = () =>
  db()
    .chainsFor(TPL)
    .filter((c) => !c.has("insert") && !c.has("update") && !c.has("delete"));

async function mountTemplates() {
  const view = renderHook(() => useSectionTemplates());
  await waitFor(() => {
    expect(listChains().length).toBeGreaterThan(0);
    expect(view.result.current.loading).toBe(false);
  });
  return view;
}

async function przemiel(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.fromOverride = null;
});

afterEach(() => {
  h.db?.reset();
  h.fromOverride = null;
});

describe("useSectionTemplates - nieznany najemca", () => {
  it("nie pyta bazy, a zapisy odmawiają wynikiem bez żadnego zapytania", async () => {
    h.tenantId = null;
    respond({ list: ok([tplRow("t1")]) });

    const view = renderHook(() => useSectionTemplates());
    await przemiel();

    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.error).toBeNull();

    let zapis: string | null = "nie-ustawione";
    let zmiana: boolean | null = null;
    let usuniecie: boolean | null = null;
    await act(async () => {
      zapis = await view.result.current.save("Sekcja", sec());
      zmiana = await view.result.current.update("t1", { name: "Nowa" });
      usuniecie = await view.result.current.remove("t1");
    });

    expect(zapis).toBeNull();
    expect(zmiana).toBe(false);
    expect(usuniecie).toBe(false);
    expect(db().chainsFor(TPL)).toHaveLength(0);
  });

  it("pusty patch pozostaje sukcesem bez zapytania nawet bez najemcy", async () => {
    // Nie ma czego zapisać, więc nie ma czego odrzucić - `true` znaczy
    // „stan w bazie odpowiada żądaniu".
    h.tenantId = null;
    const view = renderHook(() => useSectionTemplates());
    await przemiel();

    let wynik: boolean | null = null;
    await act(async () => {
      wynik = await view.result.current.update("t1", {});
    });

    expect(wynik).toBe(true);
    expect(db().chainsFor(TPL)).toHaveLength(0);
  });
});

describe("useSectionTemplates - zapisy niosą najemcę i mówią o porażce", () => {
  it("insert niesie tenant_id z sesji i kolumny szablonu sekcji", async () => {
    respond({ list: ok([]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.save("Stopka", sec());
    });

    const insert = db()
      .chainsFor(TPL)
      .find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      name: "Stopka",
      scope: "section",
      created_by: "user-9",
    });
  });

  it("udana zmiana i usunięcie oddają true, domykają tenant_id i przeładowują listę", async () => {
    respond({ list: ok([tplRow("t1")]) });
    const view = await mountTemplates();

    let zmiana: boolean | null = null;
    let usuniecie: boolean | null = null;
    await act(async () => {
      zmiana = await view.result.current.update("t1", { name: "Nowa nazwa" });
      usuniecie = await view.result.current.remove("t1");
    });

    expect(zmiana).toBe(true);
    expect(usuniecie).toBe(true);
    const update = db()
      .chainsFor(TPL)
      .find((c) => c.has("update"));
    const del = db()
      .chainsFor(TPL)
      .find((c) => c.has("delete"));
    expect(eqArgs(update)).toEqual([
      ["id", "t1"],
      ["tenant_id", TENANT],
    ]);
    expect(eqArgs(del)).toEqual([
      ["id", "t1"],
      ["tenant_id", TENANT],
    ]);
    // Montaż + przeładowanie po każdej z dwóch udanych mutacji.
    expect(listChains()).toHaveLength(3);
  });

  it("odrzucona zmiana i usunięcie oddają false i NIE przeładowują listy", async () => {
    respond({ list: ok([tplRow("t1")]), write: fail("permission denied", "42501") });
    const view = await mountTemplates();

    let zmiana: boolean | null = null;
    let usuniecie: boolean | null = null;
    await act(async () => {
      zmiana = await view.result.current.update("t1", { section: sec("nowa") });
      usuniecie = await view.result.current.remove("t1");
    });

    expect(zmiana).toBe(false);
    expect(usuniecie).toBe(false);
    expect(listChains()).toHaveLength(1);
    // Lista zostaje taka, jaką redaktor widział - nic nie mignęło.
    expect(view.result.current.items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("insert bez zwróconego wiersza (i bez błędu) też jest porażką, a nie id `undefined`", async () => {
    respond({ list: ok([]), write: ok(null) });
    const view = await mountTemplates();

    let wynik: string | null = "nie-ustawione";
    await act(async () => {
      wynik = await view.result.current.save("Sekcja", sec());
    });

    expect(wynik).toBeNull();
  });
});

describe("useSectionTemplates - obcięcie i stan błędu", () => {
  it("sto pierwszy wiersz NIE trafia na ekran, tylko podnosi `truncated`", async () => {
    const wiersze = Array.from({ length: SECTION_TEMPLATES_LIMIT + 1 }, (_, i) => tplRow(`t-${i}`));
    respond({ list: ok(wiersze) });

    const view = await mountTemplates();

    expect(view.result.current.items).toHaveLength(SECTION_TEMPLATES_LIMIT);
    // Kolejność z bazy (najnowsze najpierw) zostaje - odcinany jest OGON.
    expect(view.result.current.items[0].id).toBe("t-0");
    expect(view.result.current.items.at(-1)?.id).toBe(`t-${SECTION_TEMPLATES_LIMIT - 1}`);
    expect(view.result.current.truncated).toBe(true);
  });

  it("dokładnie sto wierszy to CAŁA biblioteka - bez sygnału obcięcia", async () => {
    respond({
      list: ok(Array.from({ length: SECTION_TEMPLATES_LIMIT }, (_, i) => tplRow(`t-${i}`))),
    });

    const view = await mountTemplates();

    expect(view.result.current.items).toHaveLength(SECTION_TEMPLATES_LIMIT);
    expect(view.result.current.truncated).toBe(false);
  });

  it("udany reload po odmowie czyści stan błędu i pokazuje szablony", async () => {
    let odmowa = true;
    db().setResponse(TPL, () =>
      odmowa ? fail("permission denied for table builder_templates", "42501") : ok([tplRow("t1")]),
    );
    const view = await mountTemplates();
    expect(view.result.current.error).toBe("permission denied for table builder_templates");

    odmowa = false;
    await act(async () => {
      await view.result.current.reload();
    });

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("błąd bez komunikatu nadal jest błędem, a nie pustym napisem udającym sukces", async () => {
    respond({ list: fail("") });

    const view = await mountTemplates();

    expect(view.result.current.error).toBeTruthy();
  });

  it("odpowiedź bez tablicy wierszy (i bez błędu) to pusta biblioteka i pusta historia", async () => {
    respond({ list: ok(null) });
    db().setResponse(REV, () => ok(null));

    const lista = await mountTemplates();
    const historia = renderHook(() => useTemplateRevisions("t1"));
    await waitFor(() => expect(db().chainsFor(REV)).toHaveLength(1));
    await waitFor(() => expect(historia.result.current.loading).toBe(false));

    // Brak wierszy to poprawny stan - ani błąd, ani sygnał obcięcia.
    for (const stan of [lista.result.current, historia.result.current]) {
      expect(stan.items).toEqual([]);
      expect(stan.error).toBeNull();
      expect(stan.truncated).toBe(false);
    }
  });

  it("oddany obiekt jest stabilny między renderami bez zmiany danych", async () => {
    respond({ list: ok([tplRow("t1")]) });
    const view = await mountTemplates();
    const przed = view.result.current;

    view.rerender();

    // Wołający trzymają hak w zależnościach efektów i memo - nowa referencja
    // przy każdym renderze przerysowywałaby bibliotekę bez powodu.
    expect(view.result.current).toBe(przed);
  });
});

describe("useSectionTemplates - wyścig odpowiedzi między najemcami", () => {
  it("spóźniona odpowiedź dla poprzedniego najemcy nie nadpisuje listy nowego", async () => {
    // Odpowiedzi trzymane na uwięzi per najemca - wspólna atrapa rozwiązuje
    // łańcuch w jednym mikrotasku, więc tu potrzebny jest własny łańcuch.
    const bramy = new Map<string, (r: SupabaseResult) => void>();
    h.fromOverride = () => {
      let tenant = "";
      const builder: Record<string, unknown> = {};
      for (const ogniwo of ["select", "eq", "order", "limit"]) {
        builder[ogniwo] = (...args: unknown[]) => {
          if (ogniwo === "eq" && args[0] === "tenant_id") tenant = String(args[1]);
          return builder;
        };
      }
      builder.then = (onFulfilled?: (v: SupabaseResult) => unknown) =>
        new Promise<SupabaseResult>((resolve) => bramy.set(tenant, resolve)).then(onFulfilled);
      return builder;
    };

    const view = renderHook(() => useSectionTemplates());
    await przemiel();
    expect([...bramy.keys()]).toEqual([TENANT]);

    // Redaktor przełącza obszar roboczy, zanim wróciła lista pierwszego.
    h.tenantId = INNY_TENANT;
    view.rerender();
    await przemiel();
    expect([...bramy.keys()]).toEqual([TENANT, INNY_TENANT]);

    await act(async () => {
      bramy.get(INNY_TENANT)?.(ok([tplRow("moj")]));
      await Promise.resolve();
    });
    await act(async () => {
      bramy.get(TENANT)?.(ok([tplRow("cudzy")]));
      await Promise.resolve();
    });

    expect(view.result.current.items.map((t) => t.id)).toEqual(["moj"]);
    expect(view.result.current.loading).toBe(false);
  });
});

describe("useTemplateRevisions - najemca, obcięcie i błąd", () => {
  it("bez najemcy historia nie pyta bazy nawet dla wybranego szablonu", async () => {
    h.tenantId = null;
    db().setResponse(REV, () => ok([revRow("r1")]));

    const view = renderHook(() => useTemplateRevisions("t1"));
    await przemiel();

    expect(db().chainsFor(REV)).toHaveLength(0);
    expect(view.result.current.items).toEqual([]);
  });

  it("pięćdziesiąta pierwsza rewizja podnosi `truncated` i nie trafia na listę", async () => {
    db().setResponse(REV, () =>
      ok(Array.from({ length: TEMPLATE_REVISIONS_LIMIT + 1 }, (_, i) => revRow(`r-${i}`))),
    );

    const view = renderHook(() => useTemplateRevisions("t1"));
    await waitFor(() => expect(view.result.current.items).toHaveLength(TEMPLATE_REVISIONS_LIMIT));

    expect(view.result.current.truncated).toBe(true);
    expect(eqArgs(db().lastChain(REV))).toEqual([
      ["template_id", "t1"],
      ["tenant_id", TENANT],
    ]);
  });

  it("odmowa odczytu historii wystawia błąd, a przejście na inny szablon go czyści", async () => {
    db().setResponse(REV, (chain) =>
      eqArgs(chain)[0]?.[1] === "t1"
        ? fail("permission denied for table builder_template_revisions", "42501")
        : ok([revRow("r2")]),
    );

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() =>
      expect(view.result.current.error).toBe(
        "permission denied for table builder_template_revisions",
      ),
    );
    expect(view.result.current.items).toEqual([]);

    view.rerender({ id: "t2" });
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.truncated).toBe(false);
  });
});
