// TRASA OBSZARU TREŚCI (`/admin/content-area`). Do 16.10.2026 na zerze.
//
// Ekran edytuje JEDEN wiersz `post_layout_settings` najemcy - ten sam, który
// `ContentAreaStyle` i `PostLayoutRenderer` czytają na KAŻDYM wpisie. Błąd tutaj
// nie psuje panelu, tylko typografię całego serwisu. Reguły pod testem:
//
//   1. SZKIC RODZI SIĘ Z WIERSZA NAJEMCY, NIE Z ZASIEWU. Loader korzenia
//      zasiewa ten klucz domyślnymi z `updatedAt: 0`. Szkic z zasiewu
//      pokazywał domyślne zamiast zapisanych wartości, zapalał „Zapisz"
//      i jednym kliknięciem nadpisywał nimi cały wiersz.
//   2. „ZAPISZ" GAŚNIE PO UDANYM ZAPISIE. Trigger `pls_set_updated_at` zmienia
//      `updated_at`, więc porównanie z odświeżonym wierszem zostawiało
//      `dirty` na zawsze; odniesieniem jest migawka wysłana do bazy.
//   3. ZAPIS NIESIE TYLKO ZMIENIONE POLA. Ten sam wiersz zapisują też układy
//      wpisu i rozmiary czcionek (`paragraph_spacing_rem`); pełny szkic cofał
//      po cichu to, co tamten panel zapisał w innej karcie. Wyjątek: bez
//      wiersza w bazie pierwszy zapis utrwala całość, którą widać na ekranie.
//   4. BŁĄD ZAPISU MA TOAST. Wcześniej odrzucenie `mutateAsync` było
//      nieobsłużoną obietnicą - administrator nie wiedział, że nic nie zapisano.
//   5. KOLOR DA SIĘ WPISAĆ ZE SPACJAMI. Przycinanie przy każdym znaku zjadało
//      spację, więc format `hsl(210 50% 40%)` z placeholdera był niewpisywalny.
//      Przycięcie dzieje się przy wyjściu z pola; puste pole to `null` („auto").
//   6. PUSTE POLE SZEROKOŚCI TO NIE 0 PX. `Number("") === 0` wkładało do szkicu
//      zero, które po zapisie dawało `maxWidth: 0px` kolumnie treści każdego
//      wpisu. Przy wyjściu z pola liczba wraca w granice `min`-`max` i do
//      całych pikseli (kolumny są `integer`).
//   7. PODGLĄD LINKU NIE GUBI KOLORU PODKREŚLENIA po „Wyłącz" -> „Włącz".
//   8. `head()` daje tytuł sekcji ze wspólnego `adminPageHead` (AGENTS.md)
//      i trzyma ekran poza indeksem.
//   9. JEDNA POWŁOKA PANELU. `AdminShell` rysuje layout `/admin`; własna
//      `<AdminShell hideSidebar>` trasy dawała drugi `<main id="main-content">`
//      i drugi przełącznik języka. Atrapa `AdminShell` niżej jest SONDĄ
//      liczącą montaże. Spad lepkiego nagłówka równa się paddingowi kolumny
//      powłoki (`adminContentPaddingClass`) - szerszy przewijał ją w poziomie.
//  10. KAŻDA KONTROLKA MA NAZWĘ Z ETYKIETY POLA. Etykiety były gołymi `<span>`,
//      więc pola liczbowe, listy i pola kolorów nie miały nazwy dostępnej.
//  11. BŁĄD ODCZYTU TO NIE „NAJEMCA BEZ WIERSZA". Odczyt publiczny zamienia
//      błąd w domyślne z `tenant_id: ""`; ekran brał je za brak wiersza
//      i pierwszy zapis upsertował WSZYSTKIE kolumny (układy wpisu, odstęp
//      akapitów, typografia) wartościami domyślnymi. Teraz: komunikat
//      z ponowieniem i żadnego formularza - także gdy w cache'u leży wiersz
//      z poprzedniej wizyty. W trakcie ponowienia widać wczytywanie, nie
//      komunikat (z danymi w cache'u status zostaje „error" przez całe żądanie).
//  12. SZKIC Z ODCZYTU PO MONTAŻU, NIE Z CACHE'U SPRZED MINUT. Wiersz
//      rozgrzany na froncie (`ContentAreaStyle`, prefetch `$.tsx`) bywa sprzed
//      zmiany w innej sesji; formularz pokazywał go jak stan bazy. To samo
//      dotyczy wiersza klucza edytora z poprzedniej wizyty (żyje `gcTime`).
//  13. PEŁNY ZAPIS TYLKO RAZ. Po pierwszym INSERT szkic nadal miał
//      `tenant_id: ""`, więc każdy kolejny zapis znów niósł cały wiersz
//      i cofał kolumny zmienione w międzyczasie przez inny panel.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  /** Wiersz w „bazie" - to, co zwraca `select("*").maybeSingle()`. */
  row: null as Record<string, unknown> | null,
  selects: 0,
  /** Gdy ustawione, odczyt wiersza czeka na ręczne rozwiązanie. */
  holdSelect: null as Promise<void> | null,
  /** Gdy ustawione, odczyt wiersza kończy się błędem PostgREST. */
  selectError: null as { message: string; code: string } | null,
  /** Ile razy zamontowano `AdminShell` - SONDA reguły 9. */
  shellRenders: 0,
  rpcCalls: [] as string[],
  upserts: [] as { payload: Record<string, unknown>; opts: unknown }[],
  upsertError: null as { message: string; code: string } | null,
  /** Gdy ustawione, zapis czeka na ręczne rozwiązanie. */
  holdUpsert: null as Promise<void> | null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
// SONDA reguły 9, nie ozdoba: trasa nie importuje już powłoki, więc atrapa nie
// powinna być wywołana ani razu (prawdziwa ciągnie sesję, nawigację i tenanta).
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children: ReactNode }) => {
    h.shellRenders += 1;
    return <div data-testid="admin-shell">{children}</div>;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      h.rpcCalls.push(name);
      return { data: "tenant-1", error: null };
    },
    from: (table: string) => {
      if (table !== "post_layout_settings") throw new Error(`nieoczekiwana tabela ${table}`);
      return {
        select: (cols: string) => ({
          maybeSingle: async () => {
            expect(cols).toBe("*");
            h.selects += 1;
            if (h.holdSelect) await h.holdSelect;
            if (h.selectError) return { data: null, error: h.selectError };
            return { data: h.row, error: null };
          },
        }),
        upsert: async (payload: Record<string, unknown>, opts: unknown) => {
          h.upserts.push({ payload, opts });
          if (h.holdUpsert) await h.holdUpsert;
          if (h.upsertError) return { error: h.upsertError };
          // Jak trigger `pls_set_updated_at`: każdy zapis stempluje nowy czas.
          h.row = { ...h.row, ...payload, updated_at: `2026-10-16T12:00:0${h.upserts.length}Z` };
          return { error: null };
        },
      };
    },
  },
}));

import "@/test/i18nReal";
// `admin.saveError` i odnośnik do opcji motywu mieszkają w nakładce, którą
// w aplikacji ładuje layout `/admin` - tu trasa jest montowana bez niego.
import "@/lib/i18n-admin-extras";
import { Route } from "@/routes/admin.content-area";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { defaultPostLayoutSettings } from "@/lib/postLayouts";
import {
  adminPostLayoutSettingsQueryOptions,
  postLayoutSettingsQueryOptions,
} from "@/hooks/usePostLayoutSettings";
import { axeViolations, summarize } from "@/test/axe";
import {
  adminContentPaddingClass,
  isAdminThemeOptionsRoute,
} from "@/components/admin/adminShellGeometry";
import { isCompactSidebarRoute } from "@/lib/admin/adminNav";

/** Wiersz najemcy - świadomie RÓŻNY od domyślnych w każdym polu ekranu. */
function tenantRow(overrides: Row = {}): Row {
  return {
    ...defaultPostLayoutSettings(),
    tenant_id: "tenant-1",
    has_sidebar_max_width: 700,
    no_sidebar_max_width: 900,
    wide_align_max_width: 1400,
    hyperlink_style: "normal",
    hyperlink_underline: true,
    hyperlink_color: "#ff0000",
    hyperlink_color_dark: null,
    underline_color: "#abc",
    underline_color_dark: null,
    list_style: "square",
    image_caption_left_border: false,
    quick_view_info: true,
    updated_at: "2026-10-01T08:00:00Z",
    updated_by: "user-1",
    ...overrides,
  };
}

let queryClient: QueryClient;

async function mount() {
  const view = await renderRoute({
    route: Route as AnyRoute,
    path: "/admin/content-area",
    initialEntry: "/admin/content-area",
    queryClient,
  });
  return view;
}

/** Montuje i czeka, aż formularz pokaże wiersz najemcy. */
async function mountLoaded() {
  const view = await mount();
  await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
  return view;
}

/** Korzeń `FieldShell` po etykiecie pola (etykieta to `<span>`, nie `<label>`). */
function field(label: string): HTMLElement {
  return screen.getByText(label).parentElement?.parentElement as HTMLElement;
}
const numberIn = (label: string) =>
  within(field(label)).getByRole("spinbutton") as HTMLInputElement;
const selectIn = (label: string) => within(field(label)).getByRole("combobox") as HTMLSelectElement;
const colorText = (label: string) => within(field(label)).getByRole("textbox") as HTMLInputElement;
const colorPicker = (label: string) =>
  within(field(label)).getByLabelText("color picker") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /^(Zapisz|Ładowanie…)$/ });
const previewLink = () => screen.getByText("to jest link w treści") as HTMLAnchorElement;
const lastPayload = () => h.upserts.at(-1)?.payload as Row;

/**
 * Pisanie znak po znaku w kontrolowanym polu: każdy znak dokleja się do tego,
 * co pole POKAZUJE po poprzednim renderze - tak jak klawiatura. Jedno
 * `fireEvent.change` z całym napisem ominęłoby właśnie ten błąd, w którym
 * render między znakami zjadał spację.
 */
function typeInto(input: HTMLInputElement, text: string) {
  for (const ch of text) fireEvent.change(input, { target: { value: input.value + ch } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.row = tenantRow();
  h.selects = 0;
  h.holdSelect = null;
  h.selectError = null;
  h.shellRenders = 0;
  h.rpcCalls.length = 0;
  h.upserts.length = 0;
  h.upsertError = null;
  h.holdUpsert = null;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("/admin/content-area - nagłówek i wczytanie", () => {
  it("head() daje tytuł sekcji i noindex - wprost i przez zamontowany router", async () => {
    expect(routeHead(Route as AnyRoute).meta).toEqual(
      expect.arrayContaining([
        { title: "Content layout | New European Strategies" },
        { name: "robots", content: "noindex, nofollow" },
      ]),
    );
    const { meta } = await mountLoaded();
    expect(meta()).toContainEqual({ title: "Content layout | New European Strategies" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("do czasu odpowiedzi pokazuje stan ładowania, potem formularz z wierszem najemcy", async () => {
    const gate = deferred();
    h.holdSelect = gate.promise;
    await mount();
    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(numberIn("Bez sidebara (px)").value).toBe("900");
    expect(numberIn("Maks. szerokość obrazu (px)").value).toBe("1400");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    expect(colorText("Kolor linku (light)").value).toBe("#ff0000");
    expect(saveButton()).toBeDisabled();
  });

  it("REGRESJA: zasiew domyślnych z korzenia (updatedAt: 0) nie staje się szkicem", async () => {
    // Dokładnie to, co robi loader `__root.tsx` na każdej trasie.
    queryClient.setQueryData(
      postLayoutSettingsQueryOptions().queryKey,
      defaultPostLayoutSettings(),
      { updatedAt: 0 },
    );
    const gate = deferred();
    h.holdSelect = gate.promise;
    await mount();

    // Zasiew jest w cache'u, ale formularz czeka na prawdziwy wiersz.
    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    // Wartości najemcy (700/900/square), nie domyślne (760/840/circle)...
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(numberIn("Bez sidebara (px)").value).toBe("900");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    // ...i nic do zapisania, czyli brak drogi do nadpisania wiersza domyślnymi.
    expect(saveButton()).toBeDisabled();
  });

  it("puste style w wierszu pokazują domyślne opcje list (disc) i linków (normal)", async () => {
    h.row = tenantRow({ list_style: "", hyperlink_style: "" });
    await mountLoaded();
    expect(selectIn("Styl list (ul)").value).toBe("disc");
    expect(selectIn("Styl").value).toBe("normal");
  });

  it("odnośnik do opcji motywu prowadzi tam, gdzie mieszkają odstępy akapitów", async () => {
    await mountLoaded();
    expect(screen.getByRole("link", { name: "Opcje motywu → Rozmiary czcionek" })).toHaveAttribute(
      "href",
      "/admin/theme-options",
    );
  });
});

describe("/admin/content-area - szkic i zapis", () => {
  it("zmiana zapala „Zapisz”, powrót do wartości z bazy gasi go znowu", async () => {
    await mountLoaded();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    expect(saveButton()).toBeEnabled();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "square" } });
    expect(saveButton()).toBeDisabled();
  });

  it("zapis wysyła tylko zmienione pola + najemcę z RPC (nie z formularza) i pokazuje toast", async () => {
    await mountLoaded();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "none" } });
    fireEvent.change(selectIn("Styl"), { target: { value: "bold" } });
    fireEvent.change(selectIn("Podkreślenie"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pokaż lewy border/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Pokaż pasek meta/ }));
    // Zmiana i powrót do wartości z bazy - pole nie jest zmienione.
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "square" } });
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "none" } });
    fireEvent.change(numberIn("Z sidebarem (px)"), { target: { value: "710" } });
    fireEvent.change(numberIn("Z sidebarem (px)"), { target: { value: "700" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Zapisano"));
    expect(h.rpcCalls).toEqual(["current_tenant_id"]);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].opts).toEqual({ onConflict: "tenant_id" });
    expect(lastPayload()).toEqual({
      list_style: "none",
      hyperlink_style: "bold",
      hyperlink_underline: false,
      image_caption_left_border: true,
      quick_view_info: false,
      tenant_id: "tenant-1",
    });
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("REGRESJA: zapis nie cofa pól, które w międzyczasie zapisał inny panel (odstęp akapitów)", async () => {
    await mountLoaded();
    // Inna karta: „Opcje motywu → Rozmiary czcionek" (do których ten ekran
    // odsyła) zapisuje odstęp akapitów i układ wpisu w TYM SAMYM wierszu.
    h.row = { ...h.row, paragraph_spacing_rem: 1.8, standard_layout: "layout-7" };

    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));

    expect(lastPayload()).toEqual({ list_style: "circle", tenant_id: "tenant-1" });
    expect(h.row).toMatchObject({
      list_style: "circle",
      paragraph_spacing_rem: 1.8,
      standard_layout: "layout-7",
    });
  });

  it("bez wiersza w bazie pierwszy zapis utrwala całe widoczne ustawienia (domyślne + zmiana)", async () => {
    h.row = null;
    await mountLoaded();
    // Formularz pokazuje domyślne aplikacji.
    expect(numberIn("Z sidebarem (px)").value).toBe("760");
    expect(screen.getByRole("checkbox", { name: /Pokaż pasek meta/ })).not.toBeChecked();

    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "square" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));

    const { tenant_id: _emptyTenant, ...defaults } = defaultPostLayoutSettings();
    void _emptyTenant;
    // Całość, nie sama zmiana: inaczej INSERT wziąłby domyślne BAZY
    // (np. `quick_view_info = true`), a nie to, co administrator widział.
    expect(lastPayload()).toEqual({ ...defaults, list_style: "square", tenant_id: "tenant-1" });
  });

  it("REGRESJA: po udanym zapisie „Zapisz” gaśnie, choć baza przestemplowała updated_at", async () => {
    await mountLoaded();
    expect(h.selects).toBe(1);
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    // Inwalidacja dociągnęła wiersz z nowym `updated_at` (klucz edytora leży
    // pod prefiksem klucza publicznego - patrz reguła 11)...
    await waitFor(() => expect(h.selects).toBe(2));
    await waitFor(() =>
      expect(
        queryClient
          .getQueriesData({ queryKey: postLayoutSettingsQueryOptions().queryKey })
          .map(([, row]) => row),
      ).toContainEqual(expect.objectContaining({ updated_at: "2026-10-16T12:00:01Z" })),
    );
    // ...a przycisk nie udaje, że zostały niezapisane zmiany.
    expect(saveButton()).toBeDisabled();
    expect(selectIn("Styl list (ul)").value).toBe("circle");
  });

  it("w trakcie zapisu przycisk jest zablokowany, a zmiany wpisane w tym czasie zostają niezapisane", async () => {
    const gate = deferred();
    h.holdUpsert = gate.promise;
    await mountLoaded();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).toHaveTextContent("Ładowanie…"));
    expect(saveButton()).toBeDisabled();
    // Edycja w locie - nie należy do wysłanej migawki.
    fireEvent.change(selectIn("Styl"), { target: { value: "italic" } });

    gate.resolve();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    // W bazie ląduje migawka z chwili kliknięcia, bez edycji w locie.
    expect(lastPayload()).toEqual({ list_style: "circle", tenant_id: "tenant-1" });
    await waitFor(() => expect(saveButton()).toHaveTextContent("Zapisz"));
    expect(saveButton()).toBeEnabled();
  });

  it("REGRESJA: błąd zapisu daje toast błędu, bez sukcesu, a szkic zostaje do ponowienia", async () => {
    h.upsertError = { message: "new row violates row-level security policy", code: "42501" };
    await mountLoaded();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Nie udało się zapisać."));
    expect(h.toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton()).toHaveTextContent("Zapisz"));
    expect(saveButton()).toBeEnabled();
    expect(selectIn("Styl list (ul)").value).toBe("circle");

    // Ponowienie po ustąpieniu błędu przechodzi i gasi przycisk.
    h.upsertError = null;
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Zapisano"));
    expect(h.upserts).toHaveLength(2);
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });
});

describe("/admin/content-area - pola kolorów", () => {
  it("REGRESJA: format hsl(…) ze spacjami da się wpisać; przycięcie dopiero przy wyjściu", async () => {
    h.row = tenantRow({ hyperlink_color_dark: null });
    await mountLoaded();
    const input = colorText("Kolor linku (dark)");
    typeInto(input, "hsl(210 50% 40%) ");
    // Spacje w środku przetrwały pisanie znak po znaku.
    expect(input.value).toBe("hsl(210 50% 40%) ");

    fireEvent.blur(input);
    expect(input.value).toBe("hsl(210 50% 40%)");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastPayload().hyperlink_color_dark).toBe("hsl(210 50% 40%)");
  });

  it("pole złożone z samych spacji to „auto” (null), nie biały napis", async () => {
    h.row = tenantRow({ underline_color_dark: null });
    await mountLoaded();
    const input = colorText("Kolor podkreślenia (dark)");
    typeInto(input, "  ");
    expect(input.value).toBe("");
    expect(saveButton()).toBeDisabled();
    // Wyjście z pola bez wartości niczego nie zmienia.
    fireEvent.blur(input);
    expect(saveButton()).toBeDisabled();
  });

  it("przycisk × czyści kolor do „auto” i zapisuje null", async () => {
    await mountLoaded();
    const shell = field("Kolor linku (light)");
    expect(within(shell).queryByText("auto")).not.toBeInTheDocument();
    fireEvent.click(within(shell).getByRole("button", { name: "clear" }));

    expect(colorText("Kolor linku (light)").value).toBe("");
    expect(within(shell).getByText("auto")).toBeInTheDocument();
    expect(within(shell).queryByRole("button", { name: "clear" })).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastPayload().hyperlink_color).toBeNull();
  });

  it("próbnik pokazuje hex z wartości (#abc -> #aabbcc, hsl -> czerń), wybór wpisuje hex w pole", async () => {
    h.row = tenantRow({ underline_color: "#abc", hyperlink_color: "hsl(0 0% 50%)" });
    await mountLoaded();
    expect(colorPicker("Kolor podkreślenia (light)").value).toBe("#aabbcc");
    expect(colorPicker("Kolor linku (light)").value).toBe("#000000");
    expect(colorPicker("Kolor linku (dark)").value).toBe("#000000");

    fireEvent.change(colorPicker("Kolor podkreślenia (dark)"), {
      target: { value: "#00ff00" },
    });
    expect(colorText("Kolor podkreślenia (dark)").value).toBe("#00ff00");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastPayload().underline_color_dark).toBe("#00ff00");
  });

  it("podgląd linku bierze kolor, kolor podkreślenia i styl ze szkicu", async () => {
    await mountLoaded();
    const link = previewLink();
    expect(link.style.color).toBe("#ff0000");
    expect(link.style.textDecorationLine).toBe("underline");
    expect(link.style.textDecorationColor).toBe("#abc");
    expect(link.style.fontWeight).toBe("");
    expect(link.style.fontStyle).toBe("");
    // Kliknięcie w podgląd nie nawiguje.
    expect(fireEvent.click(link)).toBe(false);

    fireEvent.change(selectIn("Styl"), { target: { value: "bold-italic" } });
    expect(previewLink().style.fontWeight).toBe("600");
    expect(previewLink().style.fontStyle).toBe("italic");
    fireEvent.change(selectIn("Styl"), { target: { value: "italic" } });
    expect(previewLink().style.fontWeight).toBe("");
    expect(previewLink().style.fontStyle).toBe("italic");
    fireEvent.change(selectIn("Styl"), { target: { value: "bold" } });
    expect(previewLink().style.fontWeight).toBe("600");
    expect(previewLink().style.fontStyle).toBe("");

    fireEvent.change(selectIn("Podkreślenie"), { target: { value: "0" } });
    expect(previewLink().style.textDecorationLine).toBe("none");
    fireEvent.click(within(field("Kolor linku (light)")).getByRole("button", { name: "clear" }));
    fireEvent.click(
      within(field("Kolor podkreślenia (light)")).getByRole("button", { name: "clear" }),
    );
    expect(previewLink().style.color).toBe("");
    expect(previewLink().style.textDecorationColor).toBe("");
  });
  it("REGRESJA: wyłączenie i ponowne włączenie podkreślenia nie gubi jego koloru w podglądzie", async () => {
    // Skrót `textDecoration` zeruje w przeglądarce `text-decoration-color`,
    // a React nie dopisuje go ponownie, bo jego wartość w stylu się nie
    // zmieniła - po „Wyłącz" -> „Włącz" podgląd rysował podkreślenie w kolorze
    // linku. happy-dom nie modeluje rozwijania skrótów, więc dowodem jest
    // ostrzeżenie Reacta o mieszaniu skrótu z długą formą (to samo, które
    // React wypisuje w trybie deweloperskim przeglądarki).
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mountLoaded();
      fireEvent.change(selectIn("Podkreślenie"), { target: { value: "0" } });
      expect(previewLink().style.textDecorationLine).toBe("none");
      fireEvent.change(selectIn("Podkreślenie"), { target: { value: "1" } });
      expect(previewLink().style.textDecorationLine).toBe("underline");
      expect(previewLink().style.textDecorationColor).toBe("#abc");
      expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(/conflicting property/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("/admin/content-area - pola szerokości", () => {
  it("REGRESJA: wyczyszczone pole nie wkłada 0 px do szkicu; wyjście przywraca wartość", async () => {
    await mountLoaded();
    const input = numberIn("Z sidebarem (px)");
    fireEvent.change(input, { target: { value: "" } });
    // Pole może być chwilowo puste, ale szkic się nie zmienił.
    expect(input.value).toBe("");
    expect(saveButton()).toBeDisabled();

    fireEvent.blur(input);
    expect(input.value).toBe("700");
    expect(saveButton()).toBeDisabled();
  });

  it("wpisanie nowej liczby po wyczyszczeniu trafia do zapisu jako ta liczba", async () => {
    await mountLoaded();
    const input = numberIn("Bez sidebara (px)");
    fireEvent.change(input, { target: { value: "" } });
    typeInto(input, "960");
    fireEvent.blur(input);
    expect(input.value).toBe("960");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastPayload().no_sidebar_max_width).toBe(960);
  });

  it("przy wyjściu z pola wartość wraca w granice min-max i do całych pikseli", async () => {
    await mountLoaded();
    const sidebar = numberIn("Z sidebarem (px)");
    fireEvent.change(sidebar, { target: { value: "50" } });
    fireEvent.blur(sidebar);
    expect(sidebar.value).toBe("480");

    const wide = numberIn("Maks. szerokość obrazu (px)");
    fireEvent.change(wide, { target: { value: "5000" } });
    fireEvent.blur(wide);
    expect(wide.value).toBe("2000");

    const noSidebar = numberIn("Bez sidebara (px)");
    fireEvent.change(noSidebar, { target: { value: "765.6" } });
    fireEvent.blur(noSidebar);
    expect(noSidebar.value).toBe("766");

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastPayload()).toMatchObject({
      has_sidebar_max_width: 480,
      wide_align_max_width: 2000,
      no_sidebar_max_width: 766,
    });
  });

  it("wartość w granicach przechodzi bez zmian, a samo wejście i wyjście z pola niczego nie brudzi", async () => {
    await mountLoaded();
    const input = numberIn("Maks. szerokość obrazu (px)");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(saveButton()).toBeDisabled();

    fireEvent.change(input, { target: { value: "1500" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1500");
    expect(saveButton()).toBeEnabled();
    expect(input).toHaveAttribute("min", "800");
    expect(input).toHaveAttribute("max", "2000");
    expect(input).toHaveAttribute("step", "20");
  });
});

describe("/admin/content-area - sklejenie z layoutem /admin i dostępność", () => {
  it("REGRESJA: NIE montuje własnej powłoki panelu - ani we wczytywaniu, ani w formularzu", async () => {
    const gate = deferred();
    h.holdSelect = gate.promise;
    await mount();
    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(h.shellRenders).toBe(0);

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    expect(h.shellRenders).toBe(0);
    expect(screen.queryByTestId("admin-shell")).toBeNull();
  });

  it("REGRESJA: spad lepkiego nagłówka równa się paddingowi kolumny powłoki", async () => {
    await mountLoaded();
    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    const path = "/admin/content-area";
    const padding = adminContentPaddingClass({
      isEditRoute: isCompactSidebarRoute(path),
      isThemeOptions: isAdminThemeOptionsRoute(path),
    })
      .split(/\s+/)
      .filter((cls) => /^(lg:)?px-\d+$/.test(cls));
    // `px-3` w kolumnie -> `-mx-3 px-3` w nagłówku (i tak samo od `lg:`).
    expect(padding.length).toBeGreaterThan(0);
    for (const cls of padding) expect(header).toHaveClass(cls.replace("px-", "-mx-"), cls);
    expect(header.className.split(/\s+/).filter((cls) => /(^|:)-mx-/.test(cls))).toHaveLength(
      padding.length,
    );
  });

  it("REGRESJA: każda kontrolka ma nazwę z etykiety swojego pola (axe bez naruszeń)", async () => {
    const view = await mountLoaded();
    expect(screen.getByRole("spinbutton", { name: "Z sidebarem (px)" })).toHaveValue(700);
    expect(screen.getByRole("spinbutton", { name: "Maks. szerokość obrazu (px)" })).toHaveValue(
      1400,
    );
    expect(screen.getByRole("combobox", { name: "Styl list (ul)" })).toHaveValue("square");
    expect(screen.getByRole("combobox", { name: "Podkreślenie" })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: "Kolor linku (light)" })).toHaveValue("#ff0000");
    expect(screen.getByRole("group", { name: "Kolor podkreślenia (dark)" })).toBeInTheDocument();
    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("/admin/content-area - odczyt edytora", () => {
  it("REGRESJA: błąd odczytu nie daje formularza z domyślnymi, tylko komunikat z ponowieniem", async () => {
    // Odczyt publiczny podstawiał za błąd domyślne z `tenant_id: ""` - ekran
    // brał je za najemcę bez wiersza, a pierwszy zapis wysyłał CAŁY wiersz
    // domyślnych (`standard_layout: "layout-1"`, `paragraph_spacing_rem: 1.5`...).
    h.selectError = { message: "permission denied for table post_layout_settings", code: "42501" };
    await mount();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nie udało się wczytać ustawień obszaru treści.");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Zapisz|Ładowanie…)$/ })).toBeNull();
    expect(h.upserts).toHaveLength(0);

    // Ponowienie po ustąpieniu błędu daje wiersz NAJEMCY, nie domyślne.
    h.selectError = null;
    fireEvent.click(within(alert).getByRole("button", { name: "Spróbuj ponownie" }));
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    expect(saveButton()).toBeDisabled();
    expect(h.selects).toBe(2);
  });

  it("błąd odświeżenia PO starcie szkicu nie zabiera formularza ani niezapisanych zmian", async () => {
    await mountLoaded();
    // Odświeżenie po zapisie (unieważnienie prefiksem) trafia na awarię.
    h.selectError = { message: "JWT expired", code: "PGRST301" };
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "circle" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.selects).toBe(2));

    fireEvent.change(selectIn("Styl"), { target: { value: "italic" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(selectIn("Styl list (ul)").value).toBe("circle");
    expect(saveButton()).toBeEnabled();
  });

  it("REGRESJA: wiersz rozgrzany w cache minutę temu nie staje się szkicem - formularz czeka na bazę", async () => {
    // Front (`ContentAreaStyle`, prefetch `$.tsx`) zostawił w cache wiersz
    // świeży wg `staleTime`, a od tego czasu inna sesja zmieniła ustawienia.
    queryClient.setQueryData(
      postLayoutSettingsQueryOptions().queryKey,
      {
        ...defaultPostLayoutSettings(),
        tenant_id: "tenant-1",
        has_sidebar_max_width: 640,
        list_style: "disc",
      },
      { updatedAt: Date.now() - 60_000 },
    );
    const gate = deferred();
    h.holdSelect = gate.promise;
    await mount();

    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    expect(h.selects).toBe(1);
  });

  it("REGRESJA: wiersz KLUCZA EDYTORA z poprzedniej wizyty nie staje się szkicem przed odczytem po montażu", async () => {
    // Test wyżej zasiewa klucz publiczny, którego trasa już nie czyta - tu
    // zasiew trafia w klucz edytora. Wpis z danymi ma od razu `isSuccess`,
    // więc o starcie szkicu rozstrzyga dopiero `isFetchedAfterMount`.
    queryClient.setQueryData(
      adminPostLayoutSettingsQueryOptions().queryKey,
      {
        ...defaultPostLayoutSettings(),
        tenant_id: "tenant-1",
        has_sidebar_max_width: 640,
        list_style: "disc",
      },
      { updatedAt: Date.now() - 60_000 },
    );
    const gate = deferred();
    h.holdSelect = gate.promise;
    await mount();

    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(h.selects).toBe(1);

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    // Szkic z bazy (700/square), a nie z cache'u (640/disc) zatrzaśniętego wcześniej.
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    expect(saveButton()).toBeDisabled();
  });

  it("REGRESJA: nieudany odczyt przy wierszu klucza edytora w cache daje komunikat, a ponowienie - wczytywanie", async () => {
    // Nieudane odświeżenie podnosi `isFetchedAfterMount` (licznik błędów),
    // a `data` zostaje przy wierszu z poprzedniej wizyty: bez `isSuccess`
    // formularz startowałby z niego, choć jest sprzed zmian z innych sesji.
    queryClient.setQueryData(
      adminPostLayoutSettingsQueryOptions().queryKey,
      {
        ...defaultPostLayoutSettings(),
        tenant_id: "tenant-1",
        has_sidebar_max_width: 640,
        list_style: "disc",
      },
      { updatedAt: Date.now() - 60_000 },
    );
    h.selectError = { message: "JWT expired", code: "PGRST301" };
    await mount();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nie udało się wczytać ustawień obszaru treści.");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Zapisz|Ładowanie…)$/ })).toBeNull();

    // Z danymi w cache'u status zostaje „error" przez całe ponowienie - bez
    // `!isFetching` komunikat wisiałby nad żądaniem, które właśnie trwa.
    h.selectError = null;
    const gate = deferred();
    h.holdSelect = gate.promise;
    fireEvent.click(within(alert).getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(h.selects).toBe(2);

    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: "Obszar treści wpisu" });
    expect(numberIn("Z sidebarem (px)").value).toBe("700");
    expect(selectIn("Styl list (ul)").value).toBe("square");
    expect(saveButton()).toBeDisabled();
    expect(h.upserts).toHaveLength(0);
  });

  it("REGRESJA: po pierwszym zapisie bez wiersza kolejne zapisy niosą już tylko zmienione pola", async () => {
    h.row = null;
    await mountLoaded();
    fireEvent.change(selectIn("Styl list (ul)"), { target: { value: "square" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    // Pierwszy zapis to INSERT całości (reguła 3)...
    expect(lastPayload()).toMatchObject({ standard_layout: "layout-1", list_style: "square" });

    // ...potem inny panel zmienia kolumny w TYM SAMYM wierszu.
    h.row = { ...(h.row as Row | null), standard_layout: "layout-7", paragraph_spacing_rem: 1.8 };
    fireEvent.change(selectIn("Styl"), { target: { value: "italic" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(2));

    expect(lastPayload()).toEqual({ hyperlink_style: "italic", tenant_id: "tenant-1" });
    expect(h.row).toMatchObject({
      hyperlink_style: "italic",
      list_style: "square",
      standard_layout: "layout-7",
      paragraph_spacing_rem: 1.8,
    });
  });
});
