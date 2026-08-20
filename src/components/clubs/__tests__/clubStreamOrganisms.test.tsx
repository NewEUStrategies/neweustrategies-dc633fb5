// Strumień huba klubu (`ClubFeedItem`) i lista tematów klubu
// (`ClubThreadList`) - dwie powierzchnie, które rysują TEN SAM wiersz dossier
// z pięciu różnych źródeł danych.
//
// CO TEN PLIK DOWODZI.
// (1) JEDEN WPIS STRUMIENIA = JEDEN RODZAJ KARTY. `ClubFeedItem` jest
//     rozdzielaczem po `entry.kind` (wątek, wpis ściany, termin, etap,
//     paczka dokumentów) i pomyłka w tym rozdziale nie wywala niczego -
//     pokazuje po prostu KARTĘ NIE TĘ. Każdy rodzaj dostaje tu własny dowód
//     przez `data-testid` wiersza, bo to jedyna rzecz, która odróżnia je
//     strukturalnie (szkielet jest wspólny CELOWO - nagłówek `ClubFeedItem.tsx`).
// (2) KARTA WĄTKU MA TRZY STANY DANYCH, nie jeden: pełny (status, źródło,
//     obszar, kotwica, przypięcie, nieprzeczytane, reakcje), pusty
//     (`null`/`""` we wszystkich polach opcjonalnych - nie może zostawić
//     gołego `undefined` ani pustego akapitu) i częściowy (jest nazwa działu,
//     ale nie ma go w indeksie kolorów - chip bez akcentu, a nie znikający
//     wątek).
// (3) REAKCJE JADĄ PARTIĄ NAD LISTĄ, więc karta musi znieść BRAK swojego
//     wpisu w mapie (`?? []`) i brak `onReact` (pasek bez interakcji), a gdy
//     `onReact` jest - kliknięcie reakcji musi zawołać go z ID TEGO wątku.
//     To jedyne miejsce, w którym karta wie, którego wątku dotyczy gest.
// (4) FILTRY SĄ DWUKIERUNKOWE. Chip źródła i chip obszaru świecą się jako
//     aktywne WYŁĄCZNIE dla wartości równej aktywnemu filtrowi (i nigdy dla
//     wpisu bez działu, którego `id` jest `null`), a kliknięcie oddaje wybór
//     w górę.
// (5) PACZKA DOKUMENTÓW JEST LISTĄ, nie kartą jednego pliku: plik dostaje
//     akcję pobrania (`download`), link zewnętrzny - otwarcie w nowej karcie,
//     a dokument BEZ obu źródeł nie dostaje martwego przycisku. Pobranie jest
//     REJESTROWANE - licznik pobrań jest w tym module danymi, nie ozdobą.
// (6) UKŁAD LISTY TEMATÓW JEST DECYZJĄ REDAKCYJNĄ (`clubs.layout`): `cards`
//     układa wiersze w siatkę, `magazine` wyróżnia PIERWSZY (a bez wątków nie
//     ma czego wyróżniać i musi zdegradować się do zwykłej listy), `list`
//     i każda inna wartość dają jedną kolumnę. Sam wiersz jest identyczny
//     we wszystkich - to jest teza tego pliku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `ClubDossierRow` (grzbiet, tony, metryki), `ClubThreadHeat`,
//     `ClubThreadKindIcon`, `ClubSourceChip`, `ClubTopicChip`,
//     `ClubEngagementBar`, `ClubReactionBar` - atomy i molekuły z własnymi
//     testami. Tutaj asercje dotyczą tego, CO karta im podaje.
// (b) `ClubPostCard` - jest tu ATRAPĄ. Karta wpisu ma własny plik testowy
//     (`clubPostCard.test.tsx`); w strumieniu dowodzimy wyłącznie DELEGACJI
//     (mapa podpisanych adresów, indeks działów, prawo głosu, akcje wpisu).
// (c) `buildClubFeed` (kolejność i sloty kart kontekstowych) - czysta funkcja
//     w `src/lib/clubs/clubFeed.ts`. Ten plik dostaje gotowe wpisy propsem.
// (d) `toAuthorLabel`, `clubSourceOf`, `normalizeClubThreadIcon`,
//     `documentHref`, `toDocumentKind`/`toEventKind`/`toMilestoneState` -
//     reguły czyste, przetestowane osobno; tu widać ich SKUTEK na ekranie.
// (e) Formatów daty: asercje idą na atrybut `datetime` (kontrakt maszynowy),
//     a nie na napis z `Intl` - ten zależy od ICU, nie od produktu.
//
// JEDNA GAŁĄŹ ŚWIADOMIE NIEDOBITA (nie jest luką w testach):
//   `tallies={reactions ?? []}` w karcie wątku (linia 220). `ClubFeedItem`
//   podaje ten prop JUŻ domknięty (`threadReactions?.get(id) ?? []`), więc
//   `undefined` nie ma jak dojechać do `ThreadCard` - to podwójna obrona
//   prywatnego komponentu pliku. Wymuszenie jej z testu wymagałoby renderu
//   `ThreadCard` w izolacji, a on nie jest eksportowany (i nie powinien być).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ClubFeedEntry } from "@/lib/clubs/clubFeed";
import type { ClubSourceMark } from "@/lib/clubs/threadSources";
import type { ClubReactionTally, ClubThreadListRow } from "@/lib/clubs/types";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock(
  "@/lib/clubs/workspaceApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).workspaceApiMock,
);

// Karta wpisu ściany ma własny plik testowy - w strumieniu interesuje nas
// WYŁĄCZNIE to, co dostaje propsem, więc atrapa wypisuje to do DOM-u.
vi.mock("@/components/clubs/organisms/ClubPostCard", () => ({
  ClubPostCard: ({
    post,
    clubSlug,
    mediaUrls,
    activeGroupId,
    canComment,
    onLike,
    onDelete,
  }: {
    post: { id: string };
    clubSlug: string;
    mediaUrls: Record<string, string>;
    activeGroupId: string | null;
    canComment?: boolean;
    onLike?: (postId: string) => void;
    onDelete?: (postId: string) => void;
  }) => (
    <div
      data-testid="club-post-card-stub"
      data-post-id={post.id}
      data-club-slug={clubSlug}
      data-media={Object.keys(mediaUrls).join(",")}
      data-active-group={activeGroupId ?? ""}
      data-can-comment={String(canComment)}
    >
      <button type="button" onClick={() => onLike?.(post.id)}>
        polub
      </button>
      <button type="button" onClick={() => onDelete?.(post.id)}>
        usun
      </button>
    </div>
  ),
}));

import { ClubFeedItem } from "@/components/clubs/organisms/ClubFeedItem";
import { ClubThreadList } from "@/components/clubs/organisms/ClubThreadList";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset, clubThreadListRow } from "@/test/clubs/fixtures";
import {
  clubDocumentRow,
  clubEventRow,
  clubMilestoneRow,
  clubPostRow,
} from "@/test/clubs/hubFixtures";
import { workspaceApiMock, resetWorkspaceApiMock } from "@/test/clubs/workspaceApiMock";

const CLUB_SLUG = "klub-energetyczny";

/** Katalog obszarów - jeden wpis wystarcza, chip czyta z niego etykietę. */
const TOPICS: readonly ClubTopicOption[] = [
  { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
];

/** Indeks działów z kolorem - budowany nad listą, tu podany wprost. */
const SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map([
  [CLUB_IDS.group, { id: CLUB_IDS.group, name: "Kuluary", accent: "#0f766e", icon: "lock" }],
]);

function threadEntry(thread: ClubThreadListRow): ClubFeedEntry {
  return { kind: "thread", key: `t:${thread.id}`, thread };
}

beforeEach(() => {
  resetWorkspaceApiMock();
  cleanup();
});

describe("ClubFeedItem - karta wątku, dane pełne", () => {
  const THREAD = clubThreadListRow({
    status: "resolved",
    topic: "energy",
    anchor_label: "Ustawa o rynku mocy",
    pinned_at: clubIsoOffset(-60),
    is_unread: true,
    insightful_count: 3,
    excerpt: "Zajawka wątku",
    last_reply_at: clubIsoOffset(30),
  });

  const TALLIES: readonly ClubReactionTally[] = [{ kind: "insightful", total: 2, mine: false }];

  it("niesie rodzaj, status, źródło, obszar, kotwicę, autora, datę i przypięcie", () => {
    render(
      <ClubFeedItem
        entry={threadEntry(THREAD)}
        clubSlug={CLUB_SLUG}
        sourceIndex={SOURCES}
        activeGroupId={CLUB_IDS.group}
        onSourceSelect={() => undefined}
        topicsCatalog={TOPICS}
        activeTopic="energy"
        onTopicSelect={() => undefined}
      />,
    );

    const card = screen.getByTestId("club-feed-thread");
    expect(card.getAttribute("data-tone")).toBe("discussion");
    expect(within(card).getByText("club.kind.discussion")).toBeTruthy();
    expect(within(card).getByText("club.threadStatus.resolved")).toBeTruthy();
    expect(within(card).getByText("Ustawa o rynku mocy")).toBeTruthy();
    expect(within(card).getByText("Anna Nowak")).toBeTruthy();
    expect(within(card).getByText("club.hub.feed.pinned")).toBeTruthy();
    expect(within(card).getByText("Zajawka wątku")).toBeTruthy();
    // Data: kontrakt maszynowy, nie napis z ICU. Najświeższa odpowiedź wygrywa.
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(clubIsoOffset(30));
    // Aktywny filtr działu i obszaru - oba chipy przełączone, nie tylko jeden.
    expect(
      within(card)
        .getByRole("button", { name: /Kuluary/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(card)
        .getByRole("button", { name: /Energetyka/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(card.querySelector('a[href="/club/klub-energetyczny/t/temat-pierwszy"]')).not.toBeNull();
  });

  it("metryki: odpowiedzi, uczestnicy i - tylko przy niezerowym liczniku - `insightful`", () => {
    render(
      <ClubFeedItem entry={threadEntry(THREAD)} clubSlug={CLUB_SLUG} topicsCatalog={TOPICS} />,
    );

    const card = screen.getByTestId("club-feed-thread");
    expect(within(card).getByText("club.repliesCount(count=3)")).toBeTruthy();
    expect(within(card).getByText("club.hub.feed.participantsCount(count=2)")).toBeTruthy();
    expect(within(card).getByText("club.reaction.insightful")).toBeTruthy();
  });

  it("kliknięcie reakcji oddaje ID TEGO wątku, rodzaj i poprzedni stan", () => {
    const onThreadReact = vi.fn();
    render(
      <ClubFeedItem
        entry={threadEntry(THREAD)}
        clubSlug={CLUB_SLUG}
        threadReactions={new Map([[THREAD.id, [...TALLIES]]])}
        threadReactionActors={new Map()}
        onThreadReact={onThreadReact}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.reaction.insightful (2)" }));

    expect(onThreadReact).toHaveBeenCalledWith(THREAD.id, "insightful", false);
  });

  it("kliknięcie chipów filtrów oddaje dział i obszar w górę", () => {
    const onSourceSelect = vi.fn();
    const onTopicSelect = vi.fn();
    render(
      <ClubFeedItem
        entry={threadEntry(THREAD)}
        clubSlug={CLUB_SLUG}
        sourceIndex={SOURCES}
        activeGroupId={null}
        topicsCatalog={TOPICS}
        activeTopic={null}
        onSourceSelect={onSourceSelect}
        onTopicSelect={onTopicSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Kuluary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Energetyka/ }));

    expect(onSourceSelect).toHaveBeenCalledWith(CLUB_IDS.group);
    expect(onTopicSelect).toHaveBeenCalledWith("energy");
  });
});

describe("ClubFeedItem - karta wątku, dane puste i częściowe", () => {
  it("bez statusu, źródła, obszaru, kotwicy, przypięcia i zajawki karta zostaje kartą", () => {
    render(
      <ClubFeedItem
        entry={threadEntry(
          clubThreadListRow({
            status: "published",
            topic: "",
            // Brak dzialu jedzie z RPC jako PUSTY ciag, nie jako `null` -
            // taki jest kontrakt `club_threads_list` (patrz `ClubThreadListRow`).
            group_id: "",
            group_name_pl: "",
            group_name_en: "",
            anchor_label: null,
            pinned_at: null,
            is_unread: false,
            insightful_count: 0,
            excerpt: null,
            last_reply_at: null,
          }),
        )}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-thread");
    expect(within(card).queryByText("club.threadStatus.resolved")).toBeNull();
    expect(within(card).queryByText("club.hub.feed.pinned")).toBeNull();
    expect(within(card).queryByText("club.reaction.insightful")).toBeNull();
    expect(within(card).queryByText("Kuluary")).toBeNull();
    expect(within(card).queryByText("Energetyka")).toBeNull();
    expect(card.textContent).not.toContain("undefined");
    // Bez odpowiedzi datą wpisu jest data założenia.
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(CLUB_BASE_ISO);
    // Bez `onReact` pasek nie proponuje reakcji, ale nadal prowadzi do wątku.
    expect(screen.queryByTestId("club-add-reaction")).toBeNull();
    expect(screen.getByTestId("club-comment-link")).toBeTruthy();
  });

  it("zajawka z samych spacji i kotwica z samych spacji nie zostawiają po sobie pustych miejsc", () => {
    render(
      <ClubFeedItem
        entry={threadEntry(clubThreadListRow({ excerpt: "   ", anchor_label: "   " }))}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-thread");
    const titles = Array.from(card.querySelectorAll("[title]")).map((node) =>
      node.getAttribute("title"),
    );
    expect(titles).not.toContain("   ");
    expect(within(card).queryByText("Fragment")).toBeNull();
  });

  it("dział spoza indeksu kolorów pokazuje się BEZ akcentu i nigdy jako aktywny filtr", () => {
    render(
      <ClubFeedItem
        entry={threadEntry(
          clubThreadListRow({ group_id: "", group_name_pl: "Kuluary", group_name_en: "" }),
        )}
        clubSlug={CLUB_SLUG}
        activeGroupId={CLUB_IDS.group}
        onSourceSelect={() => undefined}
        topicsCatalog={TOPICS}
        activeTopic={null}
        onTopicSelect={() => undefined}
      />,
    );

    const card = screen.getByTestId("club-feed-thread");
    // Wpis bez działu (`id === null`) nie ma czego filtrować - zostaje etykietą.
    expect(within(card).getByText("Kuluary")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Kuluary/ })).toBeNull();
    // Obszar jest ustawiony, ale filtr wskazuje coś innego - chip nieaktywny.
    expect(
      within(card)
        .getByRole("button", { name: /Energetyka/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("wpis anonimowy i wpis po usuniętym koncie mają etykietę autora z osobnych kluczy", () => {
    const { rerender } = render(
      <ClubFeedItem
        entry={threadEntry(clubThreadListRow({ author_alias: "K-12", author_name: null }))}
        clubSlug={CLUB_SLUG}
      />,
    );
    // Atrapa i18n oddaje sam klucz, więc wzorzec `{{alias}}` nie ma czego
    // podstawić - dowodem jest WYBÓR klucza anonimowego, nie treść wzorca.
    expect(screen.getByText("club.anonymousAuthor")).toBeTruthy();

    rerender(
      <ClubFeedItem
        entry={threadEntry(
          clubThreadListRow({ author_alias: null, author_name: null, author_avatar: null }),
        )}
        clubSlug={CLUB_SLUG}
      />,
    );
    expect(screen.getByText("club.deletedAuthor")).toBeTruthy();
  });

  it("brak wpisu wątku w mapie reakcji daje pusty pasek, a nie awarię karty", () => {
    render(
      <ClubFeedItem
        entry={threadEntry(clubThreadListRow())}
        clubSlug={CLUB_SLUG}
        threadReactions={new Map()}
        reactionsPending
        canReact={false}
        onThreadReact={() => undefined}
      />,
    );

    expect(screen.getByTestId("club-engagement-bar")).toBeTruthy();
    // Bez prawa głosu nie ma zaproszenia do reakcji, nawet gdy `onReact` jest.
    expect(screen.queryByTestId("club-add-reaction")).toBeNull();
  });
});

describe("ClubFeedItem - wpis ściany", () => {
  it("deleguje wpis do karty wpisu razem z adresami plików, działem i prawem głosu", () => {
    const onPostLike = vi.fn();
    const onPostDelete = vi.fn();
    render(
      <ClubFeedItem
        entry={{ kind: "post", key: "p:post-1", post: clubPostRow() }}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "club-1/plik.png": "https://podpis.example/plik.png" }}
        activeGroupId={CLUB_IDS.group}
        canReact={false}
        onPostLike={onPostLike}
        onPostDelete={onPostDelete}
      />,
    );

    const stub = screen.getByTestId("club-post-card-stub");
    expect(stub.getAttribute("data-post-id")).toBe("post-1");
    expect(stub.getAttribute("data-club-slug")).toBe(CLUB_SLUG);
    expect(stub.getAttribute("data-media")).toBe("club-1/plik.png");
    expect(stub.getAttribute("data-active-group")).toBe(CLUB_IDS.group);
    // Prawo głosu w klubie jedzie do karty jako prawo komentowania.
    expect(stub.getAttribute("data-can-comment")).toBe("false");

    fireEvent.click(within(stub).getByRole("button", { name: "polub" }));
    fireEvent.click(within(stub).getByRole("button", { name: "usun" }));
    expect(onPostLike).toHaveBeenCalledWith("post-1");
    expect(onPostDelete).toHaveBeenCalledWith("post-1");
  });
});

describe("ClubFeedItem - karta terminu", () => {
  it("termin godzinowy z miejscem i opisem", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "event",
          key: "e:event-1",
          event: clubEventRow({
            all_day: false,
            location: "Bruksela, Rue de la Loi",
            description_pl: "Posiedzenie zamknięte",
          }),
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-event");
    expect(card.getAttribute("data-tone")).toBe("event");
    expect(within(card).getByText("club.hub.feed.eventLabel")).toBeTruthy();
    expect(within(card).getByText("Bruksela, Rue de la Loi")).toBeTruthy();
    expect(within(card).getByText("Posiedzenie zamknięte")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Posiedzenie wrześniowe" })).toBeTruthy();
  });

  it("termin całodniowy bez miejsca i bez opisu nie rysuje ani pinezki, ani zajawki", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "event",
          key: "e:event-2",
          event: clubEventRow({ all_day: true, location: "   ", description_pl: null }),
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-event");
    expect(within(card).queryByText("Bruksela, Rue de la Loi")).toBeNull();
    expect(card.textContent).not.toContain("undefined");
  });

  it("termin bez pola miejsca (`null`) też się rysuje", () => {
    render(
      <ClubFeedItem
        entry={{ kind: "event", key: "e:event-3", event: clubEventRow({ location: null }) }}
        clubSlug={CLUB_SLUG}
      />,
    );

    expect(screen.getByTestId("club-feed-event")).toBeTruthy();
  });
});

describe("ClubFeedItem - karta etapu", () => {
  it("etap z terminem i opisem prowadzi do harmonogramu klubu", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "milestone",
          key: "m:milestone-1",
          milestone: clubMilestoneRow({ description_pl: "Zbieramy stanowiska" }),
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-milestone");
    expect(within(card).getByText("club.hub.feed.stageLabel")).toBeTruthy();
    expect(within(card).getByText(/club.hub.stage.due/)).toBeTruthy();
    expect(within(card).getByText("Zbieramy stanowiska")).toBeTruthy();
    expect(
      within(card)
        .getByRole("link", { name: /club.hub.feed.toSchedule/ })
        .getAttribute("href"),
    ).toBe("/club/klub-energetyczny/schedule");
  });

  it("etap bez terminu i bez opisu nie pokazuje pustej daty", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "milestone",
          key: "m:milestone-2",
          milestone: clubMilestoneRow({ due_on: null, state: "planned" }),
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-milestone");
    expect(within(card).queryByText(/club.hub.stage.due/)).toBeNull();
    expect(card.textContent).not.toContain("undefined");
  });
});

describe("ClubFeedItem - paczka dokumentów", () => {
  it("plik dostaje pobranie (i rejestruje je), link - otwarcie, dokument bez źródła - nic", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "documents",
          key: "docs:1+2+3",
          documents: [
            clubDocumentRow(),
            clubDocumentRow({
              id: "document-2",
              title_pl: "Notatka prasowa",
              file_url: null,
              external_url: "https://zewnetrzny.example/notatka",
            }),
            clubDocumentRow({
              id: "document-3",
              title_pl: "Materiał bez pliku",
              file_url: null,
              external_url: null,
            }),
          ],
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-documents");
    // Trzy pozycje = paczka, nie pojedynczy plik.
    expect(within(card).getByText("club.hub.feed.documentsLabel")).toBeTruthy();
    expect(card.querySelectorAll("li").length).toBe(3);

    const download = within(card).getByRole("link", { name: "club.docs.download" });
    expect(download.getAttribute("href")).toBe("https://pliki.example/raport.pdf");
    expect(download.getAttribute("download")).toBe("");
    expect(download.getAttribute("target")).toBeNull();

    const external = within(card).getByRole("link", { name: "club.docs.open" });
    expect(external.getAttribute("href")).toBe("https://zewnetrzny.example/notatka");
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toBe("noreferrer");

    // Dokument bez pliku i bez linku nie dostaje martwego przycisku.
    expect(within(card).getAllByRole("link").length).toBe(2);

    fireEvent.click(download);
    expect(workspaceApiMock.registerClubDocumentDownload).toHaveBeenCalledWith("document-1");
  });

  it("pojedynczy dokument dostaje etykietę liczby pojedynczej i streszczenie jako zajawkę", () => {
    render(
      <ClubFeedItem
        entry={{
          kind: "documents",
          key: "doc:document-1",
          documents: [clubDocumentRow({ summary_pl: "Streszczenie raportu" })],
        }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-documents");
    expect(within(card).getByText("club.hub.feed.documentLabel")).toBeTruthy();
    expect(within(card).getByText("Streszczenie raportu")).toBeTruthy();
  });

  it("pojedynczy dokument bez streszczenia nie zostawia pustej zajawki", () => {
    render(
      <ClubFeedItem
        entry={{ kind: "documents", key: "doc:document-1", documents: [clubDocumentRow()] }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-documents");
    expect(within(card).getByText("club.hub.feed.documentLabel")).toBeTruthy();
    expect(card.textContent).not.toContain("undefined");
  });

  it("PUSTA paczka (dane po filtrze) nie wywraca karty", () => {
    render(
      <ClubFeedItem
        entry={{ kind: "documents", key: "docs:", documents: [] }}
        clubSlug={CLUB_SLUG}
      />,
    );

    const card = screen.getByTestId("club-feed-documents");
    expect(within(card).getByText("club.hub.feed.documentsLabel")).toBeTruthy();
    expect(card.querySelectorAll("li").length).toBe(0);
  });
});

describe("ClubThreadList", () => {
  const A = clubThreadListRow({ id: "thread-a", slug: "temat-a", title: "Temat A" });
  const B = clubThreadListRow({ id: "thread-b", slug: "temat-b", title: "Temat B" });
  const C = clubThreadListRow({ id: "thread-c", slug: "temat-c", title: "Temat C" });

  /** Tytuły wierszy w kolejności renderu - dowód, co układ wpuścił do listy. */
  function titles(): string[] {
    return screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent ?? "");
  }

  it("`list` rysuje jedną kolumnę wierszy w kolejności wejściowej", () => {
    const { container } = render(
      <ClubThreadList clubSlug={CLUB_SLUG} threads={[A, B]} layout="list" />,
    );

    expect(titles()).toEqual(["Temat A", "Temat B"]);
    expect(container.querySelector("ul")?.className).toContain("space-y-2");
    expect(screen.getAllByTestId("club-thread-row").length).toBe(2);
  });

  it("`cards` układa TE SAME wiersze w siatkę", () => {
    const { container } = render(
      <ClubThreadList clubSlug={CLUB_SLUG} threads={[A, B]} layout="cards" />,
    );

    expect(titles()).toEqual(["Temat A", "Temat B"]);
    expect(container.querySelector("ul")?.className).toContain("grid");
    expect(screen.getAllByTestId("club-thread-row").length).toBe(2);
  });

  it("`magazine` wyróżnia PIERWSZY wątek listy, resztę zostawia wierszami", () => {
    render(<ClubThreadList clubSlug={CLUB_SLUG} threads={[A, B, C]} layout="magazine" />);

    expect(titles()).toEqual(["Temat A", "Temat B", "Temat C"]);
    const rows = screen.getAllByTestId("club-thread-row");
    expect(rows[0]?.className).toContain("border-primary/40");
    expect(rows[1]?.className).not.toContain("border-primary/40");
  });

  it("`magazine` bez wątków degraduje się do zwykłej listy, a nie do pustego wyróżnienia", () => {
    const { container } = render(
      <ClubThreadList clubSlug={CLUB_SLUG} threads={[]} layout="magazine" />,
    );

    expect(screen.queryByTestId("club-thread-row")).toBeNull();
    expect(container.querySelector("ul")?.className).toContain("space-y-2");
  });

  it("układ prestiżowy korzysta z tej samej jednej kolumny", () => {
    render(<ClubThreadList clubSlug={CLUB_SLUG} threads={[A]} layout="editorial" />);

    expect(titles()).toEqual(["Temat A"]);
    expect(screen.getAllByTestId("club-thread-row").length).toBe(1);
  });

  it("wiersz niesie dział, autora, datę, linki i metryki", () => {
    render(
      <ClubThreadList
        clubSlug={CLUB_SLUG}
        threads={[clubThreadListRow({ insightful_count: 2 })]}
        layout="list"
      />,
    );

    const row = screen.getByTestId("club-thread-row");
    expect(within(row).getByText("club.kind.discussion")).toBeTruthy();
    expect(within(row).getByText("Dyskusje")).toBeTruthy();
    expect(within(row).getByText("Anna Nowak")).toBeTruthy();
    expect(within(row).getByText("Fragment")).toBeTruthy();
    expect(within(row).getByText("club.repliesCount(count=3)")).toBeTruthy();
    expect(within(row).getByText("club.hub.feed.participantsCount(count=2)")).toBeTruthy();
    expect(within(row).getByText("club.reaction.insightful")).toBeTruthy();
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe(CLUB_BASE_ISO);
    expect(within(row).getByRole("link", { name: "Temat pierwszy" }).getAttribute("href")).toBe(
      "/club/klub-energetyczny/t/temat-pierwszy",
    );
  });

  it("każdy status wątku dostaje własne oznaczenie i żadne nie pojawia się przy innym", () => {
    /** Trzy oznaczenia statusu: kłódka jest IKONĄ z nazwą, dwa pozostałe napisem. */
    function markers(row: HTMLElement): Record<"locked" | "resolved" | "pending", boolean> {
      return {
        locked: within(row).queryByLabelText("club.threadStatus.locked") !== null,
        resolved: within(row).queryByText("club.threadStatus.resolved") !== null,
        pending: within(row).queryByText("club.threadStatus.pending") !== null,
      };
    }

    const CASES = [
      { status: "locked", expected: { locked: true, resolved: false, pending: false } },
      { status: "resolved", expected: { locked: false, resolved: true, pending: false } },
      { status: "pending", expected: { locked: false, resolved: false, pending: true } },
      { status: "published", expected: { locked: false, resolved: false, pending: false } },
    ] as const;

    for (const { status, expected } of CASES) {
      cleanup();
      render(
        <ClubThreadList
          clubSlug={CLUB_SLUG}
          threads={[clubThreadListRow({ status })]}
          layout="list"
        />,
      );
      expect(markers(screen.getByTestId("club-thread-row")), `status ${status}`).toEqual(expected);
    }
  });

  it("kotwica z nazwą, przypięcie i stan nieprzeczytany są widoczne w wierszu", () => {
    render(
      <ClubThreadList
        clubSlug={CLUB_SLUG}
        threads={[
          clubThreadListRow({
            anchor_label: "Ustawa o rynku mocy",
            pinned_at: clubIsoOffset(-30),
            is_unread: true,
            last_reply_at: null,
          }),
        ]}
        layout="list"
      />,
    );

    const row = screen.getByTestId("club-thread-row");
    expect(within(row).getByText("Ustawa o rynku mocy")).toBeTruthy();
    expect(within(row).getByLabelText("club.pinnedThread")).toBeTruthy();
    expect(row.className).toContain("bg-primary/[0.03]");
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe(CLUB_BASE_ISO);
  });

  it("pusta kotwica, brak zajawki i zerowy licznik `insightful` nie zostawiają pustych miejsc", () => {
    render(
      <ClubThreadList
        clubSlug={CLUB_SLUG}
        threads={[
          clubThreadListRow({
            anchor_label: "",
            excerpt: null,
            insightful_count: 0,
            group_name_pl: "",
            group_name_en: "",
          }),
          clubThreadListRow({ id: "thread-x", slug: "temat-x", excerpt: "   " }),
        ]}
        layout="list"
      />,
    );

    const rows = screen.getAllByTestId("club-thread-row");
    expect(within(rows[0]).queryByText("club.reaction.insightful")).toBeNull();
    expect(within(rows[0]).queryByText("Fragment")).toBeNull();
    expect(within(rows[1]).queryByText("Fragment")).toBeNull();
    expect(rows[0].textContent).not.toContain("undefined");
  });
});
