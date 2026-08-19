// Wersje dokumentów prawnych (`PolicyVersionsPane`, 0%) — regulamin, polityka
// prywatności, zwroty.
//
// To najostrzejsza powierzchnia w całej sekcji „Wersje": opublikowana wersja
// regulaminu jest tą, którą widzi odwiedzający i którą jest związany. Cztery
// rzeczy muszą być prawdziwe:
//
//   1. „TREŚĆ Z KODU" JEST ZAWSZE DOSTĘPNA jako punkt wyjścia — także wtedy,
//      gdy w bazie nie ma ani jednej wersji. Bez niej redakcja nie miałaby od
//      czego zacząć po nieudanej migracji.
//   2. PANEL MÓWI WPROST, KTÓRA WERSJA JEST PUBLICZNA. Domysł na tym ekranie
//      kosztuje: publikacja niewłaściwego regulaminu to zdarzenie prawne.
//   3. PRZYWRÓCENIE ROBI SZKIC, NIE PUBLIKUJE. Przywrócenie starej wersji
//      wprost na publiczną byłoby zmianą warunków bez decyzji redakcji.
//   4. PODGLĄD POKAZUJE DOKŁADNIE TO, CO ZOBACZY ODWIEDZAJĄCY — w wybranym
//      języku, niezależnie od języka panelu.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  versions: [] as unknown[],
  create: null as unknown,
  publish: null as unknown,
  unpublish: null as unknown,
  remove: null as unknown,
  toast: null as unknown,
}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

// Strona prawna ma własne testy - tutaj interesuje nas, JAKA treść do niej idzie.
vi.mock("@/components/legal/LegalPage", () => ({
  LegalPage: ({ title, lead }: { title: string; lead?: string }) => (
    <div data-testid="legal-preview">
      <h1>{title}</h1>
      <p>{lead}</p>
    </div>
  ),
}));

vi.mock("@/lib/legal/versions", async () => {
  const { vi: v } = await import("vitest");
  h.create = v.fn(async () => undefined);
  h.publish = v.fn(async () => undefined);
  h.unpublish = v.fn(async () => undefined);
  h.remove = v.fn(async () => undefined);
  return {
    useLegalVersions: () => ({ data: h.versions }),
    useLegalVersionActions: () => ({
      create: { mutateAsync: h.create, isPending: false },
      publish: { mutateAsync: h.publish, isPending: false },
      unpublish: { mutateAsync: h.unpublish, isPending: false },
      remove: { mutateAsync: h.remove, isPending: false },
    }),
  };
});

import { PolicyVersionsPane } from "@/components/admin/versions/organisms/PolicyVersionsPane";
import { LEGAL_DOCS } from "@/lib/legal/registry";

type Mock = ReturnType<typeof vi.fn>;
const toast = () => h.toast as Record<string, Mock>;

function version(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "v1",
    doc_key: "terms",
    label: "Wersja marcowa",
    status: "draft",
    created_at: "2026-08-18T10:00:00.000Z",
    content: LEGAL_DOCS.terms.baseline,
    ...over,
  };
}

beforeEach(() => {
  h.versions = [];
  for (const fn of [h.create, h.publish, h.unpublish, h.remove] as Mock[]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Punkt wyjścia
// ---------------------------------------------------------------------------

describe("PolicyVersionsPane - treść z kodu jako punkt wyjścia", () => {
  it("tresc z kodu jest na liscie nawet przy PUSTEJ historii", () => {
    // Bez niej redakcja nie miałaby od czego zacząć po nieudanej migracji.
    render(<PolicyVersionsPane lang="pl" />);
    expect(screen.getByText("Treść z kodu")).toBeInTheDocument();
    expect(screen.getByText("Wersja z kodu")).toBeInTheDocument();
  });

  it("brak opublikowanej wersji jest powiedziany WPROST", () => {
    // Domysł na tym ekranie kosztuje: to informacja o tym, co obowiązuje.
    render(<PolicyVersionsPane lang="pl" />);
    expect(
      screen.getByText("Brak opublikowanej wersji - strona publiczna korzysta z treści z kodu."),
    ).toBeInTheDocument();
  });

  it("gdy wersja JEST opublikowana, panel podaje jej nazwę", () => {
    h.versions = [version({ status: "published", label: "Regulamin 2026" })];
    render(<PolicyVersionsPane lang="pl" />);
    // Nazwa pada DWA razy: w zdaniu o stanie publicznym i jako tytul wiersza.
    // Asercja celuje w zdanie, bo to ono niesie informacje „co obowiazuje".
    expect(
      screen.getByText('Na stronie publicznej widoczna jest wersja "Regulamin 2026".'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wybór dokumentu
// ---------------------------------------------------------------------------

describe("PolicyVersionsPane - wybór dokumentu", () => {
  it("pokazuje przełącznik dla KAŻDEGO dokumentu z rejestru", () => {
    render(<PolicyVersionsPane lang="pl" />);
    for (const doc of Object.values(LEGAL_DOCS)) {
      expect(screen.getByText(doc.labelPl), doc.key).toBeInTheDocument();
    }
  });

  it("przełączenie dokumentu WRACA do treści z kodu", () => {
    // Zostawiony wybór wersji poprzedniego dokumentu pokazywałby treść
    // regulaminu pod nagłówkiem polityki prywatności.
    h.versions = [version({ label: "Wersja marcowa" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Wersja marcowa"));

    const other = Object.values(LEGAL_DOCS).find((d) => d.key !== "terms")!;
    fireEvent.click(screen.getByText(other.labelPl));

    // Akcje wersji znikają - zaznaczona jest treść z kodu, nie wersja.
    expect(screen.queryByText("Opublikuj")).toBeNull();
  });

  it("link do publicznej ścieżki dokumentu otwiera się w nowej karcie", () => {
    render(<PolicyVersionsPane lang="pl" />);
    const link = screen.getByRole("link", { name: new RegExp(LEGAL_DOCS.terms.path) });
    expect(link).toHaveAttribute("href", LEGAL_DOCS.terms.path);
    expect(link).toHaveAttribute("target", "_blank");
    // `noreferrer` przy `target=_blank` - inaczej otwierana strona dostaje
    // uchwyt do okna panelu administracyjnego.
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});

// ---------------------------------------------------------------------------
// Tworzenie wersji
// ---------------------------------------------------------------------------

describe("PolicyVersionsPane - tworzenie wersji", () => {
  it("nowa wersja z kodu tworzy SZKIC z treścią bazową", () => {
    render(<PolicyVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Nowa wersja z kodu"));

    expect(h.create as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ docKey: "terms", content: LEGAL_DOCS.terms.baseline }),
    );
  });

  it("PRZYWRÓCENIE robi kopię jako szkic, a NIE publikuje", () => {
    // Przywrócenie starej wersji wprost na publiczną byłoby zmianą warunków
    // bez decyzji redakcji.
    h.versions = [version({ label: "Wersja marcowa" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Wersja marcowa"));

    fireEvent.click(screen.getByText("Przywróć jako szkic"));

    expect(h.create as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Kopia: Wersja marcowa" }),
    );
    expect(h.publish as Mock).not.toHaveBeenCalled();
  });

  it("przycisk przywracania NIE istnieje bez wybranej wersji", () => {
    render(<PolicyVersionsPane lang="pl" />);
    expect(screen.queryByText("Przywróć jako szkic")).toBeNull();
  });

  it("nieudane utworzenie pokazuje błąd, nie sukces", async () => {
    (h.create as Mock).mockRejectedValue(new Error("rls"));
    render(<PolicyVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Nowa wersja z kodu"));

    await waitFor(() =>
      expect(toast().error).toHaveBeenCalledWith("Nie udało się utworzyć wersji"),
    );
    expect(toast().success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Publikacja
// ---------------------------------------------------------------------------

describe("PolicyVersionsPane - publikacja i archiwum", () => {
  it("szkic można OPUBLIKOWAĆ, opublikowanej nie da się opublikować ponownie", () => {
    h.versions = [version({ status: "draft", label: "Szkic A" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Szkic A"));
    expect(screen.getByText("Opublikuj")).toBeInTheDocument();
    expect(screen.queryByText("Wycofaj publikację")).toBeNull();
    cleanup();

    h.versions = [version({ status: "published", label: "Publiczna" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Publiczna"));
    expect(screen.getByText("Wycofaj publikację")).toBeInTheDocument();
    expect(screen.queryByText("Opublikuj")).toBeNull();
  });

  it("publikacja przekazuje id WYBRANEJ wersji i melduje sukces", async () => {
    h.versions = [version({ id: "v1", label: "Pierwsza" }), version({ id: "v2", label: "Druga" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Druga"));

    fireEvent.click(screen.getByText("Opublikuj"));

    await waitFor(() => expect(h.publish as Mock).toHaveBeenCalledWith("v2"));
    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("Opublikowano wersję"));
  });

  it("nieudana publikacja NIE melduje sukcesu", async () => {
    (h.publish as Mock).mockRejectedValue(new Error("denied"));
    h.versions = [version({ label: "Szkic A" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Szkic A"));

    fireEvent.click(screen.getByText("Opublikuj"));

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("Publikacja nie powiodła się"));
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("wycofanie publikacji przenosi wersję do archiwum", async () => {
    h.versions = [version({ id: "v9", status: "published", label: "Publiczna" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Publiczna"));

    fireEvent.click(screen.getByText("Wycofaj publikację"));

    await waitFor(() => expect(h.unpublish as Mock).toHaveBeenCalledWith("v9"));
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("Wersja przeniesiona do archiwum"),
    );
  });

  it("usunięcie wersji WRACA do treści z kodu", async () => {
    // Zostawienie zaznaczenia na usuniętym wierszu pokazywałoby akcje dla
    // wersji, której już nie ma.
    h.versions = [version({ id: "v3", label: "Do usunięcia" })];
    render(<PolicyVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Do usunięcia"));

    fireEvent.click(screen.getByText("Usuń"));

    await waitFor(() => expect(h.remove as Mock).toHaveBeenCalledWith("v3"));
    await waitFor(() => expect(screen.queryByText("Opublikuj")).toBeNull());
    expect(toast().success).toHaveBeenCalledWith("Usunięto wersję");
  });
});

// ---------------------------------------------------------------------------
// Podgląd
// ---------------------------------------------------------------------------

describe("PolicyVersionsPane - podgląd", () => {
  it("podgląd startuje w języku panelu", () => {
    render(<PolicyVersionsPane lang="pl" />);
    expect(screen.getByRole("button", { name: "PL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
  });

  it("język podglądu przełącza się NIEZALEŻNIE od języka panelu", () => {
    // Redaktor pracujący po polsku musi móc sprawdzić angielską wersję
    // regulaminu przed publikacją - to ta wersja wiąże anglojęzycznych.
    render(<PolicyVersionsPane lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "PL" })).toHaveAttribute("aria-pressed", "false");
  });

  it("podgląd renderuje treść WYBRANEJ wersji, nie zawsze bazowej", () => {
    h.versions = [
      version({
        label: "Nowa treść",
        content: {
          ...LEGAL_DOCS.terms.baseline,
          pl: { ...LEGAL_DOCS.terms.baseline.pl, title: "Zupełnie nowy regulamin" },
        },
      }),
    ];
    render(<PolicyVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Nowa treść"));

    expect(screen.getByTestId("legal-preview").textContent).toContain("Zupełnie nowy regulamin");
  });

  it("interfejs jest dwujęzyczny", () => {
    render(<PolicyVersionsPane lang="en" />);
    // „Code baseline" pada dwa razy: jako tytul wiersza i jako etykieta
    // plakietki statusu - oba wyjscia sa poprawne, wiec liczymy wystapienia.
    expect(screen.getAllByText("Code baseline").length).toBeGreaterThan(0);
    expect(screen.getByText("New version from code")).toBeInTheDocument();
    expect(screen.getByText("What a visitor will see")).toBeInTheDocument();
    expect(
      screen.getByText("No published version - the public page serves the code baseline."),
    ).toBeInTheDocument();
  });
});
