// Karta wpisu klubowego (A31) - jednostka „ściany” klubu.
//
// CO TEN PLIK DOWODZI.
// (1) WPIS NIE MA TYTUŁU, WIĘC PIERWSZYM ELEMENTEM JEST AUTOR - i musi
//     przetrwać wszystkie trzy jego stany: konto z profilem (nazwa jest
//     linkiem), konto bez profilu publicznego (nazwa jest tekstem) i konto
//     usunięte (`author_name = null` -> klucz „usunięty autor”, awatar
//     wyciszony). Karta bez tej degradacji pokazywałaby puste miejsce
//     w miejscu autorstwa.
// (2) PODPIĘCIE POD WĄTEK JEST POKAZANE ZAWSZE, GDY ISTNIEJE - to jedyna
//     rzecz, która łączy krótką formę ze strukturą klubu (nagłówek
//     `ClubPostCard.tsx`). `hideThreadLink` zdejmuje plakietkę TYLKO tam,
//     gdzie wątek JEST kontekstem ekranu, i wtedy zdejmuje też udostępnienie
//     adresem wątku - ale NIE komentarze, bo te żyją pod wpisem, nie w wątku.
// (3) KOMENTARZ ZOSTAJE POD WPISEM. „Komentuj" jest PRZEŁĄCZNIKIEM sekcji
//     rozmowy karty (`aria-expanded`/`aria-controls` wskazują istniejący
//     węzeł także przy zwiniętej sekcji), otwarcie przenosi fokus do pola
//     (`focusKey`), a licznik komentarzy w pasie liczników rozwija tę samą
//     sekcję. Zawartość montuje się dopiero przy pierwszym rozwinięciu
//     i ZOSTAJE po zwinięciu (szkic nie przepada). Tryb sekcji jest iloczynem
//     sesji, prawa głosu w klubie i `post.can_comment` (prawo w dziale) - gość
//     i członek bez głosu też rozwijają sekcję, ale bez kompozytora.
//     Wpis wskazany adresem (`focusComments`) rozwija się sam, bez fokusu.
//     Sama sekcja (lista, kompozytor, usuwanie) ma własny plik:
//     `clubFeedComments.test.tsx` - tutaj jest ATRAPĄ wypisującą propsy.
// (4) TREŚĆ JEST TEKSTEM, NIE HTML-em. Adresy w treści stają się linkami
//     (`target=_blank`, `rel` z `noopener`), a wszystko inne zostaje tekstem -
//     wstrzykiwanie znaczników z pola użytkownika to gotowy XSS.
// (5) ADRESY PLIKÓW SĄ WSTRZYKIWANE, NIE POBIERANE. Karta musi znieść
//     ZAŁĄCZNIK BEZ PODPISU (mapa jeszcze nie dojechała): zdjęcie pokazuje
//     pulsujący zastępnik i NIE DA SIĘ go kliknąć, nagranie to sam zastępnik,
//     a przycisk podglądu pliku jest wyłączony. Klikalny zastępnik otwierałby
//     podgląd bez adresu.
// (6) PODGLĄD PLIKU ZALEŻY OD RODZAJU: format z podglądem dostaje przycisk
//     i dopisek przy rozmiarze, archiwum - nie. Rozmiar jest formatowany
//     w jednostkach binarnych, a rozmiar zerowy (metadane bez rozmiaru) nie
//     ma prawa pokazać „0 B”.
// (7) MENU ZARZĄDZANIA ISTNIEJE TYLKO PRZY DWÓCH WARUNKACH NARAZ: prawo
//     zarządzania wpisem I podana akcja usunięcia. Samo prawo bez akcji dałoby
//     przycisk, który nic nie robi. Usunięcie zamyka menu i oddaje ID wpisu.
// (8) POLUBIENIE BEZ PODANEJ AKCJI JEST WYŁĄCZONE, a nie ciche: `aria-pressed`
//     mówi czytnikowi ekranu, czy wpis jest już polubiony, a liczba docenień
//     stoi w pasie liczników nad akcjami („Ty i N innych", gdy doceniłem).
// (10) GALERIA UKŁADA SIĘ WEDŁUG PIERWSZEGO ZDJĘCIA (reguły w `feedMedia.ts`,
//     tu ich skutek): jedno zdjęcie dostaje ramę z metadanych, dwa - parę,
//     poziome pierwsze - górny rząd, a nadwyżka ponad cztery kafle idzie do
//     licznika „+N" na ostatnim kaflu.
// (9) PODGLĄD LINKU: nazwa hosta pochodzi z `siteName`, a gdy go nie ma -
//     z adresu; adres NIE-URL nie może wywrócić karty (blok `try/catch`), a
//     link bez opisu i bez obrazka nie dostaje dymka, bo dymek nie miałby czego
//     pokazać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `parseClubPostAttachments` (odrzucanie uszkodzonych załączników, limit
//     dziesięciu) - czysta funkcja z własnym zakresem w `postTypes.ts`. Tutaj
//     dane wchodzą już jako `jsonb` wpisu, więc dowodzimy tylko RENDERU
//     rozpoznanych kształtów.
// (b) `fileLabel` / `isPreviewable` (`lib/files/fileKinds`) i podglądu
//     dokumentów (`DocumentViewerDialog`) - dialog jest ATRAPĄ, bo Radix
//     Dialog nie działa pod happy-dom bez pełnego API wskaźnika, a jego
//     zawartość ma własne testy. Dowodem jest to, CO karta oddaje do podglądu.
// (c) Radix HoverCard - podmieniony na przepust, więc zawartość dymka jest
//     w DOM-ie od razu. Testujemy JEGO TREŚĆ, nie mechanikę najazdu Radiksa.
// (d) `ClubSourceChip`, `ClubAuthorAvatar`, `ClubInlineTitle`, `Badge` - atomy
//     z własnymi zakresami.
//
// JEDNA GAŁĄŹ ŚWIADOMIE NIEDOBITA (nie jest luką w testach):
//   `if (url === undefined) return;` w `open()` w `MediaGrid`. Oba wejścia do
//   tej funkcji (kafel zdjęcia i przycisk podglądu pliku) mają `disabled`
//   ustawione DOKŁADNIE tym samym warunkiem, a React nie doręcza `onClick`
//   wyłączonemu przyciskowi - więc strażnik jest nieosiągalny z interfejsu
//   i zostaje jako obrona przed przyszłym wywołaniem z innego miejsca.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Json } from "@/integrations/supabase/types";
import type { ClubSourceMark } from "@/lib/clubs/threadSources";
import type { RouterLinkStubProps } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  /** Pliki oddane do podglądu w platformie - dowód, CO karta wysłała dalej. */
  previewed: [] as Array<{ url: string; name: string; mime: string; size?: number | null }>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// `search` routera nie dojeżdża do DOM-u w atrapie linku, a właśnie ono niesie
// dział nowego wątku i intencję „otwórz kompozytor odpowiedzi” - wystawiamy je
// więc jako atrybut danych obok gotowego `RouterLinkStub`.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: ({ search, ...rest }: RouterLinkStubProps) => (
      <RouterLinkStub {...rest} data-search={JSON.stringify(search ?? null)} />
    ),
  };
});

// Radix HoverCard nie działa pod happy-dom bez pełnego API wskaźnika; przepust
// zostawia treść dymka w DOM-ie, żeby dała się sprawdzić bez najazdu.
vi.mock("@radix-ui/react-hover-card", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Root: Passthrough,
    Trigger: Passthrough,
    Portal: Passthrough,
    // Karta niesie DWA rodzaje dymków (podgląd linku i wizytówka autora), więc
    // przepust musi oddać identyfikator podany przez komponent - inaczej oba
    // wyglądają w DOM tak samo i `getByTestId` łapie dwa elementy naraz.
    Content: ({
      children,
      "data-testid": testId,
    }: {
      children?: ReactNode;
      "data-testid"?: string;
    }) => <div data-testid={testId ?? "club-post-link-popup"}>{children}</div>,
  };
});

vi.mock("@/components/files/useDocumentViewer", () => ({
  useDocumentViewer: () => ({
    openFile: (file: { url: string; name: string; mime: string; size?: number | null }) => {
      h.previewed.push(file);
    },
    viewer: <span data-testid="club-post-viewer" />,
  }),
}));

vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: () => ({ data: null, isPending: false }),
}));

// Sekcja komentarzy ma własny plik testowy; tu dowodzimy DELEGACJI: kiedy
// karta ją montuje i z jakim trybem oraz sygnałem fokusu.
vi.mock("@/components/clubs/molecules/ClubFeedComments", () => ({
  ClubFeedComments: ({
    post,
    clubSlug,
    mode,
    focusKey,
  }: {
    post: { id: string };
    clubSlug: string;
    mode: string;
    focusKey?: number;
  }) => (
    <div
      data-testid="club-feed-comments-stub"
      data-post-id={post.id}
      data-club-slug={clubSlug}
      data-mode={mode}
      data-focus-key={String(focusKey ?? 0)}
    />
  ),
}));

import { ClubPostCard } from "@/components/clubs/organisms/ClubPostCard";
import {
  clearFeedDrafts,
  postDraftKey,
  writeFeedDraft,
} from "@/components/clubs/molecules/feedDrafts";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";
import { clubPostRow } from "@/test/clubs/hubFixtures";

const CLUB_SLUG = "klub-energetyczny";

const SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map([
  [CLUB_IDS.group, { id: CLUB_IDS.group, name: "Kuluary", accent: "#0f766e", icon: "lock" }],
]);

/** Załącznik-zdjęcie w formie, w jakiej leży w `jsonb` wpisu. */
function imageAttachment(path: string, extra: Record<string, Json> = {}): Json {
  return {
    type: "image",
    path,
    name: path,
    mime: "image/png",
    size: 2048,
    width: 800,
    height: 600,
    ...extra,
  };
}

beforeEach(() => {
  h.previewed = [];
  cleanup();
  clearFeedDrafts();
});

describe("ClubPostCard - autor i pochodzenie", () => {
  it("autor z profilem publicznym prowadzi do profilu, dział świeci się jako aktywny filtr", () => {
    const onSourceSelect = vi.fn();
    render(
      <ClubPostCard
        post={clubPostRow({ group_id: CLUB_IDS.group, edited_at: clubIsoOffset(15) })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        sourceIndex={SOURCES}
        activeGroupId={CLUB_IDS.group}
        onSourceSelect={onSourceSelect}
      />,
    );

    const card = screen.getByTestId("club-feed-post");
    expect(card.getAttribute("data-post-id")).toBe("post-1");
    expect(within(card).getByRole("link", { name: "Anna Nowak" }).getAttribute("href")).toBe(
      "/people/anna-nowak",
    );
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(CLUB_BASE_ISO);
    expect(within(card).getByText("club.post.edited")).toBeTruthy();

    const chip = within(card).getByRole("button", { name: /Kuluary/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // Chip AKTYWNEGO działu zdejmuje filtr - ten sam gest w obie strony.
    fireEvent.click(chip);
    expect(onSourceSelect).toHaveBeenCalledWith(null);
  });

  it("autor bez profilu publicznego jest tekstem, nie linkiem", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ author_slug: null })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(screen.queryByRole("link", { name: "Anna Nowak" })).toBeNull();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });

  it("wpis po usuniętym koncie zachowuje treść, a autorstwo schodzi do klucza", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ author_id: null, author_name: null, author_slug: null })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(screen.getAllByText("club.deletedAuthor").length).toBeGreaterThan(0);
    expect(screen.getByText("Krótka notatka z posiedzenia.")).toBeTruthy();
  });

  it("wpis bez działu i bez edycji nie rysuje ani chipu, ani dopisku o poprawce", () => {
    render(<ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} />);

    const card = screen.getByTestId("club-feed-post");
    expect(within(card).queryByText("Kuluary")).toBeNull();
    expect(within(card).queryByText("club.post.edited")).toBeNull();
  });
});

describe("ClubPostCard - podpięcie pod wątek i wejście w dyskusję", () => {
  it("wpis podpięty pod wątek pokazuje plakietkę wątku, a „Komentuj” zostaje pod wpisem", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: "Temat pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const plaque = screen.getByTestId("club-post-thread-link");
    expect(plaque.getAttribute("href")).toBe("/club/klub-energetyczny/t/temat-pierwszy");
    // Tytuł wątku jest etykietą huba: pełny, zawinięty - nie ucięty.
    const title = within(plaque).getByText("Temat pierwszy");
    expect(title.className).not.toContain("truncate");
    expect(title.className).toContain("min-h-6");
    expect(title.className).toContain("text-[length:var(--fs-button)]");

    // „Komentuj" to PRZYCISK sekcji w karcie, nie link do wątku.
    const comment = screen.getByTestId("club-post-comment");
    expect(comment.tagName).toBe("BUTTON");
    expect(comment.hasAttribute("href")).toBe(false);
    // Zakładanie wątku zniknęło - wpis ma własną rozmowę.
    expect(screen.queryByTestId("club-post-start-thread")).toBeNull();
  });

  it("wątek bez tytułu (projekcja bez nazwy) dostaje zastępczy klucz plakietki", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: null })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(
      within(screen.getByTestId("club-post-thread-link")).getByText("club.post.inThread"),
    ).toBeTruthy();
  });

  it("`hideThreadLink` zdejmuje plakietkę i udostępnienie, ale NIE komentarze", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: "Temat pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        hideThreadLink
      />,
    );

    expect(screen.queryByTestId("club-post-thread-link")).toBeNull();
    expect(screen.queryByTestId("club-feed-share")).toBeNull();
    // Komentarze żyją pod wpisem - ekran wątku nie prowadzi przez nie do siebie.
    expect(screen.getByTestId("club-post-comment")).toBeTruthy();
  });
});

describe("ClubPostCard - komentarze w karcie", () => {
  it("„Komentuj” przełącza sekcję: aria-controls wskazuje istniejący węzeł, treść montuje się dopiero po otwarciu", () => {
    render(
      <ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} signedIn canComment />,
    );

    const toggle = screen.getByTestId("club-post-comment");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const zoneId = toggle.getAttribute("aria-controls") ?? "";
    const zone = document.getElementById(zoneId);
    // Węzeł istnieje także przy zwiniętej sekcji - `aria-controls` nie wisi w próżni.
    expect(zone).not.toBeNull();
    expect(zone?.hidden).toBe(true);
    expect(zone?.getAttribute("data-feed-zone")).toBe("comments");
    expect(zone?.getAttribute("aria-label")).toBe("club.comments.sectionLabel");
    // Zero zapytań przed rozwinięciem: sekcja nie jest zamontowana.
    expect(screen.queryByTestId("club-feed-comments-stub")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(zone?.hidden).toBe(false);
    const stub = screen.getByTestId("club-feed-comments-stub");
    expect(stub.getAttribute("data-mode")).toBe("write");
    expect(stub.getAttribute("data-post-id")).toBe("post-1");
    expect(stub.getAttribute("data-club-slug")).toBe(CLUB_SLUG);
    // Otwarcie przyciskiem prosi sekcję o fokus w polu.
    expect(stub.getAttribute("data-focus-key")).toBe("1");

    // Zwinięcie chowa sekcję, ale jej nie odmontowuje - szkic zostaje.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(zone?.hidden).toBe(true);
    expect(screen.getByTestId("club-feed-comments-stub")).toBeTruthy();
  });

  it("licznik komentarzy w pasie liczników rozwija sekcję, a drugi klik jej nie zwija", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ comment_count: 4 })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        signedIn
      />,
    );

    const counter = screen.getByTestId("club-post-comment-count");
    expect(counter.textContent).toBe("club.comments.count(count=4)");
    expect(counter.closest('[data-feed-zone="social"]')).not.toBeNull();
    // Rozmiar na PODPISIE, nie na przycisku: atom przycisku wymusza
    // `--fs-button`, a sąsiedzi w pasie liczników mają 11 px (`text-xs`).
    expect(counter.firstElementChild).toHaveClass("text-xs");
    expect(counter.className).not.toContain("text-xs");
    // Akcja niesie liczbę w nazwie dostępnej.
    expect(screen.getByTestId("club-post-comment").getAttribute("aria-label")).toBe(
      "club.hub.feed.commentWithCount(n=4)",
    );

    fireEvent.click(counter);
    expect(counter.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(counter);
    expect(counter.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("club-feed-comments-stub").getAttribute("data-focus-key")).toBe("2");
  });

  it("karta wracająca do strumienia z niewysłanym komentarzem sama rozwija rozmowę", () => {
    // Hub podmienił strumień (wyszukiwanie, szkielet) i karta się odmontowała -
    // szkic przeżył w rejestrze, więc po powrocie czeka w otwartej sekcji.
    writeFeedDraft(postDraftKey("post-1"), "Pół zdania");
    render(<ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} signedIn />);

    expect(screen.getByTestId("club-post-comment").getAttribute("aria-expanded")).toBe("true");
    // Bez kradzieży fokusu - czytelnik nie prosił o pole.
    expect(screen.getByTestId("club-feed-comments-stub").getAttribute("data-focus-key")).toBe("0");

    cleanup();
    // Sam biały znak to nie szkic.
    writeFeedDraft(postDraftKey("post-1"), "   ");
    render(<ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} signedIn />);
    expect(screen.getByTestId("club-post-comment").getAttribute("aria-expanded")).toBe("false");
  });

  it("bez komentarzy licznik nie istnieje, a etykieta akcji nie ma liczby", () => {
    render(<ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} />);
    expect(screen.queryByTestId("club-post-comment-count")).toBeNull();
    expect(screen.getByTestId("club-post-comment").getAttribute("aria-label")).toBe(
      "club.hub.feed.comment",
    );
  });

  it.each([
    ["gość", { signedIn: false, canComment: false, can_comment: false }, "guest"],
    [
      "bez prawa głosu w klubie",
      { signedIn: true, canComment: false, can_comment: true },
      "readOnly",
    ],
    [
      "bez prawa głosu w DZIALE wpisu",
      { signedIn: true, canComment: true, can_comment: false },
      "readOnly",
    ],
    ["z prawem głosu", { signedIn: true, canComment: true, can_comment: true }, "write"],
  ])("tryb sekcji: %s", (_label, input, expected) => {
    render(
      <ClubPostCard
        post={clubPostRow({ can_comment: input.can_comment })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        signedIn={input.signedIn}
        canComment={input.canComment}
      />,
    );
    // Przycisk stoi w KAŻDYM trybie - czytanie komentarzy nie wymaga głosu.
    fireEvent.click(screen.getByTestId("club-post-comment"));
    expect(screen.getByTestId("club-feed-comments-stub").getAttribute("data-mode")).toBe(expected);
  });

  it("wpis wskazany adresem rozwija komentarze sam - BEZ prośby o fokus", () => {
    const { rerender } = render(
      <ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} signedIn />,
    );
    expect(screen.queryByTestId("club-feed-comments-stub")).toBeNull();

    // Karta już stała w strumieniu, a adres zmienił się na `?post=<ten wpis>`.
    rerender(
      <ClubPostCard
        post={clubPostRow()}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        signedIn
        focusComments
      />,
    );
    expect(screen.getByTestId("club-post-comment").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("club-feed-comments-stub").getAttribute("data-focus-key")).toBe("0");
  });

  it("wpis wskazany adresem już przy pierwszym renderze startuje z rozwiniętą sekcją", () => {
    render(
      <ClubPostCard
        post={clubPostRow()}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        signedIn
        focusComments
      />,
    );
    expect(screen.getByTestId("club-post-comment").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("club-feed-comments-stub")).toBeTruthy();
  });
});

describe("ClubPostCard - treść", () => {
  it("adresy, wzmianki i tagi w treści idą przez wspólny renderer klubowy", () => {
    renderWithQueryClient(
      <ClubPostCard
        post={clubPostRow({
          body: "Raport od @anna-nowak jest tu https://komisja.example/raport.pdf w #energia.",
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const link = screen.getByRole("link", { name: "https://komisja.example/raport.pdf" });
    expect(link.getAttribute("href")).toBe("https://komisja.example/raport.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("ugc");
    expect(document.querySelector("[data-mention='anna-nowak']")).toBeTruthy();
    expect(document.querySelector("[data-club-tag='energia']")).toBeTruthy();
  });

  it("wpis z samych spacji (sam załącznik) nie rysuje akapitu treści", () => {
    const { container } = render(
      <ClubPostCard
        post={clubPostRow({ body: "   ", attachments: [imageAttachment("a/1.png")] })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/1.png": "https://podpis.example/1.png" }}
      />,
    );

    // Celujemy w AKAPIT TREŚCI po jego klasach, a nie w „jakikolwiek <p>":
    // bylina niesie teraz wizytówkę autora, której dymek też jest akapitem, a
    // pod atrapą Radiksa stoi w DOM-ie bez otwierania.
    expect(container.querySelector("p.whitespace-pre-wrap")).toBeNull();
    expect(screen.getByTestId("club-post-images")).toBeTruthy();
  });
});

describe("ClubPostCard - załączniki graficzne i pliki", () => {
  it("zdjęcie z podpisanym adresem otwiera podgląd W PLATFORMIE", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ attachments: [imageAttachment("a/1.png")] })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/1.png": "https://podpis.example/1.png" }}
      />,
    );

    const grid = screen.getByTestId("club-post-images");
    expect(grid.getAttribute("data-layout")).toBe("single");
    const button = within(grid).getByRole("button", { name: "club.post.preview: a/1.png" });
    // Rama pojedynczego zdjęcia z metadanych: 800 x 600 mieści się w 4:5..1.91:1.
    expect(button.parentElement?.getAttribute("style")).toContain("aspect-ratio: 1.3333");
    fireEvent.click(button);

    expect(h.previewed).toEqual([
      { url: "https://podpis.example/1.png", name: "a/1.png", mime: "image/png", size: 2048 },
    ]);
    expect(screen.getByTestId("club-post-viewer")).toBeTruthy();
    expect(screen.getByText("club.post.attachmentsCount(count=1)")).toBeTruthy();
  });

  it("pionowe zdjęcie 4:5 stoi na środku pasa z rozmytym tłem i sufitem szerokości", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [imageAttachment("a/pion.png", { width: 1080, height: 1350 })],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/pion.png": "https://podpis.example/pion.png" }}
      />,
    );

    const grid = screen.getByTestId("club-post-images");
    expect(grid.getAttribute("style")).toContain("max-width: calc(40rem * 0.8000)");
    // Rozmyte tło to druga kopia tego samego pliku - ukryta przed czytnikiem.
    const backdrop = grid.parentElement?.querySelector('img[aria-hidden="true"]');
    expect(backdrop?.getAttribute("src")).toBe("https://podpis.example/pion.png");
  });

  it("zdjęcie BEZ podpisanego adresu jest zastępnikiem i nie da się go kliknąć", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            imageAttachment("a/1.png"),
            imageAttachment("a/2.png", { width: null, height: null }),
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const grid = screen.getByTestId("club-post-images");
    // Dwa zdjęcia = para obok siebie; oba bez adresu, więc oba wyłączone.
    expect(grid.getAttribute("data-layout")).toBe("pair");
    const buttons = within(grid).getAllByRole("button");
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(grid.querySelector("img")).toBeNull();

    fireEvent.click(buttons[0]);
    expect(h.previewed).toEqual([]);
  });

  it("trzy zdjęcia z poziomym pierwszym: kafel główny u góry, dwa pod nim", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            imageAttachment("a/1.png", { width: 1200, height: 627 }),
            imageAttachment("a/2.png"),
            imageAttachment("a/3.png", { width: null, height: null }),
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{
          "a/1.png": "https://podpis.example/1.png",
          "a/2.png": "https://podpis.example/2.png",
          "a/3.png": "https://podpis.example/3.png",
        }}
      />,
    );

    const grid = screen.getByTestId("club-post-images");
    expect(grid.getAttribute("data-layout")).toBe("top");
    const buttons = within(grid).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    // Kafel główny ma ramę 1.91:1, miniatury dzielą rząd 3:1 po równo.
    expect(buttons[0]?.parentElement?.getAttribute("style")).toContain("aspect-ratio: 1.91");
    expect(buttons[1]?.parentElement?.getAttribute("style")).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
    // Oba wiersze mają `min-h-0` - załadowany obraz nie rozpycha ich ponad proporcję.
    expect(buttons[0]?.parentElement?.className).toContain("min-h-0");
    expect(buttons[1]?.parentElement?.className).toContain("min-h-0");
    expect(screen.getByText("club.post.attachmentsCount(count=3)")).toBeTruthy();
  });

  it("kwadratowe pierwsze zdjęcie bierze lewą kolumnę, nadwyżka idzie do „+N”", () => {
    const attachments = [
      imageAttachment("a/1.png", { width: 1080, height: 1080 }),
      ...Array.from({ length: 5 }, (_, i) => imageAttachment(`a/${i + 2}.png`)),
    ];
    render(
      <ClubPostCard
        post={clubPostRow({ attachments })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/4.png": "https://podpis.example/4.png" }}
      />,
    );

    const grid = screen.getByTestId("club-post-images");
    expect(grid.getAttribute("data-layout")).toBe("left");
    expect(grid.getAttribute("data-overflow")).toBe("2");
    const buttons = within(grid).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.className).toContain("row-span-full");
    // Ostatni widoczny kafel niesie licznik nadwyżki i ROZWIJA galerię -
    // podgląd w platformie pokazuje jeden plik, więc bez tego zdjęcia od
    // piątego w górę byłyby nieosiągalne.
    const more = buttons[3] as HTMLElement;
    expect(more.getAttribute("aria-label")).toBe("club.post.showAllImages(count=6)");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(within(more).getByText("+2")).toBeTruthy();

    fireEvent.click(more);
    expect(h.previewed).toEqual([]);
    const all = screen.getByTestId("club-post-images");
    expect(all.getAttribute("data-layout")).toBe("all");
    const tiles = within(all).getAllByRole("button");
    expect(tiles).toHaveLength(6);
    // Odsłonięte zdjęcia nie mają jeszcze podpisu (wyłączone zastępniki),
    // więc fokus trafia na samą siatkę - nie ginie na niewidocznym kaflu.
    expect(tiles[4]?.hasAttribute("disabled")).toBe(true);
    expect(document.activeElement).toBe(all);
    fireEvent.click(tiles[3] as HTMLElement);
    expect(h.previewed).toEqual([
      { url: "https://podpis.example/4.png", name: "a/4.png", mime: "image/png", size: 2048 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "club.post.showFewerImages" }));
    const collapsed = screen.getByTestId("club-post-images");
    expect(collapsed.getAttribute("data-layout")).toBe("left");
    // Zwinięcie oddaje fokus kaflowi „+N" - nie ginie na <body>.
    expect(document.activeElement).toBe(within(collapsed).getAllByRole("button")[3]);
  });

  it("po rozwinięciu fokus trafia na pierwsze odsłonięte zdjęcie, które da się otworzyć", () => {
    const attachments = Array.from({ length: 5 }, (_, i) => imageAttachment(`b/${i + 1}.png`));
    render(
      <ClubPostCard
        post={clubPostRow({ attachments })}
        clubSlug={CLUB_SLUG}
        mediaUrls={Object.fromEntries(
          attachments.map((_, i) => [`b/${i + 1}.png`, `https://podpis.example/b${i + 1}.png`]),
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.post.showAllImages(count=5)" }));
    const tiles = within(screen.getByTestId("club-post-images")).getAllByRole("button");
    expect(tiles).toHaveLength(5);
    expect(document.activeElement).toBe(tiles[4]);
  });

  it("nagranie: z adresem odtwarzacz, bez adresu sam zastępnik", () => {
    const video: Json = {
      type: "video",
      path: "a/film.mp4",
      name: "film.mp4",
      mime: "video/mp4",
      size: 1_048_576,
      width: null,
      height: null,
    };
    const { container, rerender } = render(
      <ClubPostCard
        post={clubPostRow({ attachments: [video] })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/film.mp4": "https://podpis.example/film.mp4" }}
      />,
    );

    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://podpis.example/film.mp4",
    );

    rerender(
      <ClubPostCard
        post={clubPostRow({ attachments: [video] })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("plik z podglądem dostaje przycisk i dopisek, archiwum - ani jednego, ani drugiego", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "file",
              path: "a/raport.pdf",
              name: "raport.pdf",
              mime: "application/pdf",
              size: 2048,
              width: null,
              height: null,
            },
            {
              type: "file",
              path: "a/paczka.zip",
              name: "paczka.zip",
              mime: "application/zip",
              size: 0,
              width: null,
              height: null,
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/raport.pdf": "https://podpis.example/raport.pdf" }}
      />,
    );

    // PDF: etykieta rodzaju, rozmiar binarny, dopisek o podglądzie i przycisk.
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.getByText("2.0 kB · club.post.preview")).toBeTruthy();
    const previewButtons = screen.getAllByRole("button", { name: /club.post.preview/ });
    expect(previewButtons.length).toBe(1);
    fireEvent.click(previewButtons[0]);
    expect(h.previewed).toEqual([
      {
        url: "https://podpis.example/raport.pdf",
        name: "raport.pdf",
        mime: "application/pdf",
        size: 2048,
      },
    ]);

    // Archiwum: bez podglądu, a rozmiar zerowy nie pokazuje „0 B”.
    expect(screen.getByText("ZIP")).toBeTruthy();
    expect(screen.getByText("paczka.zip")).toBeTruthy();
    // Nazwa pliku zawija się zamiast ucinać - koniec nazwy to często wersja.
    expect(screen.getByText("raport.pdf").className).not.toContain("truncate");
    const links = screen.getAllByRole("link", { name: /club.post.openFile/ });
    expect(links.length).toBe(2);
    // Plik bez podpisanego adresu nie prowadzi nigdzie poza zaślepkę.
    expect(links[1]?.getAttribute("href")).toBe("#");
  });

  it("rozmiar pliku schodzi do jednostek megabajtowych bez części dziesiętnej powyżej dziesięciu", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "file",
              path: "a/duzy.zip",
              name: "duzy.zip",
              mime: "application/zip",
              size: 15 * 1024 * 1024,
              width: null,
              height: null,
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(screen.getByText("15 MB")).toBeTruthy();
  });
});

describe("ClubPostCard - podgląd linku", () => {
  it("link z opisem i obrazkiem: nazwa hosta z adresu, karta i dymek z tą samą treścią", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "link",
              url: "https://komisja.example/akt",
              title: "Akt delegowany",
              description: "Streszczenie aktu",
              image: "https://komisja.example/okladka.png",
              siteName: null,
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const card = screen.getByTestId("club-post-link");
    expect(card.getAttribute("href")).toBe("https://komisja.example/akt");
    expect(within(card).getByText("komisja.example")).toBeTruthy();
    expect(within(card).getByText("Akt delegowany")).toBeTruthy();
    // Opis nie mieści się na karcie - żyje w dymku, karta niesie tytuł i host.
    expect(within(card).queryByText("Streszczenie aktu")).toBeNull();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "https://komisja.example/okladka.png",
    );
    // Obraz podglądu w formacie `og:image` - 1.91:1.
    expect(card.querySelector("img")?.parentElement?.getAttribute("style")).toContain(
      "aspect-ratio: 1.91",
    );

    const popup = screen.getByTestId("club-post-link-popup");
    expect(within(popup).getByText("Akt delegowany")).toBeTruthy();
    expect(within(popup).getByText("Streszczenie aktu")).toBeTruthy();
    expect(popup.querySelector("img")).not.toBeNull();
  });

  it("`siteName` z serwera wygrywa nad nazwą hosta z adresu", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "link",
              url: "https://komisja.example/akt",
              title: null,
              description: "Streszczenie",
              image: null,
              siteName: "Komisja Europejska",
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const card = screen.getByTestId("club-post-link");
    expect(within(card).getByText("Komisja Europejska")).toBeTruthy();
    // Bez tytułu w napisie zostaje sam adres - link musi dać się rozpoznać.
    expect(within(card).getByText("https://komisja.example/akt")).toBeTruthy();
    expect(card.querySelector("img")).toBeNull();
    // Dymek jest, bo jest opis - ale bez obrazka.
    expect(screen.getByTestId("club-post-link-popup").querySelector("img")).toBeNull();
  });

  it("dymek pojawia się także bez opisu, gdy jest sam obrazek", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "link",
              url: "https://komisja.example/akt",
              title: "Akt delegowany",
              description: null,
              image: "https://komisja.example/okladka.png",
              siteName: "Komisja Europejska",
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const popup = screen.getByTestId("club-post-link-popup");
    expect(popup.querySelector("img")).not.toBeNull();
    expect(within(popup).getByText("Akt delegowany")).toBeTruthy();
    // Bez opisu dymek nie rysuje pustego akapitu.
    expect(popup.querySelectorAll("p").length).toBe(2);
  });

  it("niepoprawny adres z opisem: klucz `link` stoi ZARAZEM na karcie i w dymku", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "link",
              url: "to-nie-jest-adres",
              title: null,
              description: "Streszczenie notatki",
              image: null,
              siteName: null,
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(within(screen.getByTestId("club-post-link")).getByText("club.post.link")).toBeTruthy();
    const popup = screen.getByTestId("club-post-link-popup");
    expect(within(popup).getByText("club.post.link")).toBeTruthy();
    expect(within(popup).getByText("Streszczenie notatki")).toBeTruthy();
    // Bez tytułu w obu miejscach zostaje surowy adres - link musi być rozpoznawalny.
    expect(within(popup).getByText("to-nie-jest-adres")).toBeTruthy();
  });

  it("adres, którego nie da się rozłożyć, nie wywraca karty - zostaje klucz `link`", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            {
              type: "link",
              url: "to-nie-jest-adres",
              title: "Notatka",
              description: null,
              image: null,
              siteName: null,
            },
          ],
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const card = screen.getByTestId("club-post-link");
    expect(within(card).getByText("club.post.link")).toBeTruthy();
    // Bez opisu i bez obrazka dymek nie miałby czego pokazać - i go nie ma.
    expect(screen.queryByTestId("club-post-link-popup")).toBeNull();
  });
});

describe("ClubPostCard - polubienie i menu zarządzania", () => {
  it("polubienie oddaje ID wpisu, a liczba stoi w pasie liczników", () => {
    const onLike = vi.fn();
    render(
      <ClubPostCard
        post={clubPostRow({ like_count: 3, liked_by_me: true })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        onLike={onLike}
      />,
    );

    const button = screen.getByTestId("club-post-like");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("club.hub.feed.likeWithCount(count=3)");
    expect(screen.getByTestId("club-reaction-summary").textContent).toContain(
      "club.hub.feed.reactors.youAndOthers(count=2)",
    );
    fireEvent.click(button);
    expect(onLike).toHaveBeenCalledWith("post-1");
  });

  it("bez podanej akcji polubienie jest WYŁĄCZONE, a zero polubień nie rysuje licznika", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ like_count: 0, liked_by_me: false })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const button = screen.getByRole("button", { name: "club.post.like" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("club-reaction-summary")).toBeNull();
  });

  it("cudze docenienie bez mojego pokazuje samą liczbę", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ like_count: 5, liked_by_me: false })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(screen.getByTestId("club-reaction-summary").textContent).toContain("5");
  });

  it("wpis podpięty pod wątek można udostępnić - adresem wątku", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: "Temat pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );
    expect(screen.getByTestId("club-feed-share")).toBeTruthy();

    cleanup();
    render(<ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} />);
    // Wpis bez wątku nie ma własnego adresu - nie ma czego udostępnić.
    expect(screen.queryByTestId("club-feed-share")).toBeNull();
  });

  it("menu zarządzania otwiera się, usuwa wpis i zamyka się po wyborze", () => {
    const onDelete = vi.fn();
    render(
      <ClubPostCard
        post={clubPostRow({ can_manage: true })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        onDelete={onDelete}
      />,
    );

    const menu = screen.getByRole("button", { name: "club.post.menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /club.post.delete/ })).toBeNull();

    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /club.post.delete/ }));
    expect(onDelete).toHaveBeenCalledWith("post-1");
    expect(screen.queryByRole("button", { name: /club.post.delete/ })).toBeNull();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("prawo zarządzania BEZ podanej akcji nie daje przycisku, który nic nie robi", () => {
    render(
      <ClubPostCard post={clubPostRow({ can_manage: true })} clubSlug={CLUB_SLUG} mediaUrls={{}} />,
    );

    expect(screen.queryByRole("button", { name: "club.post.menu" })).toBeNull();
  });

  it("brak prawa zarządzania nie daje menu nawet z podaną akcją usunięcia", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ can_manage: false })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        onDelete={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "club.post.menu" })).toBeNull();
  });

  it("dodatkowa klasa układu nie zjada powierzchni karty", () => {
    render(
      <ClubPostCard post={clubPostRow()} clubSlug={CLUB_SLUG} mediaUrls={{}} className="mt-6" />,
    );

    const card = screen.getByTestId("club-feed-post");
    expect(card.className).toContain("mt-6");
    expect(card.className).toContain("bg-card");
  });
});
