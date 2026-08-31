// @vitest-environment jsdom
// PANEL WGRYWANIA EKSPORTU WXR (`src/components/admin/WxrUploadPanel.tsx`, 0%).
//
// TO JEST JEDYNA W CAŁEJ APLIKACJI DROGA WEJŚCIA DLA PLIKU XML z WordPressa
// (Tools -> Export -> Pages). Panel siedzi w zakładce dialogu importu na
// /admin/pages, sam parsuje plik w przeglądarce i sam składa ładunek dla
// `wpImportFromWxr`.
//
// CZEGO TU NIE ATRAPUJEMY - i to jest sedno tego pliku. `@/lib/wp-import.functions`
// oraz `@/lib/wp-import/wxr` działają PRAWDZIWE: podmieniony jest tylko
// framework (`@tanstack/react-start`, żeby dało się wywołać server fn bez
// kontekstu żądania), klient Supabase, i18n, toasty, ściąganie mediów
// (prawdziwe HTTP) oraz komponenty Radiksa (bez layoutu w jsdom nie da się ich
// obsłużyć klawiaturą). Dzięki temu test przechodzi CAŁĄ drogę: plik -> parser
// WXR -> ładunek -> walidator zod -> handler serwerowy -> zapis do `pages`.
//
// CO MA TU DOWÓD:
//   1. parsowanie pliku i komunikaty: sukces z liczbą stron, ostrzeżenia
//      parsera, pusty eksport, nieprawidłowy XML,
//   2. HEURYSTYKA JĘZYKA tego panelu: najpierw meta z WXR (Polylang/WPML),
//      potem wzorzec `(^|[-/_])en([-/_]|$)` na slug + tytuł,
//   3. ROZJAZD Z DRUGIM PANELEM: `WordPressImportDialog` używa INNEJ heurystyki
//      (`/-en$|^en-|\\/en\\/|\\ben\\b/`), więc ta sama witryna importowana
//      konektorem i z pliku WXR paruje języki RÓŻNIE - zarejestrowane jako
//      `it.fails` z konkretnymi przykładami rozjazdu,
//   4. fallback Elementora: strona z pustym `content:encoded` i obecnym
//      `_elementor_data` dostaje treść zsyntetyzowaną z JSON-a,
//   5. strona /main jest niewybieralna i nie wchodzi do „Wszystkie",
//   6. ładunek importu: slug, tytuł, treść, zapowiedź, okładka z attachmenta,
//      a przy sparowaniu PL/EN - pola EN w tym samym itemie,
//   7. raport po imporcie: liczby zaimportowanych/nadpisanych/pominiętych/
//      błędów oraz OSOBNE ostrzeżenie o parach bez treści EN,
//   8. domknięcie: unieważnienie cache'u list i wywołanie onImported/onClose
//      TYLKO gdy coś naprawdę weszło.
//
// GAŁĘZIE NIEOSIĄGALNE Z INTERFEJSU (zostają w kodzie, testu nie mają):
// `if (!row) continue` w podsumowaniu, `if (selected.size === 0) return` w
// `runImport` (przycisk jest wtedy ZABLOKOWANY - dowodzi tego osobny test),
// `if (!row || !page) continue` i `if (!pl) continue` - wszystkie strzegą
// niespójności między `selected` i `pages`, której panel nie potrafi wytworzyć.
//
// RODO: brak realnych danych osobowych; wszystkie URL-e i adresy e-mail w
// domenach example.com / example.org.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

type Validator = (input: unknown) => unknown;
type Handler = (ctx: { data: unknown; context: unknown }) => Promise<unknown>;
interface ServerFnSpec {
  validator?: Validator;
  handler?: Handler;
}

const h = vi.hoisted(() => ({
  language: "pl",
  toastSuccess: [] as string[],
  toastError: [] as string[],
  toastInfo: [] as string[],
  toastWarning: [] as string[],
  /** Kontekst, który w produkcji wstawia `requireStaff`. */
  context: null as unknown,
  /** Gdy ustawione, wywołanie server fn rzuca (symulacja odmowy serwera). */
  serverThrow: null as string | null,
  /** Rzut CZYMŚ INNYM niż Error - `useServerFn` przy odpowiedzi nie-JSON. */
  serverThrowRaw: null as string | null,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.language);
});

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess.push(m),
    error: (m: string) => h.toastError.push(m),
    info: (m: string) => h.toastInfo.push(m),
    warning: (m: string) => h.toastWarning.push(m),
  },
}));

// Framework: łańcuch oddaje walidator i handler, a `useServerFn` wywołuje je
// dokładnie tak, jak zrobiłby to serwer - z kontekstem po `requireStaff`.
vi.mock("@tanstack/react-start", () => {
  interface Chain {
    middleware: (m: unknown) => Chain;
    validator: (v: Validator) => Chain;
    inputValidator: (v: Validator) => Chain;
    handler: (fn: Handler) => ServerFnSpec;
  }
  const createServerFn = (): Chain => {
    const spec: ServerFnSpec = {};
    const chain: Chain = {
      middleware: () => chain,
      validator: (v) => {
        spec.validator = v;
        return chain;
      },
      inputValidator: (v) => {
        spec.validator = v;
        return chain;
      },
      handler: (fn) => {
        spec.handler = fn;
        return spec;
      },
    };
    return chain;
  };
  const useServerFn =
    (spec: ServerFnSpec) =>
    async (args: { data: unknown }): Promise<unknown> => {
      if (h.serverThrowRaw) throw h.serverThrowRaw;
      if (h.serverThrow) throw new Error(h.serverThrow);
      const data = spec.validator ? spec.validator(args.data) : args.data;
      if (!spec.handler) throw new Error("test: brak handlera server fn");
      return spec.handler({ data, context: h.context });
    };
  return { createServerFn, createMiddleware: () => ({}), useServerFn };
});

vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));

// GRANICA: prawdziwe pobieranie plików po HTTP + zapis do storage.
vi.mock("@/lib/server/wp-media.server", () => ({
  mirrorWpMedia: async () => ({
    map: new Map(),
    warnings: [],
    mirroredCount: 0,
    reusedCount: 0,
    failed: [],
  }),
  rewriteHtml: (html: string) => html,
  rewriteBuilderDoc: <T,>(doc: T) => doc,
}));

// Radix bez layoutu w jsdom nie da się obsłużyć - natywne odpowiedniki.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      data-value={value}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    id?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { WxrUploadPanel } from "@/components/admin/WxrUploadPanel";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NEW_PAGE_ID = "33333333-3333-4333-8333-333333333333";

/* ============================== fixture WXR =============================== */

interface FixtureItem {
  id: number;
  slug: string;
  title: string;
  type?: string;
  status?: string;
  content?: string;
  excerpt?: string;
  meta?: Array<[string, string]>;
  attachmentUrl?: string;
}

function xmlItem(i: FixtureItem): string {
  const meta = (i.meta ?? [])
    .map(
      ([k, v]) =>
        `<wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>`,
    )
    .join("");
  return `<item>
    <title>${i.title}</title>
    <link>https://example.com/${i.slug}</link>
    <wp:post_id>${i.id}</wp:post_id>
    <wp:post_type>${i.type ?? "page"}</wp:post_type>
    <wp:post_name>${i.slug}</wp:post_name>
    <wp:status>${i.status ?? "publish"}</wp:status>
    <content:encoded><![CDATA[${i.content ?? "<p>Treść strony.</p>"}]]></content:encoded>
    <excerpt:encoded><![CDATA[${i.excerpt ?? "Zapowiedź"}]]></excerpt:encoded>
    <wp:post_date_gmt>2026-01-01 09:00:00</wp:post_date_gmt>
    <wp:post_parent>0</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    ${i.attachmentUrl ? `<wp:attachment_url>${i.attachmentUrl}</wp:attachment_url>` : ""}
    ${meta}
  </item>`;
}

function xml(items: FixtureItem[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Witryna</title>
    <link>https://example.com</link>
    ${items.map(xmlItem).join("\n")}
  </channel>
</rss>`;
}

/* ============================== atrapa bazy =============================== */

interface Plan {
  insertError: string | null;
  slugTaken: (slug: string) => boolean;
  /** Wiersz istniejącej strony zwracany przy nadpisywaniu. */
  current: { id: string; slug: string; title_pl: string; title_en: string } | null;
}

function installSupabase(plan: Partial<Plan> = {}) {
  const p: Plan = { insertError: null, slugTaken: () => false, current: null, ...plan };
  const stub = supabaseFromStub();
  stub.setResponse("profiles", () => ok({ tenant_id: TENANT }));
  stub.setResponse("content_revisions", () => ok(null));
  stub.setResponse("pages", (chain: RecordedChain) => {
    if (chain.has("insert")) return p.insertError ? fail(p.insertError) : ok({ id: NEW_PAGE_ID });
    if (chain.has("update")) return ok(null);
    if (chain.has("maybeSingle")) return ok(p.current);
    const slug = chain.calls.find((c) => c.method === "eq" && c.args[0] === "slug")?.args[1];
    return ok(p.slugTaken(String(slug)) ? [{ id: "zajete" }] : []);
  });
  h.context = { supabase: { from: stub.from }, userId: USER };
  return stub;
}

/* ================================ pomocnicy =============================== */

function renderPanel(
  existing: Array<{
    id: string;
    title_pl: string;
    title_en: string;
    slug: string;
    status: string;
  }> = [],
) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  const view = renderWithQueryClient(
    <WxrUploadPanel existingPages={existing} onImported={onImported} onClose={onClose} />,
  );
  return { ...view, onImported, onClose };
}

async function upload(content: string, name = "export.xml"): Promise<void> {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
  const file = new File([content], name, { type: "text/xml" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(h.toastSuccess.length + h.toastError.length + h.toastInfo.length).toBeGreaterThan(0);
  });
  // Domknięcie efektu, który dopisuje wykryty język do wiersza - bez tego test
  // czyta stan sprzed pierwszego przeliczenia i widziałby wszędzie „pl".
  await act(async () => {
    await Promise.resolve();
  });
}

/** Wiersz tabeli dla danej strony - po widocznym slugu. */
function rowFor(slug: string): HTMLElement {
  const cell = screen.getAllByText(new RegExp(`^/${slug}( ·|$)`));
  const row = cell[0].closest("tr");
  if (!row) throw new Error(`test: brak wiersza dla /${slug}`);
  return row;
}

function langOf(slug: string): string {
  const selects = within(rowFor(slug)).getAllByTestId("select");
  return selects[0].getAttribute("data-value") ?? "";
}

beforeEach(() => {
  cleanup();
  h.language = "pl";
  h.toastSuccess = [];
  h.toastError = [];
  h.toastInfo = [];
  h.toastWarning = [];
  h.serverThrow = null;
  h.serverThrowRaw = null;
  installSupabase();
});

/* ================================== testy ================================= */

describe("WxrUploadPanel - parsowanie pliku", () => {
  it("po wgraniu pliku pokazuje strony, ich status i informację o Elementorze", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        {
          id: 2,
          slug: "kontakt",
          title: "Kontakt",
          status: "draft",
          content: "",
          meta: [["_elementor_data", '[{"widgetType":"heading","settings":{"title":"Napisz"}}]']],
        },
      ]),
    );
    expect(h.toastSuccess).toEqual(["Znaleziono 2 stron."]);
    expect(screen.getByText("O nas")).toBeInTheDocument();
    expect(rowFor("kontakt").textContent).toContain("draft");
    expect(rowFor("kontakt").textContent).toContain("Elementor");
    expect(screen.getByText("Wybrane: 0 / 2")).toBeInTheDocument();
  });

  it("nazwa i rozmiar wgranego pliku są widoczne", async () => {
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]), "moja-witryna.xml");
    expect(screen.getByText(/moja-witryna\.xml · /)).toBeInTheDocument();
  });

  it("ostrzeżenia parsera trafiają do osobnego toastu", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "pusta", title: "Pusta", content: "" },
      ]),
    );
    expect(h.toastWarning[0]).toContain("1 ostrzeżeń przy parsowaniu");
    expect(h.toastWarning[0]).toContain("Strona #2 (pusta) nie ma treści");
  });

  it("eksport bez stron kończy się komunikatem informacyjnym", async () => {
    renderPanel();
    await upload(xml([{ id: 1, slug: "wpis", title: "Wpis", type: "post" }]));
    expect(h.toastInfo).toEqual(["Brak stron w eksporcie."]);
    expect(screen.queryByText(/Wybrane:/)).not.toBeInTheDocument();
  });

  it("nieprawidłowy XML pokazuje komunikat parsera, a nie wysypuje panelu", async () => {
    renderPanel();
    await upload("<rss><channel><item></channel></rss>");
    expect(h.toastError[0]).toContain("Nieprawidłowy XML");
    expect(screen.queryByText(/Wybrane:/)).not.toBeInTheDocument();
  });

  it("plik, który nie jest eksportem WordPressa, jest odrzucany", async () => {
    renderPanel();
    await upload('<?xml version="1.0"?><root><cos/></root>');
    expect(h.toastError[0]).toContain("nie zawiera <channel>");
  });

  it("komunikaty są po angielsku, gdy interfejs jest w EN", async () => {
    h.language = "en";
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    expect(h.toastSuccess).toEqual(["Found 1 pages."]);
    expect(screen.getByText("Selected: 0 / 1")).toBeInTheDocument();
  });
});

describe("WxrUploadPanel - heurystyka języka", () => {
  it("meta języka z WXR (Polylang / WPML) wygrywa z wyglądem sluga", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "about-en", title: "About", meta: [["_polylang_language", "pl"]] },
        { id: 2, slug: "o-nas", title: "O nas", meta: [["wpml_language", "en"]] },
      ]),
    );
    expect(langOf("about-en")).toBe("pl");
    expect(langOf("o-nas")).toBe("en");
  });

  it("bez meta wzorzec wymaga separatora WOKÓŁ 'en' i patrzy na slug RAZEM z tytułem", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "en-about", title: "About us" },
        { id: 2, slug: "team/en/board", title: "Board" },
        { id: 3, slug: "kontakt_en_strona", title: "Kontakt" },
        { id: 4, slug: "raport", title: "Raport-en" },
        { id: 5, slug: "o-nas", title: "O nas" },
        { id: 6, slug: "enterprise", title: "Enterprise" },
      ]),
    );
    expect(langOf("en-about")).toBe("en");
    expect(langOf("team/en/board")).toBe("en");
    expect(langOf("kontakt_en_strona")).toBe("en");
    // Zakończenie wzorca (`$`) da się trafić WYŁĄCZNIE tytułem - sprawdzany
    // łańcuch to `slug + " " + tytuł`, więc slug nigdy nie stoi na końcu.
    expect(langOf("raport")).toBe("en");
    expect(langOf("o-nas")).toBe("pl");
    // „enterprise" to nie wersja angielska - brak separatora po „en".
    expect(langOf("enterprise")).toBe("pl");
  });

  it("PUŁAPKA: slug z popularnym sufiksem -en jest brany za POLSKI, gdy tytuł nie jest pusty", async () => {
    // Najczęstsza konwencja wielojęzycznych witryn WordPressa („strona-en")
    // przepada, bo po „en" stoi SPACJA przed tytułem, a wzorzec dopuszcza po
    // „en" tylko [-/_] albo koniec łańcucha. Ten sam plik zaimportowany
    // konektorem WP.com dostaje EN - rozjazd jest zarejestrowany jako
    // `it.fails` w `wordPressImportDialog.test.tsx`.
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "about-en", title: "About us" },
        { id: 2, slug: "contact-en", title: "" },
      ]),
    );
    expect(langOf("about-en")).toBe("pl");
    // Nawet PUSTY tytuł nie pomaga - w łańcuchu zostaje końcowa spacja.
    expect(langOf("contact-en")).toBe("pl");
  });

  it("ręczna zmiana języka nadpisuje heurystykę", async () => {
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    const select = within(rowFor("o-nas")).getAllByTestId("select")[0];
    fireEvent.change(select, { target: { value: "en" } });
    expect(langOf("o-nas")).toBe("en");
  });
});

describe("WxrUploadPanel - wybór stron", () => {
  it("strona /main jest niewybieralna i nie wchodzi do 'Wszystkie'", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "main", title: "Strona główna" },
        { id: 2, slug: "o-nas", title: "O nas" },
      ]),
    );
    expect(screen.getByText("Wybrane: 0 / 1")).toBeInTheDocument();
    const mainCheckbox = within(rowFor("main")).getByRole("checkbox");
    expect(mainCheckbox).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    expect(screen.getByText("Wybrane: 1 / 1")).toBeInTheDocument();
    expect(mainCheckbox).not.toBeChecked();
  });

  it("'Żadne' czyści wybór, a licznik nowych stron nadąża", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "kontakt", title: "Kontakt" },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    expect(screen.getByText("Nowe: 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Żadne" }));
    expect(screen.getByText("Wybrane: 0 / 2")).toBeInTheDocument();
    expect(screen.getByText("Nowe: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importuj \(0\)/ })).toBeDisabled();
  });

  it("wybór strony do nadpisania przenosi ją z licznika nowych do nadpisań", async () => {
    renderPanel([
      { id: NEW_PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
    ]);
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(within(rowFor("o-nas")).getByRole("checkbox"));
    const selects = within(rowFor("o-nas")).getAllByTestId("select");
    fireEvent.change(selects[2], { target: { value: NEW_PAGE_ID } });
    expect(screen.getByText("Nadpisania: 1")).toBeInTheDocument();
    expect(screen.getByText("Nowe: 0")).toBeInTheDocument();
  });

  it("wybór pary jest ZABLOKOWANY, dopóki wszystkie wiersze mają ten sam język", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "about-en", title: "About us" },
      ]),
    );
    // Heurystyka uznała OBIE strony za polskie - lista partnerów jest pusta.
    expect(within(rowFor("o-nas")).getAllByTestId("select")[1]).toBeDisabled();
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    expect(within(rowFor("o-nas")).getAllByTestId("select")[1]).not.toBeDisabled();
  });

  it("sparowanie PL/EN pokazuje licznik par", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "about-en", title: "About us" },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const pairSelect = within(rowFor("o-nas")).getAllByTestId("select")[1];
    fireEvent.change(pairSelect, { target: { value: "2" } });
    expect(screen.getByText("Pary PL/EN: 1")).toBeInTheDocument();
  });
});

describe("WxrUploadPanel - import przez PRAWDZIWĄ funkcję serwerową", () => {
  it("zapisuje stronę z pliku do bazy: slug, tytuł, treść, zapowiedź i okładka", async () => {
    const stub = installSupabase();
    const { onImported, onClose, queryClient } = renderPanel();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await upload(
      xml([
        {
          id: 9,
          slug: "raport",
          title: "Raport roczny",
          content: "<h2>Wnioski</h2><p>Treść raportu.</p>",
          excerpt: "Skrót raportu",
          meta: [["_thumbnail_id", "10"]],
        },
        {
          id: 10,
          slug: "okladka",
          title: "okladka",
          type: "attachment",
          attachmentUrl: "https://example.com/wp-content/uploads/okladka.jpg",
        },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));

    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(1));
    const insert = stub.chainsFor("pages").find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      slug: "raport",
      title_pl: "Raport roczny",
      editor: "builder",
      status: "draft",
      excerpt_pl: "Skrót raportu",
      cover_image_url: "https://example.com/wp-content/uploads/okladka.jpg",
    });
    expect(JSON.stringify(insert?.argsOf("insert")?.[0])).toContain("Treść raportu");
    expect(h.toastSuccess.at(-1)).toBe("1 zaimportowanych");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-pages"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wp-import-existing-pages"] });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("para PL/EN idzie jako JEDEN wiersz z treścią angielską", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas", content: "<p>Polska treść.</p>" },
        {
          id: 2,
          slug: "about-en",
          title: "About us",
          content: "<p>English body.</p>",
          excerpt: "EN excerpt",
        },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const pairSelect = within(rowFor("o-nas")).getAllByTestId("select")[1];
    fireEvent.change(pairSelect, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));

    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    const inserts = stub.chainsFor("pages").filter((c) => c.has("insert"));
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].argsOf("insert")?.[0];
    expect(payload).toMatchObject({ slug: "o-nas", title_pl: "O nas", title_en: "About us" });
    expect(JSON.stringify(payload)).toContain("English body");
    expect(h.toastSuccess.at(-1)).toContain("z treścią EN");
  });

  it("treść z fallbacku Elementora naprawdę dojeżdża do bazy", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(
      xml([
        {
          id: 3,
          slug: "usluga",
          title: "Usługa",
          content: "",
          meta: [
            [
              "_elementor_data",
              '[{"elType":"section","elements":[{"elType":"widget","widgetType":"heading","settings":{"title":"Co robimy","header_size":"h2"}},{"elType":"widget","widgetType":"text-editor","settings":{"editor":"<p>Opis usługi.</p>"}}]}]',
            ],
          ],
        },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    const payload = JSON.stringify(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    );
    expect(payload).toContain("Co robimy");
    expect(payload).toContain("Opis us");
  });

  it("para EN bez treści daje OSOBNE ostrzeżenie, nie ciche 'zaimportowano'", async () => {
    installSupabase();
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        // Treść EN składa się WYŁĄCZNIE ze shortcode'ów motywu - po ich
        // usunięciu nie zostaje nic, choć w pliku „treść była".
        {
          id: 2,
          slug: "about-en",
          title: "About us",
          content: "[foxiz_container]tresc[/foxiz_container]",
        },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const pairSelect = within(rowFor("o-nas")).getAllByTestId("select")[1];
    fireEvent.change(pairSelect, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(h.toastWarning.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("par PL/EN bez treści EN po konwersji");
  });

  it("zmiana statusu docelowego i wyłączenie mediów dojeżdżają do zapisu", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const statusSelect = screen
      .getAllByTestId("select")
      .find((el) => el.getAttribute("data-value") === "draft");
    if (!statusSelect) throw new Error("test: brak selektora statusu");
    fireEvent.change(statusSelect, { target: { value: "published" } });
    // Pierwszy przełącznik to „Ściągaj media" - wyłączamy go.
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ status: "published" });
  });

  it("błąd zapisu pokazuje wiersz błędu i NIE zamyka dialogu", async () => {
    installSupabase({ insertError: "duplicate key value" });
    const { onImported, onClose } = renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("1 błędów");
    expect(h.toastError.at(-1)).toBe("#1: duplicate key value");
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("odmowa serwera (wyjątek całego wywołania) kończy się komunikatem", async () => {
    installSupabase();
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    h.serverThrow = "Brak uprawnień (staff required)";
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastError.at(-1)).toBe("Brak uprawnień (staff required)");
  });

  it("wyjątek NIE-Error z warstwy serwerowej też trafia do komunikatu", async () => {
    installSupabase();
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    h.serverThrowRaw = "<html>502 Bad Gateway</html>";
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastError.at(-1)).toBe("<html>502 Bad Gateway</html>");
  });

  it("wyczyszczenie pola sluga wraca do sluga z pliku", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const slugInput = within(rowFor("o-nas")).getByPlaceholderText("o-nas");
    fireEvent.change(slugInput, { target: { value: "inny" } });
    fireEvent.change(slugInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "o-nas" });
  });

  it("import bez wybranych stron nie woła serwera", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(0\)/ }));
    expect(stub.chains).toHaveLength(0);
  });

  it("Anuluj zamyka panel bez zapisu", async () => {
    const stub = installSupabase();
    const { onClose } = renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stub.chains).toHaveLength(0);
  });
});

describe("WxrUploadPanel - ustawienia wiersza i przypadki brzegowe", () => {
  it("anulowanie wyboru pliku (brak pliku w zdarzeniu) nic nie robi", async () => {
    renderPanel();
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
    fireEvent.change(input, { target: { files: [] } });
    expect(h.toastSuccess).toEqual([]);
    expect(h.toastError).toEqual([]);
    expect(screen.queryByText(/Wybrane:/)).not.toBeInTheDocument();
  });

  it("puste dane Elementora nie podmieniają pustej treści", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "pusta", title: "Pusta", content: "", meta: [["_elementor_data", "[]"]] },
      ]),
    );
    // Strona ZOSTAJE (ma _elementor_data), ale treści nie ma skąd wziąć.
    expect(rowFor("pusta").textContent).toContain("Elementor");
    expect(h.toastSuccess).toEqual(["Znaleziono 1 stron."]);
  });

  it("odznaczenie zaznaczonej strony zmniejsza licznik", async () => {
    renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    const checkbox = within(rowFor("o-nas")).getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(screen.getByText("Wybrane: 1 / 1")).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByText("Wybrane: 0 / 1")).toBeInTheDocument();
  });

  it("wyczyszczenie pary i celu nadpisania wraca do wartości domyślnych", async () => {
    renderPanel([
      { id: NEW_PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
    ]);
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "about-en", title: "About us" },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    const selects = within(rowFor("o-nas")).getAllByTestId("select");
    fireEvent.change(selects[1], { target: { value: "2" } });
    fireEvent.change(selects[2], { target: { value: NEW_PAGE_ID } });
    expect(screen.getByText("Pary PL/EN: 1")).toBeInTheDocument();
    expect(screen.getByText("Nadpisania: 1")).toBeInTheDocument();

    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "__none__" },
    });
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[2], {
      target: { value: "__new__" },
    });
    expect(screen.getByText("Pary PL/EN: 0")).toBeInTheDocument();
    expect(screen.getByText("Nadpisania: 0")).toBeInTheDocument();
  });

  it("strony i wpisy bez tytułu pokazują się jako #id", async () => {
    renderPanel([
      { id: NEW_PAGE_ID, title_pl: "", title_en: "", slug: "bez-tytulu", status: "draft" },
    ]);
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "about-en", title: "" },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    // „#2" pojawia się i w wierszu, i na liście partnerów drugiego wiersza.
    expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
    // Lista partnerów i lista stron do nadpisania też muszą coś pokazać.
    expect(within(rowFor("o-nas")).getAllByTestId("select")[1].textContent).toContain("#2");
    expect(within(rowFor("o-nas")).getAllByTestId("select")[2].textContent).toContain("bez-tytulu");
  });

  it("ręczny slug i cel nadpisania dojeżdżają do ładunku serwerowego", async () => {
    const stub = installSupabase({
      current: { id: NEW_PAGE_ID, slug: "o-nas", title_pl: "O nas", title_en: "About" },
    });
    renderPanel([
      { id: NEW_PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
    ]);
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.change(within(rowFor("o-nas")).getByPlaceholderText("o-nas"), {
      target: { value: "  o-nas-2026  " },
    });
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[2], {
      target: { value: NEW_PAGE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));

    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(1));
    // Nadpisanie: migawka do content_revisions PRZED update-em.
    expect(stub.chainsFor("content_revisions")).toHaveLength(1);
    expect(stub.lastChain("content_revisions")?.argsOf("insert")?.[0]).toMatchObject({
      note: "wxr_import_pre_overwrite",
    });
    const update = stub.chainsFor("pages").find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toMatchObject({ slug: "o-nas-2026" });
    expect(h.toastSuccess.at(-1)).toContain("nadpisań");
  });

  it("para wskazana w wierszu EN daje DWA wiersze importu - stan faktyczny", async () => {
    // Zachowanie ZASTANE, spisane, żeby zmiana była widoczna: pętla `runImport`
    // sprawdza `consumed` tylko dla WŁASNEGO id, a nie dla partnera, więc gdy
    // parę wskazano w wierszu angielskim, strona polska trafia do ładunku DWA
    // razy: raz samodzielnie (bo jej wiersz nie wie o parze) i raz jako część
    // pary. Oba wiersze mają ten sam `clientId`. Defekt zarejestrowany niżej.
    const stub = installSupabase();
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas", content: "<p>Polska treść.</p>" },
        { id: 2, slug: "about-en", title: "About us", content: "<p>English body.</p>" },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[1], {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    const inserts = stub.chainsFor("pages").filter((c) => c.has("insert"));
    expect(inserts).toHaveLength(2);
    // Pierwszy wiersz: strona PL bez tłumaczenia. Drugi: ta sama strona z EN.
    expect(inserts[0].argsOf("insert")?.[0]).toMatchObject({ slug: "o-nas", title_en: "" });
    expect(inserts[1].argsOf("insert")?.[0]).toMatchObject({ slug: "o-nas", title_en: "About us" });
  });

  // ZAREJESTROWANY, NIE NAPRAWIONY. Kierunek wskazania pary NIE POWINIEN
  // zmieniać wyniku importu: „sparuj tę stronę EN z jej polskim oryginałem" to
  // ta sama intencja, co „sparuj tę stronę PL z jej wersją EN". Dziś pierwsza
  // wersja produkuje DWIE strony w bazie (druga dostaje slug `o-nas-2`, bo
  // `uniquePageSlug` odsuwa kolizję), czyli duplikat treści na produkcji, bez
  // żadnego ostrzeżenia - raport pokazuje „2 zaimportowanych" i to wygląda na
  // sukces. Ten sam błąd siedzi w `WordPressImportDialog.runImport` (identyczna
  // pętla), więc naprawa dotyczy DWÓCH plików produkcyjnych: wystarczy przed
  // dopisaniem itemu sprawdzić `consumed.has(plId)` albo najpierw domknąć pary
  // w obie strony. Poza zakresem pisania testów.
  it.fails("para wskazana w wierszu EN nie duplikuje strony polskiej", async () => {
    const stub = installSupabase();
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas", content: "<p>Polska treść.</p>" },
        { id: 2, slug: "about-en", title: "About us", content: "<p>English body.</p>" },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[1], {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(2\)/ }));
    await waitFor(() => expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(true));
    const inserts = stub.chainsFor("pages").filter((c) => c.has("insert"));
    expect(inserts).toHaveLength(1);
  });

  it("pominięcie po stronie serwera (slug main) jest widoczne w raporcie", async () => {
    installSupabase();
    const { onClose } = renderPanel();
    await upload(xml([{ id: 1, slug: "o-nas", title: "O nas" }]));
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));
    fireEvent.change(within(rowFor("o-nas")).getByPlaceholderText("o-nas"), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Importuj \(1\)/ }));
    await waitFor(() => expect(h.toastWarning.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("1 pominiętych");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("WxrUploadPanel - komunikaty w interfejsie angielskim", () => {
  beforeEach(() => {
    h.language = "en";
  });

  it("raport importu, ostrzeżenie o EN i błędy są po angielsku", async () => {
    installSupabase({ insertError: "duplicate key value" });
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        {
          id: 2,
          slug: "about-en",
          title: "About us",
          content: "[foxiz_container]tresc[/foxiz_container]",
        },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import \(2\)/ }));
    await waitFor(() => expect(h.toastError.length).toBeGreaterThan(0));
    expect(h.toastWarning.at(-1)).toContain("errors");
    expect(h.toastError.at(-1)).toBe("#1: duplicate key value");
  });

  it("ostrzeżenie o braku treści EN po angielsku", async () => {
    installSupabase();
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        {
          id: 2,
          slug: "about-en",
          title: "About us",
          content: "[foxiz_container]tresc[/foxiz_container]",
        },
      ]),
    );
    fireEvent.change(within(rowFor("about-en")).getAllByTestId("select")[0], {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[1], {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import \(2\)/ }));
    await waitFor(() =>
      expect(h.toastWarning.some((m) => m.includes("PL/EN pairs had no EN body"))).toBe(true),
    );
  });

  it("nadpisania i pominięcia w raporcie po angielsku", async () => {
    installSupabase({
      current: { id: NEW_PAGE_ID, slug: "o-nas", title_pl: "O nas", title_en: "About" },
    });
    renderPanel([
      { id: NEW_PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
    ]);
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "kontakt", title: "Kontakt" },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(within(rowFor("o-nas")).getAllByTestId("select")[2], {
      target: { value: NEW_PAGE_ID },
    });
    // Druga strona zostanie po stronie serwera POMINIĘTA jako /main.
    fireEvent.change(within(rowFor("kontakt")).getByPlaceholderText("kontakt"), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import \(2\)/ }));
    await waitFor(() => expect(h.toastSuccess.length).toBeGreaterThan(1));
    expect(h.toastSuccess.at(-1)).toContain("overwrites");
    expect(h.toastSuccess.at(-1)).toContain("skipped");
  });

  it("ostrzeżenia parsera po angielsku", async () => {
    renderPanel();
    await upload(
      xml([
        { id: 1, slug: "o-nas", title: "O nas" },
        { id: 2, slug: "pusta", title: "Pusta", content: "" },
      ]),
    );
    expect(h.toastWarning[0]).toContain("1 parse warnings");
  });

  it("pusty eksport i błąd parsera po angielsku", async () => {
    renderPanel();
    await upload(xml([{ id: 1, slug: "wpis", title: "Wpis", type: "post" }]));
    expect(h.toastInfo).toEqual(["No pages in export."]);
    h.toastError = [];
    await upload("<rss><channel><item></channel></rss>");
    expect(h.toastError[0]).toContain("Nieprawidłowy XML");
  });
});
