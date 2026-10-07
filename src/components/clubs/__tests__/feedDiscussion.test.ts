// Czyste reguły rozmowy w karcie strumienia (`feedDiscussion.ts`).
//
// CO TEN PLIK DOWODZI.
//  1. TRYB SEKCJI: zamknięty wątek wygrywa ze wszystkim (gość nie dostaje
//     martwego „Zaloguj się"), potem brak sesji (droga do logowania, nie
//     wykład o uprawnieniach), a dopiero potem prawo głosu rozstrzyga
//     `write` / `readOnly`. W KARCIE WĄTKU tryb doprecyzowuje widok wątku
//     (prawo w dziale, blokada, powód), a odmowa bazy przy wysyłce wygrywa
//     z widokiem sprzed chwili.
//  2. ZAMKNIĘTY WĄTEK to `locked`, `hidden` i `deleted` - rozstrzygnięty
//     i uśpiony dalej przyjmują odpowiedzi (`club_reply` wybudza uśpiony).
//  3. „ODPOWIEDZ" wstawia `@slug ` bez dublowania (także przy innej wielkości
//     liter) i z jedną spacją odstępu.
//  4. KATALOG SEKCJI jest kompletny: autorzy (pierwsi) i wzmianki z treści,
//     bez pustych slugów pseudonimów.
import { describe, expect, it } from "vitest";
import {
  appendMentionToDraft,
  clubFeedDiscussionMode,
  clubThreadReplyMode,
  discussionDirectorySlugs,
  isClubThreadClosed,
  type ClubThreadReplyView,
} from "@/components/clubs/molecules/feedDiscussion";

describe("clubFeedDiscussionMode", () => {
  it.each([
    // Zamknięty wątek: zalogowanie niczego nie zmieni - gość nie dostaje zachęty.
    [{ signedIn: false, canWrite: true, locked: true }, "locked"],
    [{ signedIn: false, canWrite: false }, "guest"],
    [{ signedIn: false, canWrite: true, locked: false }, "guest"],
    [{ signedIn: true, canWrite: true, locked: true }, "locked"],
    [{ signedIn: true, canWrite: false, locked: true }, "locked"],
    [{ signedIn: true, canWrite: false }, "readOnly"],
    [{ signedIn: true, canWrite: true }, "write"],
    [{ signedIn: true, canWrite: true, locked: false }, "write"],
  ])("%o -> %s", (input, expected) => {
    expect(clubFeedDiscussionMode(input)).toBe(expected);
  });
});

describe("clubThreadReplyMode - widok wątku doprecyzowuje kartę", () => {
  function view(over: Partial<ClubThreadReplyView> = {}): ClubThreadReplyView {
    return { can_reply: true, reason: null, locked_at: null, status: "open", ...over };
  }

  it.each([
    // Bez widoku (w drodze, wątek niewidoczny) zostaje tryb z listy.
    ["bez widoku", { mode: "write" }, { mode: "write", reason: null }],
    ["prawo w dziale", { mode: "write", view: view() }, { mode: "write", reason: null }],
    // Prawo klubu jest, prawa w DZIALE nie - powód z bazy, nie martwe pole.
    [
      "dział zamknięty planem",
      { mode: "write", view: view({ can_reply: false, reason: "tier_too_low" }) },
      { mode: "readOnly", reason: "tier_too_low" },
    ],
    [
      "brak prawa bez powodu",
      { mode: "write", view: view({ can_reply: false, reason: "" }) },
      { mode: "readOnly", reason: null },
    ],
    // Widok jest autorytatywny także w drugą stronę: prawo w dziale szersze niż w klubie.
    ["dział szerszy niż klub", { mode: "readOnly", view: view() }, { mode: "write", reason: null }],
    [
      "blokada w widoku",
      { mode: "write", view: view({ can_reply: false, locked_at: "2026-08-18T10:00:00Z" }) },
      { mode: "locked", reason: null },
    ],
    [
      "status zamknięty w widoku",
      { mode: "write", view: view({ can_reply: false, status: "hidden" }) },
      { mode: "locked", reason: null },
    ],
    ["gość zostaje gościem", { mode: "guest", view: view() }, { mode: "guest", reason: null }],
    [
      "gość na zamkniętym wątku",
      { mode: "guest", view: view({ locked_at: "2026-08-18T10:00:00Z" }) },
      { mode: "locked", reason: null },
    ],
    // Odmowa bazy przy wysyłce wygrywa z widokiem sprzed chwili.
    [
      "odmowa: wątek zamknięty",
      { mode: "write", view: view(), rejected: "locked" },
      { mode: "locked", reason: null },
    ],
    [
      "odmowa: brak prawa",
      { mode: "write", view: view(), rejected: "readOnly" },
      { mode: "readOnly", reason: null },
    ],
    ["lista mówi: zamknięty", { mode: "locked", view: view() }, { mode: "locked", reason: null }],
  ] as const)("%s", (_label, input, expected) => {
    expect(clubThreadReplyMode(input)).toEqual(expected);
  });
});

describe("isClubThreadClosed", () => {
  it.each([
    ["locked", true],
    ["hidden", true],
    ["deleted", true],
    ["open", false],
    ["resolved", false],
    ["dormant", false],
    ["pending", false],
    [null, false],
    [undefined, false],
  ])("%s -> %s", (status, expected) => {
    expect(isClubThreadClosed(status)).toBe(expected);
  });
});

describe("appendMentionToDraft", () => {
  it.each([
    ["", "jan-kowalski", "@jan-kowalski "],
    ["   ", "jan-kowalski", "@jan-kowalski "],
    ["Zgoda", "jan-kowalski", "Zgoda @jan-kowalski "],
    ["Zgoda ", "jan-kowalski", "Zgoda @jan-kowalski "],
    ["Zgoda\n", "jan-kowalski", "Zgoda\n@jan-kowalski "],
    ["Do @jan-kowalski: racja", "jan-kowalski", "Do @jan-kowalski: racja"],
    ["Do @Jan-Kowalski", "jan-kowalski", "Do @Jan-Kowalski"],
    ["Zgoda", "Jan-Kowalski", "Zgoda @jan-kowalski "],
    ["Zgoda", "   ", "Zgoda"],
  ])("%j + %s -> %j", (draft, slug, expected) => {
    expect(appendMentionToDraft(draft, slug)).toBe(expected);
  });

  it("adres e-mail z tym samym ciągiem nie jest wzmianką - wzmianka jest dopisywana", () => {
    expect(appendMentionToDraft("pisz na jan@jan-kowalski.pl", "jan-kowalski")).toBe(
      "pisz na jan@jan-kowalski.pl @jan-kowalski ",
    );
  });
});

describe("discussionDirectorySlugs", () => {
  it("autorzy pierwsi, potem wzmianki z treści; duplikaty i puste slugi odpadają", () => {
    expect(
      discussionDirectorySlugs([
        { author_slug: "anna-nowak", body: "Racja, @Jan-Kowalski i @org-firma" },
        { author_slug: null, body: "@anna-nowak #energia https://a.example/@nie-wzmianka" },
        { author_slug: "jan-kowalski", body: "" },
      ]),
    ).toEqual(["anna-nowak", "jan-kowalski", "org-firma"]);
  });

  it("pusta rozmowa to pusty katalog", () => {
    expect(discussionDirectorySlugs([])).toEqual([]);
  });
});
