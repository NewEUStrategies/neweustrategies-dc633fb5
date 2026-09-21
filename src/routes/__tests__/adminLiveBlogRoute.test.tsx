// Trasa `/admin/live-blog` ZAMONTOWANA - moderacja relacji na żywo dla
// wybranego postu i wybranego bloku „liveblog" w jego treści.
//
// USTALENIE, KTÓRE MUSI TU STAĆ NA WIERZCHU: TA TRASA NIE MA KANAŁU REALTIME.
// Zadanie zakładało, że panel relacji na żywo subskrybuje kanał i że trzeba go
// zbadać `src/test/supabase/realtime.ts`. Sprawdziłem: `admin.live-blog.tsx`
// nie woła ani `supabase.channel`, ani `removeChannel` - ani razu. Kanał
// (`liveblog:${postId}:${blockId}`, `postgres_changes` po `post_id`, zdjęcie
// subskrypcji w funkcji sprzątającej efektu) mieszka w KOMPONENCIE CZYTELNIKA:
// `src/components/blocks/LiveBlogBlock.tsx`. Panel administracyjny odświeża
// SWOJĄ listę unieważnieniem klucza `["liveBlogEntries"]`, a do czytelnika
// zmiana dochodzi kanałem - nie unieważnieniem.
//
// Z TEGO WYNIKA GRANICA TEGO PLIKU. Asercje o subskrypcji, nowym wpisie
// i WYPISANIU przy odmontowaniu należą do testu `LiveBlogBlock`, bo tylko tam
// jest co asertować; tutaj dowodzimy rzeczy, której tamten komponent nie
// widzi: że panel unieważnia SWÓJ klucz, a nie klucz czytelnika (są RÓŻNE:
// czytelnik czyta pod `["public", "blocks", "liveblog", {...}]`
// z `blockQueryOptionsList`). Test tego rozdziału stoi niżej i mówi wprost,
// dlaczego to jest poprawne, a nie zapomniane.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. ADRES JEST STANEM TEJ TRASY. Post, blok i język siedzą w `search`,
//      bo panel jest linkowany WPROST z edytora bloku (deep-link niesie tylko
//      `blockId`). `validateSearch` musi przyjąć taki adres i zawężyć język do
//      dwóch wartości - inaczej `?lang=de` wysyła zapytanie o wpisy w języku,
//      którego kolumna nie zna.
//   2. BEZ POSTU I BLOKU NIE MA ODCZYTU WPISÓW. `enabled` chroni przed
//      zapytaniem z `undefined` w filtrze, które oddałoby wpisy WSZYSTKICH
//      relacji tenanta w jednej liście.
//   3. BLOK Z INNEGO POSTU JEST CZYSZCZONY Z ADRESU. Deep-link z edytora może
//      nieść blok, którego wybrany post nie ma; zostawiony w adresie dałby
//      pustą relację bez wyjaśnienia.
//   4. ZAPIS NIESIE `tenant_id` I OBA IDENTYFIKATORY. Wpis bez nich nie
//      wyświetli się w żadnej relacji, a mimo to zajmie miejsce w tabeli.
//   5. USUNIĘCIE PYTA. Wpis relacji na żywo jest publikacją - poszedł już do
//      czytelników i do kanału RSS relacji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a prawo zapisu do
//   `live_blog_entries` egzekwuje RLS; warstw pilnuje
//   `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
// - SANITYZACJI: `sanitizeHtml` ma własne testy; tutaj jest granicą.
// - KANAŁU RSS RELACJI: `live_.rss[.]xml.ts` ma kontrakt degradacji
//   w `feedRoutesDegradation.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_POST_ID = "33333333-3333-4333-8333-333333333333";
const BLOCK_ID = "b_relacja";
const OTHER_BLOCK_ID = "b_druga";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = sesja bez obszaru roboczego (hook `useRequiredTenant` rzuca). */
  tenantId: null as string | null,
  /** Wynik RPC `get_post_for_edit` - dokument bloków wybranego postu. */
  postForEdit: null as unknown,
  rpcCalls: [] as { name: string; args?: Record<string, unknown> }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-misc-routes", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    saved: () => "adminToasts.saved",
    added: () => "adminToasts.added",
    deleted: () => "adminToasts.deleted",
    error: () => "adminToasts.error",
    emptyContent: () => "adminToasts.emptyContent",
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => {
    if (!h.tenantId) throw new Error("Brak kontekstu tenanta - operacja wymaga zalogowania.");
    return h.tenantId;
  },
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: db.from,
      rpc: async (name: string, args?: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args });
        return { data: h.postForEdit, error: null };
      },
    },
  };
});
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});
vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});
// Radixowy AlertDialog montuje treść w portalu ze strażnikiem fokusu; atrapa
// zachowuje jedyną rzecz, na której stoją asercje: treść JEST w drzewie
// wyłącznie gdy `open`, a `AlertDialogAction` wywołuje `onClick`.
vi.mock("@/components/ui/alert-dialog", async () => {
  const react = await import("react");
  const Box = ({ children }: { children?: ReactNode }) =>
    react.createElement("div", null, children as never);
  return {
    AlertDialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? react.createElement("div", { role: "alertdialog" }, children as never) : null,
    AlertDialogContent: Box,
    AlertDialogHeader: Box,
    AlertDialogFooter: Box,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) =>
      react.createElement("h2", null, children as never),
    AlertDialogDescription: Box,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) =>
      react.createElement("button", { type: "button" }, children as never),
    AlertDialogAction: ({ onClick, children }: { onClick?: () => void; children?: ReactNode }) =>
      react.createElement("button", { type: "button", onClick }, children as never),
  };
});

import { ok, fail } from "@/test/supabaseChain";
import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { Route as LiveBlogRoute } from "@/routes/admin.live-blog";

const PATH = "/admin/live-blog";
const ADMIN_ENTRIES_KEY = ["liveBlogEntries"];

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Wiersz postu. Tytuły WYMYŚLONE (RODO w fixtures). */
function post(patch: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    slug: "relacja-ze-szczytu",
    title_pl: "Relacja ze szczytu",
    title_en: "Summit live",
    ...patch,
  };
}

/** Wpis osi relacji. */
function entry(patch: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    post_id: POST_ID,
    block_id: BLOCK_ID,
    lang: "pl",
    title: "Otwarcie obrad",
    body_html: "<p>Przewodniczący otworzył sesję.</p>",
    pinned: false,
    occurred_at: "2026-03-01T09:00:00Z",
    ...patch,
  };
}

/** Dokument bloków postu z JEDNYM blokiem relacji (kształt z RPC). */
function blocksWithOne(id = BLOCK_ID) {
  return [
    { blocks_data: { pl: { blocks: [{ type: "liveblog", id, data: { title: "Relacja" } }] } } },
  ];
}

async function mount(search = "") {
  return renderRoute({ route: LiveBlogRoute, path: PATH, initialEntry: `${PATH}${search}` });
}

function chainWith(table: string, method: string): RecordedChain {
  const found = db()
    .chainsFor(table)
    .find((c) => c.has(method));
  if (!found) throw new Error(`test: brak łańcucha "${table}" z ogniwem "${method}"`);
  return found;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

/**
 * Domknięcie efektu, który NAWIGUJE. Auto-wybór bloku i czyszczenie bloku
 * spoza postu idą przez `navigate({ search })`, a przejście routera rozwiązuje
 * się poza kolejką, którą obserwują `findBy*` - bez jawnego domknięcia asercje
 * ścigałyby się z nawigacją i test byłby migotliwy, a nie fałszywy.
 */
async function settleNavigation(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Panel otwarty na konkretnej relacji, z domkniętą nawigacją efektu. */
async function openRelation(search = `?postId=${POST_ID}&blockId=${BLOCK_ID}`) {
  const view = await mount(search);
  await waitFor(() => expect(h.rpcCalls.length).toBeGreaterThan(0));
  await settleNavigation();
  return view;
}

/** Pole treści wpisu. `<Label>` w tej trasie NIE MA `htmlFor`, więc etykietą
 *  pola znaleźć się nie da - rozpoznajemy je po `placeholder`. */
const bodyField = () => screen.getByPlaceholderText("<p>...</p>");

/** Lista wyboru rozpoznana po zestawie opcji - twardy błąd zamiast `null`. */
function selectWithOption(value: string): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => el.querySelector(`option[value="${value}"]`));
  if (!found) throw new Error(`test: brak listy z opcją "${value}"`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tenantId = TENANT;
  h.postForEdit = blocksWithOne();
  h.rpcCalls = [];
  db().reset();
  db().setResponse("posts", () => ok([post()]));
  db().setResponse("live_blog_entries", (chain) => (chain.has("select") ? ok([entry()]) : ok([])));
});

afterEach(() => cleanup());

describe("admin.live-blog - kontrakt adresu (validateSearch)", () => {
  it("adres bez parametrów daje język polski, a nie `undefined`", async () => {
    // Język jest częścią FILTRA odczytu wpisów. `undefined` w tym miejscu
    // dałoby zapytanie `lang=eq.undefined`, czyli pustą relację przy pierwszym
    // wejściu do panelu z nawigacji.
    const validate = routeSearchValidator(LiveBlogRoute);

    expect(validate({})).toEqual({ postId: undefined, blockId: undefined, lang: "pl" });
  });

  it("język spoza dwóch obsługiwanych spada na polski", async () => {
    // Kolumna `lang` w `live_blog_entries` zna dwie wartości. Adres
    // `?lang=de` (podrzucony, skopiowany z innego serwisu) nie może wysłać
    // zapytania o trzecią.
    const validate = routeSearchValidator(LiveBlogRoute);

    expect(validate({ lang: "de" }).lang).toBe("pl");
    expect(validate({ lang: "en" }).lang).toBe("en");
  });

  it("identyfikatory spoza typu tekstowego są ODRZUCANE, nie rzutowane", async () => {
    // `?postId[]=1` daje w search tablicę. Rzutowanie jej na tekst dałoby
    // filtr `post_id=eq.1,2`, czyli zapytanie o czyjeś wpisy.
    const validate = routeSearchValidator(LiveBlogRoute);

    expect(validate({ postId: 7, blockId: ["a", "b"] })).toEqual({
      postId: undefined,
      blockId: undefined,
      lang: "pl",
    });
  });

  it("zamontowana trasa czyta post i blok Z ADRESU", async () => {
    // To jest cała treść deep-linku z edytora bloku: panel MUSI otworzyć się
    // na wskazanej relacji, a nie na pierwszej z listy.
    const view = await mount(`?postId=${POST_ID}&blockId=${BLOCK_ID}&lang=en`);

    expect(view.search()).toMatchObject({ postId: POST_ID, blockId: BLOCK_ID, lang: "en" });
  });

  it("nagłówek dokumentu ma tytuł i nie jest pusty", async () => {
    const head = routeHead(LiveBlogRoute, {});

    expect(head.meta).toContainEqual({ title: "Live Blog - Admin" });
  });
});

describe("admin.live-blog - kontekst obszaru roboczego", () => {
  it("BEZ tenanta panel nie renderuje się i NIE pyta bazy", async () => {
    // Lista postów filtruje po `tenant_id` WPROST (`eq("tenant_id", tenantId)`),
    // więc zapytanie bez tenanta poszłoby z `undefined` w filtrze.
    h.tenantId = null;
    await mount();

    expect(screen.queryByText("adminMiscRoutes.liveBlog.title")).toBeNull();
    expect(db().chains).toEqual([]);
  });

  it("lista postów filtruje po obszarze roboczym i pomija skasowane", async () => {
    // Post w koszu (`deleted_at`) nie może wrócić na listę wyboru - relacja
    // dopisana do skasowanego postu jest treścią bez adresu.
    await mount();
    await waitFor(() => expect(db().chainsFor("posts").length).toBe(1));

    const chain = chainWith("posts", "select");
    expect(chain.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain.argsOf("limit")).toEqual([200]);
  });
});

describe("admin.live-blog - wybór postu i bloku", () => {
  it("bez wybranego postu NIE pyta o wpisy ani o bloki", async () => {
    // REGUŁA 2. Zapytanie z `undefined` w filtrze `post_id` oddałoby wpisy
    // wszystkich relacji obszaru roboczego w jednej liście - i pozwoliłoby je
    // z tej listy usuwać.
    await mount();
    await waitFor(() => expect(db().chainsFor("posts").length).toBe(1));

    expect(db().chainsFor("live_blog_entries")).toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("bloki wybranego postu idą RPC po SLUGU, nie odczytem `blocks_data`", async () => {
    // `blocks_data` nie jest czytelne bezpośrednim selectem dla roli
    // `authenticated` - jedyną drogą jest funkcja SECURITY DEFINER, i to ona
    // jest miejscem, w którym ten dostęp da się audytować.
    await mount(`?postId=${POST_ID}`);

    await waitFor(() => expect(h.rpcCalls.map((c) => c.name)).toContain("get_post_for_edit"));
    expect(h.rpcCalls[0].args).toEqual({ _slug: "relacja-ze-szczytu" });
  });

  it("post z DOKŁADNIE JEDNYM blokiem relacji wybiera go automatycznie", async () => {
    // Deep-link z edytora bloku niesie tylko `blockId`; wejście z listy
    // postów nie niesie go wcale. Bez auto-wyboru redaktor postu z jedną
    // relacją musiałby wybrać ją z listy jednoelementowej.
    const view = await mount(`?postId=${POST_ID}`);

    await waitFor(() => expect(view.search().blockId).toBe(BLOCK_ID));
  });

  it("blok SPOZA wybranego postu jest czyszczony z adresu", async () => {
    // REGUŁA 3. Adres z blokiem innego postu (skopiowany link, zmiana postu
    // w liście) dałby pustą relację i przycisk publikacji celujący w blok,
    // którego ten post nie ma.
    h.postForEdit = blocksWithOne(OTHER_BLOCK_ID);
    const view = await mount(`?postId=${POST_ID}&blockId=${BLOCK_ID}`);

    await waitFor(() => expect(view.search().blockId).toBe(OTHER_BLOCK_ID));
  });

  it("post BEZ bloku relacji mówi o tym redakcji zamiast milczeć", async () => {
    // Redaktor wybiera post z listy wszystkich postów - większość nie ma
    // bloku relacji. Panel bez ostrzeżenia wygląda wtedy na zepsuty.
    h.postForEdit = [{ blocks_data: { pl: { blocks: [{ type: "paragraph", id: "b_akapit" }] } } }];
    await mount(`?postId=${POST_ID}`);

    expect(
      await screen.findByText(/adminMiscRoutes\.liveBlog\.noBlockWarning/),
    ).toBeInTheDocument();
  });

  it("zmiana języka w adresie przestawia FILTR odczytu wpisów", async () => {
    // Wpisy PL i EN to osobne wiersze tej samej relacji. Filtr, który nie
    // idzie za wyborem języka, pokazywałby redakcji polską wersję przy
    // edycji angielskiej.
    await openRelation(`?postId=${POST_ID}&blockId=${BLOCK_ID}&lang=en`);

    await waitFor(() => expect(db().chainsFor("live_blog_entries").length).toBeGreaterThan(0));
    const eqPairs = chainWith("live_blog_entries", "select")
      .calls.filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqPairs).toEqual([
      ["post_id", POST_ID],
      ["block_id", BLOCK_ID],
      ["lang", "en"],
    ]);
  });
});

describe("admin.live-blog - lista wpisów", () => {
  it("wpisy są porządkowane od najnowszego - relacja czyta się z góry", async () => {
    await openRelation();
    // Odczyt może pobiec DWA razy: efekt czyści blok spoza listy, a potem
    // wybiera jedyny dostępny - drugie przejście jest częścią zachowania,
    // więc asercja idzie na łańcuch, nie na ich liczbę.
    await waitFor(() => expect(db().chainsFor("live_blog_entries").length).toBeGreaterThan(0));

    expect(chainWith("live_blog_entries", "select").argsOf("order")).toEqual([
      "occurred_at",
      { ascending: false },
    ]);
  });

  it("pusta relacja mówi o pustce, a nie zostawia gołej sekcji", async () => {
    db().setResponse("live_blog_entries", () => ok([]));
    await openRelation();

    expect(await screen.findByText("adminMiscRoutes.liveBlog.empty")).toBeInTheDocument();
  });

  it("awaria odczytu wpisów nie wywala panelu - formularz publikacji zostaje", async () => {
    // Panel bez tej odporności zamienia odmowę w biały ekran i odcina
    // redakcję od publikowania KOLEJNYCH wpisów w trakcie wydarzenia.
    db().setResponse("live_blog_entries", () =>
      fail("test: odmowa odczytu live_blog_entries", "42501"),
    );
    await openRelation();

    expect(await screen.findByText("adminMiscRoutes.liveBlog.newEntry")).toBeInTheDocument();
    expect(button("adminMiscRoutes.liveBlog.publish")).toBeInTheDocument();
  });

  it("wpis przypięty jest OZNACZONY - inaczej redakcja nie wie, co widzi czytelnik", async () => {
    db().setResponse("live_blog_entries", (chain) =>
      chain.has("select") ? ok([entry({ pinned: true })]) : ok([]),
    );
    await openRelation();

    expect(await screen.findByText("adminMiscRoutes.liveBlog.pinnedBadge")).toBeInTheDocument();
  });
});

describe("admin.live-blog - publikacja wpisu", () => {
  it("pusta treść NIE jedzie do bazy - relacja nie może mieć pustego wpisu", async () => {
    await openRelation();
    fireEvent.click(button("adminMiscRoutes.liveBlog.publish"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.emptyContent"));
    expect(
      db()
        .chainsFor("live_blog_entries")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("ładunek wpisu niesie `tenant_id`, oba identyfikatory, język i znacznik czasu", async () => {
    // REGUŁA 4. Brak któregokolwiek z tych pól daje wiersz, którego nie
    // wyświetli żadna relacja - a mimo to poszedł do bazy jako publikacja.
    await openRelation();
    fireEvent.change(bodyField(), { target: { value: "<p>Głosowanie zakończone.</p>" } });
    fireEvent.click(button("adminMiscRoutes.liveBlog.publish"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("live_blog_entries")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = chainWith("live_blog_entries", "insert").argsOf("insert")?.[0];
    expect(payload).toMatchObject({
      tenant_id: TENANT,
      post_id: POST_ID,
      block_id: BLOCK_ID,
      lang: "pl",
      title: null,
      body_html: "<p>Głosowanie zakończone.</p>",
      pinned: false,
    });
    expect(typeof (payload as { occurred_at: unknown }).occurred_at).toBe("string");
  });

  it("udana publikacja czyści formularz i unieważnia klucz PANELU", async () => {
    // ROZDZIAŁ KLUCZY, o którym mówi nagłówek pliku: panel unieważnia SWÓJ
    // klucz (`["liveBlogEntries", ...]`). Klucz czytelnika
    // (`["public", "blocks", "liveblog", ...]`) świadomie NIE jest tu ruszany -
    // do czytelnika zmiana dochodzi kanałem realtime z `LiveBlogBlock`, więc
    // unieważnienie stąd byłoby drugą, wolniejszą drogą do tego samego.
    const view = await openRelation();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const body = bodyField();
    fireEvent.change(body, { target: { value: "<p>Wynik głosowania.</p>" } });
    fireEvent.click(button("adminMiscRoutes.liveBlog.publish"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.added"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ADMIN_ENTRIES_KEY });
    const publicCalls = spy.mock.calls.filter((call) => {
      const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) && key[0] === "public";
    });
    expect(publicCalls).toEqual([]);
    expect(body).toHaveValue("");
  });

  it("błąd zapisu pokazuje komunikat i NIE czyści wersji roboczej", async () => {
    // Wpis pisany w trakcie wydarzenia nie może przepaść po odmowie zapisu -
    // redakcja nie odtworzy go z pamięci przy następnym punkcie programu.
    db().setResponse("live_blog_entries", (chain) =>
      chain.has("select") ? ok([entry()]) : fail("test: odmowa polityki RLS", "42501"),
    );
    await openRelation();
    const body = bodyField();
    fireEvent.change(body, { target: { value: "<p>Treść w toku.</p>" } });
    fireEvent.click(button("adminMiscRoutes.liveBlog.publish"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(body).toHaveValue("<p>Treść w toku.</p>");
  });
});

describe("admin.live-blog - edycja, przypięcie i usunięcie wpisu", () => {
  it("edycja aktualizuje DOKŁADNIE ten wpis i tylko pola treści", async () => {
    // Ładunek z całym wierszem nadpisałby `occurred_at`, czyli przestawiłby
    // wpis w osi czasu relacji przy poprawce literówki.
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.edit"));
    const editors = screen.getAllByRole("textbox");
    fireEvent.change(editors[editors.length - 1], {
      target: { value: "<p>Otwarcie obrad - sprostowanie.</p>" },
    });
    fireEvent.click(button("common.save"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("live_blog_entries")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = chainWith("live_blog_entries", "update");
    expect(update.argsOf("update")?.[0]).toEqual({
      title: "Otwarcie obrad",
      body_html: "<p>Otwarcie obrad - sprostowanie.</p>",
    });
    expect(update.argsOf("eq")).toEqual(["id", ENTRY_ID]);
  });

  it("edycja z pustą treścią jest odrzucana przed zapytaniem", async () => {
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.edit"));
    const editors = screen.getAllByRole("textbox");
    fireEvent.change(editors[editors.length - 1], { target: { value: "   " } });
    fireEvent.click(button("common.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.emptyContent"));
    expect(
      db()
        .chainsFor("live_blog_entries")
        .some((c) => c.has("update")),
    ).toBe(false);
  });

  it("przypięcie ODWRACA stan wpisu, a nie ustawia go na stałe", async () => {
    // Przycisk jest przełącznikiem. Ustawienie `pinned: true` bez odwrócenia
    // zamieniłoby go w akcję jednokierunkową i relacja zostałaby z wpisem
    // przyklejonym na szczycie na zawsze.
    db().setResponse("live_blog_entries", (chain) =>
      chain.has("select") ? ok([entry({ pinned: true })]) : ok([]),
    );
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.unpin"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("live_blog_entries")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(chainWith("live_blog_entries", "update").argsOf("update")?.[0]).toEqual({
      pinned: false,
    });
  });

  it("usunięcie WYMAGA potwierdzenia - klik w kosz tylko otwiera pytanie", async () => {
    // REGUŁA 5. Wpis relacji jest publikacją: poszedł do czytelników i do
    // kanału RSS relacji. Usunięcie bez pytania to nieodwracalna kasacja
    // opublikowanej treści jednym kliknięciem.
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.remove"));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("adminMiscRoutes.liveBlog.confirmTitle")).toBeInTheDocument();
    expect(
      db()
        .chainsFor("live_blog_entries")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });

  it("potwierdzenie usuwa DOKŁADNIE ten wpis i zamyka pytanie", async () => {
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.remove"));
    await screen.findByRole("alertdialog");
    fireEvent.click(button("adminMiscRoutes.liveBlog.confirmAction"));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("live_blog_entries")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(chainWith("live_blog_entries", "delete").argsOf("eq")).toEqual(["id", ENTRY_ID]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("ANULOWANIE pytania nie usuwa wpisu", async () => {
    await openRelation();
    await screen.findByText("Otwarcie obrad");
    fireEvent.click(button("adminMiscRoutes.liveBlog.remove"));
    await screen.findByRole("alertdialog");
    fireEvent.click(button("common.cancel"));

    expect(
      db()
        .chainsFor("live_blog_entries")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });
});

describe("admin.live-blog - relacja innego postu", () => {
  it("wybór innego postu z listy przestawia adres, a nie tylko widok", async () => {
    // Adres jest stanem tej trasy (REGUŁA 1): wybór postu, który nie ląduje
    // w adresie, nie da się udostępnić ani odświeżyć - a panel relacji na
    // żywo jest przekazywany między dyżurnymi redaktorami.
    db().setResponse("posts", () =>
      ok([post(), post({ id: OTHER_POST_ID, slug: "druga-relacja", title_pl: "Druga relacja" })]),
    );
    const view = await mount();
    await waitFor(() =>
      expect(document.querySelector(`option[value="${OTHER_POST_ID}"]`)).not.toBeNull(),
    );
    fireEvent.change(selectWithOption(OTHER_POST_ID), { target: { value: OTHER_POST_ID } });
    await settleNavigation();

    await waitFor(() => expect(view.search().postId).toBe(OTHER_POST_ID));
  });
});
