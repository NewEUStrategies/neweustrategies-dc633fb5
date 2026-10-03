// ZDJĘCIE W NAGŁÓWKU ARCHIWUM - reguła adresu i wartość CSS
// (`src/lib/archive/heroImage.ts`).
//
// Styl tła „Zdjęcie” był martwym ustawieniem: adresu nie przechowywało nic,
// więc każde archiwum z tym stylem schodziło po cichu na neutralne tło.
// Po podpięciu adres trafia do CSS na KAŻDEJ publicznej stronie archiwum, więc
// ten plik pilnuje trzech rzeczy:
//   1. reguła `isHeroImageUrl` jest LUSTREM CHECK-u
//      `archive_layout_settings_hero_image_url_shape`. pgTAP
//      (`supabase/tests/archive_layout_hero_image_test.sql`) sprawdza w bazie
//      każdą część tej reguły: obcy schemat, brak hosta, znak zakazany (spacja,
//      tabulator, nowa linia, DEL, odwrotny ukośnik), znaki spoza ASCII
//      i granicę długości. Tutaj są te same przypadki i kilka dodatkowych.
//      Rozjazd oznacza, że panel przepuści wartość, którą baza odrzuci bez
//      komunikatu (albo odwrotnie),
//   2. wartość CSS jest ZAWSZE cytowanym, escapowanym `url("…")` - surowe
//      `url(${adres})` rozrywał nawias albo cudzysłów w adresie,
//   3. „brak zdjęcia” ma jedną postać (`null`) i nie jedzie do bazy jako `""`.
import { describe, expect, it } from "vitest";
import {
  HERO_IMAGE_URL_MAX_LENGTH,
  heroImageBackground,
  heroImageUrlForSave,
  isHeroImageUrl,
  isInvalidHeroImageUrl,
  normalizeHeroImageUrl,
} from "@/lib/archive/heroImage";

/** Adres https o DOKŁADNIE zadanej długości w punktach kodowych. */
function urlOfLength(length: number): string {
  const prefix = "https://cdn.example/";
  return prefix + "a".repeat(length - prefix.length);
}

describe("isHeroImageUrl - przyjmuje", () => {
  it.each([
    ["adres https", "https://cdn.example/hero.jpg"],
    ["adres http", "http://cdn.example/hero.jpg"],
    ["schemat wielkimi literami (baza porównuje przez ~*)", "HTTPS://CDN.EXAMPLE/HERO.JPG"],
    ["ścieżkę w serwisie", "/media/archiwum/hero.jpg"],
    ["nawiasy w nazwie pliku", "/media/archiwum/hero(1).jpg"],
    ["cudzysłowy w adresie (escapuje je render)", `https://cdn.example/a"b'c.jpg`],
    ["znaki spoza ASCII", "/media/zdjęcie-łąka.jpg"],
    ["zapytanie i kotwicę", "https://cdn.example/hero.jpg?w=1600#x"],
  ])("%s", (_opis, value) => {
    expect(isHeroImageUrl(value)).toBe(true);
  });

  it("adres DOKŁADNIE na limicie długości (granica włącznie)", () => {
    expect(isHeroImageUrl(urlOfLength(HERO_IMAGE_URL_MAX_LENGTH))).toBe(true);
  });
});

describe("isHeroImageUrl - odrzuca", () => {
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: w mieszanej wielkości liter", "JavaScript:alert(1)"],
    ["data:", "data:image/png;base64,iVBORw0KGgo="],
    ["adres bez schematu (//host)", "//evil.example/x.jpg"],
    ["'/\\host' - przeglądarka czyta go jak //host", "/\\evil.example/x.jpg"],
    ["pusty host (https:///)", "https:///evil.example/x.jpg"],
    ["sam ukośnik", "/"],
    ["sam schemat", "https://"],
    ["ścieżkę względną bez ukośnika", "media/hero.jpg"],
    ["inny schemat (ftp:)", "ftp://cdn.example/hero.jpg"],
    ["mailto:", "mailto:redakcja@example.com"],
    ["wiodącą spację (przycina normalizacja, nie reguła)", " https://cdn.example/hero.jpg"],
    ["spację w środku", "https://cdn.example/moje zdjęcie.jpg"],
    ["nową linię - rozerwałaby wartość CSS", "https://cdn.example/x.jpg\n);color:red"],
    ["tabulator", "/media/a\tb.jpg"],
    ["znak DEL", "/media/a\u007fb.jpg"],
    ["odwrotny ukośnik w ścieżce", "/media/a\\b.jpg"],
  ])("%s", (_opis, value) => {
    expect(isHeroImageUrl(value)).toBe(false);
  });

  it("adres o jeden znak dłuższy niż limit", () => {
    expect(isHeroImageUrl(urlOfLength(HERO_IMAGE_URL_MAX_LENGTH + 1))).toBe(false);
  });

  it("długość liczy PUNKTY KODOWE, jak `char_length` w bazie", () => {
    // Emoji to dwie jednostki UTF-16, ale jeden znak dla Postgresa. Liczenie
    // `.length` odrzucałoby w panelu adres, który baza przyjmuje.
    const value = urlOfLength(HERO_IMAGE_URL_MAX_LENGTH - 1) + "😀";
    expect(value.length).toBe(HERO_IMAGE_URL_MAX_LENGTH + 1);
    expect(isHeroImageUrl(value)).toBe(true);
  });
});

describe("normalizeHeroImageUrl", () => {
  it("przycina białe znaki na brzegach", () => {
    expect(normalizeHeroImageUrl("  https://cdn.example/hero.jpg \n")).toBe(
      "https://cdn.example/hero.jpg",
    );
  });

  it.each([[""], ["   "], [null], [undefined], [42]])(
    "„brak zdjęcia” ma jedną postać: %j → null",
    (raw) => {
      expect(normalizeHeroImageUrl(raw)).toBeNull();
    },
  );

  it("NIE waliduje - to robi reguła adresu", () => {
    expect(normalizeHeroImageUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("heroImageUrlForSave i isInvalidHeroImageUrl - decyzje panelu", () => {
  it("poprawny adres jedzie do zapisu przycięty", () => {
    expect(heroImageUrlForSave("  /media/hero.jpg  ")).toBe("/media/hero.jpg");
    expect(isInvalidHeroImageUrl("  /media/hero.jpg  ")).toBe(false);
  });

  it("puste pole jedzie jako null i NIE jest błędem", () => {
    expect(heroImageUrlForSave("")).toBeNull();
    expect(isInvalidHeroImageUrl("")).toBe(false);
    expect(isInvalidHeroImageUrl(null)).toBe(false);
  });

  it("niepoprawny adres NIGDY nie jedzie do bazy i jest zgłaszany", () => {
    // CHECK odrzuciłby cały zapis ustawień archiwum, łącznie z polami
    // zmienionymi poprawnie.
    for (const bad of ["javascript:alert(1)", "//evil.example/x.jpg", "data:image/png;base64,AA"]) {
      expect(heroImageUrlForSave(bad)).toBeNull();
      expect(isInvalidHeroImageUrl(bad)).toBe(true);
    }
  });
});

describe("heroImageBackground - wartość CSS", () => {
  it('poprawny adres → cytowany url("…")', () => {
    expect(heroImageBackground("https://cdn.example/hero.jpg")).toBe(
      'url("https://cdn.example/hero.jpg")',
    );
  });

  it("ESCAPUJE cudzysłowy, apostrofy i nawiasy - wartość zostaje jednym tokenem", () => {
    // Surowe `url(${adres})` kończyło token na pierwszym `)`, a cudzysłów
    // pozwalał domknąć napis i dopisać własną deklarację.
    expect(heroImageBackground(`https://cdn.example/a"b'(1).jpg`)).toBe(
      String.raw`url("https://cdn.example/a\"b\'\(1\).jpg")`,
    );
  });

  it("adres próbujący domknąć url() zostaje napisem, a nie nową deklaracją", () => {
    // Reguła przepuszcza go (brak spacji, poprawny początek), więc całą
    // robotę robi escapowanie: każdy `"`, `(` i `)` dostaje odwrotny ukośnik.
    expect(heroImageBackground(`https://cdn.example/");background:red;x:("`)).toBe(
      String.raw`url("https://cdn.example/\"\);background:red;x:\(\"")`,
    );
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["adres bez schematu", "//evil.example/x.jpg"],
    ["nowa linia", "https://cdn.example/x.jpg\n);color:red"],
  ])("odrzuca %s → null (render schodzi na neutralne tło)", (_opis, value) => {
    expect(heroImageBackground(value)).toBeNull();
  });

  it("brak adresu → null", () => {
    expect(heroImageBackground(null)).toBeNull();
    expect(heroImageBackground(undefined)).toBeNull();
    expect(heroImageBackground("   ")).toBeNull();
  });

  it("plik z biblioteki mediów renderuje się ścieżką WZGLĘDNĄ /media/…", () => {
    // Pole panelu trzyma markowy adres absolutny; render, jak podgląd panelu,
    // sięga po plik w bieżącym środowisku i pod domeną bieżącego tenanta.
    expect(heroImageBackground("https://neweuropeanstrategies.com/media/archiwum/hero.jpg")).toBe(
      'url("/media/archiwum/hero.jpg")',
    );
  });
});
