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
//     gdzie wątek JEST kontekstem ekranu, i wtedy zdejmuje też wejście
//     w dyskusję - inaczej ekran wątku proponowałby przejście do siebie.
// (3) KOMENTARZ PROWADZI DO WĄTKU, A GDY WĄTKU NIE MA - DO JEGO ZAŁOŻENIA.
//     Martwy przycisk jest tu najgorszą opcją, a nowy wątek musi wystartować
//     W TYM DZIALE, z którego pochodzi wpis (parametr `groupId`), inaczej
//     materiał ucieka z działu, w którym go opublikowano.
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
//     mówi czytnikowi ekranu, czy wpis jest już polubiony, a licznik zastępuje
//     etykietę dopiero od pierwszego polubienia.
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
    Content: ({ children }: { children?: ReactNode }) => (
      <div data-testid="club-post-link-popup">{children}</div>
    ),
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

import { ClubPostCard } from "@/components/clubs/organisms/ClubPostCard";
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
      "/author/anna-nowak",
    );
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(CLUB_BASE_ISO);
    expect(within(card).getByText("(club.post.edited)")).toBeTruthy();

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
    expect(within(card).queryByText("(club.post.edited)")).toBeNull();
  });
});

describe("ClubPostCard - podpięcie pod wątek i wejście w dyskusję", () => {
  it("wpis podpięty pod wątek pokazuje plakietkę wątku i prowadzi do kompozytora odpowiedzi", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: "Temat pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const plaque = screen.getByTestId("club-post-thread-link");
    expect(plaque.getAttribute("href")).toBe("/club/klub-energetyczny/t/temat-pierwszy");
    expect(within(plaque).getByText("Temat pierwszy")).toBeTruthy();

    const comment = screen.getByTestId("club-post-comment");
    expect(comment.getAttribute("href")).toBe("/club/klub-energetyczny/t/temat-pierwszy");
    expect(comment.getAttribute("data-search")).toBe('{"reply":true}');
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

  it("wpis BEZ wątku proponuje jego założenie - w dziale, z którego pochodzi", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ group_id: CLUB_IDS.group, thread_slug: null })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const start = screen.getByTestId("club-post-start-thread");
    expect(start.getAttribute("href")).toBe("/club/klub-energetyczny/new");
    expect(start.getAttribute("data-search")).toBe(`{"groupId":"${CLUB_IDS.group}"}`);
    expect(screen.queryByTestId("club-post-comment")).toBeNull();
  });

  it("wpis bez wątku i bez działu zakłada wątek bez zawężenia do działu", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ group_id: null, thread_slug: null })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    expect(screen.getByTestId("club-post-start-thread").getAttribute("data-search")).toBe("{}");
  });

  it("`hideThreadLink` zdejmuje ZARAZEM plakietkę i wejście w dyskusję", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy", thread_title: "Temat pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        hideThreadLink
      />,
    );

    expect(screen.queryByTestId("club-post-thread-link")).toBeNull();
    expect(screen.queryByTestId("club-post-comment")).toBeNull();
    expect(screen.queryByTestId("club-post-start-thread")).toBeNull();
  });

  it("bez prawa głosu w klubie nie ma ani komentarza, ani zakładania wątku", () => {
    render(
      <ClubPostCard
        post={clubPostRow({ thread_slug: "temat-pierwszy" })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        canComment={false}
      />,
    );

    expect(screen.queryByTestId("club-post-comment")).toBeNull();
    expect(screen.queryByTestId("club-post-start-thread")).toBeNull();
    // Plakietka wątku ZOSTAJE - czytanie nie wymaga prawa głosu.
    expect(screen.getByTestId("club-post-thread-link")).toBeTruthy();
  });
});

describe("ClubPostCard - treść", () => {
  it("adresy w treści stają się linkami bez protokołu w napisie, reszta zostaje tekstem", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          body: "Raport jest tu https://komisja.example/raport.pdf - warto przeczytać.",
        })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
      />,
    );

    const link = screen.getByRole("link", { name: "komisja.example/raport.pdf" });
    expect(link.getAttribute("href")).toBe("https://komisja.example/raport.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.getByText(/warto przeczytać/)).toBeTruthy();
  });

  it("wpis z samych spacji (sam załącznik) nie rysuje akapitu treści", () => {
    const { container } = render(
      <ClubPostCard
        post={clubPostRow({ body: "   ", attachments: [imageAttachment("a/1.png")] })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{ "a/1.png": "https://podpis.example/1.png" }}
      />,
    );

    expect(container.querySelector("p")).toBeNull();
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
    expect(grid.className).toContain("grid-cols-1");
    const button = within(grid).getByRole("button", { name: "club.post.preview: a/1.png" });
    fireEvent.click(button);

    expect(h.previewed).toEqual([
      { url: "https://podpis.example/1.png", name: "a/1.png", mime: "image/png", size: 2048 },
    ]);
    expect(screen.getByTestId("club-post-viewer")).toBeTruthy();
    expect(screen.getByText("club.post.attachmentsCount(count=1)")).toBeTruthy();
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
    // Dwa zdjęcia = dwie kolumny; oba bez adresu, więc oba wyłączone.
    expect(grid.className).toContain("grid-cols-2");
    const buttons = within(grid).getAllByRole("button");
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(grid.querySelector("img")).toBeNull();

    fireEvent.click(buttons[0]);
    expect(h.previewed).toEqual([]);
  });

  it("trzy zdjęcia: pierwsze zajmuje dwie kolumny, proporcja idzie z metadanych", () => {
    render(
      <ClubPostCard
        post={clubPostRow({
          attachments: [
            imageAttachment("a/1.png"),
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

    const buttons = within(screen.getByTestId("club-post-images")).getAllByRole("button");
    expect(buttons[0]?.className).toContain("first:col-span-2");
    expect(buttons[0]?.getAttribute("style")).toContain("aspect-ratio: 800 / 600");
    // Bez metadanych proporcji karta i tak rezerwuje miejsce - strumień nie skacze.
    expect(buttons[2]?.getAttribute("style")).toContain("aspect-ratio: 16 / 9");
    expect(screen.getByText("club.post.attachmentsCount(count=3)")).toBeTruthy();
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
    expect(within(card).getByText("Streszczenie aktu")).toBeTruthy();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "https://komisja.example/okladka.png",
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
  it("polubienie oddaje ID wpisu, a licznik zastępuje etykietę", () => {
    const onLike = vi.fn();
    render(
      <ClubPostCard
        post={clubPostRow({ like_count: 3, liked_by_me: true })}
        clubSlug={CLUB_SLUG}
        mediaUrls={{}}
        onLike={onLike}
      />,
    );

    const button = screen.getByRole("button", { name: "3" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onLike).toHaveBeenCalledWith("post-1");
  });

  it("bez podanej akcji polubienie jest WYŁĄCZONE, a zero polubień pokazuje etykietę", () => {
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
