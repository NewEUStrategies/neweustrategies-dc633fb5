// Czyste reguły rozmowy w karcie strumienia (`feedDiscussion.ts`).
//
// CO TEN PLIK DOWODZI.
//  1. TRYB SEKCJI: brak sesji wygrywa ze wszystkim (gość dostaje drogę do
//     logowania, nie wykład o uprawnieniach), zamknięty wątek wygrywa z prawem
//     głosu, a dopiero potem prawo głosu rozstrzyga `write` / `readOnly`.
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
  discussionDirectorySlugs,
  isClubThreadClosed,
} from "@/components/clubs/molecules/feedDiscussion";

describe("clubFeedDiscussionMode", () => {
  it.each([
    [{ signedIn: false, canWrite: true, locked: true }, "guest"],
    [{ signedIn: true, canWrite: true, locked: true }, "locked"],
    [{ signedIn: true, canWrite: false, locked: true }, "locked"],
    [{ signedIn: true, canWrite: false }, "readOnly"],
    [{ signedIn: true, canWrite: true }, "write"],
    [{ signedIn: true, canWrite: true, locked: false }, "write"],
  ])("%o -> %s", (input, expected) => {
    expect(clubFeedDiscussionMode(input)).toBe(expected);
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
