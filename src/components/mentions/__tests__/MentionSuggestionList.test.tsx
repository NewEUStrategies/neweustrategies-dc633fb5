// Lista podpowiedzi @wzmianek - `MentionSuggestionList`.
//
// CO TEN PLIK DOWODZI.
// (1) RODZAJ CELU SŁYSZY CZYTNIK. Nazwa dostępna opcji kończy się rodzajem
//     („…, mentions.person" / „…, mentions.organization"). Do tej zmiany
//     etykieta siedziała wewnątrz awatara z `aria-hidden`, więc osoba i firma
//     o tej samej nazwie brzmiały identycznie.
// (2) JEDEN ZNAK ZASTĘPCZY W AWATARZE: osoba bez zdjęcia ma ikonę, a nie ikonę
//     PLUS dwie pierwsze litery nazwy (tak było).
// (3) PODGLĄD CELU otwiera się najechaniem i dociąga profil dopiero wtedy -
//     z prawdziwymi inicjałami („JK", nie „JA"), podpisem zastępczym rodzaju,
//     biogramem i adresem bez protokołu.
// (4) WYBÓR MYSZĄ idzie na `mousedown` z blokadą domyślnej akcji - inaczej
//     pole traci fokus (blur) przed wyborem i lista znika pod kursorem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Klawiatury i wstawiania sluga - `MentionTextarea.test.tsx` i
//     `useMentionAutocomplete.test.tsx`; lista dostaje stan propsami.
// (b) Pobierania profilu - `useMentionProfile.test.tsx`; tu jest atrapą.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { MentionProfilePreview } from "@/lib/mentions/useMentionProfile";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";

const state = vi.hoisted(() => ({
  lang: "pl",
  profile: { data: null as MentionProfilePreview | null, isPending: false },
  profileCalls: [] as Array<{ slug: string | null; lang: string; enabled: boolean }>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => state.lang),
);
vi.mock("@/lib/i18n-mentions", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: (slug: string | null, lang: string, enabled: boolean) => {
    state.profileCalls.push({ slug, lang, enabled });
    return state.profile;
  },
}));

import { MentionSuggestionList } from "@/components/mentions/MentionSuggestionList";

function suggestion(over: Partial<MentionSuggestion> = {}): MentionSuggestion {
  return {
    kind: "person",
    slug: "jan-kowalski",
    name: "Jan Kowalski",
    avatarUrl: null,
    logoUrl: null,
    website: null,
    subtitle: null,
    verified: false,
    ...over,
  };
}

const ORG = suggestion({
  kind: "organization",
  slug: "org-123e4567-e89b-12d3-a456-426614174000",
  name: "ACME Europe",
  subtitle: "Energetyka",
});

function preview(over: Partial<MentionProfilePreview> = {}): MentionProfilePreview {
  return {
    kind: "person",
    id: "u1",
    slug: "jan-kowalski",
    name: "Jan Kowalski",
    avatarUrl: null,
    logoUrl: null,
    jobTitle: null,
    company: null,
    website: null,
    bio: null,
    verified: false,
    ...over,
  };
}

function renderList(props: Partial<Parameters<typeof MentionSuggestionList>[0]> = {}): {
  onChoose: ReturnType<typeof vi.fn>;
  onHighlight: ReturnType<typeof vi.fn>;
} {
  const onChoose = vi.fn();
  const onHighlight = vi.fn();
  render(
    <MentionSuggestionList
      listId="lista"
      suggestions={[suggestion(), ORG]}
      isFetching={false}
      highlight={0}
      onHighlight={onHighlight}
      onChoose={onChoose}
      {...props}
    />,
  );
  return { onChoose, onHighlight };
}

/** Otwiera podgląd celu najechaniem na wiersz i czeka na portal dymka. */
async function hover(name: string): Promise<HTMLElement> {
  fireEvent.mouseEnter(screen.getByRole("option", { name: new RegExp(name) }));
  return await waitFor(() => {
    const content = document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]");
    if (content === null) throw new Error("test: dymek podglądu się nie otworzył");
    return content;
  });
}

beforeEach(() => {
  state.lang = "pl";
  state.profile = { data: null, isPending: false };
  state.profileCalls = [];
});

// ---------------------------------------------------------------------------
// Wiersze listy
// ---------------------------------------------------------------------------

describe("MentionSuggestionList - wiersze", () => {
  it("lista jest nazwanym listboxem z opcjami o stabilnych id", () => {
    renderList({ highlight: 1 });
    const list = screen.getByRole("listbox", { name: "mentions.listLabel" });
    const options = within(list).getAllByRole("option");

    expect(list).toHaveAttribute("id", "lista");
    expect(options.map((o) => o.id)).toEqual(["lista-opt-0", "lista-opt-1"]);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });

  it("czytnik słyszy RODZAJ celu - osoba i firma brzmią inaczej", () => {
    // Regresja, którą to łapie: etykieta rodzaju wewnątrz `aria-hidden`.
    renderList();

    expect(
      screen.getByRole("option", { name: "Jan Kowalski , mentions.person" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "ACME Europe , mentions.organization Energetyka" }),
    ).toBeInTheDocument();
  });

  it("osoba bez zdjęcia ma JEDEN znak zastępczy: ikonę, bez liter", () => {
    // Regresja, którą to łapie: ikona i „JA" naraz w awatarze 24 px.
    renderList({ suggestions: [suggestion()] });
    const avatar = document.querySelector("[data-suggestion-avatar]");

    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar?.querySelectorAll("svg")).toHaveLength(1);
    expect(avatar?.textContent).toBe("");
  });

  it("zdjęcie osoby albo logo firmy zastępuje ikonę", () => {
    renderList({
      suggestions: [
        suggestion({ avatarUrl: "https://cdn.example/jan.png" }),
        { ...ORG, logoUrl: "https://cdn.example/acme.png" },
      ],
    });
    const images = Array.from(document.querySelectorAll("[data-suggestion-avatar] img"));

    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "https://cdn.example/jan.png",
      "https://cdn.example/acme.png",
    ]);
    expect(document.querySelectorAll("[data-suggestion-avatar] svg")).toHaveLength(0);
  });

  it("podpis wchodzi tylko wtedy, gdy jest - bez nicku i bez pustej linii", () => {
    renderList();
    const [person, org] = screen.getAllByRole("option");

    expect(person?.textContent).toBe("Jan Kowalski, mentions.person");
    expect(org?.textContent).toContain("Energetyka");
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("w trakcie ładowania bez wyników pokazuje stan ładowania, nie pustą listę", () => {
    renderList({ suggestions: [], isFetching: true });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("mentions.loading")).toHaveAttribute("aria-disabled", "true");
  });

  it("odświeżanie przy znanych wynikach zostawia wyniki na miejscu", () => {
    renderList({ isFetching: true });

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByText("mentions.loading")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wybór i podświetlenie myszą
// ---------------------------------------------------------------------------

describe("MentionSuggestionList - mysz", () => {
  it("wybór idzie na `mousedown` i blokuje utratę fokusu pola", () => {
    const { onChoose } = renderList();

    const notCancelled = fireEvent.mouseDown(screen.getByRole("option", { name: /ACME/ }));

    expect(notCancelled).toBe(false);
    expect(onChoose).toHaveBeenCalledWith(ORG);
  });

  it("najechanie podświetla wiersz", () => {
    const { onHighlight } = renderList();

    fireEvent.mouseEnter(screen.getByRole("option", { name: /ACME/ }));

    expect(onHighlight).toHaveBeenCalledWith(1);
  });

  it("podgląd celu dociąga profil DOPIERO po najechaniu i znika po zjechaniu", async () => {
    renderList();
    expect(state.profileCalls).toEqual([]);

    await hover("Jan Kowalski");
    expect(state.profileCalls).toContainEqual({ slug: "jan-kowalski", lang: "pl", enabled: true });

    fireEvent.mouseLeave(screen.getByRole("option", { name: /Jan Kowalski/ }));
    await waitFor(() =>
      expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull(),
    );
  });

  it("zjechanie z INNEGO wiersza nie zamyka bieżącego podglądu", async () => {
    renderList();
    await hover("Jan Kowalski");
    fireEvent.mouseEnter(screen.getByRole("option", { name: /ACME/ }));
    fireEvent.mouseLeave(screen.getByRole("option", { name: /Jan Kowalski/ }));

    // Podgląd przeszedł na firmę - zjechanie z osoby nie może go zgasić.
    await waitFor(() => expect(state.profileCalls.map((call) => call.slug)).toContain(ORG.slug));
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).not.toBeNull();
  });

  it("podgląd prosi o profil w języku interfejsu", async () => {
    state.lang = "en-GB";
    renderList();

    await hover("Jan Kowalski");

    expect(state.profileCalls.every((call) => call.lang === "en")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Podgląd celu
// ---------------------------------------------------------------------------

describe("MentionSuggestionList - podgląd celu", () => {
  it("w trakcie pobierania pokazuje wskaźnik, a nie komunikat o braku", async () => {
    state.profile = { data: null, isPending: true };
    renderList();
    const card = await hover("Jan Kowalski");

    expect(card.textContent).toBe("...");
  });

  it("nierozwiązany cel dostaje wizytówkę z danych podpowiedzi, BEZ sluga", async () => {
    renderList();
    const card = await hover("ACME");

    // Nazwa i podpis z samej podpowiedzi - nie „nie znaleziono profilu".
    expect(within(card).getByText("ACME Europe")).toBeInTheDocument();
    expect(within(card).getByText("Energetyka")).toBeInTheDocument();
    expect(card.textContent).not.toContain("mentions.noProfile");
    expect(card.textContent).not.toContain("org-");
  });

  it("członek klubu spoza katalogu redakcji: imię, prawdziwe inicjały i stanowisko z podpowiedzi", async () => {
    // `club_mention_members` podpowiada zwykłych członków, a pełna wizytówka
    // (`get_mention_target`) rozwiązuje tylko redakcję - profil wraca pusty.
    state.profile = { data: null, isPending: false };
    renderList({
      suggestions: [suggestion({ slug: "anna-nowak", name: "Anna Nowak", subtitle: "Analityk" })],
    });
    const card = await hover("Anna Nowak");

    expect(within(card).getByText("Anna Nowak")).toBeInTheDocument();
    expect(within(card).getByText("AN")).toBeInTheDocument();
    expect(within(card).getByText("Analityk")).toBeInTheDocument();
    expect(card.textContent).not.toContain("mentions.noProfile");
  });

  it("osoba bez zdjęcia dostaje PRAWDZIWE inicjały i pełną wizytówkę", async () => {
    // Regresja, którą to łapie: „JA" (dwie pierwsze litery) zamiast „JK".
    state.profile = {
      data: preview({
        jobTitle: "Analityk",
        bio: "Zajmuje się energetyką.",
        website: "https://jan.example/o-mnie",
      }),
      isPending: false,
    };
    renderList();
    const card = await hover("Jan Kowalski");

    expect(within(card).getByText("JK")).toBeInTheDocument();
    expect(within(card).getByText("Analityk")).toBeInTheDocument();
    expect(within(card).getByText("Zajmuje się energetyką.")).toBeInTheDocument();
    // Adres bez protokołu - tekst pomocniczy, nie link do kliknięcia.
    expect(within(card).getByText("jan.example/o-mnie")).toBeInTheDocument();
  });

  it("osoba ze zdjęciem pokazuje zdjęcie zamiast inicjałów", async () => {
    state.profile = {
      data: preview({ avatarUrl: "https://cdn.example/jan.png" }),
      isPending: false,
    };
    renderList();
    const card = await hover("Jan Kowalski");

    expect(card.querySelector("img")).toHaveAttribute("src", "https://cdn.example/jan.png");
    expect(within(card).queryByText("JK")).toBeNull();
  });

  it("bez stanowiska podpisem jest rodzaj celu", async () => {
    state.profile = { data: preview(), isPending: false };
    renderList();
    const card = await hover("Jan Kowalski");

    expect(within(card).getByText("mentions.person")).toBeInTheDocument();
    expect(card.querySelectorAll("p")).toHaveLength(2);
  });

  it("firma pokazuje logo, branżę i NIE dostaje inicjałów osoby", async () => {
    state.profile = {
      data: preview({
        kind: "organization",
        slug: ORG.slug,
        name: "ACME Europe",
        logoUrl: "https://cdn.example/acme.png",
        company: "Energetyka",
      }),
      isPending: false,
    };
    renderList();
    const card = await hover("ACME");

    expect(card.querySelector("img")).toHaveAttribute("src", "https://cdn.example/acme.png");
    expect(within(card).getByText("Energetyka")).toBeInTheDocument();
  });

  it("firma bez logo i bez branży: ikona firmy i podpis rodzaju", async () => {
    state.profile = {
      data: preview({ kind: "organization", slug: ORG.slug, name: "ACME Europe" }),
      isPending: false,
    };
    renderList();
    const card = await hover("ACME");

    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("svg")).not.toBeNull();
    expect(within(card).getByText("mentions.organization")).toBeInTheDocument();
    expect(within(card).queryByText("AE")).toBeNull();
  });
});
