// Dwa organizmy KONTEKSTOWE: „Eksperci tego wątku” (`ClubThreadExpertsPanel`)
// i szew międzymodułowy „o tym rozmawiają w klubach” (`ClubAnchorThreads`).
//
// CO TEN PLIK DOWODZI. Oba mają tę samą, nietypową regułę naczelną: MILCZĄ,
// gdy nie mają nic do powiedzenia - i to jest reguła BEZPIECZEŃSTWA, nie
// kosmetyka.
//
//   1. CISZA PRZY BRAKU DANYCH, PRZY BŁĘDZIE I PRZY PUSTCE. Nagłówek
//      „Eksperci” nad pustką sugerowałby, że w klubie nie ma nikogo, kto się
//      na tym zna - a to zwykle nieprawda, tylko nikt tego nie zadeklarował.
//      Sekcja „Dyskusje w klubach: brak” na stronie każdego aktu prawnego
//      mówiłaby czytelnikowi BEZ DOSTĘPU, że kluby istnieją i coś się w nich
//      dzieje - a przy klubie `secret` byłaby dokładnie tym wyciekiem, którego
//      reszta warstwy pilnuje. Pusty wynik i brak dostępu muszą wyglądać
//      identycznie.
//   2. PANEL KONTEKSTOWY NIE KRZYCZY O WŁASNEJ AWARII nad dyskusją, po którą
//      czytelnik przyszedł - dlatego błąd RPC też daje ciszę, a nie komunikat.
//   3. OBECNOŚĆ W WĄTKU JEST INFORMACJĄ, NIE WYRÓŻNIENIEM: mówi „tej osoby nie
//      trzeba prosić, ona już tu jest” - i dlatego zdejmuje przycisk prośby.
//   4. „POPROŚ O ZDANIE” JEST JEDNORAZOWE. Baza deduplikuje prośbę po trójce
//      (wątek, adresat, pytający), więc druga prośba NIE jest błędem - wraca
//      jako „nic się nie stało” i nie ma prawa pokazać komunikatu sukcesu.
//   5. PROSIĆ MOŻE TEN, KTO SAM MOŻE SIĘ W WĄTKU ODEZWAĆ - bez tego prawa
//      całego bloku akcji nie ma.
//   6. KOTWICA NIE ZNA MODELU KLUBÓW: podaje typ i identyfikator, dostaje
//      listę. Bez identyfikatora nie pyta bazy wcale.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU WIDOCZNOŚCI: `club_thread_experts` i `club_threads_for_anchor`
//   liczą `club_capabilities` per wiersz w SECURITY DEFINER RPC i mają pgTAP.
//   Te komponenty niczego nie sprawdzają i nie próbują - i właśnie tego tu
//   dowodzimy.
// - `topicLabel` i katalogu obszarów: mają własny zakres (`topicCatalog`).
//   Atrapa `useClubTopics` oddaje jeden wpis, żeby asercja mogła pokazać, że
//   panel podaje temat DO tłumaczenia, a nie wypisuje surowy klucz.
// - `MessageOrConnectButton`: organizm sieci z własnym zakresem; tutaj jest
//   atrapą, bo przedmiotem dowodu jest to, KOMU panel go pokazuje.
// - KLUCZY CACHE'U i zakresu unieważnień: `clubWorkspaceHooks.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toasts: [] as { level: "success" | "error"; key: string }[],
  /** Język widziany przez atrapę `useTranslation`. */
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ level: "success", key }),
    error: (key: string) => h.toasts.push({ level: "error", key }),
  },
}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/clubs/networkApi", () => networkApiMock);
vi.mock("@/lib/clubs/api", () => clubApiMock);
vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [{ key: "energy", label_pl: "Energia i klimat", label_en: "Energy and climate" }],
    isLoading: false,
  }),
}));
vi.mock("@/components/network/MessageOrConnectButton", () => ({
  MessageOrConnectButton: ({ userId }: { userId: string }) => (
    <div data-testid={`kontakt-${userId}`} />
  ),
}));

// KOLEJNOŚĆ IMPORTÓW JEST ZNACZĄCA - patrz `clubThreadPanels.test.tsx`.
import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import { clubAnchorHit, threadExpertRow } from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubAnchorThreads } from "@/components/clubs/organisms/ClubAnchorThreads";
import { ClubThreadExpertsPanel } from "@/components/clubs/organisms/ClubThreadExpertsPanel";

const THREAD = "thread-1";

const wLocie = () => new Promise<never>(() => {});
const odmowa = () => Promise.reject(new Error("clubs: forbidden"));

beforeEach(() => {
  resetClubApiMock();
  resetNetworkApiMock();
  h.toasts = [];
  h.lang = "pl";
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Eksperci wątku
// ---------------------------------------------------------------------------

describe("ClubThreadExpertsPanel", () => {
  const renderPanel = (canAsk = true) =>
    renderWithQueryClient(
      <ClubThreadExpertsPanel threadId={THREAD} canAsk={canAsk} className="mt-4" />,
    );

  it("zapytanie w locie NIE rysuje nagłówka - panel kontekstowy nie mruga", () => {
    networkApiMock.fetchClubThreadExperts.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container).toBeEmptyDOMElement();
  });

  it("awaria RPC daje ciszę, a nie komunikat nad dyskusją", async () => {
    networkApiMock.fetchClubThreadExperts.mockImplementation(odmowa);

    const { container } = renderPanel();

    await waitFor(() => expect(networkApiMock.fetchClubThreadExperts).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("club.network.experts.title")).toBeNull();
  });

  it("zero wierszy daje ciszę - „nikt się na tym nie zna” byłoby nieprawdą", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([]);

    const { container } = renderPanel();

    await waitFor(() => expect(networkApiMock.fetchClubThreadExperts).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("obszar wątku jedzie do tłumaczenia, a nie na ekran jako klucz", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);

    renderPanel();

    expect(await screen.findByText("club.network.experts.title")).toBeInTheDocument();
    expect(
      screen.getByText("club.network.experts.inArea(area=Energia i klimat)"),
    ).toBeInTheDocument();
    expect(screen.getByText("club.network.experts.hint")).toBeInTheDocument();
  });

  it("wątek bez obszaru nie udaje, że go ma", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow({ topic: null })]);

    renderPanel();

    await screen.findByText("club.network.experts.title");
    expect(screen.queryByText(/experts\.inArea/)).toBeNull();
  });

  it("osoba z profilem publicznym dostaje link, osoba bez profilu sam napis", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([
      threadExpertRow(),
      threadExpertRow({
        user_id: "user-lead",
        display_name: "Jan Kowalski",
        profile_slug: null,
        headline: null,
        topics: [],
      }),
    ]);

    renderPanel();

    expect(await screen.findByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(screen.getByText("Jan Kowalski").tagName).toBe("SPAN");
    // Osoba bez zapowiedzi i bez deklaracji nie rysuje pustych bloków.
    expect(screen.getByText("Analityczka rynku energii")).toBeInTheDocument();
  });

  it("wypisuje NAJWYŻEJ trzy deklaracje kompetencji", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([
      threadExpertRow({ topics: ["energy", "climate", "digital", "trade"] }),
    ]);

    const { container } = renderPanel();

    await screen.findByText("club.network.experts.title");
    // Chip kompetencji ma własną obwódkę - po niej go rozpoznajemy, żeby nie
    // policzyć przy okazji nazwiska (też `truncate`).
    const chipy = Array.from(container.querySelectorAll('li span[class*="border-primary/30"]')).map(
      (node) => node.textContent,
    );
    expect(chipy).toHaveLength(3);
    // Pierwszy obszar jedzie przez katalog z atrapy, czwarty nie wchodzi wcale.
    expect(chipy[0]).toBe("Energia i klimat");
    expect(chipy).not.toContain("trade");
  });

  it("obecność w wątku zdejmuje prośbę i mówi to plakietką", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow({ in_thread: true })]);

    renderPanel(true);

    expect(await screen.findByText("club.network.experts.inThread")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.network.experts.ask" })).toBeNull();
    expect(screen.queryByTestId("kontakt-user-member")).toBeNull();
  });

  it("bez prawa odezwania się w wątku nie ma bloku akcji wcale", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);

    renderPanel(false);

    await screen.findByText("club.network.experts.title");
    expect(screen.queryByRole("button", { name: "club.network.experts.ask" })).toBeNull();
    expect(screen.queryByTestId("kontakt-user-member")).toBeNull();
  });

  it("prośba o zdanie idzie do RPC z parą (wątek, adresat)", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);
    networkApiMock.pingClubThreadExpert.mockResolvedValue(true);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "club.network.experts.ask" }));

    await waitFor(() =>
      expect(networkApiMock.pingClubThreadExpert).toHaveBeenCalledWith(THREAD, "user-member"),
    );
    expect(h.toasts).toEqual([{ level: "success", key: "club.network.experts.askSent" }]);
    expect(screen.getByTestId("kontakt-user-member")).toBeInTheDocument();
  });

  it("DRUGA prośba do tej samej osoby nie jest sukcesem ani błędem - jest niczym", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);
    // Baza deduplikuje po trójce i oddaje `false`: nic nowego nie powstało.
    networkApiMock.pingClubThreadExpert.mockResolvedValue(false);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "club.network.experts.ask" }));

    await waitFor(() => expect(networkApiMock.pingClubThreadExpert).toHaveBeenCalled());
    expect(h.toasts).toHaveLength(0);
  });

  it("odmowa prośby wraca komunikatem błędu", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);
    networkApiMock.pingClubThreadExpert.mockRejectedValue(new Error("clubs: forbidden"));

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "club.network.experts.ask" }));

    await waitFor(() =>
      expect(h.toasts).toEqual([{ level: "error", key: "club.network.experts.askFailed" }]),
    );
  });

  it("prośba W LOCIE blokuje przycisk, żeby nie poszła dwa razy", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([threadExpertRow()]);
    networkApiMock.pingClubThreadExpert.mockReturnValue(wLocie());

    renderPanel(true);
    const przycisk = await screen.findByRole("button", { name: "club.network.experts.ask" });
    fireEvent.click(przycisk);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "club.network.experts.ask" })).toBeDisabled(),
    );
  });

  it("osoba już poproszona widzi STAN, a nie przycisk", async () => {
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([
      threadExpertRow({ pinged_by_me: true }),
    ]);

    renderPanel(true);

    expect(await screen.findByText("club.network.experts.asked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.network.experts.ask" })).toBeNull();
    // Kontakt zostaje: prośba jednorazowa nie zabiera drogi do rozmowy.
    expect(screen.getByTestId("kontakt-user-member")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Szew międzymodułowy: wątki przypięte do kotwicy
// ---------------------------------------------------------------------------

describe("ClubAnchorThreads", () => {
  // Bez wartości domyślnej dla `anchorId`: `renderAnchor(undefined)` MUSI
  // dojechać do komponentu jako brak kotwicy, a nie jako wartość zastępcza.
  const renderAnchor = (anchorId: string | undefined, limit?: number) =>
    renderWithQueryClient(
      <ClubAnchorThreads
        anchorType="eu_policy_item"
        anchorId={anchorId}
        limit={limit}
        className="mt-6"
      />,
    );

  it("bez identyfikatora kotwicy NIE pyta bazy i nie rysuje nic", () => {
    const { container } = renderAnchor(undefined);

    expect(container).toBeEmptyDOMElement();
    expect(clubApiMock.fetchClubThreadsForAnchor).not.toHaveBeenCalled();
  });

  it("zapytanie w locie nie mruga szkieletem na stronie, na której często nic nie ma", () => {
    clubApiMock.fetchClubThreadsForAnchor.mockReturnValue(wLocie());

    const { container } = renderAnchor("act-1");

    expect(container).toBeEmptyDOMElement();
  });

  it("pusty wynik i brak dostępu wyglądają IDENTYCZNIE - to jest celowe", async () => {
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([]);

    const { container } = renderAnchor("act-1");

    await waitFor(() => expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("awaria RPC też daje ciszę, a nie komunikat na stronie aktu prawnego", async () => {
    clubApiMock.fetchClubThreadsForAnchor.mockImplementation(odmowa);

    const { container } = renderAnchor("act-1");

    await waitFor(() => expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("wątek prowadzi do klubu i wypisuje nazwę klubu, rodzaj i licznik", async () => {
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([clubAnchorHit()]);

    renderAnchor("act-1");

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/club/klub-energetyczny/t/rynek-mocy");
    expect(link).toHaveTextContent("Rynek mocy po 2030");
    expect(screen.getByText("Klub energetyczny")).toBeInTheDocument();
    expect(screen.getByText("club.kind.debate")).toBeInTheDocument();
    expect(screen.getByText("club.repliesCount(count=7)")).toBeInTheDocument();
    // Sekcja jest opisana nagłówkiem, bo stoi wśród obcej treści.
    expect(screen.getByRole("region", { name: "club.anchor.title" })).toBeInTheDocument();
  });

  it("nazwa klubu idzie w języku interfejsu, nie ze stałej kolumny", async () => {
    h.lang = "en";
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([clubAnchorHit()]);

    renderAnchor("act-1");

    expect(await screen.findByText("Energy club")).toBeInTheDocument();
  });

  it("domyślnie prosi o pięć wątków, a podany limit trafia do RPC", async () => {
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([clubAnchorHit()]);

    const { unmount } = renderAnchor("act-1");
    await waitFor(() =>
      expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledWith({
        anchorType: "eu_policy_item",
        anchorId: "act-1",
        limit: 5,
      }),
    );
    unmount();

    renderAnchor("act-2", 2);
    await waitFor(() =>
      expect(clubApiMock.fetchClubThreadsForAnchor).toHaveBeenCalledWith({
        anchorType: "eu_policy_item",
        anchorId: "act-2",
        limit: 2,
      }),
    );
  });

  it("wiele wątków to wiele pozycji listy, w kolejności z RPC", async () => {
    clubApiMock.fetchClubThreadsForAnchor.mockResolvedValue([
      clubAnchorHit(),
      clubAnchorHit({
        thread_id: "thread-2",
        thread_slug: "koszty-sieci",
        title: "Koszty sieci",
        reply_count: 0,
      }),
    ]);

    renderAnchor("act-1");

    await screen.findByText("Rynek mocy po 2030");
    expect(screen.getAllByRole("link").map((node) => node.textContent)).toEqual([
      expect.stringContaining("Rynek mocy po 2030"),
      expect.stringContaining("Koszty sieci"),
    ]);
    expect(screen.getByText("club.repliesCount(count=0)")).toBeInTheDocument();
  });
});
