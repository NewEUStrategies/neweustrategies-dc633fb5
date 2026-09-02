// Wpisy klubowe (A31) - model danych ŚCIANY: rozpoznanie rodzaju pliku,
// odczyt załączników z jsonb, pierwszy adres w treści i warunek zapisu.
//
// PO CO TEN PLIK ISTNIEJE. `postTypes.ts` jest warstwą CZYSTĄ, ale trzyma
// cztery decyzje, których nie widać z żadnego innego miejsca, a każda z nich
// psuje się cicho:
//
//   1. ROZPOZNANIE RODZAJU PLIKU. MIME jest pierwszym źródłem prawdy, ale
//      przeglądarka regularnie oddaje pusty typ albo `application/octet-stream`
//      dla plików Office z dysków sieciowych. Wtedy decyduje ROZSZERZENIE.
//      Bez tego zapasu użytkownik dostaje „nieobsługiwany format" dla zwykłego
//      .docx - i nie ma jak tego obejść, bo plik jest poprawny.
//
//   2. ODPORNOŚĆ ODCZYTU ZAŁĄCZNIKÓW. Wpis z JEDNYM uszkodzonym załącznikiem
//      ma się WYŚWIETLIĆ. Walidacja „wszystko albo nic" znaczyłaby, że jeden
//      zły rekord (np. po ręcznej korekcie w bazie) wywraca całą kartę wpisu.
//      Przedmiotem dowodu jest więc nie „czy parsuje", tylko CO ZOSTAJE po
//      napotkaniu śmiecia.
//
//   3. GÓRNY LIMIT LICZBY ZAŁĄCZNIKÓW jest egzekwowany PRZY ODCZYCIE, nie
//      tylko przy zapisie. Wiersz zapisany przed wprowadzeniem limitu (albo
//      ręcznie) nie ma prawa rozsypać układu karty.
//
//   4. PIERWSZY ADRES W TREŚCI. Kompozytor pobiera metadane podglądu WYŁĄCZNIE
//      dla niego, więc od tej funkcji zależy, ile zapytań sieciowych wychodzi
//      z jednego wklejenia.
//
// GRANICA DOWODU: to jest warstwa czysta - zero bazy, zero sieci, zero
// komponentów. Renderowanie karty wpisu ma własne testy w `src/components`.
import { describe, expect, it } from "vitest";
import type { Json } from "@/integrations/supabase/types";
import {
  CLUB_POST_ACCEPT_ATTR,
  CLUB_POST_ACCEPT_MIME,
  CLUB_POST_FILE_EXT,
  CLUB_POST_FILE_MIME,
  CLUB_POST_IMAGE_MIME,
  CLUB_POST_MAX_ATTACHMENTS,
  CLUB_POST_MAX_BODY,
  CLUB_POST_MAX_FILE_BYTES,
  CLUB_POST_MEDIA_BUCKET,
  CLUB_POST_VIDEO_MIME,
  canSubmitClubPost,
  clubPostMediaKind,
  extractFirstUrl,
  isLinkAttachment,
  isMediaAttachment,
  parseClubPostAttachments,
  type ClubPostAttachment,
} from "../postTypes";

// ---------------------------------------------------------------------------
// Rozpoznanie rodzaju załącznika
// ---------------------------------------------------------------------------

describe("clubPostMediaKind - MIME najpierw, rozszerzenie jako zapas", () => {
  it("rozpoznaje KAŻDY obraz z listy akceptacji", () => {
    for (const mime of CLUB_POST_IMAGE_MIME) {
      expect(clubPostMediaKind(mime), mime).toBe("image");
    }
  });

  it("rozpoznaje KAŻDE wideo z listy akceptacji", () => {
    for (const mime of CLUB_POST_VIDEO_MIME) {
      expect(clubPostMediaKind(mime), mime).toBe("video");
    }
  });

  it("rozpoznaje KAŻDY dokument z listy akceptacji", () => {
    for (const mime of CLUB_POST_FILE_MIME) {
      expect(clubPostMediaKind(mime), mime).toBe("file");
    }
  });

  // To jest sedno zapasu: system operacyjny oddaje pusty MIME dla .csv i .docx
  // z dysku sieciowego, a wtedy JEDYNĄ przesłanką jest nazwa.
  it("pusty MIME plus znane rozszerzenie to nadal dokument", () => {
    for (const ext of CLUB_POST_FILE_EXT) {
      expect(clubPostMediaKind("", `raport${ext}`), ext).toBe("file");
    }
  });

  it("`application/octet-stream` z rozpoznawalną nazwą przechodzi jako dokument", () => {
    expect(clubPostMediaKind("application/octet-stream", "analiza.docx")).toBe("file");
  });

  it("rozszerzenie porównuje się BEZ wielkości liter - .PDF z Windowsa to ten sam plik", () => {
    expect(clubPostMediaKind("", "RAPORT.PDF")).toBe("file");
    expect(clubPostMediaKind("", "Raport.DocX")).toBe("file");
  });

  it("liczy się OSTATNIA kropka, nie pierwsza", () => {
    // "sprawozdanie.2026.q1.xlsx" ma trzy kropki; rozszerzeniem jest ostatnia
    // część, inaczej plik z datą w nazwie przestaje być rozpoznawalny.
    expect(clubPostMediaKind("", "sprawozdanie.2026.q1.xlsx")).toBe("file");
  });

  it("nazwa BEZ kropki i bez MIME to brak rozpoznania, nie zgadywanie", () => {
    expect(clubPostMediaKind("", "zalacznik")).toBeNull();
  });

  it("nieznane rozszerzenie odrzuca - lista akceptacji jest zamknięta", () => {
    expect(clubPostMediaKind("", "skrypt.exe")).toBeNull();
    expect(clubPostMediaKind("application/x-msdownload", "skrypt.exe")).toBeNull();
  });

  it("brak nazwy jest wartością domyślną - wywołanie z samym MIME nie wybucha", () => {
    expect(clubPostMediaKind("image/png")).toBe("image");
    expect(clubPostMediaKind("application/x-nieznany")).toBeNull();
  });

  it("kropka na końcu nazwy nie jest rozszerzeniem", () => {
    expect(clubPostMediaKind("", "raport.")).toBeNull();
  });
});

describe("listy akceptacji - jedno źródło dla `<input accept>`", () => {
  it("`CLUB_POST_ACCEPT_MIME` to suma trzech rozłącznych list", () => {
    expect(CLUB_POST_ACCEPT_MIME).toEqual([
      ...CLUB_POST_IMAGE_MIME,
      ...CLUB_POST_VIDEO_MIME,
      ...CLUB_POST_FILE_MIME,
    ]);
    // Rozłączność: ten sam MIME na dwóch listach dałby rodzaj zależny od
    // KOLEJNOŚCI sprawdzania, czyli od szczegółu implementacji.
    expect(new Set(CLUB_POST_ACCEPT_MIME).size).toBe(CLUB_POST_ACCEPT_MIME.length);
  });

  it("atrybut `accept` niesie MIME ORAZ rozszerzenia", () => {
    const parts = CLUB_POST_ACCEPT_ATTR.split(",");
    expect(parts).toEqual([...CLUB_POST_ACCEPT_MIME, ...CLUB_POST_FILE_EXT]);
    // Bez rozszerzeń użytkownik z pustym MIME nie mógłby WYBRAĆ pliku
    // w oknie systemowym - odrzucenie następowałoby przed wysyłką.
    expect(parts).toContain(".docx");
    expect(parts).toContain("application/pdf");
  });

  it("limity są liczbami, na które patrzy zarówno kompozytor, jak i baza", () => {
    expect(CLUB_POST_MAX_BODY).toBe(6000);
    expect(CLUB_POST_MAX_ATTACHMENTS).toBe(10);
    expect(CLUB_POST_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    // Kubełek jest PRYWATNY - odczyt idzie przez adresy podpisane. Zmiana
    // nazwy tutaj to zmiana polityki dostępu do wszystkich plików ściany.
    expect(CLUB_POST_MEDIA_BUCKET).toBe("club-media");
  });
});

// ---------------------------------------------------------------------------
// Odczyt załączników z jsonb
// ---------------------------------------------------------------------------

describe("parseClubPostAttachments - wpis z jednym śmieciem ma się wyświetlić", () => {
  it("wartość niebędąca tablicą daje pustą listę, nie wyjątek", () => {
    const cases: Array<Json | null | undefined> = [null, undefined, {}, "[]", 7, true];
    for (const value of cases) {
      expect(parseClubPostAttachments(value), JSON.stringify(value) ?? "undefined").toEqual([]);
    }
  });

  it("pusta tablica daje pustą listę", () => {
    expect(parseClubPostAttachments([])).toEqual([]);
  });

  it("czyta komplet pól załącznika medialnego", () => {
    const parsed = parseClubPostAttachments([
      {
        type: "image",
        path: "club-1/foto.png",
        name: "foto.png",
        mime: "image/png",
        size: 2048,
        width: 800,
        height: 600,
      },
    ]);
    expect(parsed).toEqual([
      {
        type: "image",
        path: "club-1/foto.png",
        name: "foto.png",
        mime: "image/png",
        size: 2048,
        width: 800,
        height: 600,
      },
    ]);
  });

  it("brak nazwy: bierze OSTATNI człon ścieżki, a nie całą ścieżkę", () => {
    // Nazwa jest tym, co widzi użytkownik pod kartą. Cała ścieżka w kubełku
    // ujawniałaby układ magazynu w interfejsie.
    const [item] = parseClubPostAttachments([{ type: "file", path: "club-1/2026/raport.pdf" }]);
    expect(item).toMatchObject({ name: "raport.pdf" });
  });

  it("brak nazwy i ścieżka bez ukośnika: nazwą jest sama ścieżka", () => {
    const [item] = parseClubPostAttachments([{ type: "file", path: "raport.pdf" }]);
    expect(item).toMatchObject({ name: "raport.pdf" });
  });

  it("brak MIME i rozmiaru schodzi do wartości domyślnych, nie do `undefined`", () => {
    // `undefined` w polu `size` znaczy w interfejsie „NaN kB"; zero znaczy
    // „nie znamy rozmiaru" i tak się rysuje.
    const [item] = parseClubPostAttachments([{ type: "video", path: "club-1/nagranie" }]);
    expect(item).toMatchObject({ mime: "application/octet-stream", size: 0 });
  });

  it("brak wymiarów to `null`, czyli nieznane - a nie zero", () => {
    // Zero jako wymiar liczy proporcje jako 0/0 i rozjeżdża układ karty.
    const [item] = parseClubPostAttachments([{ type: "image", path: "club-1/foto.png" }]);
    expect(item).toMatchObject({ width: null, height: null });
  });

  it("wymiar niebędący skończoną liczbą jest odrzucany do `null`", () => {
    const [item] = parseClubPostAttachments([
      { type: "image", path: "club-1/foto.png", width: "800", height: Number.NaN },
    ]);
    expect(item).toMatchObject({ width: null, height: null });
  });

  it("puste i białoznakowe napisy są traktowane jak brak wartości", () => {
    const [item] = parseClubPostAttachments([
      { type: "file", path: "club-1/raport.pdf", name: "   ", mime: "" },
    ]);
    expect(item).toMatchObject({ name: "raport.pdf", mime: "application/octet-stream" });
  });

  it("napisy są PRZYCINANE - spacja z kopiuj-wklej nie wchodzi do nazwy pliku", () => {
    const [item] = parseClubPostAttachments([
      { type: "file", path: "club-1/raport.pdf", name: "  Raport roczny.pdf  " },
    ]);
    expect(item).toMatchObject({ name: "Raport roczny.pdf" });
  });

  it("czyta komplet pól podglądu linku", () => {
    const parsed = parseClubPostAttachments([
      {
        type: "link",
        url: "https://example.org/rozporzadzenie",
        title: "Rozporządzenie",
        description: "Streszczenie",
        image: "https://example.org/okladka.png",
        siteName: "example.org",
      },
    ]);
    expect(parsed).toEqual([
      {
        type: "link",
        url: "https://example.org/rozporzadzenie",
        title: "Rozporządzenie",
        description: "Streszczenie",
        image: "https://example.org/okladka.png",
        siteName: "example.org",
      },
    ]);
  });

  it("link bez metadanych zostaje - sam adres wystarczy do narysowania karty", () => {
    const parsed = parseClubPostAttachments([{ type: "link", url: "https://example.org/akt" }]);
    expect(parsed).toEqual([
      {
        type: "link",
        url: "https://example.org/akt",
        title: null,
        description: null,
        image: null,
        siteName: null,
      },
    ]);
  });

  it("link BEZ adresu jest pomijany - karta bez celu nie ma czego otworzyć", () => {
    expect(parseClubPostAttachments([{ type: "link", title: "Bez adresu" }])).toEqual([]);
  });

  it("załącznik medialny BEZ ścieżki jest pomijany", () => {
    expect(parseClubPostAttachments([{ type: "image", name: "foto.png" }])).toEqual([]);
  });

  it("nieznany rodzaj jest pomijany, a nie przepuszczany dalej", () => {
    expect(
      parseClubPostAttachments([{ type: "audio", path: "club-1/podcast.mp3" }, { path: "x" }]),
    ).toEqual([]);
  });

  it("element niebędący obiektem (null, napis, tablica) jest pomijany", () => {
    const parsed = parseClubPostAttachments([
      null,
      "https://example.org",
      ["type", "image"],
      42,
      { type: "file", path: "club-1/raport.pdf" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: "file", path: "club-1/raport.pdf" });
  });

  // SEDNO ODPORNOŚCI: jeden zły rekord nie może zabrać dobrych.
  it("dobre załączniki PRZEŻYWAJĄ sąsiedztwo uszkodzonego", () => {
    const parsed = parseClubPostAttachments([
      { type: "image", path: "club-1/a.png" },
      { type: "link" },
      { type: "file" },
      { type: "link", url: "https://example.org/b" },
    ]);
    expect(parsed.map((item) => item.type)).toEqual(["image", "link"]);
  });

  // Limit egzekwowany PRZY ODCZYCIE - patrz nagłówek pliku, punkt 3.
  it("przycina listę do górnego limitu, nawet gdy w bazie leży więcej", () => {
    const many: Json = Array.from({ length: CLUB_POST_MAX_ATTACHMENTS + 5 }, (_, index) => ({
      type: "file",
      path: `club-1/plik-${index}.pdf`,
    }));
    const parsed = parseClubPostAttachments(many);
    expect(parsed).toHaveLength(CLUB_POST_MAX_ATTACHMENTS);
    // Przycięcie od KOŃCA: pierwsze załączniki to te, które autor dodał najpierw.
    expect(parsed[0]).toMatchObject({ path: "club-1/plik-0.pdf" });
  });
});

describe("strażniki rodzaju załącznika", () => {
  const link: ClubPostAttachment = {
    type: "link",
    url: "https://example.org/akt",
    title: null,
    description: null,
    image: null,
    siteName: null,
  };
  const media: ClubPostAttachment = {
    type: "file",
    path: "club-1/raport.pdf",
    name: "raport.pdf",
    mime: "application/pdf",
    size: 10,
    width: null,
    height: null,
  };

  it("są wobec siebie ROZŁĄCZNE - każdy załącznik jest dokładnie jednym z dwóch", () => {
    expect(isLinkAttachment(link)).toBe(true);
    expect(isMediaAttachment(link)).toBe(false);
    expect(isLinkAttachment(media)).toBe(false);
    expect(isMediaAttachment(media)).toBe(true);
  });

  it("zawężają typ, więc pola swoiste są dostępne bez rzutowania", () => {
    // Warunek na TYPACH: gdyby strażnik przestał zawężać, poniższe przestanie
    // się kompilować - i to jest jego jedyne zadanie w kodzie widoku.
    const items: ClubPostAttachment[] = [link, media];
    const urls = items.filter(isLinkAttachment).map((item) => item.url);
    const paths = items.filter(isMediaAttachment).map((item) => item.path);
    expect(urls).toEqual(["https://example.org/akt"]);
    expect(paths).toEqual(["club-1/raport.pdf"]);
  });
});

// ---------------------------------------------------------------------------
// Pierwszy adres w treści
// ---------------------------------------------------------------------------

describe("extractFirstUrl - jeden podgląd, jedno zapytanie sieciowe", () => {
  it("znajduje adres w środku zdania", () => {
    expect(extractFirstUrl("Warto przeczytać https://example.org/akt przed posiedzeniem")).toBe(
      "https://example.org/akt",
    );
  });

  it("bierze PIERWSZY adres, nie ostatni i nie wszystkie", () => {
    // To jest cała oszczędność tej funkcji: pięć wklejonych odnośników
    // nie może znaczyć pięciu zapytań o metadane.
    expect(
      extractFirstUrl(
        "https://example.org/jeden i https://example.com/dwa oraz http://example.net",
      ),
    ).toBe("https://example.org/jeden");
  });

  it("przyjmuje `http` i `https`, a wielkość liter schematu nie ma znaczenia", () => {
    expect(extractFirstUrl("http://example.org/a")).toBe("http://example.org/a");
    expect(extractFirstUrl("HTTPS://EXAMPLE.ORG/a")).toBe("HTTPS://EXAMPLE.ORG/a");
  });

  it("kropka i przecinek kończące zdanie NIE są częścią adresu", () => {
    // Bez tego przycięcia podgląd pobierałby adres z kropką i dostawał 404
    // przy każdym linku wklejonym na końcu zdania.
    expect(extractFirstUrl("Szczegóły: https://example.org/akt.")).toBe("https://example.org/akt");
    expect(extractFirstUrl("Patrz https://example.org/akt, punkt 4")).toBe(
      "https://example.org/akt",
    );
    expect(extractFirstUrl("Patrz https://example.org/akt;")).toBe("https://example.org/akt");
    expect(extractFirstUrl("Patrz https://example.org/akt:")).toBe("https://example.org/akt");
  });

  it("kropka WEWNĄTRZ adresu zostaje - przycinany jest tylko ogon", () => {
    expect(extractFirstUrl("https://example.org/raport.pdf")).toBe(
      "https://example.org/raport.pdf",
    );
  });

  it("adres w nawiasie kończy się na nawiasie, nie połyka go", () => {
    expect(extractFirstUrl("(patrz https://example.org/akt)")).toBe("https://example.org/akt");
  });

  it("treść bez adresu daje `null`, nie pusty napis", () => {
    // `null` znaczy „nie ma czego pobrać"; pusty napis poszedłby do pobrania
    // metadanych jako adres względny.
    for (const text of ["", "Bez odnośnika", "example.org bez schematu", "ftp://example.org/a"]) {
      expect(extractFirstUrl(text), text).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Warunek zapisu
// ---------------------------------------------------------------------------

describe("canSubmitClubPost - ten sam warunek, co CHECK w bazie", () => {
  it("sama treść wystarcza", () => {
    expect(canSubmitClubPost("Notatka z posiedzenia", [])).toBe(true);
  });

  it("sam załącznik wystarcza - wpis bywa samym zdjęciem", () => {
    expect(canSubmitClubPost("", [{ type: "image" }])).toBe(true);
  });

  it("treść ORAZ załącznik oczywiście wystarczają", () => {
    expect(canSubmitClubPost("Zdjęcie z sali", [{ type: "image" }])).toBe(true);
  });

  it("pusty wpis nie przechodzi", () => {
    expect(canSubmitClubPost("", [])).toBe(false);
  });

  it("same białe znaki to nadal pusty wpis - inaczej baza odrzuci go po wysyłce", () => {
    // Gdyby klient przepuścił spacje, użytkownik zobaczyłby surowy błąd CHECK
    // zamiast wyłączonego przycisku.
    expect(canSubmitClubPost("   \n\t  ", [])).toBe(false);
  });
});
