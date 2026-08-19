// TRASA „NOWA STRONA”. Do 19.08.2026 na zerze (65 instrukcji).
//
// Ta trasa nie ma własnego ekranu - to śluza: otwiera wybór szablonu i tworzy
// wiersz strony, po czym natychmiast przenosi redaktora do edytora. Dokładnie
// dlatego jej błędy są dotkliwe: redaktor kliknął „Nowa strona” i albo utknął
// na pustym ekranie, albo w bazie został osierocony wiersz bez treści.
//
// Reguły: (1) każde wyjście prowadzi DALEJ - do edytora albo z powrotem na
// listę, nigdy donikąd; (2) tworzenie nie startuje przed wczytaniem sesji ani
// drugi raz w trakcie; (3) porażka nie zostawia redaktora na tym ekranie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  auth: { user: { id: "u1" }, loading: false, tenantId: "t1" } as Record<string, unknown>,
  language: "pl",
  navigations: [] as Record<string, unknown>[],
  created: [] as unknown[],
  createResult: { slug: "nowa-strona" } as { slug: string },
  createError: null as Error | null,
  toast: { success: vi.fn(), error: vi.fn() },
  pickerProps: null as Record<string, unknown> | null,
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
// kontrakt (pomiń / zastosuj / zamknij) jako trzy przyciski.
vi.mock("@/components/patterns/PatternPicker", () => ({
  PatternPicker: (props: Record<string, unknown>) => {
    h.pickerProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="wybor-szablonu">
        <button type="button" onClick={() => (props.onSkip as () => void)()}>
          pomiń szablon
        </button>
        <button
          type="button"
          onClick={() =>
            (props.onApply as (a: unknown) => void)({
              kind: "page",
              title_pl: "Tytuł PL",
              title_en: "Title EN",
              builder: { blocks: [] },
            })
          }
        >
          zastosuj szablon
        </button>
        <button type="button" onClick={() => (props.onOpenChange as (v: boolean) => void)(false)}>
          zamknij wybór
        </button>
      </div>
    );
  },
}));

import { Route } from "@/routes/admin.pages.new";

function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  return render(<Component />);
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
    setup();
    fireEvent.click(screen.getByText("pomiń szablon"));
    fireEvent.click(screen.getByText("pomiń szablon"));

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
