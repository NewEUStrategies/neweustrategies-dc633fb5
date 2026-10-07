// Komentarze wpisów ściany - warstwa CZYSTA: warunek wysyłki, migawka podglądu
// linku i mapowanie odmowy na komunikat.
//
// CO TU REALNIE PSUJE SIĘ PO CICHU:
//
//   1. MIGAWKA LINKU jest daną od użytkownika, która trafia do `href` i `src`
//      w karcie KAŻDEGO czytelnika. Parser jest ostatnią linią przed `data:`
//      i `javascript:` w komentarzu zapisanym z pominięciem RPC - i zarazem
//      normalizatorem przed wysyłką, bez którego obraz `http:` z serwera
//      podglądów kończyłby się odmową całego komentarza.
//   2. PRZYCINANIE TEKSTU po jednostkach UTF-16 zostawia połówkę emoji, a jsonb
//      w Postgresie odrzuca taki escape. Komentarz padałby błędem bazy, którego
//      autor nie ma jak zrozumieć.
//   3. KOMUNIKAT ODMOWY. PostgREST gubi SQLSTATE, więc powód jedzie w treści
//      wyjątku. Zła kolejność dopasowań („rate limit" przed „burst limit")
//      pokazałaby limit dobowy komuś, kto po prostu pisze za szybko. To samo
//      dla kompozytora wpisu (`clubPostErrorKey`), który dotąd pokazywał
//      surowy napis bazy.
//   4. ZNAKI STERUJĄCE w migawce. Bajt NUL z `og:title` strony to `\u0000`,
//      którego jsonb nie przyjmie - komentarz padałby przez dodatek.
//   5. LICZNIK KOMENTARZY liczy wyłącznie widoczne - zmiana statusu rusza go
//      tylko przy wejściu do widocznych albo wyjściu z nich.
//
// GRANICA DOWODU: zero bazy, zero sieci, zero komponentów.
import { describe, expect, it } from "vitest";
import {
  CLUB_COMMENT_ERROR_KEYS,
  CLUB_LINK_TEXT_MAX,
  CLUB_LINK_URL_MAX,
  CLUB_POST_COMMENT_MAX,
  CLUB_POST_COMMENT_PAGE_SIZE,
  CLUB_POST_COMMENT_STATUSES,
  CLUB_POST_ERROR_KEYS,
  canSubmitClubComment,
  clubCommentCountDelta,
  clubCommentErrorKey,
  clubPostErrorKey,
  clubLinkSnapshotFromPreview,
  clubLinkSnapshotToAttachment,
  isClubPostCommentStatus,
  parseClubLinkSnapshot,
  parseClubPostAttachments,
} from "../postTypes";

describe("stałe kontraktu z bazą", () => {
  it("limity są takie, jak CHECK i walidacja RPC", () => {
    expect(CLUB_POST_COMMENT_MAX).toBe(3000);
    expect(CLUB_LINK_URL_MAX).toBe(2048);
    expect(CLUB_LINK_TEXT_MAX).toBe(300);
    expect(CLUB_POST_COMMENT_PAGE_SIZE).toBe(3);
  });

  it("słownik statusów jest zamknięty i zgodny z tabelą", () => {
    expect([...CLUB_POST_COMMENT_STATUSES]).toEqual(["pending", "visible", "hidden", "deleted"]);
    for (const status of CLUB_POST_COMMENT_STATUSES) {
      expect(isClubPostCommentStatus(status)).toBe(true);
    }
    for (const stray of ["published", "removed", "", null, undefined, 1]) {
      expect(isClubPostCommentStatus(stray), String(stray)).toBe(false);
    }
  });
});

describe("canSubmitClubComment", () => {
  it("pusta treść i same białe znaki nie są komentarzem", () => {
    expect(canSubmitClubComment("", false)).toBe(false);
    expect(canSubmitClubComment("   \n\t ", false)).toBe(false);
  });

  it("zwykła treść przechodzi", () => {
    expect(canSubmitClubComment("Dobra uwaga.", false)).toBe(true);
  });

  it("wysyłka W DRODZE blokuje kolejną - podwójne kliknięcie nie daje dwóch komentarzy", () => {
    expect(canSubmitClubComment("Dobra uwaga.", true)).toBe(false);
  });

  it("limit jest WŁĄCZNY i liczony po przycięciu", () => {
    expect(canSubmitClubComment("a".repeat(CLUB_POST_COMMENT_MAX), false)).toBe(true);
    expect(canSubmitClubComment(`  ${"a".repeat(CLUB_POST_COMMENT_MAX)}  `, false)).toBe(true);
    expect(canSubmitClubComment("a".repeat(CLUB_POST_COMMENT_MAX + 1), false)).toBe(false);
  });

  it("emoji liczy się jako JEDEN znak, jak `char_length` w bazie", () => {
    // 3000 emoji to 6000 jednostek UTF-16 - `String.length` odrzuciłby
    // komentarz, który baza przyjmie.
    expect(canSubmitClubComment("🙂".repeat(CLUB_POST_COMMENT_MAX), false)).toBe(true);
    expect(canSubmitClubComment("🙂".repeat(CLUB_POST_COMMENT_MAX + 1), false)).toBe(false);
  });
});

describe("parseClubLinkSnapshot - odczyt migawki z jsonb", () => {
  const FULL = {
    url: "https://energia.example/raport",
    title: "Raport o rynku mocy",
    description: "Wnioski z konsultacji.",
    image: "https://energia.example/og.png",
    siteName: "Energia",
  };

  it("pełna migawka wraca bez zmian", () => {
    expect(parseClubLinkSnapshot(FULL)).toEqual(FULL);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["tablica", [FULL]],
    ["tekst", "https://energia.example"],
    ["liczba", 7],
    ["obiekt bez adresu", { title: "Bez adresu" }],
  ])("%s daje brak karty, nie wyjątek", (_label, value) => {
    expect(parseClubLinkSnapshot(value as never)).toBeNull();
  });

  it.each([
    ["http", "http://energia.example"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<b>x</b>"],
    ["względny", "/club/energia"],
    ["https bez hosta", "https://"],
    ["spacja w adresie", "https://energia.example/raport roczny"],
    ["znak sterujący", "https://energia.example/\u0000"],
    ["znak sterujący C1", "https://energia.example/\u0085raport"],
  ])("adres %s odrzuca CAŁĄ migawkę", (_label, url) => {
    expect(parseClubLinkSnapshot({ ...FULL, url })).toBeNull();
  });

  it("adres ponad limit odrzuca migawkę, a adres NA limicie przechodzi", () => {
    const base = "https://energia.example/";
    const atLimit = base + "a".repeat(CLUB_LINK_URL_MAX - base.length);
    expect(parseClubLinkSnapshot({ ...FULL, url: atLimit })?.url).toBe(atLimit);
    expect(parseClubLinkSnapshot({ ...FULL, url: `${atLimit}a` })).toBeNull();
  });

  it("schemat pisany wielkimi literami jest normalizowany - baza sprawdza prefiks dosłownie", () => {
    expect(parseClubLinkSnapshot({ ...FULL, url: "HTTPS://Energia.example/Raport" })?.url).toBe(
      "https://Energia.example/Raport",
    );
  });

  it("obraz spoza https znika, ale karta zostaje", () => {
    for (const image of [
      "http://energia.example/og.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "og.png",
      7,
    ]) {
      const snapshot = parseClubLinkSnapshot({ ...FULL, image } as never);
      expect(snapshot?.url, String(image)).toBe(FULL.url);
      expect(snapshot?.image, String(image)).toBeNull();
    }
  });

  it("pola tekstowe: przycięte, puste jako null, typ inny niż tekst jako null", () => {
    const snapshot = parseClubLinkSnapshot({
      url: FULL.url,
      title: "  Tytuł  ",
      description: "   ",
      siteName: 42,
    });
    expect(snapshot).toEqual({
      url: FULL.url,
      title: "Tytuł",
      description: null,
      image: null,
      siteName: null,
    });
  });

  it("tekst jest cięty do 300 ZNAKÓW, a nie jednostek UTF-16", () => {
    const snapshot = parseClubLinkSnapshot({ ...FULL, title: "🙂".repeat(400) });
    expect(Array.from(snapshot?.title ?? "")).toHaveLength(CLUB_LINK_TEXT_MAX);
    expect(snapshot?.title).toBe("🙂".repeat(CLUB_LINK_TEXT_MAX));
  });

  it("osierocona połówka emoji znika - jsonb odrzuciłby jej escape", () => {
    // Serwer podglądów tnie po `slice`, więc taka połówka realnie dojeżdża.
    const broken = `Raport ${"🙂".slice(0, 1)}`;
    const snapshot = parseClubLinkSnapshot({ ...FULL, title: broken });
    expect(snapshot?.title).toBe("Raport");
    expect(JSON.stringify(snapshot)).not.toMatch(/\\ud[89ab]/i);
  });

  it("nadmiarowe klucze nie przechodzą - migawka ma DOKŁADNIE pięć pól", () => {
    const snapshot = parseClubLinkSnapshot({ ...FULL, html: "<script>", type: "link" });
    expect(Object.keys(snapshot ?? {}).sort()).toEqual(
      ["description", "image", "siteName", "title", "url"].sort(),
    );
  });
});

describe("clubLinkSnapshotFromPreview - normalizacja PRZED wysyłką", () => {
  it("wynik serwera podglądów z obrazem http jedzie bez obrazu", () => {
    expect(
      clubLinkSnapshotFromPreview({
        url: "https://energia.example/raport",
        title: "Raport",
        description: null,
        image: "http://energia.example/og.png",
        siteName: "Energia",
      }),
    ).toEqual({
      url: "https://energia.example/raport",
      title: "Raport",
      description: null,
      image: null,
      siteName: "Energia",
    });
  });

  it("brak podglądu i podgląd z adresem nie do przyjęcia dają `null`", () => {
    expect(clubLinkSnapshotFromPreview(null)).toBeNull();
    expect(clubLinkSnapshotFromPreview(undefined)).toBeNull();
    expect(clubLinkSnapshotFromPreview({ url: "http://energia.example" })).toBeNull();
  });

  it("niepełny podgląd uzupełnia brakujące pola NULL-ami", () => {
    expect(clubLinkSnapshotFromPreview({ url: "https://energia.example" })).toEqual({
      url: "https://energia.example",
      title: null,
      description: null,
      image: null,
      siteName: null,
    });
  });
});

describe("znaki sterujące w migawce - jsonb odrzuca `\\u0000`", () => {
  it("NUL i pozostałe znaki sterujące znikają z pól tekstowych", () => {
    expect(
      clubLinkSnapshotFromPreview({
        url: "https://energia.example",
        title: "A\u0000B",
        description: "\u0000",
        siteName: "X\u0007\u009b",
      }),
    ).toEqual({
      url: "https://energia.example",
      title: "AB",
      description: null,
      image: null,
      siteName: "X",
    });
  });

  it("koniec linii i tabulator stają się JEDNĄ spacją, a nie zlepiają słów", () => {
    expect(
      clubLinkSnapshotFromPreview({
        url: "https://energia.example",
        title: "Raport\nroczny",
        description: "Rynek \r\n\tmocy\n",
      }),
    ).toMatchObject({ title: "Raport roczny", description: "Rynek mocy" });
  });

  it("serializacja oczyszczonej migawki nie niesie escape'u, którego baza nie przyjmie", () => {
    const snapshot = clubLinkSnapshotFromPreview({
      url: "https://energia.example",
      title: "Tytu\u0000ł",
      description: "Opis\u001f",
      siteName: "\u0000Serwis",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/\\u00[01][0-9a-f]/i);
    // Ten sam wynik przy odczycie wiersza zapisanego z pominięciem RPC.
    expect(
      parseClubLinkSnapshot({ url: "https://energia.example", title: "A\u0000" }),
    ).toMatchObject({ title: "A" });
  });

  it("to samo trafia do załącznika `link` wpisu ściany", () => {
    const snapshot = clubLinkSnapshotFromPreview({
      url: "https://energia.example",
      title: "\u0000Raport\u0000",
    });
    expect(snapshot && clubLinkSnapshotToAttachment(snapshot)).toMatchObject({
      type: "link",
      title: "Raport",
    });
  });
});

describe("clubLinkSnapshotToAttachment - element `link` nowego wpisu", () => {
  it("daje załącznik rozpoznawany przez parser załączników wpisu", () => {
    const attachment = clubLinkSnapshotToAttachment({
      url: "https://energia.example/raport",
      title: "Raport",
      description: "Opis",
      image: "https://energia.example/og.png",
      siteName: "Energia",
    });
    expect(attachment).toEqual({
      type: "link",
      url: "https://energia.example/raport",
      title: "Raport",
      description: "Opis",
      image: "https://energia.example/og.png",
      siteName: "Energia",
    });
    // Ta sama droga, którą przejdzie zapisany wpis przy odczycie.
    expect(parseClubPostAttachments(JSON.parse(JSON.stringify([attachment])))).toEqual([
      attachment,
    ]);
  });
});

describe("clubCommentErrorKey - odmowa bazy na komunikat", () => {
  it.each([
    ["clubs: comment rate limit", "club.comments.error.rateLimit"],
    ["clubs: reply rate limit", "club.comments.error.rateLimit"],
    ["clubs: comment burst limit", "club.comments.error.burstLimit"],
    ["clubs: reply burst limit", "club.comments.error.burstLimit"],
    ["clubs: thread locked", "club.comments.error.locked"],
    ["clubs: forbidden", "club.comments.error.forbidden"],
    ["clubs: authentication required", "club.comments.error.forbidden"],
    ["clubs: post not found", "club.comments.error.notFound"],
    ["clubs: thread not found", "club.comments.error.notFound"],
    ["clubs: invalid comment", "club.comments.error.invalid"],
    ["clubs: invalid link preview", "club.comments.error.invalid"],
    ["clubs: invalid link attachment", "club.comments.error.invalid"],
    ["Failed to fetch", "club.comments.error.generic"],
    ["", "club.comments.error.generic"],
  ])("%j -> %s", (message, key) => {
    // Kształt PostgREST: zwykły obiekt z `message`, nie zawsze instancja Error.
    expect(clubCommentErrorKey({ message, code: "P0001" })).toBe(key);
    expect(clubCommentErrorKey(new Error(message))).toBe(key);
  });

  it("„burst limit” wygrywa z „rate limit” - inny komunikat, inna rada", () => {
    expect(clubCommentErrorKey({ message: "clubs: comment burst limit (rate limit)" })).toBe(
      "club.comments.error.burstLimit",
    );
  });

  it("wielkość liter w komunikacie nie ma znaczenia", () => {
    expect(clubCommentErrorKey({ message: "CLUBS: FORBIDDEN" })).toBe(
      "club.comments.error.forbidden",
    );
  });

  it("wartość bez komunikatu daje komunikat ogólny, nie wyjątek", () => {
    // Asercja na KONKRETNY klucz: sam typ wyniku gwarantuje już przynależność
    // do katalogu, więc `toContain` przepuściłby „brak prawa" dla błędu sieci.
    for (const value of [null, undefined, 42, {}, { message: 7 }, { message: null }, new Error()]) {
      expect(() => clubCommentErrorKey(value)).not.toThrow();
      expect(clubCommentErrorKey(value)).toBe("club.comments.error.generic");
    }
    expect(clubCommentErrorKey("clubs: thread locked")).toBe("club.comments.error.locked");
  });

  it("katalog kluczy jest kompletny - każdy wynik funkcji jest w nim wymieniony", () => {
    expect([...CLUB_COMMENT_ERROR_KEYS].sort()).toEqual(
      [
        "club.comments.error.burstLimit",
        "club.comments.error.forbidden",
        "club.comments.error.generic",
        "club.comments.error.invalid",
        "club.comments.error.locked",
        "club.comments.error.notFound",
        "club.comments.error.rateLimit",
      ].sort(),
    );
  });
});

describe("clubPostErrorKey - odmowa publikacji wpisu na komunikat", () => {
  it.each([
    ["clubs: post rate limit", "club.post.error.rateLimit"],
    ["clubs: post burst limit", "club.post.error.burstLimit"],
    ["clubs: invalid link attachment", "club.post.error.invalidLink"],
    ["club_post_create: unauthenticated", "club.post.error.forbidden"],
    ["club_post_create: forbidden", "club.post.error.forbidden"],
    ["clubs: authentication required", "club.post.error.forbidden"],
    ["club_post_create: too many attachments", "club.post.error.invalid"],
    ["club_post_create: empty post", "club.post.error.invalid"],
    ["club_post_create: body too long", "club.post.error.invalid"],
    ["club_post_create: thread not in club", "club.post.error.invalid"],
    ["club_post_create: group not in club", "club.post.error.invalid"],
    ["Failed to fetch", "club.post.error.generic"],
    ["", "club.post.error.generic"],
  ])("%j -> %s", (message, key) => {
    expect(clubPostErrorKey({ message, code: "P0001" })).toBe(key);
    expect(clubPostErrorKey(new Error(message))).toBe(key);
  });

  it("„burst limit” wygrywa z „rate limit”, a karta linku z ogólnym „invalid”", () => {
    expect(clubPostErrorKey({ message: "clubs: post burst limit (rate limit)" })).toBe(
      "club.post.error.burstLimit",
    );
    expect(clubPostErrorKey({ message: "CLUBS: INVALID LINK ATTACHMENT" })).toBe(
      "club.post.error.invalidLink",
    );
  });

  it("wartość bez komunikatu daje komunikat ogólny, nie wyjątek", () => {
    for (const value of [null, undefined, 42, {}, { message: 7 }, new Error()]) {
      expect(() => clubPostErrorKey(value)).not.toThrow();
      expect(clubPostErrorKey(value)).toBe("club.post.error.generic");
    }
  });

  it("katalog kluczy jest kompletny - każdy wynik funkcji jest w nim wymieniony", () => {
    expect([...CLUB_POST_ERROR_KEYS].sort()).toEqual(
      [
        "club.post.error.burstLimit",
        "club.post.error.forbidden",
        "club.post.error.generic",
        "club.post.error.invalid",
        "club.post.error.invalidLink",
        "club.post.error.rateLimit",
      ].sort(),
    );
  });
});

describe("clubCommentCountDelta - licznik liczy wyłącznie widoczne", () => {
  it.each([
    ["pending", "visible", 1],
    ["hidden", "visible", 1],
    ["visible", "hidden", -1],
    ["visible", "deleted", -1],
    ["pending", "hidden", 0],
    ["pending", "deleted", 0],
    ["hidden", "deleted", 0],
    ["visible", "visible", 0],
    ["deleted", "deleted", 0],
  ] as const)("%s -> %s: %d", (from, to, delta) => {
    expect(clubCommentCountDelta(from, to)).toBe(delta);
  });
});
