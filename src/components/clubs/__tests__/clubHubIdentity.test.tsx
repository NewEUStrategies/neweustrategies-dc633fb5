// Pasek tożsamości klubu (`ClubHubIdentity`) - pierwszy ekran po wejściu.
//
// CO TEN PLIK DOWODZI.
//  1. MONOGRAM istnieje ZAWSZE - także dla klubu o jednowyrazowej nazwie
//     i dla wiersza, w którym obie kolumny nazwy są puste. To jedyny znak
//     rozpoznawczy klubu na pasie okładki, więc „brak dwóch słów” nie może
//     dać pustego kwadratu.
//  2. OKŁADKA MA DWA STANY, oba poprawne: zdjęcie albo pas w kolorze akcentu.
//     Brak zdjęcia NIE jest stanem błędu i nie ma prawa dać pustego prostokąta.
//  3. EDYCJA OKŁADKI stoi za `can_moderate` - i to jest granica uprawnienia
//     widoczna na ekranie. Po udanej zmianie pasek unieważnia CAŁE gniazdo
//     kluczy klubu, bo okładka jedzie w wierszu `club_view`, a nie osobno.
//  4. TRZY STANY DANYCH OPCJONALNYCH: hasło („tagline”) pełne, puste
//     i białoznakowe - to tu leżą gałęzie `pickLocalized`, a białe znaki
//     w kolumnie są brakiem treści, nie treścią.
//  5. JEDNA akcja pierwszoplanowa: „nowy temat” pokazuje się WYŁĄCZNIE
//     przy `can_post_thread`, „o klubie” zawsze - przycisk, którego RPC
//     i tak odrzuci, jest gorszy niż jego brak.
//  6. POWÓD INFORMACYJNY (`pre_moderation`) mówi się PRZED napisaniem wpisu.
//  7. Nazwa, hasło i obszar tematyczny jadą w JĘZYKU INTERFEJSU, a liczby
//     przez `formatNumber` z podanym `locale` - nie przez `String(n)`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - `ClubCoverEditor`: ma własny plik (`clubCoverEditor.test.tsx`) i tutaj
//    stoi w atrapie. Sprawdzamy WYŁĄCZNIE kontrakt wpięcia: `clubId`,
//    `hasCover` i skutek `onChanged`.
//  - `ClubTopicChip` i katalog obszarów: reguły etykiety mieszkają
//    w `topicCatalog` i w `clubAtomChips.test.tsx`; tutaj dowodzimy, że pasek
//    podaje chipowi katalog z `useClubTopics` i język interfejsu.
//  - POLITYKI `pickLocalized` (żądany język -> drugi -> ""): ma własny zakres.
//  - AUTORYTETU: `can_moderate`, `can_post_thread` i `reason` pochodzą
//    z SECURITY DEFINER RPC i mają pgTAP. Pasek je czyta, nie liczy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  /** Propsy, z jakimi pasek wpiął edytor okładki. */
  cover: null as { clubId: string; hasCover: boolean } | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [{ key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 1 }],
    isLoading: false,
  }),
}));

// Edytor okładki wysyła pliki do magazynu - w tym pliku liczy się WYŁĄCZNIE
// to, czy pasek go w ogóle pokazuje i co robi z jego zgłoszeniem zmiany.
vi.mock("@/components/clubs/molecules/ClubCoverEditor", () => ({
  ClubCoverEditor: (props: { clubId: string; hasCover: boolean; onChanged: () => void }) => {
    h.cover = { clubId: props.clubId, hasCover: props.hasCover };
    return (
      <button type="button" data-testid="cover-editor" onClick={props.onChanged}>
        cover
      </button>
    );
  },
}));

import { ClubHubIdentity } from "@/components/clubs/molecules/ClubHubIdentity";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { clubViewRow } from "@/test/clubs/fixtures";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { formatNumber } from "@/lib/i18n/format";
import type { ClubViewRow } from "@/lib/clubs/types";

const LOCALE = "pl-PL";

function mount(overrides: Partial<ClubViewRow> = {}) {
  return renderWithQueryClient(<ClubHubIdentity club={clubViewRow(overrides)} locale={LOCALE} />);
}

/**
 * Monogram czyta się ze STRUKTURY, nie po napisie: dla klubu o nazwie „X”
 * monogram i nagłówek mają identyczną treść, więc `getByText` trafiałby
 * w dwa węzły. Monogram jest jedynym blokiem oznaczonym jako dekoracja,
 * który niesie w środku ikonę - i to jest jego stabilna cecha.
 */
function monogramText(container: HTMLElement): string {
  const badge = Array.from(container.querySelectorAll("div[aria-hidden='true']")).find(
    (node) => node.querySelector("svg") !== null,
  );
  return badge?.textContent?.trim() ?? "";
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
  h.cover = null;
});

describe("ClubHubIdentity - monogram klubu", () => {
  it("bierze pierwsze litery dwóch pierwszych słów nazwy", () => {
    const { container } = mount();
    expect(monogramText(container)).toBe("KE");
  });

  it("dla nazwy jednowyrazowej bierze dwie pierwsze litery tego słowa", () => {
    const { container } = mount({ name_pl: "Klub", name_en: "Klub" });
    expect(monogramText(container)).toBe("KL");
  });

  it("dla nazwy jednoliterowej zostaje przy jednej literze", () => {
    const { container } = mount({ name_pl: "X", name_en: "X" });
    expect(monogramText(container)).toBe("X");
  });

  it("dla wiersza bez nazwy w obu językach spada na literę zastępczą", () => {
    const { container } = mount({ name_pl: "", name_en: "" });
    expect(monogramText(container)).toBe("K");
  });

  it("nazwa jedzie w języku interfejsu", () => {
    h.lang = "en-GB";
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Energy club");
  });
});

describe("ClubHubIdentity - pas okładki", () => {
  it("klub ze zdjęciem dostaje obraz opisany jako dekoracja", () => {
    const { container } = mount({ cover_image_url: "https://obrazy.example/okladka.jpg" });
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://obrazy.example/okladka.jpg");
    expect(img).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".club-cover-placeholder")).toBeNull();
  });

  it("klub bez zdjęcia dostaje pas w kolorze akcentu, nie pusty prostokąt", () => {
    const { container } = mount({ cover_image_url: "" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".club-cover-placeholder")).not.toBeNull();
  });

  it("edytor okładki widzi WYŁĄCZNIE moderacja i dostaje stan „ma okładkę”", () => {
    mount({ can_moderate: true, cover_image_url: "https://obrazy.example/okladka.jpg" });
    expect(screen.getByTestId("cover-editor")).toBeInTheDocument();
    expect(h.cover).toEqual({ clubId: "club-1", hasCover: true });
  });

  it("bez `can_moderate` edytora okładki nie ma wcale", () => {
    mount({ can_moderate: false });
    expect(screen.queryByTestId("cover-editor")).toBeNull();
    expect(h.cover).toBeNull();
  });

  it("udana zmiana okładki unieważnia CAŁE gniazdo kluczy klubu", () => {
    const { queryClient } = mount({ can_moderate: true, cover_image_url: "" });
    expect(h.cover).toEqual({ clubId: "club-1", hasCover: false });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByTestId("cover-editor"));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: clubKeys.all });
  });
});

describe("ClubHubIdentity - treść nagłówka", () => {
  it("hasło klubu stoi pod nazwą, gdy jest wypełnione", () => {
    mount();
    expect(screen.getByText("Energia i klimat")).toBeInTheDocument();
  });

  it("puste hasło w obu językach nie zostawia pustego akapitu", () => {
    const { container } = mount({ tagline_pl: "", tagline_en: "" });
    expect(container.querySelector("p")).toBeNull();
  });

  it("hasło z samych białych znaków jest brakiem treści, nie treścią", () => {
    const { container } = mount({ tagline_pl: "   ", tagline_en: "  " });
    expect(container.querySelector("p")).toBeNull();
  });

  it("obszar tematyczny jedzie z katalogu i w języku interfejsu", () => {
    h.lang = "en";
    mount();
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("klub bez obszaru tematycznego nie rysuje chipa", () => {
    mount({ policy_area: "" });
    expect(screen.queryByText("Energia")).toBeNull();
  });

  it("reżim Chatham House stoi przy nazwie, bo zmienia sposób pisania", () => {
    mount({ attribution_mode: "chatham" });
    expect(screen.getByText("club.attribution.chatham")).toBeInTheDocument();
  });

  it("klub z podpisem imiennym nie dostaje plakietki reżimu", () => {
    mount({ attribution_mode: "named" });
    expect(screen.queryByText("club.attribution.chatham")).toBeNull();
  });

  it("liczby jadą przez formatowanie lokalne, nie przez surową zamianę na napis", () => {
    mount({ member_count: 12345, thread_count: 67890 });
    const members = screen.getByText("club.hub.identity.members").parentElement;
    const threads = screen.getByText("club.hub.identity.threads").parentElement;
    expect(members?.textContent).toContain(formatNumber(12345, LOCALE));
    expect(threads?.textContent).toContain(formatNumber(67890, LOCALE));
  });
});

describe("ClubHubIdentity - akcje i powód informacyjny", () => {
  it("„nowy temat” prowadzi do kompozytora TEGO klubu, gdy wolno zakładać temat", () => {
    mount({ can_post_thread: true });
    expect(screen.getByRole("link", { name: /club\.newThread/ })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/new",
    );
  });

  it("bez prawa do tematu zostaje wyłącznie „o klubie”", () => {
    mount({ can_post_thread: false });
    expect(screen.queryByRole("link", { name: /club\.newThread/ })).toBeNull();
    expect(screen.getByRole("link", { name: "club.about" })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/about",
    );
  });

  it("premoderacja jest zapowiedziana PRZED napisaniem wpisu", () => {
    mount({ reason: "pre_moderation" });
    expect(screen.getByText("club.reason.pre_moderation")).toBeInTheDocument();
  });

  it("klub bez powodu informacyjnego nie dokłada paska ostrzeżenia", () => {
    mount({ reason: "" });
    expect(screen.queryByText("club.reason.pre_moderation")).toBeNull();
  });
});
