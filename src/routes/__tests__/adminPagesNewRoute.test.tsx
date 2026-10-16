// TRASA „NOWA STRONA”. Do 19.08.2026 na zerze (65 instrukcji).
//
// Ta trasa nie ma własnego ekranu - to śluza: otwiera wybór szablonu i tworzy
// wiersz strony, po czym natychmiast przenosi redaktora do edytora. Dokładnie
// dlatego jej błędy są dotkliwe: redaktor kliknął „Nowa strona” i albo utknął
// na pustym ekranie, albo w bazie został osierocony wiersz bez treści.
//
// Reguły: (1) każde wyjście prowadzi DALEJ - do edytora albo z powrotem na
// listę, nigdy donikąd; (2) tworzenie nie startuje przed wczytaniem sesji ani
// drugi raz w trakcie; (3) porażka nie zostawia redaktora na tym ekranie;
// (4) wybór szablonu albo pustej strony to NIE jest „zamknięcie bez wyboru”.
//
// Reguła 4 dołożona 16.10.2026: PatternPicker zamyka okno W TYM SAMYM
// handlerze, w którym zgłasza wybór (`onOpenChange(false)` PRZED `onSkip`,
// PO `onApply`). Trasa czytała flagę „trwa tworzenie” ze stanu poprzedniego
// renderu, więc każde zamknięcie po wyborze wysyłało redaktora na listę,
// zanim strona powstała - a po utworzeniu historia przeglądarki prowadziła
// „wstecz” z powrotem na śluzę.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  auth: { user: { id: "u1" }, loading: false, tenantId: "t1" } as Record<string, unknown>,
  language: "pl" as string | undefined,
  navigations: [] as Record<string, unknown>[],
  created: [] as unknown[],
  createResult: { slug: "nowa-strona" } as { slug: string },
  createError: null as unknown,
  toast: { success: vi.fn(), error: vi.fn() },
  pickerProps: null as Record<string, unknown> | null,
  appliedTitles: { title_pl: "Tytuł PL", title_en: "Title EN" },
  realPicker: false,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => (opts: Record<string, unknown>) => {
    h.navigations.push(opts);
  },
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: h.language } }),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/content.functions", () => ({ createPage: "create-page" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (payload: unknown) => {
    h.created.push(payload);
    if (h.createError) throw h.createError;
    return h.createResult;
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));

// Wybór szablonu to osobny organizm z własnymi testami - tutaj wystawiamy jego
// kontrakt (pomiń / zastosuj / zamknij) jako trzy przyciski. KOLEJNOŚĆ wywołań
// jest skopiowana z PatternPicker.tsx: „Pusta strona” woła `onOpenChange(false)`
// i DOPIERO POTEM `onSkip()`, a zatwierdzenie szablonu `onApply(...)` i zaraz
// po nim `onOpenChange(false)` - w jednym handlerze kliknięcia. Atrapa wołająca
// samo `onSkip` ukrywała błąd trasy. `h.realPicker` montuje prawdziwy organizm.
vi.mock("@/components/patterns/PatternPicker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/patterns/PatternPicker")>();
  type PickerProps = Parameters<typeof actual.PatternPicker>[0];
  return {
    PatternPicker: (props: PickerProps) => {
      h.pickerProps = { ...props };
      if (h.realPicker) return <actual.PatternPicker {...props} />;
      if (!props.open) return null;
      const close = () => props.onOpenChange(false);
      return (
        <div data-testid="wybor-szablonu">
          <button
            type="button"
            onClick={() => {
              close();
              props.onSkip?.();
            }}
          >
            pomiń szablon
          </button>
          <button
            type="button"
            onClick={() => {
              props.onApply({
                kind: "page",
                ...h.appliedTitles,
                builder: { blocks: [] },
              } as unknown as Parameters<PickerProps["onApply"]>[0]);
              close();
            }}
          >
            zastosuj szablon
          </button>
          <button type="button" onClick={close}>
            zamknij wybór
          </button>
        </div>
      );
    },
  };
});

import { routeHead } from "@/test/routeHarness";
import { Route } from "@/routes/admin.pages.new";

function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  // Świeży klient na test: podgląd PRAWDZIWEGO wyboru szablonu renderuje
  // widżety, które czytają dane przez react-query.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

const lastNav = () => h.navigations.at(-1);

beforeEach(() => {
  h.auth = { user: { id: "u1" }, loading: false, tenantId: "t1" };
  h.language = "pl";
  h.navigations.length = 0;
  h.created.length = 0;
  h.createResult = { slug: "nowa-strona" };
  h.createError = null;
  h.pickerProps = null;
  h.appliedTitles = { title_pl: "Tytuł PL", title_en: "Title EN" };
  h.realPicker = false;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("nowa strona - wstrzymanie do czasu sesji", () => {
  it("w trakcie wczytywania sesji NIE otwiera wyboru szablonu", () => {
    // Wybór otwarty przed sesją pozwala kliknąć „pomiń” bez tenanta - i wtedy
    // nic się nie dzieje, a redaktor widzi zawieszony ekran.
    h.auth = { user: null, loading: true, tenantId: null };
    setup();

    expect(screen.queryByTestId("wybor-szablonu")).toBeNull();
  });

  it("po wczytaniu sesji wybór szablonu jest OTWARTY od razu", () => {
    // To jedyna treść tej trasy - zamknięty wybór daje pustą stronę.
    setup();
    expect(screen.getByTestId("wybor-szablonu")).toBeInTheDocument();
  });

  it("bez zalogowanego użytkownika pominięcie szablonu nic nie tworzy", () => {
    h.auth = { user: null, loading: false, tenantId: "t1" };
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    expect(h.created).toHaveLength(0);
  });

  it("bez tenanta pominięcie szablonu nic nie tworzy", () => {
    // Strona bez tenanta wyciekłaby poza redakcję.
    h.auth = { user: { id: "u1" }, loading: false, tenantId: null };
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    expect(h.created).toHaveLength(0);
  });
});

describe("nowa strona - tworzenie", () => {
  it("pominięcie szablonu tworzy PUSTĄ stronę", async () => {
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.created[0]).toEqual({ data: {} });
  });

  it("zastosowanie szablonu niesie tytuły i strukturę bloków", async () => {
    // Utrata `builder` daje pustą stronę mimo wybranego szablonu.
    setup();
    fireEvent.click(screen.getByText("zastosuj szablon"));

    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.created[0]).toEqual({
      data: {
        title_pl: "Tytuł PL",
        title_en: "Title EN",
        builder_data: { blocks: [] },
      },
    });
  });

  it("po utworzeniu przenosi do edytora TEJ strony i ZASTĘPUJE wpis w historii", async () => {
    // Bez `replace` przycisk „wstecz” wraca na śluzę i tworzy drugą stronę.
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(lastNav()).toMatchObject({
      to: "/admin/pages/$slug",
      params: { slug: "nowa-strona" },
      replace: true,
    });
  });

  it("drugie kliknięcie w trakcie tworzenia NIE tworzy drugiej strony", async () => {
    // Podwójne kliknięcie zostawiłoby w bazie osierocony wiersz bez treści.
    // Drugie kliknięcie trafia w okno, które jeszcze znika (animacja), więc
    // przychodzi z NOWEGO renderu - wołamy `onSkip` z aktualnych propsów.
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));
    act(() => (h.pickerProps?.onSkip as () => void)());

    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(h.created).toHaveLength(1);
  });
});

describe("nowa strona - wyjścia", () => {
  it("zamknięcie wyboru wraca na LISTĘ stron, nie zostawia pustki", async () => {
    setup();
    fireEvent.click(screen.getByText("zamknij wybór"));

    await waitFor(() => expect(lastNav()).toMatchObject({ to: "/admin/pages" }));
  });

  it("PORAŻKA tworzenia mówi o błędzie i też wyprowadza na listę", async () => {
    // Redaktor zostawiony na śluzie po błędzie klika ponownie w pustkę.
    h.createError = new Error("brak uprawnień");
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("brak uprawnień"));
    expect(lastNav()).toMatchObject({ to: "/admin/pages" });
  });
});

describe("nowa strona - język", () => {
  it.each([
    ["pl", "Zastosowano szablon"],
    ["en", "Template applied"],
  ])("potwierdzenie dla %s brzmi „%s”", async (language, expected) => {
    // Redaktor EN nie może zobaczyć polskiego potwierdzenia.
    h.language = language;
    setup();
    fireEvent.click(screen.getByText("zastosuj szablon"));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(expected));
  });

  it("przekazuje wyborowi szablonu JĘZYK i rodzaj treści", async () => {
    // Wybór z rodzajem „post” pokazałby szablony wpisów zamiast stron.
    h.language = "en-GB";
    setup();

    expect(h.pickerProps).toMatchObject({ kind: "page", lang: "en" });
  });
});

describe("nowa strona - nagłówek karty", () => {
  it("head() nazywa SEKCJĘ i trzyma panel poza indeksem", () => {
    // Bez własnego `head()` karta dziedziczyła ogólny tytuł listy stron.
    const { meta } = routeHead(Route as AnyRoute);

    expect(meta).toContainEqual({ title: "New page | New European Strategies" });
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("nowa strona - wybór to nie jest zamknięcie bez wyboru", () => {
  it("„pusta strona” (okno zamyka się PRZED zgłoszeniem) prowadzi WYŁĄCZNIE do edytora", async () => {
    // Wcześniej: najpierw skok na listę, potem `replace` na edytor - wpis
    // śluzy zostawał w historii, a lista mignęła w trakcie tworzenia.
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() => expect(h.created).toHaveLength(1));
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(h.navigations).toEqual([
      { to: "/admin/pages/$slug", params: { slug: "nowa-strona" }, replace: true },
    ]);
  });

  it("zatwierdzony szablon (okno zamyka się PO zgłoszeniu) też nie wraca na listę", async () => {
    setup();
    fireEvent.click(screen.getByText("zastosuj szablon"));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(h.navigations).toEqual([
      { to: "/admin/pages/$slug", params: { slug: "nowa-strona" }, replace: true },
    ]);
  });

  it("PRAWDZIWY wybór szablonu: „Pusta strona” tworzy stronę i otwiera jej edytor", async () => {
    // Ten sam kontrakt na żywym organizmie - dowód, że atrapa wyżej odwzorowuje
    // jego kolejność wywołań, a nie wygodne założenie.
    h.realPicker = true;
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Pusta strona/ }));

    await waitFor(() => expect(h.created).toEqual([{ data: {} }]));
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(h.navigations[0]).toMatchObject({ to: "/admin/pages/$slug", replace: true });
  });

  it("bez sesji „pusta strona” nic nie tworzy, ale też nie zostawia na śluzie", async () => {
    // Zamknięte okno bez tworzenia = pusta strona bez wyjścia.
    h.auth = { user: null, loading: false, tenantId: "t1" };
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() => expect(lastNav()).toMatchObject({ to: "/admin/pages" }));
    expect(h.created).toHaveLength(0);
  });
});

describe("nowa strona - dane i błędy", () => {
  it("PUSTE tytuły szablonu nie lecą jako pusty napis - serwer nada zapasowy slug", async () => {
    // `createPage` buduje slug z `title_pl || title_en || page-…`; pusty napis
    // zamiast braku pola dawałby tytuł „” zamiast domyślnego.
    h.appliedTitles = { title_pl: "", title_en: "" };
    setup();
    fireEvent.click(screen.getByText("zastosuj szablon"));

    await waitFor(() => expect(h.created).toHaveLength(1));
    const { data } = h.created[0] as { data: Record<string, unknown> };
    expect(data.title_pl).toBeUndefined();
    expect(data.title_en).toBeUndefined();
    expect(data.builder_data).toEqual({ blocks: [] });
  });

  it("odrzucenie bez obiektu Error nadal pokazuje jego treść i wyprowadza na listę", async () => {
    h.createError = "Rate limit exceeded - please slow down";
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("Rate limit exceeded - please slow down"),
    );
    expect(lastNav()).toMatchObject({ to: "/admin/pages" });
  });

  it("brak wykrytego języka panelu daje POLSKI wybór szablonu", () => {
    // i18next przed inicjalizacją nie ma `language` - polski jest domyślny.
    h.language = undefined;
    setup();

    expect(h.pickerProps).toMatchObject({ lang: "pl" });
    expect(screen.getByText("Wybierz szablon, aby kontynuować…")).toBeInTheDocument();
  });
});
