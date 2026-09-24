// Reguly karty prelegenta rozwijanej kliknieciem (warstwa czysta).
//
// DLACZEGO TEN TEST ISTNIEJE. Karta dostaje wiersze z trzech zrodel: RPC
// publicznego (`event_speakers_public`), panelu (`admin_event_speakers_list`)
// i podgladu studia / pamieci podrecznej sprzed kolumn karty. Tylko pierwsze
// dwa przechodza przez CHECK-i bazy, wiec parser sciezek, `safeCardHref`
// i dobor koloru napisu musza bronic sie same - `javascript:` w `href`,
// zdublowany klucz Reacta albo bialy napis na zoltym przycisku to bledy, ktore
// widac dopiero na zywej stronie wydarzenia. Walidacja szkicu jest lustrem
// CHECK-ow z migracji 0048: jesli sie rozjedzie, redaktor dostanie odmowe
// `23514` bez wskazania pola.
import { describe, expect, it } from "vitest";

import {
  EMPTY_SPEAKER_CARD_DRAFT,
  SPEAKER_CARD_LABEL_MAX,
  hexColorOrNull,
  parseSpeakerTracks,
  readableInkOn,
  safeCardHref,
  speakerCardAction,
  speakerCardDraftErrors,
  speakerCardDraftFrom,
  speakerCardPhoto,
  speakerTrackName,
  type SpeakerCardDraft,
  type SpeakerTrack,
} from "@/lib/events/speakerCard";

const TRACK_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TRACK_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function rawTrack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRACK_A,
    key: "policy",
    name_pl: "Polityka",
    name_en: "Policy",
    accent_color: "#1A237E",
    sessions_count: 2,
    ...overrides,
  };
}

function track(overrides: Partial<SpeakerTrack> = {}): SpeakerTrack {
  return {
    id: TRACK_A,
    key: null,
    namePl: "Polityka",
    nameEn: "Policy",
    accentColor: null,
    sessionsCount: 1,
    ...overrides,
  };
}

function draft(overrides: Partial<SpeakerCardDraft> = {}): SpeakerCardDraft {
  return { ...EMPTY_SPEAKER_CARD_DRAFT, ...overrides };
}

// Niezalezne od modulu odwzorowanie WCAG 2.x (wzor z definicji relative
// luminance), zeby test sprawdzal WYNIK, a nie powtarzal implementacje.
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("hexColorOrNull", () => {
  it("przepuszcza #RRGGBB w obu wielkosciach liter i obcina spacje", () => {
    expect(hexColorOrNull("#1a237e")).toBe("#1a237e");
    expect(hexColorOrNull("#1A237E")).toBe("#1A237E");
    expect(hexColorOrNull("  #ffcc00 ")).toBe("#ffcc00");
  });

  it("odrzuca skrot #RGB, kanal alfa, nazwy kolorow i brak krzyzyka", () => {
    expect(hexColorOrNull("#fff")).toBeNull();
    expect(hexColorOrNull("#ffcc0080")).toBeNull();
    expect(hexColorOrNull("red")).toBeNull();
    expect(hexColorOrNull("ffcc00")).toBeNull();
    expect(hexColorOrNull("#gggggg")).toBeNull();
    expect(hexColorOrNull("")).toBeNull();
  });

  it("odrzuca wartosci, ktore nie sa napisem", () => {
    expect(hexColorOrNull(null)).toBeNull();
    expect(hexColorOrNull(undefined)).toBeNull();
    expect(hexColorOrNull(0xffcc00)).toBeNull();
    expect(hexColorOrNull({ color: "#ffcc00" })).toBeNull();
  });
});

describe("parseSpeakerTracks", () => {
  it("zwraca pusta liste dla wejscia, ktore nie jest tablica", () => {
    expect(parseSpeakerTracks(null)).toEqual([]);
    expect(parseSpeakerTracks(undefined)).toEqual([]);
    expect(parseSpeakerTracks(rawTrack())).toEqual([]);
    expect(parseSpeakerTracks("[]")).toEqual([]);
  });

  it("mapuje pelny wpis na kamelowy ksztalt i zachowuje kolejnosc z bazy", () => {
    const result = parseSpeakerTracks([
      rawTrack(),
      rawTrack({
        id: TRACK_B,
        key: null,
        name_pl: "Gospodarka",
        name_en: "Economy",
        accent_color: null,
        sessions_count: 1,
      }),
    ]);
    expect(result).toEqual([
      {
        id: TRACK_A,
        key: "policy",
        namePl: "Polityka",
        nameEn: "Policy",
        accentColor: "#1A237E",
        sessionsCount: 2,
      },
      {
        id: TRACK_B,
        key: null,
        namePl: "Gospodarka",
        nameEn: "Economy",
        accentColor: null,
        sessionsCount: 1,
      },
    ]);
  });

  it("obcina spacje w id, kluczu i nazwach, a puste napisy zamienia na null", () => {
    const [only] = parseSpeakerTracks([
      rawTrack({ id: `  ${TRACK_A} `, key: "   ", name_pl: " Polityka ", name_en: "  " }),
    ]);
    expect(only).toMatchObject({ id: TRACK_A, key: null, namePl: "Polityka", nameEn: null });
  });

  it("pomija wpisy, ktorych nie da sie narysowac: null, prymitywy, tablice, brak id", () => {
    const result = parseSpeakerTracks([
      null,
      undefined,
      "sciezka",
      42,
      [rawTrack()],
      rawTrack({ id: undefined }),
      rawTrack({ id: "   " }),
      rawTrack({ id: 7 }),
      rawTrack({ id: TRACK_B }),
    ]);
    expect(result.map((t) => t.id)).toEqual([TRACK_B]);
  });

  it("pomija sciezke bez nazwy w obu jezykach, ale przyjmuje nazwe w jednym", () => {
    const result = parseSpeakerTracks([
      rawTrack({ id: "no-name", name_pl: null, name_en: " " }),
      rawTrack({ id: "pl-only", name_pl: "Tylko PL", name_en: null }),
      rawTrack({ id: "en-only", name_pl: "", name_en: "EN only" }),
    ]);
    expect(result.map((t) => [t.id, t.namePl, t.nameEn])).toEqual([
      ["pl-only", "Tylko PL", null],
      ["en-only", null, "EN only"],
    ]);
  });

  it("odsiewa duplikat id (pierwszy wygrywa), zeby klucz Reacta byl jednoznaczny", () => {
    const result = parseSpeakerTracks([
      rawTrack({ name_pl: "Pierwsza" }),
      rawTrack({ name_pl: "Druga" }),
      rawTrack({ id: ` ${TRACK_A}`, name_pl: "Trzecia po trimie" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].namePl).toBe("Pierwsza");
  });

  it("wpis bez nazwy nie rezerwuje id - pozniejszy poprawny wpis z tym id zostaje", () => {
    const result = parseSpeakerTracks([
      rawTrack({ name_pl: null, name_en: null }),
      rawTrack({ name_pl: "Poprawna" }),
    ]);
    expect(result.map((t) => t.namePl)).toEqual(["Poprawna"]);
  });

  it("kolor akcentu spoza #RRGGBB zamienia na null", () => {
    const colors = ["#abc", "blue", 123, null].map(
      (accent_color) => parseSpeakerTracks([rawTrack({ accent_color })])[0].accentColor,
    );
    expect(colors).toEqual([null, null, null, null]);
    expect(parseSpeakerTracks([rawTrack({ accent_color: " #00ff00 " })])[0].accentColor).toBe(
      "#00ff00",
    );
  });

  it.each<[unknown, number]>([
    [3, 3],
    ["4", 4],
    [2.9, 2],
    ["5.7", 5],
    [0, 0],
    [-2, 0],
    ["-1", 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ["abc", 0],
    ["", 0],
    [null, 0],
    [undefined, 0],
    [{}, 0],
  ])("sessions_count %p -> %p", (sessions_count, expected) => {
    const [only] = parseSpeakerTracks([rawTrack({ sessions_count })]);
    expect(only.sessionsCount).toBe(expected);
  });
});

describe("speakerTrackName", () => {
  it("wybiera nazwe w jezyku interfejsu", () => {
    expect(speakerTrackName(track(), "pl")).toBe("Polityka");
    expect(speakerTrackName(track(), "en")).toBe("Policy");
  });

  it("w braku nazwy w jezyku interfejsu siega po drugi jezyk", () => {
    expect(speakerTrackName(track({ nameEn: null }), "en")).toBe("Polityka");
    expect(speakerTrackName(track({ namePl: null }), "pl")).toBe("Policy");
  });

  it("bez zadnej nazwy zwraca pusty napis, a nie null", () => {
    expect(speakerTrackName(track({ namePl: null, nameEn: null }), "pl")).toBe("");
    expect(speakerTrackName(track({ namePl: null, nameEn: null }), "en")).toBe("");
  });
});

describe("safeCardHref", () => {
  it("przepuszcza adres https", () => {
    expect(safeCardHref("https://example.com/zapis?x=1#a")).toBe("https://example.com/zapis?x=1#a");
  });

  it("wielkie HTTPS odrzuca - jak CHECK bazy, ktory rozroznia wielkosc liter", () => {
    // Panel, ktory by to przepuscil, dawalby redaktorowi odmowe bazy (23514)
    // bez wskazania pola, a karta z pamieci podrecznej - link za „wewnetrzny".
    expect(safeCardHref("HTTPS://example.com")).toBeNull();
    expect(safeCardHref("Https://example.com")).toBeNull();
  });

  it("sciezka z odwrotnym ukosnikiem na drugim miejscu to link POZA serwis", () => {
    // Przegladarka czyta `/\\evil.com` jak `//evil.com` - adres wzgledny wobec
    // protokolu. `new URL("/\\evil.com", "https://site.pl/").host === "evil.com"`.
    expect(safeCardHref("/\\evil.com")).toBeNull();
    expect(safeCardHref("/\\/evil.com")).toBeNull();
  });

  it("bialy znak w srodku adresu odrzuca - parser adresu wycina tabulator", () => {
    expect(safeCardHref("/\t/evil.com")).toBeNull();
    expect(safeCardHref("/pro gram")).toBeNull();
    expect(safeCardHref("https://example.com/a b")).toBeNull();
  });

  it("odwrotny ukosnik DALEJ w sciezce zostaje - to nadal ten sam serwis", () => {
    expect(safeCardHref("/a\\b")).toBe("/a\\b");
  });

  it("przepuszcza sciezke wzgledem korzenia serwisu", () => {
    expect(safeCardHref("/wydarzenia/kongres/program")).toBe("/wydarzenia/kongres/program");
    expect(safeCardHref("/a")).toBe("/a");
  });

  it("obcina spacje z brzegow przed sprawdzeniem", () => {
    expect(safeCardHref("  https://example.com  ")).toBe("https://example.com");
    expect(safeCardHref("\t/program\n")).toBe("/program");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.com",
    "mailto:ktos@example.com",
    "tel:+48123456789",
  ])("odrzuca schemat inny niz https: %s", (value) => {
    expect(safeCardHref(value)).toBeNull();
  });

  it.each(["//evil.example", "///evil.example", "// evil.example"])(
    "odrzuca adres protokolowo-wzgledny %s (prowadzi poza serwis)",
    (value) => {
      expect(safeCardHref(value)).toBeNull();
    },
  );

  it("odrzuca sciezki wzgledne bez ukosnika na poczatku i sam ukosnik", () => {
    expect(safeCardHref("program")).toBeNull();
    expect(safeCardHref("./program")).toBeNull();
    expect(safeCardHref("../program")).toBeNull();
    expect(safeCardHref("#rejestracja")).toBeNull();
    expect(safeCardHref("?q=1")).toBeNull();
    expect(safeCardHref("/")).toBeNull();
  });

  it("odrzuca adres z bialym znakiem w srodku i sam schemat bez hosta", () => {
    expect(safeCardHref("https://example.com/a b")).toBeNull();
    expect(safeCardHref("/program dnia")).toBeNull();
    expect(safeCardHref("https://")).toBeNull();
  });

  it("odrzuca pusty napis i wartosci, ktore nie sa napisem", () => {
    expect(safeCardHref("")).toBeNull();
    expect(safeCardHref("   ")).toBeNull();
    expect(safeCardHref(null)).toBeNull();
    expect(safeCardHref(undefined)).toBeNull();
    expect(safeCardHref(42)).toBeNull();
  });
});

describe("speakerCardAction", () => {
  const LINK = {
    card_cta_label_pl: "Zapisz sie",
    card_cta_label_en: "Sign up",
    card_cta_url: "https://example.com/zapis",
  };

  it("adres zewnetrzny -> link w nowej karcie z etykieta w jezyku interfejsu", () => {
    expect(speakerCardAction(LINK, "pl", false)).toEqual({
      kind: "link",
      href: "https://example.com/zapis",
      label: "Zapisz sie",
      external: true,
    });
    expect(speakerCardAction(LINK, "en", false)).toMatchObject({ label: "Sign up" });
  });

  it("sciezka wewnetrzna -> link w tej samej karcie", () => {
    expect(speakerCardAction({ ...LINK, card_cta_url: "/program" }, "pl", false)).toEqual({
      kind: "link",
      href: "/program",
      label: "Zapisz sie",
      external: false,
    });
  });

  it("adres ma pierwszenstwo przed profilem, nawet gdy profil da sie otworzyc", () => {
    expect(speakerCardAction(LINK, "pl", true)?.kind).toBe("link");
  });

  it("pusta etykieta w jezyku interfejsu nie gasi przycisku - bierze drugi jezyk", () => {
    expect(speakerCardAction({ ...LINK, card_cta_label_en: "  " }, "en", false)).toMatchObject({
      kind: "link",
      label: "Zapisz sie",
    });
    expect(speakerCardAction({ ...LINK, card_cta_label_pl: null }, "pl", false)).toMatchObject({
      kind: "link",
      label: "Sign up",
    });
  });

  it("bez etykiety w obu jezykach -> label null (etykieta domyslna interfejsu)", () => {
    expect(speakerCardAction({ card_cta_url: "https://example.com" }, "pl", false)).toEqual({
      kind: "link",
      href: "https://example.com",
      label: null,
      external: true,
    });
  });

  it("etykieta od redakcji jest obcieta ze spacji", () => {
    expect(
      speakerCardAction({ ...LINK, card_cta_label_pl: "  Bilety  " }, "pl", false),
    ).toMatchObject({ label: "Bilety" });
  });

  it("bez adresu, ale z profilem do pokazania -> otwarcie profilu z etykieta", () => {
    expect(speakerCardAction({ card_cta_label_pl: "Wiecej" }, "pl", true)).toEqual({
      kind: "profile",
      label: "Wiecej",
    });
    expect(speakerCardAction({ card_cta_label_pl: "Wiecej" }, "en", true)).toEqual({
      kind: "profile",
      label: "Wiecej",
    });
    expect(speakerCardAction({}, "en", true)).toEqual({ kind: "profile", label: null });
  });

  it("niebezpieczny adres jest traktowany jak brak adresu", () => {
    const row = { ...LINK, card_cta_url: "javascript:alert(1)" };
    expect(speakerCardAction(row, "pl", true)).toEqual({ kind: "profile", label: "Zapisz sie" });
    expect(speakerCardAction(row, "pl", false)).toBeNull();
    expect(speakerCardAction({ ...LINK, card_cta_url: "//evil.example" }, "pl", false)).toBeNull();
  });

  it("bez adresu i bez profilu -> brak przycisku, nawet z etykieta", () => {
    expect(speakerCardAction({ card_cta_label_pl: "Kliknij" }, "pl", false)).toBeNull();
    expect(speakerCardAction({}, "pl", false)).toBeNull();
  });
});

describe("speakerCardPhoto", () => {
  it("kadr od redakcji ma pierwszenstwo przed zdjeciem osoby", () => {
    expect(
      speakerCardPhoto({
        card_photo_url: "https://cdn.example/kadr.jpg",
        avatar_url: "https://cdn.example/avatar.jpg",
      }),
    ).toBe("https://cdn.example/kadr.jpg");
  });

  it("pusty albo brakujacy kadr -> zdjecie osoby", () => {
    expect(
      speakerCardPhoto({ card_photo_url: "  ", avatar_url: "https://cdn.example/a.jpg" }),
    ).toBe("https://cdn.example/a.jpg");
    expect(speakerCardPhoto({ avatar_url: " https://cdn.example/a.jpg " })).toBe(
      "https://cdn.example/a.jpg",
    );
  });

  it("bez obu zdjec -> null", () => {
    expect(speakerCardPhoto({})).toBeNull();
    expect(speakerCardPhoto({ card_photo_url: null, avatar_url: "" })).toBeNull();
  });
});

describe("readableInkOn", () => {
  it("na jasnym tle daje czarny napis (bialy na zoltym bylby nieczytelny)", () => {
    expect(readableInkOn("#ffffff")).toBe("#000000");
    expect(readableInkOn("#ffff00")).toBe("#000000");
    expect(readableInkOn("#f59e0b")).toBe("#000000");
    expect(readableInkOn("#00ff00")).toBe("#000000");
  });

  it("na ciemnym tle daje bialy napis", () => {
    expect(readableInkOn("#000000")).toBe("#ffffff");
    expect(readableInkOn("#1a237e")).toBe("#ffffff");
    expect(readableInkOn("#0000ff")).toBe("#ffffff");
    expect(readableInkOn("#2563eb")).toBe("#ffffff");
  });

  it("czysta czerwien idzie na czarny napis - WCAG liczy luminancje, nie intuicje", () => {
    // #ff0000: 5.25:1 z czernia kontra 4.00:1 z biela.
    expect(readableInkOn("#ff0000")).toBe("#000000");
  });

  it("granica szarosci lezy miedzy #757575 a #767676", () => {
    // L ~ 0.1779 -> biel 4.61:1, czern 4.56:1; L ~ 0.1812 -> biel 4.54:1, czern 4.62:1.
    expect(readableInkOn("#757575")).toBe("#ffffff");
    expect(readableInkOn("#767676")).toBe("#000000");
  });

  it.each([
    "#ffffff",
    "#000000",
    "#ffff00",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#1a237e",
    "#2563eb",
    "#e11d48",
    "#f59e0b",
    "#737373",
    "#757575",
    "#767676",
    "#777777",
    "#808080",
    "#c0c0c0",
  ])("dla %s wybiera napis o WIEKSZYM kontrascie wg WCAG 2.x", (hex) => {
    const ink = readableInkOn(hex);
    const other = ink === "#000000" ? "#ffffff" : "#000000";
    expect(contrast(hex, ink)).toBeGreaterThanOrEqual(contrast(hex, other));
  });

  it("wielkosc liter i spacje wokol koloru nie zmieniaja wyniku", () => {
    expect(readableInkOn(" #FFFF00 ")).toBe("#000000");
    expect(readableInkOn("#1A237E")).toBe("#ffffff");
  });

  it("brak albo niepoprawny kolor -> bialy napis (tlo marki jest ciemne)", () => {
    expect(readableInkOn(null)).toBe("#ffffff");
    expect(readableInkOn("")).toBe("#ffffff");
    expect(readableInkOn("#fff")).toBe("#ffffff");
    expect(readableInkOn("yellow")).toBe("#ffffff");
  });
});

describe("speakerCardDraftErrors", () => {
  it("pusty szkic nie ma bledow (pusty = brak, baza dostaje NULL)", () => {
    expect(speakerCardDraftErrors(EMPTY_SPEAKER_CARD_DRAFT)).toEqual({});
  });

  it("same spacje w polach tez nie sa bledem", () => {
    expect(
      speakerCardDraftErrors(
        draft({ photoUrl: "  ", labelPl: "   ", labelEn: " ", url: "  ", color: "  " }),
      ),
    ).toEqual({});
  });

  it("poprawny szkic nie ma bledow", () => {
    expect(
      speakerCardDraftErrors({
        photoUrl: "https://cdn.example/kadr.jpg",
        labelPl: "Zapisz sie",
        labelEn: "Sign up",
        url: "/program",
        color: "#FFCC00",
      }),
    ).toEqual({});
  });

  it("etykieta: limit to 40 znakow po obcieciu spacji, 41 to labelTooLong", () => {
    const max = "x".repeat(SPEAKER_CARD_LABEL_MAX);
    expect(SPEAKER_CARD_LABEL_MAX).toBe(40);
    expect(speakerCardDraftErrors(draft({ labelPl: max, labelEn: `  ${max}  ` }))).toEqual({});
    expect(speakerCardDraftErrors(draft({ labelPl: `${max}y` }))).toEqual({
      labelPl: "labelTooLong",
    });
    expect(speakerCardDraftErrors(draft({ labelEn: `${max}y` }))).toEqual({
      labelEn: "labelTooLong",
    });
  });

  it("adres przycisku, ktorego nie przepusci safeCardHref, to urlShape", () => {
    for (const url of ["javascript:alert(1)", "http://example.com", "//evil.example", "program"]) {
      expect(speakerCardDraftErrors(draft({ url }))).toEqual({ url: "urlShape" });
    }
    expect(speakerCardDraftErrors(draft({ url: " https://example.com " }))).toEqual({});
  });

  it("kadr musi byc adresem https bez bialych znakow - inaczej photoShape", () => {
    for (const photoUrl of [
      "http://cdn.example/a.jpg",
      "/uploads/a.jpg",
      "https://cdn.example/a b.jpg",
      "https://",
    ]) {
      expect(speakerCardDraftErrors(draft({ photoUrl }))).toEqual({ photoUrl: "photoShape" });
    }
    expect(speakerCardDraftErrors(draft({ photoUrl: " https://cdn.example/a.jpg " }))).toEqual({});
  });

  it("kolor spoza #RRGGBB to colorShape", () => {
    for (const color of ["#fff", "red", "ffcc00", "#ffcc0080"]) {
      expect(speakerCardDraftErrors(draft({ color }))).toEqual({ color: "colorShape" });
    }
    expect(speakerCardDraftErrors(draft({ color: " #ffcc00 " }))).toEqual({});
  });

  it("zbiera bledy ze wszystkich pol naraz, zeby redaktor widzial calosc", () => {
    const tooLong = "x".repeat(SPEAKER_CARD_LABEL_MAX + 1);
    expect(
      speakerCardDraftErrors({
        photoUrl: "ftp://cdn.example/a.jpg",
        labelPl: tooLong,
        labelEn: tooLong,
        url: "javascript:void(0)",
        color: "blue",
      }),
    ).toEqual({
      photoUrl: "photoShape",
      labelPl: "labelTooLong",
      labelEn: "labelTooLong",
      url: "urlShape",
      color: "colorShape",
    });
  });
});

describe("speakerCardDraftFrom", () => {
  it("wiersz bez pol karty daje pusty szkic", () => {
    expect(speakerCardDraftFrom({})).toEqual(EMPTY_SPEAKER_CARD_DRAFT);
    expect(
      speakerCardDraftFrom({
        card_photo_url: null,
        card_cta_label_pl: null,
        card_cta_label_en: null,
        card_cta_url: null,
        card_cta_color: null,
      }),
    ).toEqual(EMPTY_SPEAKER_CARD_DRAFT);
  });

  it("przepisuje pola karty 1:1 na pola szkicu", () => {
    expect(
      speakerCardDraftFrom({
        card_photo_url: "https://cdn.example/kadr.jpg",
        card_cta_label_pl: "Zapisz sie",
        card_cta_label_en: "Sign up",
        card_cta_url: "/program",
        card_cta_color: "#ffcc00",
      }),
    ).toEqual({
      photoUrl: "https://cdn.example/kadr.jpg",
      labelPl: "Zapisz sie",
      labelEn: "Sign up",
      url: "/program",
      color: "#ffcc00",
    });
  });

  it("szkic z wiersza przechodzi walidacje, gdy wiersz spelnia CHECK-i bazy", () => {
    const fromRow = speakerCardDraftFrom({
      card_photo_url: "https://cdn.example/kadr.jpg",
      card_cta_url: "https://example.com",
      card_cta_color: "#000000",
    });
    expect(fromRow).toEqual(
      draft({
        photoUrl: "https://cdn.example/kadr.jpg",
        url: "https://example.com",
        color: "#000000",
      }),
    );
    expect(speakerCardDraftErrors(fromRow)).toEqual({});
  });

  it("nie wspoldzieli obiektu z EMPTY_SPEAKER_CARD_DRAFT", () => {
    const fresh = speakerCardDraftFrom({});
    fresh.labelPl = "zmiana";
    expect(EMPTY_SPEAKER_CARD_DRAFT.labelPl).toBe("");
  });
});

describe("speakerCardDraftErrors - zgodnosc z CHECK-ami bazy", () => {
  const draft = (over: Partial<SpeakerCardDraft>): SpeakerCardDraft => ({
    ...EMPTY_SPEAKER_CARD_DRAFT,
    ...over,
  });

  it("wielkie HTTPS w zdjeciu i w adresie to blad przy polu, nie odmowa bazy", () => {
    expect(speakerCardDraftErrors(draft({ photoUrl: "HTTPS://cdn.example/a.jpg" }))).toEqual({
      photoUrl: "photoShape",
    });
    expect(speakerCardDraftErrors(draft({ url: "HTTPS://example.com" }))).toEqual({
      url: "urlShape",
    });
  });

  it("adres z odwrotnym ukosnikiem na drugim miejscu jest bledem pola", () => {
    expect(speakerCardDraftErrors(draft({ url: "/\\evil.com" }))).toEqual({ url: "urlShape" });
  });

  it("limit etykiety liczy punkty kodowe jak `char_length`, nie jednostki UTF-16", () => {
    // 21 emoji to 42 jednostki UTF-16, ale 21 znakow dla bazy - miesci sie.
    const emoji = "\u{1F600}";
    expect(speakerCardDraftErrors(draft({ labelPl: emoji.repeat(21) }))).toEqual({});
    expect(speakerCardDraftErrors(draft({ labelEn: emoji.repeat(40) }))).toEqual({});
    expect(speakerCardDraftErrors(draft({ labelEn: emoji.repeat(41) }))).toEqual({
      labelEn: "labelTooLong",
    });
  });
});
