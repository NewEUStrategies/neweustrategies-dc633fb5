// Dwie powierzchnie WEJŚCIOWE huba klubów: wyszukiwanie ponad klubami
// (`ClubGlobalSearchInput` + `ClubGlobalSearchResults`) i siatka specjalizacji
// (`ClubSpecializationGrid`).
//
// CO TEN PLIK DOWODZI.
// (1) POLE SZUKANIA ODDAJE KAŻDE UDERZENIE W KLAWIATURĘ. Kontrolka jest
//     w pełni sterowana z góry (hub trzyma frazę, debounce i RPC), więc jej
//     jedynym zobowiązaniem jest wołać `onChange` - raz z nową frazą przy
//     pisaniu i raz z pustym ciągiem przy krzyżyku. Krzyżyk NIE MOŻE istnieć
//     przy pustej frazie: przycisk kasujący pustkę to obietnica bez pokrycia,
//     a przy `pointer-coarse` zabiera 44 px celu dotykowego obok pola.
// (2) `placeholderKey` to JEDEN klucz różnicujący dwa konteksty (hub szuka
//     ponad klubami, strona klubu - w klubie) i jedzie ZARAZEM do etykiety
//     dostępnościowej, nie tylko do podpowiedzi. Pole bez `aria-label` jest
//     dla czytnika ekranu polem bez nazwy.
// (3) WYNIKI MAJĄ CZTERY STANY I ŻADNE DWA NIE WYGLĄDAJĄ TAK SAMO: awaria
//     (z ponowieniem), zapytanie w locie, brak trafień Z FRAZĄ w komunikacie
//     oraz trafienia. Kolejność bramek jest tezą: awaria bije stan „w locie”,
//     bo padnięte RPC nie jest ładowaniem, a „brak trafień” nie ma prawa
//     pokazać się w miejscu awarii - to dwie różne informacje dla czytelnika
//     (nagłówek `ClubErrorNotice.tsx`).
// (4) WIERSZ TRAFIENIA MÓWI, DLACZEGO TU JEST. Fragment `ts_headline` idzie
//     jako TEKST po zdjęciu `<b>` (nigdy jako HTML z bazy), a trafienie
//     semantyczne bez fragmentu dostaje własne zdanie zamiast pustego miejsca.
//     Nazwa klubu stoi PRZED tytułem, bo przy szukaniu ponad klubami ona mówi,
//     gdzie czytelnik trafił.
// (5) SIATKA SPECJALIZACJI DZIAŁA BEZ DANYCH. Zapytanie w locie (i awaria -
//     ta sama gałąź `data ?? []`) pokazuje osiem kafli warstwy awaryjnej ze
//     slugami, które są kontraktem publicznym URL-a, a nie pustą sekcję.
//     Z danymi z panelu wygrywają teksty administratora.
// (6) `signedIn` przestawia siatkę w TRZECH miejscach naraz (zajawka sekcji,
//     etykieta akcji, licznik klubów) i ZDEJMUJE blok zgłoszenia - anonim
//     dostaje zaproszenie do aplikowania, członek nie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Reguł budowy widoku specjalizacji (`buildSpecializationViews`,
//     `fallbackSpecializationSources`, kolejność źródeł tekstu) - to czyste
//     funkcje z własnym zakresem w `src/lib/clubs/specializations.ts`.
// (b) Warstwy danych: `useClubSpecializations` jest tu ATRAPĄ, bo dowód
//     kluczy cache i `staleTime` leży w testach hooków katalogu.
// (c) `ClubErrorNotice` (treść i przycisk) oraz `ClubTopicChip` - atomy
//     z własnymi testami. Tutaj dowodzimy WYŁĄCZNIE tego, że wyniki wołają
//     powiadomienie o awarii i przekazują do niego ponowienie.
// (d) Debounce'u, scalania warstw wyszukiwania i samego RPC - to `clubSemantic`
//     i trasy huba; ten plik dostaje trafienia propsem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ClubSpecializationRow } from "@/lib/clubs/specializationsApi";
import type { ClubSearchResult } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  /** `undefined` = zapytanie w locie ALBO awaria - komponent widzi jedno i to samo. */
  rows: undefined as ClubSpecializationRow[] | undefined,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/clubs/useClubSpecializations", () => ({
  useClubSpecializations: () => ({ data: h.rows }),
}));

import {
  ClubGlobalSearchInput,
  ClubGlobalSearchResults,
} from "@/components/clubs/organisms/ClubGlobalSearch";
import { ClubSpecializationGrid } from "@/components/clubs/organisms/ClubSpecializationGrid";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";

/** Trafienie wyszukiwania - kształt 1:1 z `ClubSearchResult`, bez rzutowań. */
function searchHit(overrides: Partial<ClubSearchResult> = {}): ClubSearchResult {
  return {
    thread_id: CLUB_IDS.thread,
    thread_slug: "temat-pierwszy",
    title: "Rewizja taryf przesyłowych",
    kind: "discussion",
    club_id: CLUB_IDS.club,
    club_slug: "klub-energetyczny",
    club_name_pl: "Klub energetyczny",
    club_name_en: "Energy club",
    reply_count: 4,
    last_reply_at: CLUB_BASE_ISO,
    snippet: "fragment z <b>taryfą</b> w środku",
    match: "text",
    ...overrides,
  };
}

/** Wiersz specjalizacji z panelu - `club_specializations_public`. */
function specRow(overrides: Partial<ClubSpecializationRow> = {}): ClubSpecializationRow {
  return {
    slug: "energy",
    key: "energy",
    label_pl: "Energetyka i klimat",
    label_en: "Energy and climate",
    lead_pl: "Rynek mocy, taryfy, transformacja",
    lead_en: "Capacity market",
    desc_pl: "Opis",
    desc_en: "Description",
    icon: "Zap",
    sort_order: 10,
    club_count: 4,
    ...overrides,
  };
}

beforeEach(() => {
  h.rows = undefined;
  cleanup();
});

describe("ClubGlobalSearchInput", () => {
  it("przy pustej frazie nie pokazuje krzyżyka i nazywa pole domyślnym kluczem", () => {
    render(<ClubGlobalSearchInput value="" onChange={() => undefined} />);

    const field = screen.getByLabelText("club.hub.searchPlaceholder");
    expect(field.getAttribute("placeholder")).toBe("club.hub.searchPlaceholder");
    expect(screen.queryByRole("button", { name: "club.searchClear" })).toBeNull();
  });

  it("oddaje wpisaną frazę do `onChange`", () => {
    const onChange = vi.fn();
    render(<ClubGlobalSearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("club.hub.searchPlaceholder"), {
      target: { value: "taryfy" },
    });

    expect(onChange).toHaveBeenCalledWith("taryfy");
  });

  it("krzyżyk pojawia się dopiero z frazą i kasuje ją pustym ciągiem", () => {
    const onChange = vi.fn();
    render(<ClubGlobalSearchInput value="taryfy" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "club.searchClear" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("`placeholderKey` przestawia ZARAZEM podpowiedź i etykietę dostępnościową", () => {
    render(
      <ClubGlobalSearchInput
        value=""
        onChange={() => undefined}
        placeholderKey="club.searchPlaceholder"
      />,
    );

    const field = screen.getByLabelText("club.searchPlaceholder");
    expect(field.getAttribute("placeholder")).toBe("club.searchPlaceholder");
  });
});

describe("ClubGlobalSearchResults", () => {
  it("awaria wygrywa nad stanem `w locie` i podaje dalej ponowienie", () => {
    const onRetry = vi.fn();
    render(<ClubGlobalSearchResults hits={[]} pending failed query="taryfy" onRetry={onRetry} />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("club.searchEmpty(query=taryfy)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /club.error.retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("zapytanie w locie rysuje szkielet opisany jako zajęty, bez komunikatu o pustce", () => {
    const { container } = render(<ClubGlobalSearchResults hits={[]} pending query="taryfy" />);

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.children.length).toBe(3);
    expect(screen.queryByText("club.searchEmpty(query=taryfy)")).toBeNull();
  });

  it("brak trafień niesie FRAZĘ w komunikacie", () => {
    render(<ClubGlobalSearchResults hits={[]} pending={false} failed={false} query="taryfy" />);

    expect(screen.getByText("club.searchEmpty(query=taryfy)")).toBeTruthy();
  });

  it("trafienie pełnotekstowe: klub przed tytułem, fragment BEZ znaczników, data odpowiedzi", () => {
    render(<ClubGlobalSearchResults hits={[searchHit()]} pending={false} query="taryfy" />);

    expect(screen.getByText("club.hub.searchCount(count=1)")).toBeTruthy();
    expect(screen.getByText("Klub energetyczny")).toBeTruthy();
    expect(screen.getByText("club.kind.discussion")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rewizja taryf przesyłowych" })).toBeTruthy();
    expect(screen.getByText("fragment z taryfą w środku")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/club/klub-energetyczny/t/temat-pierwszy");
  });

  it("trafienie semantyczne bez fragmentu tłumaczy się osobnym zdaniem", () => {
    render(
      <ClubGlobalSearchResults
        hits={[searchHit({ snippet: null, match: "semantic", last_reply_at: null })]}
        pending={false}
        query="taryfy"
      />,
    );

    expect(screen.getByText("club.searchSemanticHit")).toBeTruthy();
    // Bez ostatniej odpowiedzi nie ma czego datować - zostaje sam licznik.
    expect(screen.queryByText(/2026/)).toBeNull();
  });

  it("pusty fragment przy trafieniu pełnotekstowym nie zostawia ani zdania, ani pustego akapitu", () => {
    render(
      <ClubGlobalSearchResults
        hits={[
          searchHit({ snippet: "" }),
          searchHit({
            thread_id: "thread-2",
            thread_slug: "temat-drugi",
            title: "Drugi wątek",
            last_reply_at: clubIsoOffset(90),
          }),
        ]}
        pending={false}
        query="taryfy"
      />,
    );

    expect(screen.getByText("club.hub.searchCount(count=2)")).toBeTruthy();
    expect(screen.queryByText("club.searchSemanticHit")).toBeNull();
    expect(screen.getAllByRole("link").length).toBe(2);
  });
});

describe("ClubSpecializationGrid", () => {
  it("bez danych (zapytanie w locie albo awaria) pokazuje osiem kafli warstwy awaryjnej", () => {
    render(<ClubSpecializationGrid />);

    const links = screen.getAllByRole("link");
    // Osiem kafli specjalizacji + przycisk zgłoszenia dla anonima.
    expect(links.length).toBe(9);
    expect(links[0]?.getAttribute("href")).toBe("/club/specialization/defence-geopolitics");
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("08")).toBeTruthy();
  });

  it("anonim widzi zajawkę sprzedażową, etykietę `explore` i zaproszenie do zgłoszenia", () => {
    render(<ClubSpecializationGrid signedIn={false} />);

    expect(screen.getByText("club.spec.sectionLead")).toBeTruthy();
    expect(screen.getAllByText("club.spec.explore").length).toBe(8);
    expect(screen.getByText("club.spec.applyCta")).toBeTruthy();
    expect(screen.getByText("club.spec.applyLead")).toBeTruthy();
    expect(screen.queryByText(/club.spec.clubCount/)).toBeNull();
  });

  it("zalogowany widzi liczniki klubów, etykietę przeglądania i NIE widzi bloku zgłoszenia", () => {
    h.rows = [
      specRow(),
      specRow({
        slug: "transport",
        key: "transport",
        label_pl: "Transport",
        lead_pl: "Korytarze, kolej, porty",
        club_count: 0,
      }),
    ];

    render(<ClubSpecializationGrid signedIn />);

    expect(screen.getByText("club.spec.sectionLeadMember")).toBeTruthy();
    expect(screen.getByText("Energetyka i klimat")).toBeTruthy();
    expect(screen.getByText("Rynek mocy, taryfy, transformacja")).toBeTruthy();
    expect(screen.getByText("club.spec.clubCount(count=4)")).toBeTruthy();
    expect(screen.getByText("club.spec.clubCount(count=0)")).toBeTruthy();
    expect(screen.getAllByText("club.spec.browseClubs").length).toBe(2);
    expect(screen.queryByText("club.spec.applyCta")).toBeNull();
    // Dane z panelu ZASTĘPUJĄ warstwę awaryjną, a nie dokładają się do niej.
    expect(screen.getAllByRole("link").length).toBe(2);
  });
});
