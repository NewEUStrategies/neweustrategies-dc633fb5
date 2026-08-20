// Dwa edytory wiążące widget z PROFILEM EKSPERTA (`team-member`,
// `author-profile-card`) plus wspólny panel wiązania. Sens jest jeden:
// redaktor wybiera osobę raz, a karta wypełnia się danymi z jej profilu -
// zdjęciem, stanowiskiem, biogramem i linkami społecznościowymi.
//
// Test przypina to, co przy takim „wypełnianiu” psuje się najczęściej:
//  1. MAPOWANIE KLUCZY. Oba edytory czytają ten sam ładunek hydratacji, ale
//     zapisują go pod RÓŻNE klucze (`bio_pl` w karcie zespołu,
//     `description_pl` w karcie autora). Pomyłka daje puste pole na karcie.
//  2. PUSTE POLA PROFILU NIE NADPISUJĄ RĘCZNYCH WPISÓW. Hydratacja zapisuje
//     tylko te wartości, które profil naprawdę ma - inaczej wybór osoby
//     z niepełnym profilem WYCZYŚCIŁ BY ręcznie wpisane stanowisko.
//  3. ODŁĄCZENIE zdejmuje samo WIĄZANIE, a nie skopiowane dane - karta ma
//     dalej działać jako wpis ręczny.
//  4. BŁĄD I BRAK PROFILU kończą się komunikatem, nie cichym niczym.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { ExpertHydration } from "@/lib/experts/hydration";
import { ExpertLinkPanel } from "../ExpertLinkPanel";
import { TeamMemberEditor } from "../TeamMemberEditor";
import { AuthorProfileCardEditor } from "../AuthorProfileCardEditor";

const fetchHydration = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock("@/lib/experts/hydration", () => ({ fetchExpertHydration: fetchHydration }));
// Sam picker ekspertów to osobna powierzchnia (baza wewnętrzna, wyszukiwanie).
// Tutaj potrzebujemy tylko dwóch zdarzeń, które z niego wychodzą.
vi.mock("@/components/admin/experts/ExpertPicker", () => ({
  ExpertPicker: ({
    value,
    disabled,
    onSelect,
    onClear,
  }: {
    value: string;
    disabled?: boolean;
    onSelect: (e: { id: string }) => void;
    onClear?: () => void;
  }) => (
    <div>
      <span data-testid="wybrany">{value}</span>
      <button type="button" disabled={disabled} onClick={() => onSelect({ id: "u-1" })}>
        wybierz osobę
      </button>
      <button type="button" onClick={() => onClear?.()}>
        wyczyść wybór
      </button>
    </div>
  ),
}));
// Podgląd karty autora renderuje prawdziwy widget publiczny - ma własne testy
// i własne zapytania. Tu liczy się, że edytor go montuje z aktualną treścią.
vi.mock("@/components/builder/organisms/widget-view/AuthorProfileCardWidget", () => ({
  AuthorProfileCardWidget: ({ node }: { node: { content: Record<string, unknown> } }) => (
    <div data-testid="podglad-karty">{String(node.content.name ?? "")}</div>
  ),
}));
vi.mock("../../../molecules/SchemaFieldControl", () => ({
  SchemaFieldControl: ({ field }: { field: { key: string } }) => (
    <div data-testid={`pole-${field.key}`} />
  ),
}));

const FULL: ExpertHydration = {
  authorId: "u-1",
  authorSlug: "jan-kowalski",
  photo: "https://cdn.test/u1.png",
  name: "Jan Kowalski",
  positionPl: "Ekspert",
  positionEn: "Expert",
  bioPl: "Biogram",
  bioEn: "Bio",
  email: "jan@neweu.test",
  x: "https://x.com/jan",
  linkedin: "https://linkedin.com/in/jan",
  website: "https://jan.test",
};

const EMPTY: ExpertHydration = {
  authorId: "u-2",
  authorSlug: null,
  photo: null,
  name: null,
  positionPl: null,
  positionEn: null,
  bioPl: null,
  bioEn: null,
  email: null,
  x: null,
  linkedin: null,
  website: null,
};

function renderEditor(
  Editor: typeof TeamMemberEditor | typeof AuthorProfileCardEditor,
  c: Record<string, unknown> = {},
  lang: "pl" | "en" = "pl",
) {
  const written: Array<[string, Json]> = [];
  const view = render(<Editor c={c} lang={lang} setContent={(k, v) => written.push([k, v])} />);
  return {
    ...view,
    written,
    map: (): Record<string, Json> => Object.fromEntries(written),
  };
}

beforeEach(() => {
  fetchHydration.mockReset();
  fetchHydration.mockResolvedValue(FULL);
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("TeamMemberEditor - hydratacja z profilu", () => {
  it("wypełnia pola karty zespołu danymi profilu", async () => {
    const { map } = renderEditor(TeamMemberEditor);
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(fetchHydration).toHaveBeenCalledWith("u-1"));
    await waitFor(() => expect(map().name).toBe("Jan Kowalski"));
    expect(map()).toMatchObject({
      authorId: "u-1",
      authorSlug: "jan-kowalski",
      photo: "https://cdn.test/u1.png",
      position_pl: "Ekspert",
      position_en: "Expert",
      bio_pl: "Biogram",
      bio_en: "Bio",
      email: "jan@neweu.test",
      x: "https://x.com/jan",
      linkedin: "https://linkedin.com/in/jan",
      website: "https://jan.test",
    });
  });

  it("puste pola profilu NIE nadpisują ręcznych wpisów", async () => {
    fetchHydration.mockResolvedValue(EMPTY);
    const { written } = renderEditor(TeamMemberEditor, { position_pl: "Ręcznie" });
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    const keys = written.map(([k]) => k);
    // Zapisane MUSZĄ być tylko wiązania - inaczej wybór osoby z niepełnym
    // profilem czyściłby wpisane wcześniej stanowisko.
    expect(keys).toEqual(["authorId", "authorSlug"]);
  });

  it("profil bez slugu zapisuje pusty slug, nie null", async () => {
    fetchHydration.mockResolvedValue(EMPTY);
    const { map } = renderEditor(TeamMemberEditor);
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(map().authorId).toBe("u-2"));
    expect(map().authorSlug).toBe("");
  });

  it("odłączenie czyści samo wiązanie", () => {
    const { written } = renderEditor(TeamMemberEditor, {
      authorId: "u-1",
      authorSlug: "jan-kowalski",
      name: "Jan Kowalski",
    });
    fireEvent.click(screen.getByRole("button", { name: /Odłącz/ }));
    // Skopiowane dane zostają - karta ma dalej działać jako wpis ręczny.
    expect(written).toEqual([
      ["authorId", ""],
      ["authorSlug", ""],
    ]);
  });

  it("rysuje pola ze schematu widgetu", () => {
    renderEditor(TeamMemberEditor);
    expect(document.querySelectorAll('[data-testid^="pole-"]').length).toBeGreaterThan(0);
  });

  it("angielski panel ma angielskie napisy", () => {
    renderEditor(TeamMemberEditor, {}, "en");
    expect(screen.getByText("Linked expert")).toBeInTheDocument();
  });
});

describe("AuthorProfileCardEditor - hydratacja z profilu", () => {
  it("biogram ląduje pod kluczem opisu karty autora", async () => {
    const { map } = renderEditor(AuthorProfileCardEditor);
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(map().name).toBe("Jan Kowalski"));
    // Ten sam ładunek, INNE klucze niż w karcie zespołu.
    expect(map().description_pl).toBe("Biogram");
    expect(map().description_en).toBe("Bio");
    expect(map().bio_pl).toBeUndefined();
  });

  it("puste pola profilu nie nadpisują ręcznych wpisów", async () => {
    fetchHydration.mockResolvedValue(EMPTY);
    const { written } = renderEditor(AuthorProfileCardEditor, { description_pl: "Ręcznie" });
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.map(([k]) => k)).toEqual(["authorId", "authorSlug"]);
  });

  it("odłączenie czyści samo wiązanie", () => {
    const { written } = renderEditor(AuthorProfileCardEditor, { authorId: "u-1" });
    fireEvent.click(screen.getByRole("button", { name: /Odłącz/ }));
    expect(written).toEqual([
      ["authorId", ""],
      ["authorSlug", ""],
    ]);
  });

  it("podgląd karty dostaje aktualną treść widgetu", () => {
    renderEditor(AuthorProfileCardEditor, { name: "Anna Nowak" });
    // Podgląd renderuje TEN SAM komponent, co strona publiczna - inaczej
    // redaktor akceptuje wygląd, którego czytelnik nie zobaczy.
    expect(screen.getByTestId("podglad-karty").textContent).toBe("Anna Nowak");
  });

  it("podgląd jest nieklikalny", () => {
    const { container } = renderEditor(AuthorProfileCardEditor);
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();
  });

  it("nagłówek podglądu idzie za językiem panelu", () => {
    renderEditor(AuthorProfileCardEditor, {}, "en");
    expect(screen.getByText("Card preview")).toBeInTheDocument();
  });

  it("nietekstowe wiązanie w dokumencie traktujemy jak brak", () => {
    renderEditor(AuthorProfileCardEditor, { authorId: 7, authorSlug: null });
    expect(screen.getByTestId("wybrany").textContent).toBe("");
    expect(screen.queryByRole("button", { name: /Odłącz/ })).toBeNull();
  });
});

describe("ExpertLinkPanel", () => {
  function renderPanel(authorId = "", authorSlug = "", lang: "pl" | "en" = "pl") {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <ExpertLinkPanel
        lang={lang}
        authorId={authorId}
        authorSlug={authorSlug}
        onApply={onApply}
        onClear={onClear}
      />,
    );
    return { onApply, onClear };
  }

  it("wybór osoby wczytuje dane i informuje o sukcesie", async () => {
    const { onApply } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(FULL));
    expect(toastSuccess).toHaveBeenCalledWith("Dane eksperta wczytane", expect.anything());
  });

  it("odświeżenie danych NIE pokazuje komunikatu o sukcesie", async () => {
    const { onApply } = renderPanel("u-1", "jan-kowalski");
    fireEvent.click(screen.getByRole("button", { name: /Odśwież dane/ }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(FULL));
    // Odświeżenie jest akcją cichą - komunikat przy każdym kliknięciu byłby
    // hałasem, a nie informacją.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("brak profilu kończy się komunikatem błędu, nie cichym niczym", async () => {
    fetchHydration.mockResolvedValue(null);
    const { onApply } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nie znaleziono eksperta"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("błąd wczytywania pokazuje jego treść", async () => {
    fetchHydration.mockRejectedValue(new Error("timeout bazy"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Błąd wczytywania",
        expect.objectContaining({ description: "timeout bazy" }),
      ),
    );
  });

  it("błąd niebędący wyjątkiem też trafia do komunikatu", async () => {
    fetchHydration.mockRejectedValue("padło");
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "wybierz osobę" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Błąd wczytywania",
        expect.objectContaining({ description: "padło" }),
      ),
    );
  });

  it("bez wiązania nie ma ani odświeżania, ani odłączania, ani linku do profilu", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /Odśwież dane/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Odłącz/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Zobacz profil publiczny/ })).toBeNull();
    // Skrót do tworzenia profilu jest ZAWSZE - to on ratuje redakcję, gdy
    // szukanej osoby jeszcze nie ma w bazie.
    expect(screen.getByRole("link", { name: /Utwórz nowy profil/ })).toBeInTheDocument();
  });

  it("wiązanie bez slugu nie daje linku do profilu publicznego", () => {
    renderPanel("u-1", "");
    expect(screen.queryByRole("link", { name: /Zobacz profil publiczny/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Odłącz/ })).toBeInTheDocument();
  });

  it("link do profilu publicznego prowadzi pod slug osoby", () => {
    renderPanel("u-1", "jan-kowalski");
    const link = screen.getByRole("link", { name: /Zobacz profil publiczny/ });
    expect(link).toHaveAttribute("href", "/author/jan-kowalski");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("odłączenie woła obsługę rodzica", () => {
    const { onClear } = renderPanel("u-1", "jan-kowalski");
    fireEvent.click(screen.getByRole("button", { name: /Odłącz/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("wyczyszczenie wyboru w pickerze też woła obsługę rodzica", () => {
    const { onClear } = renderPanel("u-1", "jan-kowalski");
    fireEvent.click(screen.getByRole("button", { name: "wyczyść wybór" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("własna podpowiedź nadpisuje domyślną", () => {
    render(
      <ExpertLinkPanel
        lang="pl"
        authorId=""
        authorSlug=""
        onApply={vi.fn()}
        onClear={vi.fn()}
        hint="Własna podpowiedź"
      />,
    );
    expect(screen.getByText("Własna podpowiedź")).toBeInTheDocument();
  });

  it("domyślna podpowiedź jest dwujęzyczna", () => {
    const { unmount } = render(
      <ExpertLinkPanel lang="pl" authorId="" authorSlug="" onApply={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText(/Wybranie osoby wypełni pola karty/)).toBeInTheDocument();
    unmount();
    render(
      <ExpertLinkPanel lang="en" authorId="" authorSlug="" onApply={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText(/Selecting a person populates the card/)).toBeInTheDocument();
  });

  it("w trakcie wczytywania picker i przyciski są zablokowane", async () => {
    let release: (h: ExpertHydration) => void = () => {};
    fetchHydration.mockReturnValue(
      new Promise<ExpertHydration>((resolve) => {
        release = resolve;
      }),
    );
    renderPanel("u-1", "jan-kowalski");
    fireEvent.click(screen.getByRole("button", { name: /Odśwież dane/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "wybierz osobę" })).toBeDisabled(),
    );
    release(FULL);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "wybierz osobę" })).not.toBeDisabled(),
    );
  });
});
