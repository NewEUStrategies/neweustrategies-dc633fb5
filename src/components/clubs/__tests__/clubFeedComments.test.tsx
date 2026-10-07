// Rozmowa wprost w karcie strumienia: komentarze wpisu ściany
// (`ClubFeedComments`), podgląd i odpowiedź w wątku (`ClubFeedThreadReplies`)
// oraz wzmianki i karta linku w kompozytorze nowego wpisu (`ClubPostComposer`).
//
// CO TEN PLIK DOWODZI. Przez PRAWDZIWĄ warstwę danych (hooki -> `supabase.rpc`
// atrapy `clubRpc`), więc asercje patrzą na argumenty RPC, a nie na zaślepki:
//  1. LISTA czyta się od góry (najstarszy nad najnowszym), choć RPC oddaje
//     najnowsze pierwsze; „Wczytaj wcześniejsze (N)" idzie kursorem keyset
//     `(created_at, id)` ostatniego wiersza; pusta lista i awaria mają własne
//     zdania, a awaria - ponowienie.
//  2. WIERSZ: treść przez wspólny renderer klubu (link `ugc`, wzmianka), karta
//     linku z MIGAWKI (tylko https), plakietka i inny dymek dla `pending`,
//     pseudonim (Chatham House) bez odnośnika i bez „Odpowiedz".
//  3. KOMPOZYTOR: przycisk i Ctrl/Cmd+Enter mają JEDNĄ regułę wysyłki, treść
//     jedzie przycięta, sukces czyści pole i mówi, czy komentarz czeka na
//     moderację, odmowa bazy mapuje się na zdanie (`clubCommentErrorKey`)
//     i zostawia szkic. „Odpowiedz" wstawia `@slug ` bez dublowania.
//  4. WZMIANKI mają ZAKRES KLUBU (`club_mention_members` z `p_club_id`) obok
//     publicznego katalogu; Escape zamyka listę, Enter wybiera osobę, a przy
//     otwartej liście Ctrl+Enter NIE wysyła.
//  5. LINK: pierwszy adres https dostaje kartę; migawka jedzie do RPC
//     (`p_link_preview` / element `type: "link"` wpisu), a „×" ją odrzuca na
//     stałe dla tego adresu. `http://` nie pyta serwera podglądów wcale.
//  6. USUWANIE pyta o potwierdzenie w miejscu (fokus na „Anuluj", powrót
//     fokusu na „Usuń" po anulowaniu) i dopiero wtedy woła RPC.
//  7. WĄTEK: podgląd dwóch najnowszych odpowiedzi (offset z `reply_count`),
//     „Zobacz całą dyskusję (N)" tylko, gdy coś zostało poza podglądem,
//     odpowiedź z karty jest GŁÓWNA i jawna; zamknięty wątek i gość dostają
//     zdanie zamiast kompozytora.
//  8. SŁOWNIKI: każdy klucz odmowy i liczba mnoga licznika mają tekst PL i EN.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Reguł czystych (`parseClubLinkSnapshot`, `clubCommentErrorKey`,
//    `canSubmitClubComment`, kluczy cache i unieważnień) - mają testy
//    w `src/lib/clubs/__tests__/`. Tu widać ich SKUTEK na ekranie.
//  - Katalogu wzmianek (`useMentionDirectory`) - dostawca jest atrapą, która
//    zapisuje slugi: dowodem jest KOMPLET slugów sekcji (zagnieżdżony dostawca
//    zastępuje zewnętrzny), nie zapytanie o profile.
//  - Debounce (`useDebouncedValue`) jest tożsamością - sprawdzamy reguły
//    kompozytora, nie zegar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubLinkPreview } from "@/lib/clubs/linkPreview.functions";

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  /** Odpowiedzi serwera podglądów po adresie (`undefined` = w drodze). */
  previews: {} as Record<string, ClubLinkPreview | null | undefined>,
  /** Adresy, o które kompozytor faktycznie zapytał. */
  previewAsked: [] as string[],
  /** Slugi ostatniego katalogu wzmianek sekcji. */
  directorySlugs: [] as readonly string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: ({ search, ...rest }: import("@/test/routerLinkStub").RouterLinkStubProps) => (
      <RouterLinkStub {...rest} data-search={JSON.stringify(search ?? null)} />
    ),
  };
});
vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));
vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: () => ({ data: null, isPending: false }),
}));
vi.mock("@/lib/clubs/useClubLinkPreview", () => ({
  useClubLinkPreview: (url: string | null, enabled: boolean) => {
    const active = enabled && typeof url === "string" && url !== "";
    if (active) h.previewAsked.push(url);
    const data = active ? h.previews[url] : undefined;
    return { data, isFetching: active && data === undefined };
  },
}));
vi.mock("@/components/mentions/MentionDirectory", () => ({
  MentionDirectoryProvider: ({
    slugs,
    children,
  }: {
    slugs: readonly string[];
    children?: ReactNode;
  }) => {
    h.directorySlugs = slugs;
    return <>{children}</>;
  },
  useMentionEntity: () => null,
}));

import { ClubFeedComments } from "@/components/clubs/molecules/ClubFeedComments";
import { ClubFeedThreadReplies } from "@/components/clubs/molecules/ClubFeedThreadReplies";
import { ClubPostComposer } from "@/components/clubs/molecules/ClubPostComposer";
import type { ClubFeedDiscussionMode } from "@/components/clubs/molecules/feedDiscussion";
import { CLUB_IDS, clubIsoOffset, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { clubPostCommentRow, clubReplyRow } from "@/test/clubs/hubFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { CLUB_COMMENT_ERROR_KEYS, type ClubPostCommentRow } from "@/lib/clubs/postTypes";
import { clubEn, clubPl } from "@/lib/i18n-club";

const CLUB_SLUG = "klub-energetyczny";
const POST = { id: "post-1", club_id: CLUB_IDS.club };
const LIST = "club_post_comments_list";
const CREATE = "club_post_comment_create";
const DELETE = "club_post_comment_delete";

/** Strona RPC: NAJNOWSZE PIERWSZE, `total_count` na każdym wierszu. */
function page(rows: ClubPostCommentRow[], total = rows.length): ClubPostCommentRow[] {
  return rows.map((row) => ({ ...row, total_count: total }));
}

function renderComments(mode: ClubFeedDiscussionMode = "write", focusKey = 0) {
  return renderWithQueryClient(
    <ClubFeedComments post={POST} clubSlug={CLUB_SLUG} mode={mode} focusKey={focusKey} />,
  );
}

function field(): HTMLTextAreaElement {
  const node = screen.getByRole("combobox", { name: "club.comments.fieldLabel" });
  if (!(node instanceof HTMLTextAreaElement)) throw new Error("pole komentarza nie jest polem");
  return node;
}

function type(node: HTMLTextAreaElement, value: string): void {
  fireEvent.change(node, { target: { value } });
  node.setSelectionRange(value.length, value.length);
  fireEvent.select(node);
}

function submitButton(): HTMLElement {
  return screen.getByTestId("club-feed-composer-submit");
}

beforeEach(() => {
  resetClubRpc();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.previews = {};
  h.previewAsked = [];
  h.directorySlugs = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  clubRpc.setData(LIST, []);
  clubRpc.setData(CREATE, [{ comment_id: "comment-new", comment_status: "visible" }]);
  clubRpc.setData(DELETE, true);
  clubRpc.setData("club_mention_members", []);
  clubRpc.setData("search_mention_targets", []);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClubFeedComments - lista", () => {
  it("czyta się od góry: najstarszy nad najnowszym, choć RPC oddaje najnowsze pierwsze", async () => {
    clubRpc.setData(
      LIST,
      page([
        clubPostCommentRow({ id: "c-3", body: "Trzeci", created_at: clubIsoOffset(3) }),
        clubPostCommentRow({ id: "c-2", body: "Drugi", created_at: clubIsoOffset(2) }),
        clubPostCommentRow({ id: "c-1", body: "Pierwszy", created_at: clubIsoOffset(1) }),
      ]),
    );
    renderComments();

    const items = await screen.findAllByTestId("club-feed-comment");
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual([
      "Pierwszy",
      "Drugi",
      "Trzeci",
    ]);
    const call = clubRpc.lastCall(LIST);
    expect(call?.arg("p_post_id")).toBe("post-1");
    expect(call?.arg("p_limit")).toBe(3);
    // Pierwsza strona bez kursora - serwerowy DEFAULT, nie `null`.
    expect(call?.arg("p_before")).toBeUndefined();
    expect(call?.arg("p_before_id")).toBeUndefined();
    // Komplet wczytany - nie ma czego doczytywać.
    expect(screen.queryByTestId("club-feed-comments-older")).toBeNull();
  });

  it("„Wczytaj wcześniejsze komentarze (N)” idzie kursorem keyset ostatniego wiersza", async () => {
    clubRpc.setResponse(LIST, (call) =>
      call.arg("p_before_id") === "c-3"
        ? {
            data: page(
              [
                clubPostCommentRow({ id: "c-2", body: "Drugi", created_at: clubIsoOffset(2) }),
                clubPostCommentRow({ id: "c-1", body: "Pierwszy", created_at: clubIsoOffset(1) }),
              ],
              5,
            ),
            error: null,
          }
        : {
            data: page(
              [
                clubPostCommentRow({ id: "c-5", body: "Piąty", created_at: clubIsoOffset(5) }),
                clubPostCommentRow({ id: "c-4", body: "Czwarty", created_at: clubIsoOffset(4) }),
                clubPostCommentRow({ id: "c-3", body: "Trzeci", created_at: clubIsoOffset(3) }),
              ],
              5,
            ),
            error: null,
          },
    );
    renderComments();

    const older = await screen.findByTestId("club-feed-comments-older");
    expect(older.textContent).toBe("club.comments.loadOlder(n=2)");
    fireEvent.click(older);

    await waitFor(() => expect(screen.getAllByTestId("club-feed-comment")).toHaveLength(5));
    const call = clubRpc.lastCall(LIST);
    expect(call?.arg("p_before")).toBe(clubIsoOffset(3));
    expect(call?.arg("p_before_id")).toBe("c-3");
    expect(
      screen
        .getAllByTestId("club-feed-comment")
        .map((item) => item.querySelector("p")?.textContent),
    ).toEqual(["Pierwszy", "Drugi", "Trzeci", "Czwarty", "Piąty"]);
    expect(screen.queryByTestId("club-feed-comments-older")).toBeNull();
  });

  it("pusta rozmowa ma zdanie zachęty, a awaria - zdanie i ponowienie", async () => {
    renderComments();
    expect(await screen.findByText("club.comments.empty")).toBeTruthy();

    cleanup();
    clubRpc.setError(LIST, "network down");
    renderComments();
    expect(await screen.findByText("club.comments.loadFailed")).toBeTruthy();
    const before = clubRpc.callsFor(LIST).length;
    clubRpc.setData(LIST, page([clubPostCommentRow({ body: "Po ponowieniu" })]));
    fireEvent.click(screen.getByRole("button", { name: "club.comments.retry" }));
    expect(await screen.findByText("Po ponowieniu")).toBeTruthy();
    expect(clubRpc.callsFor(LIST).length).toBeGreaterThan(before);
  });

  it("wiersz: link `ugc`, wzmianka, karta linku z migawki i plakietka moderacji", async () => {
    clubRpc.setData(
      LIST,
      page([
        clubPostCommentRow({
          id: "c-pending",
          status: "pending",
          can_manage: true,
          body: "Dzięki @anna-nowak, źródło: https://komisja.example/akt",
          link_preview: {
            url: "https://komisja.example/akt",
            title: "Akt delegowany",
            description: "Streszczenie",
            image: "https://komisja.example/okladka.png",
            siteName: "Komisja Europejska",
          },
        }),
        clubPostCommentRow({
          id: "c-bad-link",
          // Migawka spoza https NIE rysuje karty - nawet zapisana z pominięciem RPC.
          link_preview: { url: "javascript:alert(1)", title: "x" },
        }),
      ]),
    );
    renderComments();

    const [badLink, pending] = await screen.findAllByTestId("club-feed-comment");
    expect(within(badLink as HTMLElement).queryByTestId("club-comment-link-card")).toBeNull();

    const item = pending as HTMLElement;
    expect(item.getAttribute("data-status")).toBe("pending");
    expect(within(item).getByTestId("club-feed-discussion-pending").textContent).toBe(
      "club.comments.pending",
    );
    const inline = within(item).getByRole("link", { name: "https://komisja.example/akt" });
    expect(inline.getAttribute("rel")).toContain("ugc");
    expect(inline.getAttribute("target")).toBe("_blank");
    expect(item.querySelector("[data-mention='anna-nowak']")).not.toBeNull();

    const card = within(item).getByTestId("club-comment-link-card");
    expect(card.getAttribute("href")).toBe("https://komisja.example/akt");
    expect(card.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
    expect(within(card).getByText("Komisja Europejska")).toBeTruthy();
    // Pełny tytuł, zawijany - nie ucięty.
    const title = within(card).getByText("Akt delegowany");
    expect(title.className).not.toContain("truncate");
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "https://komisja.example/okladka.png",
    );
  });

  it("katalog wzmianek sekcji: autorzy komentarzy i wzmianki z treści, bez pseudonimów", async () => {
    clubRpc.setData(
      LIST,
      page([
        clubPostCommentRow({ id: "c-2", author_slug: "jan-kowalski", body: "Racja, @Piotr-Z" }),
        clubPostCommentRow({
          id: "c-1",
          author_id: null,
          author_name: null,
          author_slug: null,
          author_alias: "A7",
          body: "Zgoda z @org-firma",
        }),
      ]),
    );
    renderComments();

    await screen.findAllByTestId("club-feed-comment");
    await waitFor(() => expect(h.directorySlugs).toEqual(["jan-kowalski", "org-firma", "piotr-z"]));
  });
});

describe("ClubFeedComments - kompozytor", () => {
  it("jedna reguła wysyłki dla przycisku: puste pole blokuje, treść jedzie przycięta", async () => {
    renderComments();
    await screen.findByText("club.comments.empty");

    expect(field().getAttribute("placeholder")).toBe("club.comments.placeholder");
    expect(field().getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
    expect(submitButton()).toBeDisabled();
    type(field(), "   ");
    expect(submitButton()).toBeDisabled();

    type(field(), "  Dziękuję za notatkę  ");
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());

    await waitFor(() => expect(clubRpc.callsFor(CREATE)).toHaveLength(1));
    const call = clubRpc.lastCall(CREATE);
    expect(call?.arg("p_post_id")).toBe("post-1");
    expect(call?.arg("p_body")).toBe("Dziękuję za notatkę");
    // Bez linku w treści migawka nie jedzie wcale (serwerowy DEFAULT NULL).
    expect(call?.arg("p_link_preview")).toBeUndefined();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.comments.posted"));
    expect(field().value).toBe("");
  });

  it("Ctrl+Enter i Cmd+Enter wysyłają; komentarz w kolejce mówi o moderacji", async () => {
    clubRpc.setData(CREATE, [{ comment_id: "comment-q", comment_status: "pending" }]);
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), "Pierwszy skrótem");
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(clubRpc.callsFor(CREATE)).toHaveLength(1));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.comments.queued"));

    type(field(), "Drugi skrótem");
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(clubRpc.callsFor(CREATE)).toHaveLength(2));

    // Sam Enter to nowa linia, nie wysyłka.
    type(field(), "Trzeci");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(clubRpc.callsFor(CREATE)).toHaveLength(2);
  });

  it("odmowa bazy mapuje się na zdanie i ZOSTAWIA szkic", async () => {
    clubRpc.setError(CREATE, "clubs: comment burst limit", "42901");
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), "Za szybko");
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("club.comments.error.burstLimit"),
    );
    expect(field().value).toBe("Za szybko");
  });

  it("„Odpowiedz” wstawia wzmiankę autora bez dublowania; pseudonim nie ma przycisku", async () => {
    clubRpc.setData(
      LIST,
      page([
        clubPostCommentRow({ id: "c-2", author_slug: "jan-kowalski", author_name: "Jan" }),
        clubPostCommentRow({
          id: "c-1",
          author_id: null,
          author_name: null,
          author_slug: null,
          author_alias: "A7",
        }),
      ]),
    );
    renderComments();

    const [alias, named] = await screen.findAllByTestId("club-feed-comment");
    expect(within(alias as HTMLElement).queryByTestId("club-feed-discussion-reply")).toBeNull();
    // Pseudonim to tekst, nie odnośnik do profilu.
    expect(within(alias as HTMLElement).queryByRole("link")).toBeNull();
    expect(within(alias as HTMLElement).getByText("club.anonymousAuthor")).toBeTruthy();

    const reply = within(named as HTMLElement).getByTestId("club-feed-discussion-reply");
    expect(reply.getAttribute("aria-label")).toBe("club.comments.replyTo(name=Jan)");
    fireEvent.click(reply);
    expect(field().value).toBe("@jan-kowalski ");
    expect(document.activeElement).toBe(field());

    fireEvent.click(reply);
    expect(field().value).toBe("@jan-kowalski ");

    type(field(), "Zgoda");
    fireEvent.click(reply);
    expect(field().value).toBe("Zgoda @jan-kowalski ");
  });

  it("rozwinięcie przyciskiem (`focusKey`) przenosi fokus do pola", async () => {
    renderComments("write", 1);
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it.each([
    ["guest", "club.comments.signIn"],
    ["readOnly", "club.comments.readOnly"],
  ] as const)("tryb %s: zdanie zamiast kompozytora i bez „Odpowiedz”", async (mode, text) => {
    clubRpc.setData(LIST, page([clubPostCommentRow()]));
    renderComments(mode, 1);

    await screen.findAllByTestId("club-feed-comment");
    expect(screen.queryByRole("combobox")).toBeNull();
    const notice = screen.getByTestId("club-feed-discussion-notice");
    expect(notice.getAttribute("data-mode")).toBe(mode);
    expect(notice.textContent).toContain(text);
    expect(screen.queryByTestId("club-feed-discussion-reply")).toBeNull();
    if (mode === "guest") {
      const login = within(notice).getByRole("link", { name: "club.comments.signInAction" });
      expect(login.getAttribute("href")).toBe("/login");
      expect(login.getAttribute("data-search")).toBe('{"mode":"signin"}');
    }
  });
});

describe("ClubFeedComments - wzmianki z zakresem klubu", () => {
  const MEMBER = {
    kind: "person",
    id: "user-anna",
    slug: "anna-nowak",
    label: "Anna Nowak",
    subtitle: "Analityczka",
    avatar_url: null,
    logo_url: null,
    website: null,
    verified: false,
  };

  it("pyta o członków TEGO klubu, Escape zamyka listę, Enter wybiera osobę", async () => {
    clubRpc.setData("club_mention_members", [MEMBER]);
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), "Zgoda z @an");
    await waitFor(() => expect(clubRpc.callsFor("club_mention_members").length).toBeGreaterThan(0));
    const call = clubRpc.lastCall("club_mention_members");
    expect(call?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(call?.arg("p_q")).toBe("an");
    // Publiczny katalog idzie RÓWNOLEGLE - firmy i eksperci spoza klubu.
    expect(clubRpc.callsFor("search_mention_targets").length).toBeGreaterThan(0);

    const option = await screen.findByRole("option", { name: /Anna Nowak/ });
    expect(field().getAttribute("aria-expanded")).toBe("true");

    // Przy otwartej liście Ctrl+Enter wybiera osobę, nie wysyła komentarza.
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("option")).toBeNull();

    type(field(), "Zgoda z @ann");
    await screen.findByRole("option", { name: /Anna Nowak/ });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    expect(field().value).toBe("Zgoda z @anna-nowak ");
    expect(clubRpc.callsFor(CREATE)).toHaveLength(0);
    expect(option).toBeTruthy();
  });
});

describe("ClubFeedComments - podgląd linku w kompozytorze", () => {
  const URL_A = "https://komisja.example/akt";

  it("pierwszy adres https dostaje kartę, a migawka jedzie z komentarzem", async () => {
    h.previews[URL_A] = {
      url: URL_A,
      title: "Akt delegowany",
      description: "Streszczenie",
      // Obraz `http:` znika z migawki - karta zostaje bez niego.
      image: "http://komisja.example/okladka.png",
      siteName: "Komisja Europejska",
    };
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), `Warto przeczytać ${URL_A} oraz https://drugi.example`);
    const card = await screen.findByTestId("club-composer-link-card");
    expect(card.getAttribute("data-url")).toBe(URL_A);
    expect(within(card).getByText("Akt delegowany")).toBeTruthy();
    expect(card.querySelector("img")).toBeNull();
    // Pytamy wyłącznie o PIERWSZY adres.
    expect(new Set(h.previewAsked)).toEqual(new Set([URL_A]));

    fireEvent.click(submitButton());
    await waitFor(() => expect(clubRpc.callsFor(CREATE)).toHaveLength(1));
    expect(clubRpc.lastCall(CREATE)?.arg("p_link_preview")).toEqual({
      url: URL_A,
      title: "Akt delegowany",
      description: "Streszczenie",
      image: null,
      siteName: "Komisja Europejska",
    });
  });

  it("„×” odrzuca kartę na stałe dla tego adresu - komentarz idzie bez migawki", async () => {
    h.previews[URL_A] = {
      url: URL_A,
      title: "Akt",
      description: null,
      image: null,
      siteName: null,
    };
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), `Link ${URL_A}`);
    const dismiss = await screen.findByRole("button", { name: "club.comments.link.dismiss" });
    fireEvent.click(dismiss);
    expect(screen.queryByTestId("club-composer-link-card")).toBeNull();

    // Dopisanie tekstu nie przywraca odrzuconej karty.
    type(field(), `Link ${URL_A} - ważne`);
    expect(screen.queryByTestId("club-composer-link-card")).toBeNull();

    fireEvent.click(submitButton());
    await waitFor(() => expect(clubRpc.callsFor(CREATE)).toHaveLength(1));
    expect(clubRpc.lastCall(CREATE)?.arg("p_link_preview")).toBeUndefined();
  });

  it("karta w drodze pokazuje szkielet; `http://` nie pyta serwera wcale", async () => {
    renderComments();
    await screen.findByText("club.comments.empty");

    type(field(), "Stary adres http://komisja.example/akt");
    expect(h.previewAsked).toEqual([]);
    expect(screen.queryByTestId("club-composer-link-card")).toBeNull();

    type(field(), `Nowy adres ${URL_A}`);
    const card = await screen.findByTestId("club-composer-link-card");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(within(card).getByText("club.comments.link.loading")).toBeTruthy();
  });
});

describe("ClubFeedComments - usuwanie", () => {
  it("pyta w miejscu, anulowanie oddaje fokus „Usuń”, potwierdzenie woła RPC", async () => {
    clubRpc.setData(LIST, page([clubPostCommentRow({ id: "c-mine", can_manage: true })]));
    renderComments();

    const item = await screen.findByTestId("club-feed-comment");
    const remove = within(item).getByTestId("club-feed-discussion-delete");
    fireEvent.click(remove);

    const confirm = within(item).getByRole("group", { name: "club.comments.deleteConfirm" });
    const cancel = within(confirm).getByRole("button", { name: "club.comments.cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(clubRpc.callsFor(DELETE)).toHaveLength(0);
    expect(document.activeElement).toBe(within(item).getByTestId("club-feed-discussion-delete"));

    fireEvent.click(within(item).getByTestId("club-feed-discussion-delete"));
    fireEvent.click(within(item).getByTestId("club-feed-discussion-delete-confirm"));
    await waitFor(() => expect(clubRpc.callsFor(DELETE)).toHaveLength(1));
    expect(clubRpc.lastCall(DELETE)?.arg("p_comment_id")).toBe("c-mine");
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.comments.deleted"));
  });

  it("cudzy komentarz bez prawa zarządzania nie ma „Usuń”", async () => {
    clubRpc.setData(LIST, page([clubPostCommentRow({ can_manage: false })]));
    renderComments();
    const item = await screen.findByTestId("club-feed-comment");
    expect(within(item).queryByTestId("club-feed-discussion-delete")).toBeNull();
  });
});

describe("ClubFeedThreadReplies - podgląd i odpowiedź z karty", () => {
  const THREAD = { id: CLUB_IDS.thread, slug: "temat-pierwszy", reply_count: 5 };

  function renderReplies(mode: ClubFeedDiscussionMode = "write") {
    return renderWithQueryClient(
      <ClubFeedThreadReplies
        clubId={CLUB_IDS.club}
        clubSlug={CLUB_SLUG}
        thread={THREAD}
        mode={mode}
      />,
    );
  }

  beforeEach(() => {
    clubRpc.setData("club_replies_list", [
      clubReplyRow({ id: "r-4", body: "Czwarta", created_at: clubIsoOffset(4), total_count: 5 }),
      clubReplyRow({ id: "r-5", body: "Piąta", created_at: clubIsoOffset(5), total_count: 5 }),
    ]);
    clubRpc.setData("club_reply", [{ reply_id: "r-new", reply_status: "visible" }]);
  });

  it("dwie najnowsze odpowiedzi (offset z `reply_count`) i „Zobacz całą dyskusję (N)”", async () => {
    renderReplies();

    const items = await screen.findAllByTestId("club-feed-reply");
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual(["Czwarta", "Piąta"]);
    const call = clubRpc.lastCall("club_replies_list");
    expect(call?.arg("p_thread_id")).toBe(CLUB_IDS.thread);
    expect(call?.arg("p_sort")).toBe("chronological");
    expect(call?.arg("p_limit")).toBe(2);
    expect(call?.arg("p_offset")).toBe(3);

    const all = screen.getByTestId("club-feed-replies-all");
    expect(all.getAttribute("href")).toBe(`/club/${CLUB_SLUG}/t/temat-pierwszy`);
    expect(all.textContent).toBe("club.comments.viewAll(n=5)");
  });

  it("gdy podgląd mieści całą rozmowę, link do reszty nie obiecuje niczego", async () => {
    clubRpc.setData("club_replies_list", [clubReplyRow({ total_count: 1 })]);
    renderWithQueryClient(
      <ClubFeedThreadReplies
        clubId={CLUB_IDS.club}
        clubSlug={CLUB_SLUG}
        thread={{ ...THREAD, reply_count: 1 }}
        mode="write"
      />,
    );
    await screen.findAllByTestId("club-feed-reply");
    expect(screen.queryByTestId("club-feed-replies-all")).toBeNull();
  });

  it("odpowiedź z karty jest GŁÓWNA i jawna, a kolejka moderacji ma własne zdanie", async () => {
    clubRpc.setData("club_reply", [{ reply_id: "r-q", reply_status: "pending" }]);
    renderReplies();
    await screen.findAllByTestId("club-feed-reply");

    const input = screen.getByRole("combobox", { name: "club.comments.threadFieldLabel" });
    // Kompozytor odpowiedzi nie obiecuje karty linku - `club_reply` jej nie zapisze.
    type(input as HTMLTextAreaElement, "Dorzucam źródło https://komisja.example/akt");
    expect(screen.queryByTestId("club-composer-link-card")).toBeNull();
    fireEvent.click(submitButton());

    await waitFor(() => expect(clubRpc.callsFor("club_reply")).toHaveLength(1));
    const call = clubRpc.lastCall("club_reply");
    expect(call?.arg("p_thread_id")).toBe(CLUB_IDS.thread);
    expect(call?.arg("p_body")).toBe("Dorzucam źródło https://komisja.example/akt");
    expect(call?.arg("p_parent_id")).toBeUndefined();
    expect(call?.arg("p_anonymous")).toBe(false);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("club.replyQueued"));
  });

  it("zamknięty wątek: odmowa z bazy i zdanie zamiast kompozytora", async () => {
    clubRpc.setError("club_reply", "clubs: thread locked");
    const { unmount } = renderReplies();
    await screen.findAllByTestId("club-feed-reply");
    type(
      screen.getByRole("combobox", {
        name: "club.comments.threadFieldLabel",
      }) as HTMLTextAreaElement,
      "Spóźniona odpowiedź",
    );
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("club.comments.error.locked"));
    unmount();

    renderReplies("locked");
    await screen.findAllByTestId("club-feed-reply");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("club-feed-discussion-notice").getAttribute("data-mode")).toBe(
      "locked",
    );
  });

  it("wątek bez odpowiedzi mówi to wprost", async () => {
    clubRpc.setData("club_replies_list", []);
    renderWithQueryClient(
      <ClubFeedThreadReplies
        clubId={CLUB_IDS.club}
        clubSlug={CLUB_SLUG}
        thread={{ ...THREAD, reply_count: 0 }}
        mode="guest"
      />,
    );
    expect(await screen.findByText("club.comments.threadEmpty")).toBeTruthy();
  });
});

describe("ClubPostComposer - wzmianki i karta linku nowego wpisu", () => {
  const URL_A = "https://komisja.example/akt";

  function postField(): HTMLTextAreaElement {
    const node = screen.getByRole("combobox", { name: "club.post.placeholder" });
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("pole wpisu nie jest polem");
    return node;
  }

  beforeEach(() => {
    clubRpc.setData("club_post_create", [{ post_id: "post-new" }]);
    h.previews[URL_A] = {
      url: URL_A,
      title: "Akt delegowany",
      description: null,
      image: "https://komisja.example/okladka.png",
      siteName: null,
    };
  });

  it('nieodrzucona karta jedzie jako element `type: "link"` w `p_attachments`', async () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    type(postField(), `Nowy akt: ${URL_A}`);
    await screen.findByTestId("club-composer-link-card");

    fireEvent.click(screen.getByRole("button", { name: "club.post.publish" }));
    await waitFor(() => expect(clubRpc.callsFor("club_post_create")).toHaveLength(1));
    expect(clubRpc.lastCall("club_post_create")?.arg("p_attachments")).toEqual([
      {
        type: "link",
        url: URL_A,
        title: "Akt delegowany",
        description: null,
        image: "https://komisja.example/okladka.png",
        siteName: null,
      },
    ]);
  });

  it("odrzucona karta nie jedzie; pole ma podpowiedzi członków klubu", async () => {
    renderWithQueryClient(<ClubPostComposer clubId={CLUB_IDS.club} canPost />);
    type(postField(), `Nowy akt: ${URL_A} @jan`);
    await waitFor(() =>
      expect(clubRpc.lastCall("club_mention_members")?.arg("p_club_id")).toBe(CLUB_IDS.club),
    );
    fireEvent.click(await screen.findByRole("button", { name: "club.comments.link.dismiss" }));

    await act(async () => {
      fireEvent.keyDown(postField(), { key: "Enter", ctrlKey: true });
    });
    await waitFor(() => expect(clubRpc.callsFor("club_post_create")).toHaveLength(1));
    expect(clubRpc.lastCall("club_post_create")?.arg("p_attachments")).toEqual([]);
  });
});

describe("Słowniki rozmowy w karcie", () => {
  function read(tree: unknown, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        tree,
      );
  }

  it.each(CLUB_COMMENT_ERROR_KEYS)("%s ma tekst PL i EN", (key) => {
    const path = key.replace(/^club\./, "");
    expect(typeof read(clubPl.club, path)).toBe("string");
    expect(typeof read(clubEn.club, path)).toBe("string");
    expect(read(clubEn.club, path)).not.toBe(read(clubPl.club, path));
  });

  it("licznik komentarzy ma formy mnogie PL (one/few/many/other) i EN (one/other)", () => {
    for (const form of ["one", "few", "many", "other"]) {
      expect(typeof read(clubPl.club, `comments.count_${form}`)).toBe("string");
    }
    for (const form of ["one", "other"]) {
      expect(typeof read(clubEn.club, `comments.count_${form}`)).toBe("string");
    }
  });
});
