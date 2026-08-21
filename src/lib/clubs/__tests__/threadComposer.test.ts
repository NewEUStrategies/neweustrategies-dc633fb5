// Reguły kompozytora odpowiedzi, wyprowadzone z JSX-a trasy wątku.
//
// CO TEN PLIK DOWODZI. Pięć decyzji, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie znaczników - w tym JEDNA POWTÓRZONA DWA RAZY
// (warunek wysyłki stał osobno w uchwycie i osobno w `disabled` przycisku):
//
//   1. WYSYŁKA wymaga treści PO PRZYCIĘCIU i braku wpisu w drodze. Rozjazd
//      między tym warunkiem a `disabled` daje przycisk, który wygląda na czynny
//      i nic nie robi - albo wysyła wpis z samych spacji.
//   2. ENTER ZOSTAJE ZNAKIEM NOWEJ LINII. To pole deliberacji, nie okno czatu:
//      wysłanie akapitu w połowie zdania jest tu kosztowniejsze niż jedno
//      kliknięcie więcej. Wysyłka idzie Ctrl/Cmd + Enter.
//   3. ESCAPE zdejmuje ADRESATA, nigdy treści - i tylko wtedy, gdy adresat jest.
//      Bez adresata Escape musi zachować swoje domyślne działanie (zamknięcie
//      podpowiedzi wzmianek), więc reguła oddaje `ignore`, a nie „nic nie rób”.
//   4. LICZNIK ZNAKÓW pojawia się dopiero, gdy limit robi się realny. Stały
//      licznik pod polem uczy, że tekst ma być krótki - a to nieprawda.
//   5. BRAK PRAWA DO ODPOWIEDZI mówi POWÓD ze słownika, jeśli RPC go podało;
//      pusty kod schodzi na zdanie ogólne, a nie na identyfikator z bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza samego pola (`MentionTextarea`
// i parser wzmianek mają własne zakresy), nie sprawdza mutacji `club_reply`
// (`postsApi.test.ts`, `api.test.ts`) ani kolejki premoderacji (pgTAP + testy
// `useClubs`). Sklejenie - że trasa naprawdę woła te reguły na naciśnięcie
// klawisza i na kliknięcie - dowodzi `clubThreadRoute.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  canSubmitClubReply,
  clubBlockedReplyKey,
  clubComposerHeadingKey,
  clubComposerKeyIntent,
  clubReplyBodyLength,
  showsClubReplyCounter,
  CLUB_REPLY_BODY_MAX,
  CLUB_REPLY_COUNTER_RATIO,
} from "@/lib/clubs/threadComposer";
import { CLUB_IDS } from "@/test/clubs/fixtures";

// --- długość treści ---------------------------------------------------------

describe("clubReplyBodyLength - treścią jest to, co zostaje po przycięciu", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["\n\t ", 0],
    ["abc", 3],
    ["  abc  ", 3],
  ])("`%s` ma długość %i", (body, expected) => {
    expect(clubReplyBodyLength(body)).toBe(expected);
  });
});

// --- warunek wysyłki --------------------------------------------------------

describe("canSubmitClubReply - jedno źródło dla przycisku i dla uchwytu", () => {
  it("treść przy wolnym kompozytorze wolno wysłać", () => {
    expect(canSubmitClubReply("zdanie", false)).toBe(true);
  });

  it("pusta treść nie idzie nigdzie", () => {
    expect(canSubmitClubReply("", false)).toBe(false);
  });

  it("same spacje to nie treść", () => {
    expect(canSubmitClubReply("    \n ", false)).toBe(false);
  });

  it("wpis W DRODZE blokuje drugą wysyłkę - RPC nie deduplikuje odpowiedzi", () => {
    expect(canSubmitClubReply("zdanie", true)).toBe(false);
  });

  it("pusta treść i wpis w drodze naraz też są zablokowane", () => {
    expect(canSubmitClubReply("", true)).toBe(false);
  });
});

// --- licznik znaków ---------------------------------------------------------

describe("showsClubReplyCounter - licznik pokazuje się, gdy limit jest realny", () => {
  const progIndex = Math.floor(CLUB_REPLY_BODY_MAX * CLUB_REPLY_COUNTER_RATIO);

  it("krótka odpowiedź nie dostaje licznika", () => {
    expect(showsClubReplyCounter("dwa zdania na temat")).toBe(false);
  });

  it("DOKŁADNIE na progu licznika jeszcze nie ma - granica należy do milczących", () => {
    expect(showsClubReplyCounter("a".repeat(progIndex))).toBe(false);
  });

  it("jeden znak nad progiem odsłania licznik", () => {
    expect(showsClubReplyCounter("a".repeat(progIndex + 1))).toBe(true);
  });

  it("spacje nie podbijają licznika", () => {
    expect(showsClubReplyCounter(" ".repeat(CLUB_REPLY_BODY_MAX + 100))).toBe(false);
  });

  it("próg liczy się od PODANEGO limitu, gdy widok ma własny", () => {
    expect(showsClubReplyCounter("a".repeat(8), 10)).toBe(true);
    expect(showsClubReplyCounter("a".repeat(7), 10)).toBe(false);
  });
});

// --- klawiatura -------------------------------------------------------------

interface KeyCase {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
}

function keyEvent(input: KeyCase): { key: string; metaKey: boolean; ctrlKey: boolean } {
  return { key: input.key, metaKey: input.metaKey ?? false, ctrlKey: input.ctrlKey ?? false };
}

describe("clubComposerKeyIntent - Enter zostaje znakiem nowej linii", () => {
  it("goły Enter NIE wysyła - to jest pole deliberacji, nie czat", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "Enter" }), false)).toBe("ignore");
  });

  it("Cmd + Enter wysyła", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "Enter", metaKey: true }), false)).toBe("submit");
  });

  it("Ctrl + Enter wysyła", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "Enter", ctrlKey: true }), false)).toBe("submit");
  });

  it("modyfikator BEZ Entera nic nie robi", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "s", ctrlKey: true }), false)).toBe("ignore");
  });

  it("wysyłka wygrywa nad zdjęciem adresata, gdy adresat jest wybrany", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "Enter", ctrlKey: true }), true)).toBe("submit");
  });
});

describe("clubComposerKeyIntent - Escape zdejmuje adresata, nie treść", () => {
  it("Escape przy wybranym adresacie zdejmuje adresata", () => {
    expect(clubComposerKeyIntent(keyEvent({ key: "Escape" }), true)).toBe("clear-reply-target");
  });

  it("Escape BEZ adresata jest przepuszczany dalej", () => {
    // Trasa woła `preventDefault` dopiero po tym rozstrzygnięciu, więc każda
    // inna odpowiedź odebrałaby Escape zamykanie podpowiedzi wzmianek.
    expect(clubComposerKeyIntent(keyEvent({ key: "Escape" }), false)).toBe("ignore");
  });

  it.each(["Tab", "a", "ArrowUp", ""])("klawisz `%s` nie znaczy tu nic", (key) => {
    expect(clubComposerKeyIntent(keyEvent({ key }), true)).toBe("ignore");
  });
});

// --- nagłówek kompozytora ---------------------------------------------------

describe("clubComposerHeadingKey", () => {
  it("bez adresata nagłówek zaprasza do odpowiedzi", () => {
    expect(clubComposerHeadingKey(null)).toBe("club.postReply");
  });

  it("z adresatem nagłówek mówi, że wpis pójdzie w GAŁĄŹ", () => {
    expect(clubComposerHeadingKey(CLUB_IDS.reply)).toBe("club.replyingTo");
  });
});

// --- brak prawa do odpowiedzi ----------------------------------------------

describe("clubBlockedReplyKey - powód zamiast „nie możesz”", () => {
  it.each(["locked", "not_member", "tier_too_low", "moderated"])(
    "kod `%s` dostaje własne zdanie ze słownika",
    (reason) => {
      expect(clubBlockedReplyKey(reason)).toBe(`club.reason.${reason}`);
    },
  );

  it.each([
    ["pusty napis z RPC", ""],
    ["brak kolumny", null],
    ["pole nieustawione", undefined],
  ])("%s schodzi na zdanie ogólne", (_label, reason) => {
    expect(clubBlockedReplyKey(reason)).toBe("club.cannotReply");
  });
});
