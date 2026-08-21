// Biblioteka klubu (`ClubDocumentLibrary`) - wspólny zestaw źródeł dyskusji.
//
// CO TEN PLIK DOWODZI.
//
//   1. ZAKRES I RODZAJ TO DWA RÓŻNE PYTANIA. Zakres wybiera, o który ZBIÓR
//      chodzi (co klub wytworzył / z czego pracuje), rodzaj zawęża jeden zbiór.
//      Dlatego zmiana zakresu ZERUJE rodzaj i stronę, a pasek chipów pokazuje
//      wyłącznie rodzaje należące do zakresu - rodzaj spoza zakresu zwróciłby
//      pustkę, czyli obietnicę bez pokrycia.
//   2. PUSTY ZAKRES TO INNA INFORMACJA NIŻ PUSTY FILTR. Klub bez produktów ma
//      przeczytać, że nic jeszcze nie wytworzył, a nie że „nic nie pasuje do
//      zawężenia”; klub bez żadnych dokumentów - trzecią rzecz.
//   3. FRAZA KRÓTSZA NIŻ DWA ZNAKI NIE ZAWĘŻA NICZEGO: nie jedzie do RPC i nie
//      zmienia komunikatu pustki. Zawężanie jest opóźnione (debounce), więc test
//      czeka na wynik, a nie na naciśnięcie klawisza.
//   4. PLIK POBIERAMY, LINK OTWIERAMY - i to nie jest kosmetyka: `download`
//      na obcej domenie zostanie zignorowany, a `target="_blank"` na własnym
//      pliku otwiera pustą kartę. Dokument bez pliku i bez linku nie ma być
//      linkiem donikąd.
//   5. ROZMIAR PLIKU JEST CZYTANY BEZ LICZENIA ZER (B / kB / MB / GB), a
//      wartość bezsensowna (brak, zero, nieskończoność) nie rysuje rubryki.
//   6. STRONICOWANIE JEST OFFSETOWE i pilnuje krawędzi: pierwsza strona nie ma
//      „wstecz”, ostatnia nie ma „dalej”, a każdy filtr wraca na stronę pierwszą.
//   7. ODZNAKI POKAZUJEMY TYLKO PRZY ODSTĘPSTWIE OD NORMY - „opublikowany”
//      przy każdym wierszu nie niesie informacji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ z `workspaceTypes`: `documentHref`, `toDocumentKind/Status/Visibility`
//   i słowników `CLUB_*_KINDS` (mają własne tabele przypadków). Tutaj dowodzimy,
//   że organizm je WOŁA i respektuje wynik.
// - ATOMÓW `ClubSegmented`, `ClubDocumentKindChip`, `ClubDocumentKindIcon`
//   i skeletonu biblioteki - zakres w testach atomów.
// - WARSTWY DANYCH: kluczy cache'u i progu frazy w `useClubDocuments`.
// - MOLEKUŁY `ClubDocumentForm` - biblioteka w tym widoku nie edytuje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { workspaceApiMock, resetWorkspaceApiMock } from "@/test/clubs/workspaceApiMock";
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";
import { clubDocumentRow } from "@/test/clubs/hubFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  CLUB_DOCUMENT_KINDS,
  CLUB_PRODUCT_KINDS,
  CLUB_SOURCE_KINDS,
  type ClubDocumentRow,
} from "@/lib/clubs/workspaceTypes";
import type { ClubDocumentsQuery } from "@/lib/clubs/workspaceApi";
import { ClubDocumentLibrary } from "@/components/clubs/organisms/ClubDocumentLibrary";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/clubs/workspaceApi", () => workspaceApiMock);

const SLUG = "klub-energetyczny";

function strona(
  rows: ClubDocumentRow[],
  total = rows.length,
): { rows: ClubDocumentRow[]; total: number } {
  return { rows, total };
}

/** Parametry, z jakimi biblioteka ostatnio odpytała RPC. */
function ostatnieZapytanie(): ClubDocumentsQuery {
  const wywolania = workspaceApiMock.fetchClubDocuments.mock.calls;
  const ostatnie: ClubDocumentsQuery = wywolania[wywolania.length - 1]?.[0];
  return ostatnie;
}

/**
 * Odpowiedź, która OPISUJE swoje zapytanie w tytule wiersza. Powrót do filtru
 * użytego wcześniej idzie z cache'u, więc licznik wywołań RPC już nic nie
 * powie - a widoczny wiersz nadal mówi, KTÓRY zestaw parametrów rysuje ekran.
 */
function odpowiadajOpisemFiltru(total = 65): void {
  workspaceApiMock.fetchClubDocuments.mockImplementation((params: ClubDocumentsQuery) => {
    const opis = `kind=${params.kind ?? "brak"} offset=${params.offset ?? 0} search=${
      params.search ?? "brak"
    }`;
    return Promise.resolve(strona([clubDocumentRow({ id: `d-${opis}`, title_pl: opis })], total));
  });
}

/**
 * happy-dom wykonuje domyślną akcję kliknięcia w `<a href>` - czyli REALNE
 * żądanie sieciowe do adresu z fixture'u. Test jednostkowy nie ma prawa
 * wychodzić do sieci, a nieudane połączenie wraca po zakończeniu testu jako
 * błąd bez właściciela. Blokujemy samą nawigację, nie zdarzenie: `preventDefault`
 * nie zatrzymuje propagacji, więc handler Reacta nadal się wykonuje.
 */
function zablokujNawigacje(event: Event): void {
  event.preventDefault();
}

beforeEach(() => {
  document.addEventListener("click", zablokujNawigacje);
  resetWorkspaceApiMock();
  workspaceApiMock.fetchClubDocuments.mockResolvedValue(strona([]));
  workspaceApiMock.registerClubDocumentDownload.mockResolvedValue(undefined);
});

afterEach(() => {
  document.removeEventListener("click", zablokujNawigacje);
  cleanup();
});

describe("ClubDocumentLibrary - stany zapytania", () => {
  it("zapytanie w locie pokazuje skeleton listy, a licznik stoi na zerze", () => {
    workspaceApiMock.fetchClubDocuments.mockReturnValue(new Promise<never>(() => undefined));
    const { container } = renderWithQueryClient(
      <ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("club.docs.count(count=0)")).toBeInTheDocument();
    expect(screen.queryByText("club.docs.empty")).toBeNull();
  });

  it("awaria odczytu pokazuje komunikat błędu, a ponowienie strzela zapytaniem jeszcze raz", async () => {
    workspaceApiMock.fetchClubDocuments.mockRejectedValue(new Error("rpc padlo"));
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    const przed = workspaceApiMock.fetchClubDocuments.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubDocuments.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("pusta biblioteka bez filtrów mówi „pusto”, a nie „nic nie pasuje”", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());
    expect(screen.queryAllByTestId("club-document-row")).toHaveLength(0);
  });
});

describe("ClubDocumentLibrary - zakres i rodzaj", () => {
  it("otwiera się na WSZYSTKIM: bez zawężenia rodzajów i od pierwszej strony", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalled());
    expect(ostatnieZapytanie()).toEqual({
      clubId: CLUB_IDS.club,
      groupId: null,
      kind: null,
      kinds: null,
      search: null,
      offset: 0,
      limit: 30,
    });
    expect(screen.queryByText("club.docs.scope.productsHint")).toBeNull();
  });

  it("zakres „dorobek” pyta o zbiór produktów i dokłada podpowiedź", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.products" }));

    await waitFor(() => expect(ostatnieZapytanie().kinds).toEqual([...CLUB_PRODUCT_KINDS]));
    expect(screen.getByText("club.docs.scope.productsHint")).toBeInTheDocument();
  });

  it("zakres „źródła” pyta o zbiór materiałów wejściowych i ma własną podpowiedź", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.sources" }));

    await waitFor(() => expect(ostatnieZapytanie().kinds).toEqual([...CLUB_SOURCE_KINDS]));
    expect(screen.getByText("club.docs.scope.sourcesHint")).toBeInTheDocument();
  });

  it("pasek chipów pokazuje rodzaje NALEŻĄCE do zakresu, a nie cały słownik", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    expect(screen.getAllByRole("button", { name: /^club\.docs\.kind\./ })).toHaveLength(
      CLUB_DOCUMENT_KINDS.length,
    );

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.products" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^club\.docs\.kind\./ })).toHaveLength(
        CLUB_PRODUCT_KINDS.length,
      ),
    );
    expect(screen.getByText("club.docs.kind.discussion_note")).toBeInTheDocument();
    expect(screen.queryByText("club.docs.kind.brief")).toBeNull();
  });

  it("chip rodzaju zawęża, a ponowne kliknięcie tego samego chipu zawężenie zdejmuje", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await screen.findByRole("heading", { name: /kind=brak/ });

    const chip = screen.getByRole("button", { name: "club.docs.kind.analysis" });
    fireEvent.click(chip);
    expect(await screen.findByRole("heading", { name: /kind=analysis/ })).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip);
    expect(await screen.findByRole("heading", { name: /kind=brak/ })).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "club.docs.kindAll" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("chip „wszystkie rodzaje” zdejmuje zawężenie ustawione innym chipem", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await screen.findByRole("heading", { name: /kind=brak/ });

    fireEvent.click(screen.getByRole("button", { name: "club.docs.kind.dataset" }));
    expect(await screen.findByRole("heading", { name: /kind=dataset/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.docs.kindAll" }));
    expect(await screen.findByRole("heading", { name: /kind=brak/ })).toBeInTheDocument();
  });

  it("zmiana zakresu ZERUJE wybrany rodzaj - rodzaj spoza zakresu zwróciłby pustkę", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "club.docs.kind.brief" }));
    await waitFor(() => expect(ostatnieZapytanie().kind).toBe("brief"));

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.products" }));
    await waitFor(() => expect(ostatnieZapytanie().kind).toBeNull());
    expect(ostatnieZapytanie().kinds).toEqual([...CLUB_PRODUCT_KINDS]);
  });
});

describe("ClubDocumentLibrary - komunikat pustki", () => {
  it("pusty ZAKRES „dorobek” mówi, że klub nic nie wytworzył", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.products" }));
    await waitFor(() =>
      expect(screen.getByText("club.docs.scope.emptyProducts")).toBeInTheDocument(),
    );
  });

  it("pusty ZAKRES „źródła” ma własny komunikat", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.sources" }));
    await waitFor(() =>
      expect(screen.getByText("club.docs.scope.emptySources")).toBeInTheDocument(),
    );
  });

  it("pusty wynik zawężenia rodzajem mówi „nic nie pasuje”, także wewnątrz zakresu", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "club.docs.scope.products" }));
    await waitFor(() =>
      expect(screen.getByText("club.docs.scope.emptyProducts")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.docs.kind.memo" }));
    await waitFor(() => expect(screen.getByText("club.docs.emptyFiltered")).toBeInTheDocument());
  });
});

describe("ClubDocumentLibrary - wyszukiwanie", () => {
  it("fraza krótsza niż dwa znaki nie jedzie do RPC i nie zmienia komunikatu pustki", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("club.docs.searchPlaceholder"), {
      target: { value: "a" },
    });

    await waitFor(() => expect(ostatnieZapytanie().search).toBeNull());
    expect(screen.getByText("club.docs.empty")).toBeInTheDocument();
  });

  it("fraza od dwóch znaków jedzie do RPC po uspokojeniu pisania i zmienia komunikat pustki", async () => {
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.docs.empty")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("club.docs.searchPlaceholder"), {
      target: { value: "  raport  " },
    });

    await waitFor(() => expect(ostatnieZapytanie().search).toBe("raport"));
    expect(screen.getByText("club.docs.emptyFiltered")).toBeInTheDocument();
  });

  it("krzyżyk czyści frazę i wraca do pełnej listy", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await screen.findByRole("heading", { name: /search=brak/ });

    const pole = screen.getByLabelText("club.docs.searchPlaceholder");
    // Krzyżyk pojawia się dopiero, gdy jest co czyścić.
    expect(screen.queryByLabelText("club.searchClear")).toBeNull();

    fireEvent.change(pole, { target: { value: "raport" } });
    expect(await screen.findByRole("heading", { name: /search=raport/ })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("club.searchClear"));
    expect(await screen.findByRole("heading", { name: /search=brak/ })).toBeInTheDocument();
    expect(pole).toHaveValue("");
  });
});

describe("ClubDocumentLibrary - stronicowanie", () => {
  const wiersze = Array.from({ length: 30 }, (_, i) =>
    clubDocumentRow({ id: `d-${i}`, slug: `dok-${i}`, title_pl: `Dokument ${i}` }),
  );

  it("biblioteka mieszcząca się na jednej stronie nie rysuje sterowania", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(strona(wiersze.slice(0, 5), 5));
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(5));
    expect(screen.queryByText("club.docs.nextPage")).toBeNull();
    expect(screen.getByText("club.docs.count(count=5)")).toBeInTheDocument();
  });

  it("pierwsza strona nie ma „wstecz”, a „dalej” przesuwa offset o pełną stronę", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await screen.findByRole("heading", { name: /offset=0/ });
    expect(screen.getByRole("button", { name: "club.docs.prevPage" })).toBeDisabled();
    expect(screen.getByText("club.docs.pageOf(page=1,pages=3)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.docs.nextPage" }));
    expect(await screen.findByRole("heading", { name: /offset=30/ })).toBeInTheDocument();
    expect(screen.getByText("club.docs.pageOf(page=2,pages=3)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.docs.prevPage" }));
    expect(await screen.findByRole("heading", { name: /offset=0/ })).toBeInTheDocument();
  });

  it("ostatnia strona nie ma „dalej”", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(strona(wiersze, 45));
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(30));
    fireEvent.click(screen.getByRole("button", { name: "club.docs.nextPage" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "club.docs.nextPage" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "club.docs.prevPage" })).toBeEnabled();
  });

  it("zawężenie po przejściu na dalszą stronę wraca na stronę pierwszą", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await screen.findByRole("heading", { name: /offset=0/ });
    fireEvent.click(screen.getByRole("button", { name: "club.docs.nextPage" }));
    await screen.findByRole("heading", { name: /offset=30/ });

    fireEvent.click(screen.getByRole("button", { name: "club.docs.kind.brief" }));
    expect(await screen.findByRole("heading", { name: /kind=brief offset=0/ })).toBeInTheDocument();
  });

  it("wyczyszczenie frazy krzyżykiem też wraca na stronę pierwszą", async () => {
    odpowiadajOpisemFiltru();
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await screen.findByRole("heading", { name: /offset=0/ });
    fireEvent.click(screen.getByRole("button", { name: "club.docs.nextPage" }));
    await screen.findByRole("heading", { name: /offset=30/ });

    fireEvent.change(screen.getByLabelText("club.docs.searchPlaceholder"), {
      target: { value: "raport" },
    });
    expect(
      await screen.findByRole("heading", { name: /offset=0 search=raport/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.docs.nextPage" }));
    await screen.findByRole("heading", { name: /offset=30 search=raport/ });

    fireEvent.click(screen.getByLabelText("club.searchClear"));
    expect(
      await screen.findByRole("heading", { name: /offset=0 search=brak/ }),
    ).toBeInTheDocument();
  });
});

describe("ClubDocumentLibrary - wiersz dokumentu", () => {
  it("dane PEŁNE: przypięcie, widoczność dla moderatorów, szkic, wersja, źródło, autor i wątek", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-pelny",
          title_pl: "Raport energetyczny",
          summary_pl: "Streszczenie raportu.",
          pinned_at: CLUB_BASE_ISO,
          visibility: "moderators",
          status: "draft",
          version: "2.1",
          source_label: "Komisja Europejska",
          uploader_name: "Anna Nowak",
          thread_slug: "temat-pierwszy",
          file_size: 2048,
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(1));
    expect(screen.getByText("club.docs.pinned")).toBeInTheDocument();
    expect(screen.getByText("club.docs.visibility.moderators")).toBeInTheDocument();
    expect(screen.getByText("club.docs.status.draft")).toBeInTheDocument();
    expect(screen.getByText("Streszczenie raportu.")).toBeInTheDocument();
    expect(screen.getByText("club.docs.version(value=2.1)")).toBeInTheDocument();
    expect(screen.getByText("club.docs.source(value=Komisja Europejska)")).toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("2 kB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /club.docs.linkedThread/ })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/t/temat-pierwszy",
    );
  });

  it("dane CZĘŚCIOWE: dokument opublikowany, bez przypięcia, streszczenia, wersji, źródła i autora nie rysuje pustych rubryk", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-chudy",
          title_pl: "Notatka",
          summary_pl: "   ",
          summary_en: "   ",
          pinned_at: null,
          visibility: "club",
          status: "published",
          version: "   ",
          source_label: "   ",
          uploader_name: null,
          thread_slug: null,
          file_size: null,
          published_at: null,
          created_at: CLUB_BASE_ISO,
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(1));
    expect(screen.queryByText("club.docs.pinned")).toBeNull();
    expect(screen.queryByText("club.docs.visibility.moderators")).toBeNull();
    expect(screen.queryByText("club.docs.status.published")).toBeNull();
    expect(screen.queryByText(/club.docs.version/)).toBeNull();
    expect(screen.queryByText(/club.docs.source\(/)).toBeNull();
    expect(screen.queryByText("club.docs.linkedThread")).toBeNull();
    // Brak daty publikacji spada na datę utworzenia - wiersz nigdy nie jest bez daty.
    expect(screen.getByText("18.08.2026")).toBeInTheDocument();
  });

  it("PLIK pobieramy: tytuł i przycisk mają `download`, nie otwierają nowej karty, a klik meldujemy", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-plik",
          title_pl: "Raport PDF",
          file_url: "https://pliki.example/raport.pdf",
          external_url: "https://zewnetrzny.example/strona",
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const tytul = await waitFor(() => screen.getByRole("link", { name: "Raport PDF" }));
    // Plik BIJE link zewnętrzny - dokument ma dokładnie jedno źródło treści.
    expect(tytul).toHaveAttribute("href", "https://pliki.example/raport.pdf");
    expect(tytul).toHaveAttribute("download", "");
    expect(tytul).not.toHaveAttribute("target");
    expect(screen.getByText("club.docs.download")).toBeInTheDocument();

    fireEvent.click(tytul);
    expect(workspaceApiMock.registerClubDocumentDownload).toHaveBeenCalledWith("d-plik");
  });

  it("LINK otwieramy w nowej karcie i bez `download`, a klik też meldujemy", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-link",
          title_pl: "Strona konsultacji",
          file_url: null,
          external_url: "https://zewnetrzny.example/strona",
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const przycisk = await waitFor(() => screen.getByRole("link", { name: /club.docs.open/ }));
    expect(przycisk).toHaveAttribute("target", "_blank");
    expect(przycisk).toHaveAttribute("rel", "noreferrer");
    expect(przycisk).not.toHaveAttribute("download");

    fireEvent.click(przycisk);
    expect(workspaceApiMock.registerClubDocumentDownload).toHaveBeenCalledWith("d-link");
  });

  it("dokument bez pliku i bez linku nie jest linkiem donikąd", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-bez-zrodla",
          title_pl: "Ustalenie ustne",
          file_url: "   ",
          external_url: "   ",
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ustalenie ustne" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Ustalenie ustne" })).toBeNull();
    expect(screen.queryByText("club.docs.download")).toBeNull();
    expect(screen.queryByText("club.docs.open")).toBeNull();
  });

  it("rozmiar pliku schodzi do jednostki, którą człowiek czyta bez liczenia zer", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({ id: "d-b", slug: "b", title_pl: "Bajty", file_size: 512 }),
        clubDocumentRow({ id: "d-kb", slug: "kb", title_pl: "Kilobajty", file_size: 4096 }),
        clubDocumentRow({ id: "d-mb", slug: "mb", title_pl: "Megabajty", file_size: 1_500_000 }),
        clubDocumentRow({
          id: "d-gb",
          slug: "gb",
          title_pl: "Gigabajty",
          file_size: 5 * 1024 ** 3,
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(4));
    expect(screen.getByText("512 B")).toBeInTheDocument();
    expect(screen.getByText("4 kB")).toBeInTheDocument();
    expect(screen.getByText("1,4 MB")).toBeInTheDocument();
    expect(screen.getByText("5 GB")).toBeInTheDocument();
  });

  it("rozmiar bezsensowny - zero, wartość ujemna i nieskończoność - nie rysuje rubryki", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({ id: "d-zero", slug: "zero", title_pl: "Zero", file_size: 0 }),
        clubDocumentRow({ id: "d-ujemny", slug: "ujemny", title_pl: "Ujemny", file_size: -1 }),
        clubDocumentRow({
          id: "d-nieskonczony",
          slug: "nieskonczony",
          title_pl: "Nieskończony",
          file_size: Number.POSITIVE_INFINITY,
        }),
      ]),
    );
    const { container } = renderWithQueryClient(
      <ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(3));
    expect(container.textContent).not.toContain(" B");
    expect(container.textContent).not.toContain("kB");
    expect(container.textContent).not.toContain("Infinity");
  });

  it("rodzaj nieznany słownikowi ląduje w bezpiecznej gałęzi, a nie w pustym chipie", async () => {
    workspaceApiMock.fetchClubDocuments.mockResolvedValue(
      strona([
        clubDocumentRow({
          id: "d-nowy-rodzaj",
          title_pl: "Materiał z nowej migracji",
          kind: "rodzaj-z-przyszlosci",
          status: "stan-z-przyszlosci",
          visibility: "widocznosc-z-przyszlosci",
        }),
      ]),
    );
    renderWithQueryClient(<ClubDocumentLibrary clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-document-row")).toHaveLength(1));
    const wiersz = within(screen.getByTestId("club-document-row"));
    expect(wiersz.getByText("club.docs.kind.other")).toBeInTheDocument();
    expect(wiersz.queryByText(/club.docs.status\./)).toBeNull();
    expect(wiersz.queryByText("club.docs.visibility.moderators")).toBeNull();
  });
});
