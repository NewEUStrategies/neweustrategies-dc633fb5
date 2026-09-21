// Edytor nagłówka / stopki / menu jako dokument buildera -
// `AppearanceBuilderPane`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ten panel jest pojedynczym wejściem do
// trzech różnych powierzchni serwisu (`header`, `footer`, `menu`) i zapisuje
// je do jednego wiersza `site_settings`. Trzy rzeczy w nim są nieodwracalne
// albo niewidoczne gołym okiem, więc muszą być przypięte:
//   1. ZASIEW DOKUMENTU. Pusty wiersz w bazie NIE może dać pustego płótna dla
//      zasięgu, który ma domyślną chromę: redaktor otwierający nagłówek
//      pierwszy raz zobaczyłby białą stronę zamiast obecnego nagłówka i
//      "zapisał" ją na produkcję. Panel bez zasięgu (dokument wolny) seje
//      pustkę - i to też jest kontrakt, nie przypadek.
//   2. ZAPIS SCALA, NIE NADPISUJE. Do wiersza wraca całe odczytane `value`
//      z podmienionym `builder_data`, a konflikt rozstrzyga `tenant_id,key`.
//      Nadpisanie wiersza skasowałoby sąsiedni podklucz `chrome` (ustawienia
//      stopki mieszkają w tym samym wierszu, patrz `FooterChromePane`).
//   3. UNIEWAŻNIENIE PAMIĘCI PODRĘCZNEJ OBEJMUJE KLUCZ ZBIORCZY
//      `["site_settings_public", "all"]`. Front czyta WSZYSTKIE ustawienia
//      jednym zapytaniem - bez tego unieważnienia zapisany nagłówek pokazuje
//      się dopiero po przeładowaniu strony.
//   4. JĘZYK PŁÓTNA STARTUJE OD JĘZYKA PANELU. Angielski redaktor ma wejść
//      na zakładkę EN; wpadnięcie na PL to edycja niewłaściwego języka bez
//      żadnego ostrzeżenia.
//   5. PRZYWRÓCENIE UKŁADU podmienia dokument na domyślny DLA TEGO ZASIĘGU
//      i nie zapisuje go samo z siebie (redaktor musi jeszcze kliknąć zapis),
//      a przycisk istnieje WYŁĄCZNIE tam, gdzie jest zasięg.
//   6. ZAKŁADKI SĄ RÓŻNE DLA RÓŻNYCH ZASIĘGÓW: nagłówek ma pasek trendów i
//      opcje motywu, stopka - opcje stopki, menu nie ma ich wcale.
//
// GAŁĄŹ NIEOSIĄGALNA Z INTERFEJSU: osłona `...(data ?? {})` w `mutationFn` -
// przycisk zapisu renderuje się dopiero, gdy `doc` jest ustawiony, a `doc`
// ustawia efekt zależny od `data`; przy błędzie odczytu panel stoi na stanie
// ładowania (osobny test niżej), więc `data === undefined` nigdy nie spotyka
// się z klikniętym zapisem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: samego buildera (`Builder`), `ThemeOptionsPane`,
// `TrendingTickerPane` i `FooterChromePane` - to osobne powierzchnie z własnymi
// właścicielami i własnymi testami; tutaj są ATRAPAMI, bo przedmiotem dowodu
// jest sklejenie. `defaultDocFor` działa PRAWDZIWY, bo to on jest treścią
// kontraktu zasiewu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, useContext, useState, type ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseResult,
} from "@/test/supabase";
import { radixTabsStub } from "@/test/reactStubs";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  language: "pl",
  toastSuccess: vi.fn<(message: string) => void>(),
  toastInfo: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown, operation: string) => void>(),
}));

const baza = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => baza.from(table) },
}));
vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, info: h.toastInfo, error: vi.fn() },
  Toaster: () => null,
}));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

// Radix AlertDialog wymaga pełnego pointer API - zastępujemy go najprostszym
// oknem sterowanym stanem, żeby dało się kliknąć "przywróć" i "anuluj".
vi.mock("@/components/ui/alert-dialog", () => {
  const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    AlertDialog: ({ children }: { children?: ReactNode }) => {
      const [open, setOpen] = useState(false);
      return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
    },
    AlertDialogTrigger: ({ children }: { children?: ReactNode }) => {
      const { setOpen } = useContext(Ctx);
      return (
        <span data-testid="wyzwalacz" onClick={() => setOpen(true)}>
          {children}
        </span>
      );
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const { open } = useContext(Ctx);
      return open ? <div role="alertdialog">{children}</div> : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const { setOpen } = useContext(Ctx);
      return (
        <button type="button" onClick={() => setOpen(false)}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => {
      const { setOpen } = useContext(Ctx);
      return (
        <button
          type="button"
          onClick={() => {
            onClick?.();
            setOpen(false);
          }}
        >
          {children}
        </button>
      );
    },
  };
});

// Atrapa buildera: wystawia propy, na których stoi kontrakt sklejenia
// (dokument, język, zasięg) i pozwala oddać zmianę w górę.
vi.mock("@/components/admin/builder/Builder", () => ({
  Builder: ({
    value,
    onChange,
    lang,
    onLangChange,
    hideChrome,
    scope,
  }: {
    value: BuilderDocument;
    onChange: (v: BuilderDocument) => void;
    lang: string;
    onLangChange: (v: "pl" | "en") => void;
    hideChrome?: boolean;
    scope?: string;
  }) => (
    <div
      data-testid="builder"
      data-lang={lang}
      data-scope={scope ?? ""}
      data-hide-chrome={String(!!hideChrome)}
      data-sekcje={String(value.sections.length)}
    >
      <button type="button" onClick={() => onChange({ version: 1, sections: [] })}>
        wyczysc-dokument
      </button>
      <button type="button" onClick={() => onLangChange("en")}>
        przelacz-na-en
      </button>
    </div>
  ),
}));

vi.mock("@/components/admin/ThemeOptionsPane", () => ({
  ThemeOptionsPane: () => <div data-testid="opcje-motywu" />,
}));
vi.mock("@/components/admin/FooterChromePane", () => ({
  FooterChromePane: () => <div data-testid="opcje-stopki" />,
}));
vi.mock("@/components/admin/TrendingTickerPane", () => ({
  TrendingTickerPane: () => <div data-testid="pasek-trendow" />,
}));

const { AppearanceBuilderPane } = await import("@/components/admin/AppearanceBuilderPane");

/** Wiersz `site_settings` - obok `builder_data` żyje w nim `chrome`. */
function wiersz(builderData: unknown) {
  return { value: { chrome: { layout: "dark" }, builder_data: builderData } };
}

function ustawBaze(builderData: unknown, zapis: SupabaseResult = ok(null)) {
  baza.reset();
  baza.setResponse("site_settings", (chain: RecordedChain) =>
    chain.has("upsert") ? zapis : ok(wiersz(builderData)),
  );
}

async function renderuj(
  opcje: {
    builderData?: unknown;
    scope?: "header" | "footer" | "menu";
    settingsKey?: string;
    zapis?: SupabaseResult;
    language?: string;
  } = {},
) {
  h.language = opcje.language ?? "pl";
  ustawBaze(opcje.builderData ?? null, opcje.zapis ?? ok(null));
  const utils = renderWithQueryClient(
    <AppearanceBuilderPane
      settingsKey={opcje.settingsKey ?? "header"}
      title="Nagłówek serwisu"
      scope={opcje.scope}
    />,
  );
  const invalidate = vi.spyOn(utils.queryClient, "invalidateQueries");
  await screen.findByTestId("builder");
  return { ...utils, invalidate };
}

function budowniczy(): HTMLElement {
  return screen.getByTestId("builder");
}

/** Ładunek ostatniego zapisu - to on ląduje w kolumnie jsonb. */
function ostatniZapis(): Record<string, unknown> {
  const upsert = baza
    .chainsFor("site_settings")
    .filter((c) => c.has("upsert"))
    .at(-1)
    ?.argsOf("upsert");
  if (!upsert) throw new Error("test: panel nie wykonał zapisu");
  return upsert[0] as Record<string, unknown>;
}

function zapisz(): void {
  fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
}

beforeEach(() => {
  h.toastSuccess.mockReset();
  h.toastInfo.mockReset();
  h.toastError.mockReset();
});

describe("AppearanceBuilderPane - zasiew dokumentu przy pierwszym otwarciu", () => {
  it("do czasu odpowiedzi pokazuje stan ładowania zamiast pustego płótna", () => {
    ustawBaze(null);
    renderWithQueryClient(<AppearanceBuilderPane settingsKey="header" title="Nagłówek" />);

    expect(screen.getByText("adminPanesMisc.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).not.toBeInTheDocument();
  });

  it("zapisany dokument z sekcjami wchodzi bez zmian", async () => {
    const istniejacy: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "sekcja-1",
          kind: "section",
          children: [],
        } as unknown as BuilderDocument["sections"][number],
      ],
    };
    await renderuj({ builderData: istniejacy, scope: "header" });

    expect(budowniczy()).toHaveAttribute("data-sekcje", "1");
  });

  it.each(["header", "footer", "menu"] as const)(
    "pusty wiersz dla zasięgu %s zasiewa domyślną chromę, a nie białą stronę",
    async (scope) => {
      await renderuj({ builderData: null, scope });

      const oczekiwane = defaultDocFor(scope).sections.length;
      expect(oczekiwane).toBeGreaterThan(0);
      expect(budowniczy()).toHaveAttribute("data-sekcje", String(oczekiwane));
    },
  );

  it("dokument z ZEROMA sekcji też idzie przez zasiew (to nadal pusty dokument)", async () => {
    await renderuj({ builderData: { version: 1, sections: [] }, scope: "footer" });

    expect(budowniczy()).toHaveAttribute(
      "data-sekcje",
      String(defaultDocFor("footer").sections.length),
    );
  });

  it("panel BEZ zasięgu seje pustkę - dokument wolny nie ma domyślnej chromy", async () => {
    await renderuj({ builderData: null, scope: undefined });

    expect(budowniczy()).toHaveAttribute("data-sekcje", "0");
    expect(budowniczy()).toHaveAttribute("data-scope", "");
  });

  it("BRAK WIERSZA w bazie też prowadzi do zasiewu, a nie do wywrotki", async () => {
    // `maybeSingle()` oddaje `null` - panel musi to potraktować jak pusty wiersz.
    baza.reset();
    baza.setResponse("site_settings", ok(null));
    h.language = "pl";
    renderWithQueryClient(
      <AppearanceBuilderPane settingsKey="header" title="Nagłówek" scope="header" />,
    );

    const builder = await screen.findByTestId("builder");
    expect(builder).toHaveAttribute("data-sekcje", String(defaultDocFor("header").sections.length));
  });

  it("błąd odczytu zostawia stan ładowania - płótno się NIE montuje", async () => {
    baza.reset();
    baza.setResponse("site_settings", fail("permission denied for table site_settings", "42501"));
    h.language = "pl";
    renderWithQueryClient(
      <AppearanceBuilderPane settingsKey="header" title="Nagłówek" scope="header" />,
    );

    await waitFor(() => expect(baza.chainsFor("site_settings").length).toBeGreaterThan(0));
    expect(screen.getByText("adminPanesMisc.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).not.toBeInTheDocument();
  });

  it("czyta ustawienia DOKŁADNIE spod przekazanego klucza", async () => {
    await renderuj({ settingsKey: "menu", scope: "menu" });

    expect(baza.lastChain("site_settings")?.argsOf("eq")).toEqual(["key", "menu"]);
  });
});

describe("AppearanceBuilderPane - język płótna i przekazywanie propów", () => {
  it("startuje od języka panelu (PL)", async () => {
    await renderuj({ scope: "header", language: "pl" });

    expect(budowniczy()).toHaveAttribute("data-lang", "pl");
  });

  it("angielski panel wchodzi od razu na płótno EN", async () => {
    await renderuj({ scope: "header", language: "en" });

    expect(budowniczy()).toHaveAttribute("data-lang", "en");
  });

  it("przełączenie języka na płótnie zmienia prop, nie tylko stan buildera", async () => {
    await renderuj({ scope: "footer", language: "pl" });

    fireEvent.click(screen.getByRole("button", { name: "przelacz-na-en" }));

    expect(budowniczy()).toHaveAttribute("data-lang", "en");
  });

  it("builder dostaje zasięg i ukrytą chromę edytora", async () => {
    await renderuj({ scope: "footer" });

    expect(budowniczy()).toHaveAttribute("data-scope", "footer");
    expect(budowniczy()).toHaveAttribute("data-hide-chrome", "true");
  });

  it("tytuł panelu pochodzi z propa, a nie ze słownika", async () => {
    await renderuj({ scope: "menu" });

    expect(screen.getByRole("heading", { name: "Nagłówek serwisu" })).toBeInTheDocument();
  });
});

describe("AppearanceBuilderPane - zapis dokumentu", () => {
  it("scala `builder_data` z resztą wiersza i nie rusza podklucza `chrome`", async () => {
    await renderuj({ scope: "menu", settingsKey: "menu" });

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const ladunek = ostatniZapis();
    expect(ladunek.key).toBe("menu");
    const value = ladunek.value as Record<string, unknown>;
    expect(value.chrome).toEqual({ layout: "dark" });
    expect((value.builder_data as BuilderDocument).sections).toHaveLength(
      defaultDocFor("menu").sections.length,
    );
  });

  it("zapisuje dokument PO zmianie na płótnie, a nie ten wczytany", async () => {
    await renderuj({ scope: "header" });

    fireEvent.click(screen.getByRole("button", { name: "wyczysc-dokument" }));
    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const value = ostatniZapis().value as Record<string, unknown>;
    expect((value.builder_data as BuilderDocument).sections).toEqual([]);
  });

  it("konflikt rozstrzyga para `tenant_id,key`", async () => {
    await renderuj({ scope: "header" });

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const opcje = baza
      .chainsFor("site_settings")
      .filter((c) => c.has("upsert"))
      .at(-1)
      ?.argsOf("upsert")?.[1];
    expect(opcje).toEqual({ onConflict: "tenant_id,key" });
  });

  it("sukces unieważnia klucz panelu, klucz zbiorczy frontu i klucz pojedynczy", async () => {
    const { invalidate } = await renderuj({ scope: "header", settingsKey: "header" });

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminPanesMisc.savedToast"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings", "header"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "all"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "header"] });
  });

  it("błąd zapisu idzie do `toastError` z etykietą operacji, bez fałszywego sukcesu", async () => {
    await renderuj({ scope: "header", zapis: fail("permission denied", "42501") });

    zapisz();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const [blad, operacja] = h.toastError.mock.calls[0];
    expect(blad).toBeInstanceOf(Error);
    expect(operacja).toBe("save");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("trwający zapis pokazuje stan i blokuje przycisk", async () => {
    let zakoncz: () => void = () => {};
    baza.reset();
    baza.setResponse("site_settings", (chain: RecordedChain) =>
      chain.has("upsert")
        ? new Promise((resolve) => {
            zakoncz = () => resolve(ok(null));
          })
        : ok(wiersz(null)),
    );
    h.language = "pl";
    renderWithQueryClient(
      <AppearanceBuilderPane settingsKey="header" title="Nagłówek" scope="header" />,
    );
    await screen.findByTestId("builder");

    zapisz();

    const przycisk = await screen.findByRole("button", { name: /adminPanesMisc\.saving/ });
    expect(przycisk).toBeDisabled();
    zakoncz();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});

describe("AppearanceBuilderPane - przywrócenie domyślnego układu", () => {
  it("panel bez zasięgu NIE ma czego przywracać", async () => {
    await renderuj({ scope: undefined });

    expect(
      screen.queryByRole("button", { name: /adminPanesMisc\.appearance\.resetLayout/ }),
    ).not.toBeInTheDocument();
  });

  it("potwierdzenie podmienia dokument na domyślny dla zasięgu i NIE zapisuje go", async () => {
    const wlasny: BuilderDocument = { version: 1, sections: [] };
    await renderuj({ builderData: wlasny, scope: "footer" });
    // Zasiew dał domyślną stopkę; czyścimy płótno, żeby różnica była widoczna.
    fireEvent.click(screen.getByRole("button", { name: "wyczysc-dokument" }));
    expect(budowniczy()).toHaveAttribute("data-sekcje", "0");

    fireEvent.click(screen.getByTestId("wyzwalacz"));
    fireEvent.click(screen.getByRole("button", { name: "adminPanesMisc.appearance.restore" }));

    expect(budowniczy()).toHaveAttribute(
      "data-sekcje",
      String(defaultDocFor("footer").sections.length),
    );
    expect(h.toastInfo).toHaveBeenCalledWith("adminPanesMisc.appearance.resetLayoutToast");
    // Przywrócenie to zmiana LOKALNA - dopóki redaktor nie kliknie zapisu,
    // w bazie zostaje poprzedni układ.
    expect(baza.chainsFor("site_settings").filter((c) => c.has("upsert"))).toHaveLength(0);
  });

  it("anulowanie zostawia dokument bez zmian", async () => {
    await renderuj({ scope: "header" });
    fireEvent.click(screen.getByRole("button", { name: "wyczysc-dokument" }));

    fireEvent.click(screen.getByTestId("wyzwalacz"));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(budowniczy()).toHaveAttribute("data-sekcje", "0");
    expect(h.toastInfo).not.toHaveBeenCalled();
  });
});

describe("AppearanceBuilderPane - zakładki zależą od zasięgu", () => {
  it("nagłówek ma builder, pasek trendów i opcje motywu", async () => {
    await renderuj({ scope: "header" });

    const zakladki = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(zakladki).toEqual([
      "Builder",
      "adminPanesMisc.appearance.tabTrending",
      "adminPanesMisc.appearance.tabThemeOptions",
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "adminPanesMisc.appearance.tabTrending" }));
    expect(screen.getByTestId("pasek-trendow")).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "adminPanesMisc.appearance.tabThemeOptions" }));
    expect(screen.getByTestId("opcje-motywu")).toBeInTheDocument();
  });

  it("stopka ma builder i opcje stopki - bez paska trendów", async () => {
    await renderuj({ scope: "footer" });

    const zakladki = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(zakladki).toEqual(["Builder", "adminPanesMisc.appearance.tabFooterOptions"]);

    fireEvent.click(
      screen.getByRole("tab", { name: "adminPanesMisc.appearance.tabFooterOptions" }),
    );
    expect(screen.getByTestId("opcje-stopki")).toBeInTheDocument();
    expect(screen.queryByTestId("pasek-trendow")).not.toBeInTheDocument();
  });

  it("menu nie ma zakładek wcale - samo płótno", async () => {
    await renderuj({ scope: "menu" });

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("builder")).toBeInTheDocument();
  });
});
