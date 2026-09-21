// Hint LCP okładki klubu - CZYSTA decyzja „czy i co wstępnie pobrać".
//
// CO TEN PLIK DOWODZI. `clubCoverPreload` jest jedynym miejscem, w którym stoi
// reguła „kiedy okładka klubu jest elementem LCP" (audyt CWV 2026-09-20, F09).
// Decyzja ma dwa końce i OBA kosztują:
//
//   * PRELOAD, KTÓREGO NIKT NIE MALUJE, to czysta strata pasma na ścieżce
//     krytycznej - a pasmo na niej jest tym samym zasobem, o który walczy
//     dokument. Dlatego większość przypadków w tym pliku to asercje na `null`:
//     inna powierzchnia niż hub, brak karty, brak pliku, klub otwarty.
//   * PRELOAD Z INNYM ZESTAWEM KANDYDATÓW niż `<img>` każe przeglądarce
//     pobrać plik, którego obraz i tak nie wybierze - czyli PODWAJA transfer
//     zamiast go przyspieszać. Stąd parytet z `ClubCover variant="banner"`
//     (`buildImageSrcSet` + `sizes`) jest tu warunkiem poprawności, nie
//     ozdobą: asercja porównuje CAŁY deskryptor, nie sam `href`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Mechaniki `buildImageSrcSet` (lista szerokości,
// jakość per wariant, rozpoznanie adresu Supabase Storage) dowodzi
// `src/lib/__tests__/cropSizes.test.ts`. Tutaj interesuje nas WYWOŁANIE:
// czy deskryptor niesie dokładnie to, co odda ta funkcja, i co się dzieje,
// gdy odda pusty ciąg.
import { describe, expect, it } from "vitest";
import { buildImageSrcSet } from "@/lib/cropSizes";
import {
  CLUB_COVER_BANNER_SIZES,
  clubCoverPreload,
  isClubHubPath,
  type ClubCoverSource,
} from "@/lib/clubs/clubCoverPreload";

/** Adres w Supabase Storage - JEDYNY kształt, dla którego `buildImageSrcSet`
 *  oddaje niepusty zestaw kandydatów. */
const OKLADKA = "https://projekt.supabase.co/storage/v1/object/public/media/klub/okladka.jpg";

/** Adres SPOZA Storage'u: `<img>` nie dostanie `srcSet`, więc preload też nie. */
const OKLADKA_OBCA = "https://cdn.example.org/klub/okladka.jpg";

const HUB = "/club/klub-energetyczny";

function karta(over: Partial<ClubCoverSource> = {}): ClubCoverSource {
  return { can_read: false, cover_image_url: OKLADKA, ...over };
}

describe("isClubHubPath - hub liczony z SEGMENTÓW, nie z porównania adresów", () => {
  it("hub klubu to DOKŁADNIE dwa segmenty `/club/<slug>`", () => {
    expect(isClubHubPath(HUB)).toBe(true);
    expect(isClubHubPath(`${HUB}/`)).toBe(true);
  });

  it("prefiks językowy nie zmienia rozstrzygnięcia", () => {
    // `/en/club/<slug>` to ten sam hub - gdyby prefiks liczył się jako segment,
    // angielski dokument nigdy nie dostałby hintu.
    expect(isClubHubPath(`/en${HUB}`)).toBe(true);
  });

  it.each([
    `${HUB}/members`,
    `${HUB}/t/temat-pierwszy`,
    `${HUB}/minisite`,
    "/club",
    "/clubs/klub-energetyczny",
    "/",
  ])("`%s` NIE jest hubem", (pathname) => {
    expect(isClubHubPath(pathname)).toBe(false);
  });

  it("slug ze znakiem spoza ASCII liczy się jak każdy inny segment", () => {
    // Parametr trasy jest ODKODOWANY, a ścieżka żądania nie musi być - dlatego
    // reguła liczy segmenty, zamiast porównywać sklejony adres.
    expect(isClubHubPath("/club/klub-%C5%9Brodowiskowy")).toBe(true);
    expect(isClubHubPath("/club/klub-środowiskowy")).toBe(true);
  });
});

describe("clubCoverPreload - hint tylko tam, gdzie okładka NAPRAWDĘ jest LCP", () => {
  it("hub za bramką dostępu dostaje pełny deskryptor w parytecie z `<img>`", () => {
    // `ClubAccessGate` zaczyna się od `ClubCover variant=\"banner\"` z `priority`,
    // więc to pierwszy i największy obraz nad zgięciem.
    expect(clubCoverPreload(karta(), HUB)).toEqual({
      href: OKLADKA,
      imageSrcSet: buildImageSrcSet(OKLADKA),
      imageSizes: CLUB_COVER_BANNER_SIZES,
    });
  });

  it("`sizes` jest DOSŁOWNIE tym, co renderuje wariant `banner`", () => {
    // Rozjazd tej jednej wartości z `ClubCover` wybiera inny kandydat niż
    // `<img>` i podwaja transfer - dlatego stała jest tu przypięta wprost.
    expect(CLUB_COVER_BANNER_SIZES).toBe("(min-width: 1024px) 64rem, 100vw");
  });

  it("adres SPOZA Storage'u daje sam `href` - bo `<img>` też nie ma `srcSet`", () => {
    // Preload z wymyślonym zestawem kandydatów byłby gorszy niż jego brak.
    expect(clubCoverPreload(karta({ cover_image_url: OKLADKA_OBCA }), HUB)).toEqual({
      href: OKLADKA_OBCA,
    });
  });

  it("KLUB OTWARTY (`can_read`) nie dostaje hintu - hub rysuje wtedy `ClubHub`", () => {
    // Powierzchnia z dostępem nie ma obrazu nad zgięciem, więc hint byłby
    // pobraniem pliku, którego nikt nie maluje.
    expect(clubCoverPreload(karta({ can_read: true }), HUB)).toBeNull();
  });

  it.each([
    ["skład", `${HUB}/members`],
    ["wątek", `${HUB}/t/temat-pierwszy`],
    ["minisite", `${HUB}/minisite`],
    ["kalendarz", `${HUB}/calendar`],
  ])("powierzchnia `%s` nie dostaje hintu", (_nazwa, pathname) => {
    expect(clubCoverPreload(karta(), pathname)).toBeNull();
  });

  it("BRAK KARTY (układ zdegradował) nie zgaduje okładki", () => {
    expect(clubCoverPreload(null, HUB)).toBeNull();
  });

  it.each([
    ["null", null],
    ["pusty ciąg", ""],
    ["same spacje", "   "],
  ])("okładka `%s` nie daje hintu", (_nazwa, cover) => {
    // `ClubCover variant=\"banner\"` bez pliku nie rysuje NIC - preload pustego
    // albo białego adresu byłby żądaniem pod adres, którego nie ma.
    expect(clubCoverPreload(karta({ cover_image_url: cover }), HUB)).toBeNull();
  });
});
