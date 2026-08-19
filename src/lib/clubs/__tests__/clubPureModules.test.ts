// Czyste moduły klubów, które stały na zerze albo blisko: parser treści
// inline, katalog ikon tematu, specjalizacje i nagłówki SEO tras.
//
// DLACZEGO RAZEM. Wszystkie cztery mają tę samą cechę: są PURE, nie mają
// I/O, a ich złamanie widzi WYŁĄCZNIE użytkownik. Parser gubiący znak, ikona
// spoza kuratorowanego zestawu (dociągnięcie 1600-elementowego rejestru do
// chunku publicznej trasy), specjalizacja bez tytułu w drugim języku,
// `noindex` na klubie publicznym albo `index` na klubie zamkniętym - żadnego
// z tych błędów nie złapie tsc ani przegląd.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => requestUrl.value }));

const requestUrl = { value: "" };

import {
  MAX_TAG_LEN,
  extractHashtags,
  firstUrl,
  normalizeTag,
  splitInline,
} from "@/lib/clubs/inlineSegments";
import {
  CLUB_THREAD_ICONS,
  CLUB_THREAD_ICON_GROUPS,
  normalizeClubThreadIcon,
} from "@/lib/clubs/threadIcons";
import {
  CLUB_SPECIALIZATION_ICON_NAMES,
  buildSpecializationViews,
  fallbackSpecializationSources,
  resolveSpecializationIcon,
} from "@/lib/clubs/specializations";
import { buildClubHead, isClubIndexable, toClubHeadSource } from "@/lib/clubs/clubHead";
import { buildClubApplyHead } from "@/lib/clubs/applyHead";

// ---------------------------------------------------------------------------
// Parser treści inline
// ---------------------------------------------------------------------------

describe("splitInline - inwariant odtwarzalności", () => {
  /** Konkatenacja segmentów MUSI odtworzyć wejście 1:1. */
  function rebuilt(body: string): string {
    return splitInline(body)
      .map((s) => (s.kind === "text" ? s.text : s.raw))
      .join("");
  }

  const CASES = [
    "",
    "zwykły tekst bez niczego",
    "adres https://example.org/a?b=1 w zdaniu",
    "wzmianka @anna-nowak i tag #energia",
    "@na-poczatku i #tez",
    "mail nie jest wzmianką: kontakt@example.org",
    "adres z kropką na końcu https://example.org/a.",
    "adres w nawiasie (https://example.org/a) dalej",
    "adres z nawiasem w środku https://pl.wikipedia.org/wiki/Test_(ujednoznacznienie)",
    "#tag-z-myślnikiem i #TagWielką",
    "dwa linki https://a.example i https://b.example",
    "slash/nie/robi/tagu #ale-ten-tak",
  ];

  it.each(CASES)("odtwarza wejście znak w znak: %s", (body) => {
    // To jest najmocniejsza gwarancja tego parsera: skoro segmenty składają
    // się z powrotem w oryginał, to nic nie zginęło ani się nie zdublowało.
    expect(rebuilt(body)).toBe(body);
  });

  it("pusta i nieistniejąca treść dają pustą listę", () => {
    expect(splitInline("")).toEqual([]);
    expect(splitInline(null)).toEqual([]);
    expect(splitInline(undefined)).toEqual([]);
  });

  it("rozpoznaje URL, wzmiankę i tag jako OSOBNE rodzaje węzłów", () => {
    const segs = splitInline("zob. https://example.org od @anna-nowak w #energia");
    const kinds = segs.map((s) => s.kind);

    expect(kinds).toContain("url");
    expect(kinds).toContain("mention");
    expect(kinds).toContain("hashtag");
  });

  it("interpunkcja przylegająca do adresu NIE wchodzi do linku", () => {
    const [, url] = splitInline("czytaj https://example.org/raport, dalej");

    expect(url).toMatchObject({ kind: "url", href: "https://example.org/raport" });
  });

  it("adres w nawiasie kończy się przed domknięciem", () => {
    const wrapped = splitInline("(https://example.org/a)").find((s) => s.kind === "url");

    expect(wrapped).toMatchObject({ href: "https://example.org/a" });
  });

  it("ZNANE OGRANICZENIE: adres z nawiasem w środku urywa się na domknięciu", () => {
    const hit = splitInline("https://pl.wikipedia.org/wiki/Test_(ujednoznacznienie)").find(
      (s) => s.kind === "url",
    );

    // Klasa znaków adresu WYKLUCZA `)`, więc domknięcie nigdy nie wchodzi do
    // dopasowania - a `trimUrl` ma gałąź „zdejmij `)` tylko bez otwarcia",
    // która przez to nie ma jak się wykonać. Skutek jest widoczny dla
    // czytelnika: link do hasła z dopiskiem ujednoznaczniającym prowadzi pod
    // urwany adres. Test PRZYPINA stan faktyczny, żeby ewentualna naprawa
    // była świadomą zmianą, a nie przypadkiem.
    expect(hit).toMatchObject({ href: "https://pl.wikipedia.org/wiki/Test_(ujednoznacznienie" });
  });

  it("adres e-mail NIE jest wzmianką - inaczej linkowalibyśmy do nieistniejącego profilu", () => {
    const segs = splitInline("napisz na kontakt@example.org");

    expect(segs.some((s) => s.kind === "mention")).toBe(false);
  });

  it("wzmianka schodzi na małe litery (slug profilu jest lowercase)", () => {
    const mention = splitInline("@Anna-Nowak").find((s) => s.kind === "mention");

    expect(mention).toMatchObject({ slug: "anna-nowak", raw: "@Anna-Nowak" });
  });

  it("tag jest normalizowany, ale `raw` zachowuje oryginał", () => {
    const tag = splitInline("#EnergiaJądrowa").find((s) => s.kind === "hashtag");

    expect(tag).toMatchObject({ tag: "energiajądrowa", raw: "#EnergiaJądrowa" });
  });
});

describe("normalizeTag", () => {
  it("zdejmuje krzyżyk, schodzi na małe litery po polsku i tnie do limitu", () => {
    expect(normalizeTag("#Energia")).toBe("energia");
    expect(normalizeTag("ŁĄKA")).toBe("łąka");
    expect(normalizeTag("a".repeat(80))).toHaveLength(MAX_TAG_LEN);
  });
});

describe("extractHashtags / firstUrl", () => {
  it("tagi są UNIKALNE i w kolejności wystąpienia", () => {
    expect(extractHashtags("#beta tekst #alfa i znowu #beta oraz #ALFA")).toEqual(["beta", "alfa"]);
  });

  it("tag JEDNOZNAKOWY nie jest tagiem - wzorzec wymaga co najmniej dwóch znaków", () => {
    // `[\p{L}\p{N}][\p{L}\p{N}_-]{1,49}` - pierwszy znak plus MINIMUM jeden
    // kolejny. „#a" zostaje zwykłym tekstem, więc filtr strumienia nie dostaje
    // tagów, których nikt nie da się wyszukać.
    expect(extractHashtags("#a #b")).toEqual([]);
    expect(splitInline("#a").every((seg) => seg.kind === "text")).toBe(true);
  });

  it("brak tagów daje pustą listę", () => {
    expect(extractHashtags("bez tagów")).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
  });

  it("firstUrl bierze PIERWSZY adres, nie ostatni", () => {
    expect(firstUrl("a https://one.example b https://two.example")).toBe("https://one.example");
  });

  it("firstUrl bez adresu daje null", () => {
    expect(firstUrl("bez adresu")).toBeNull();
    expect(firstUrl(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Katalog ikon tematu
// ---------------------------------------------------------------------------

describe("katalog ikon tematu", () => {
  it("płaska lista jest sumą grup i nie ma duplikatów", () => {
    const fromGroups = CLUB_THREAD_ICON_GROUPS.flatMap((g) => g.icons);

    expect(CLUB_THREAD_ICONS).toEqual(fromGroups);
    // Duplikat oznacza tę samą ikonę w dwóch grupach pickera - autor widzi
    // ją dwa razy i nie wie, czym się różnią.
    expect(new Set(CLUB_THREAD_ICONS).size).toBe(CLUB_THREAD_ICONS.length);
  });

  it("KAŻDA nazwa jest w kebab-case - taki kształt sprawdza CHECK w bazie", () => {
    for (const name of CLUB_THREAD_ICONS) {
      expect(name, `${name} nie jest kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("każda grupa ma klucz i18n i niepustą listę ikon", () => {
    for (const group of CLUB_THREAD_ICON_GROUPS) {
      expect(group.labelKey).toMatch(/^club\.iconPicker\.group\./);
      expect(group.icons.length).toBeGreaterThan(0);
    }
  });

  it("normalizacja przepuszcza nazwę z katalogu, także z białymi znakami i wielką literą", () => {
    expect(normalizeClubThreadIcon("landmark")).toBe("landmark");
    expect(normalizeClubThreadIcon("  LANDMARK  ")).toBe("landmark");
  });

  it("nazwa SPOZA katalogu degraduje do null, a nie do wyjątku", () => {
    // Ikona jest ozdobą tematu: uszkodzony draft w localStorage nie ma prawa
    // zablokować publikacji.
    expect(normalizeClubThreadIcon("bluetooth")).toBeNull();
    expect(normalizeClubThreadIcon("")).toBeNull();
    expect(normalizeClubThreadIcon("   ")).toBeNull();
    expect(normalizeClubThreadIcon(null)).toBeNull();
    expect(normalizeClubThreadIcon(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Specjalizacje
// ---------------------------------------------------------------------------

describe("resolveSpecializationIcon", () => {
  it("znana nazwa daje swoją ikonę, nieznana - globus (a nie pustkę)", () => {
    const known = resolveSpecializationIcon(CLUB_SPECIALIZATION_ICON_NAMES[0]);
    const unknown = resolveSpecializationIcon("NieMaTakiej");

    expect(known).toBeDefined();
    expect(unknown).toBeDefined();
  });

  it("null i undefined też schodzą na ikonę domyślną", () => {
    expect(resolveSpecializationIcon(null)).toBeDefined();
    expect(resolveSpecializationIcon(undefined)).toBeDefined();
  });
});

describe("buildSpecializationViews - kolejność źródeł tekstu", () => {
  const t = (key: string): string =>
    key === "club.spec.items.energy.title" ? "Energia (i18n)" : key;

  function row(over: Record<string, unknown> = {}) {
    return {
      slug: "wlasna-specjalizacja",
      key: "wlasna",
      label_pl: "",
      label_en: "",
      lead_pl: null,
      lead_en: null,
      desc_pl: null,
      desc_en: null,
      icon: "Globe2",
      sort_order: 10,
      club_count: 0,
      ...over,
    };
  }

  it("wartość z bazy w JĘZYKU INTERFEJSU wygrywa ze wszystkim", () => {
    const [view] = buildSpecializationViews([row({ label_pl: "Z panelu" })], "pl", t);

    expect(view?.title).toBe("Z panelu");
  });

  it("REGRESJA: specjalizacja WŁASNA opisana tylko po polsku ma tytuł także po angielsku", () => {
    // Bez trzeciego źródła angielski czytelnik dostawał kafel z numerem
    // i ikoną, ale bez tytułu i bez opisu - `tr()` nie zna klucza własnej
    // specjalizacji, więc zwracał "".
    const [view] = buildSpecializationViews(
      [row({ label_pl: "Polityka miejska", lead_pl: "Wstęp", desc_pl: "Opis" })],
      "en",
      t,
    );

    expect(view?.title).toBe("Polityka miejska");
    expect(view?.lead).toBe("Wstęp");
    expect(view?.desc).toBe("Opis");
  });

  it("numer porządkowy jest dwucyfrowy i liczony od jedynki", () => {
    const views = buildSpecializationViews([row(), row({ slug: "b" })], "pl", t);

    expect(views.map((v) => v.index)).toEqual(["01", "02"]);
  });

  it("licznik klubów przychodzący jako tekst jest liczbą", () => {
    const [view] = buildSpecializationViews([row({ club_count: "7" })], "pl", t);

    expect(view?.clubCount).toBe(7);
  });

  it("brak licznika to zero, nie NaN", () => {
    const [view] = buildSpecializationViews([row({ club_count: undefined })], "pl", t);

    expect(view?.clubCount).toBe(0);
  });

  it("pusta lista wejściowa daje pustą listę widoków", () => {
    expect(buildSpecializationViews([], "pl", t)).toEqual([]);
  });

  it("warstwa awaryjna daje komplet systemowych specjalizacji bez tekstów z bazy", () => {
    const rows = fallbackSpecializationSources();

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.label_pl).toBe("");
      expect(r.club_count).toBe(0);
    }
    // Porządek jest rosnący i unikalny - inaczej kafle skakałyby przy renderze.
    const orders = rows.map((r) => r.sort_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("warstwa awaryjna przechodzi przez budowniczego z tytułami z i18n", () => {
    const translate = (key: string): string => `T:${key}`;
    const views = buildSpecializationViews(fallbackSpecializationSources(), "pl", translate);

    expect(views.every((v) => v.title.startsWith("T:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nagłówki SEO tras klubowych
// ---------------------------------------------------------------------------

describe("toClubHeadSource / isClubIndexable", () => {
  const ROW = {
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia",
    tagline_en: "Energy",
    cover_image_url: null,
    visibility: "public",
  };

  it("null wchodzi i wychodzi jako null (404 i awaria backendu to ten sam nagłówek)", () => {
    expect(toClubHeadSource(null)).toBeNull();
  });

  it("wiersz sprowadza się do CZTERECH pól plus widoczność", () => {
    expect(toClubHeadSource(ROW)).toEqual({
      namePl: "Klub energetyczny",
      nameEn: "Energy club",
      taglinePl: "Energia",
      taglineEn: "Energy",
      coverImageUrl: null,
      visibility: "public",
    });
  });

  it("indeksowalny jest WYŁĄCZNIE klub public", () => {
    for (const visibility of ["members", "private", "secret", "draft", ""]) {
      expect(isClubIndexable(toClubHeadSource({ ...ROW, visibility }))).toBe(false);
    }
    expect(isClubIndexable(toClubHeadSource(ROW))).toBe(true);
  });

  it("BRAK DANYCH znaczy 'nie indeksuj' - błąd w tę stronę kosztuje ruch, w drugą wyciek", () => {
    expect(isClubIndexable(null)).toBe(false);
  });
});

describe("buildClubHead", () => {
  const PUBLIC_CLUB = toClubHeadSource({
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia i klimat",
    tagline_en: "Energy and climate",
    cover_image_url: "https://cdn.example/cover.jpg",
    visibility: "public",
  });

  interface MetaEntry {
    title?: string;
    name?: string;
    content?: string;
  }

  function robotsOf(head: { meta?: ReadonlyArray<MetaEntry> }): string {
    return head.meta?.find((m) => m.name === "robots")?.content ?? "";
  }

  /** `buildContentHead` oddaje tytuł jako wpis `meta`, nie pole `title`. */
  function titleOf(head: { meta?: ReadonlyArray<MetaEntry> }): string {
    return head.meta?.find((m) => m.title !== undefined)?.title ?? "";
  }

  function descriptionOf(head: { meta?: ReadonlyArray<MetaEntry> }): string {
    return head.meta?.find((m) => m.name === "description")?.content ?? "";
  }

  it("klub publiczny dostaje index ORAZ follow", () => {
    requestUrl.value = "https://nes.test/club/klub-energetyczny";

    const head = buildClubHead({ fallbackPath: "/club/x", club: PUBLIC_CLUB });

    // `follow` jest tu równie ważny co `index`: link do wątku ma nieść sygnał
    // dalej, a nie kończyć ścieżkę.
    expect(robotsOf(head)).toBe("index, follow");
  });

  it("klub zamknięty dostaje noindex, nofollow", () => {
    requestUrl.value = "https://nes.test/club/zamkniety";
    const club = toClubHeadSource({
      name_pl: "Zamknięty",
      name_en: "Closed",
      tagline_pl: null,
      tagline_en: null,
      cover_image_url: null,
      visibility: "members",
    });

    expect(robotsOf(buildClubHead({ fallbackPath: "/club/x", club }))).toBe("noindex, nofollow");
  });

  it("forceNoindex bije nawet klub publiczny (powierzchnie czynnościowe)", () => {
    requestUrl.value = "https://nes.test/club/klub-energetyczny/new";

    const head = buildClubHead({
      fallbackPath: "/club/x/new",
      club: PUBLIC_CLUB,
      forceNoindex: true,
    });

    expect(robotsOf(head)).toBe("noindex, nofollow");
  });

  it("tytuł podrzędny poprzedza nazwę klubu", () => {
    requestUrl.value = "https://nes.test/club/klub-energetyczny/t/temat";

    const head = buildClubHead({
      fallbackPath: "/club/x",
      club: PUBLIC_CLUB,
      subtitle: "Rynek mocy",
    });

    expect(titleOf(head)).toBe("Rynek mocy - Klub energetyczny");
  });

  it("pusty tytuł podrzędny nie zostawia myślnika", () => {
    requestUrl.value = "https://nes.test/club/klub-energetyczny";

    const head = buildClubHead({ fallbackPath: "/club/x", club: PUBLIC_CLUB, subtitle: "   " });

    expect(titleOf(head)).toBe("Klub energetyczny");
  });

  it("brak klubu daje tytuł awaryjny w języku adresu", () => {
    requestUrl.value = "https://nes.test/club/x";
    expect(titleOf(buildClubHead({ fallbackPath: "/club/x", club: null }))).toBe("Klub dyskusyjny");

    requestUrl.value = "https://nes.test/en/club/x";
    expect(titleOf(buildClubHead({ fallbackPath: "/en/club/x", club: null }))).toBe(
      "Discussion club",
    );
  });

  it("REGRESJA: nazwa z SAMYCH SPACJI schodzi na drugi język, nie na pusty tytuł", () => {
    requestUrl.value = "https://nes.test/club/x";
    const club = toClubHeadSource({
      name_pl: "   ",
      name_en: "Energy club",
      tagline_pl: null,
      tagline_en: null,
      cover_image_url: null,
      visibility: "public",
    });

    // Dawna wersja uznawała ciąg spacji za wartość obecną, więc tytuł strony
    // był pusty, a stąd fallback „Klub dyskusyjny" zamiast nazwy w drugim
    // języku.
    expect(titleOf(buildClubHead({ fallbackPath: "/club/x", club }))).toBe("Energy club");
  });

  it("opis bierze tagline klubu, a bez niego zdanie awaryjne", () => {
    requestUrl.value = "https://nes.test/club/x";

    const withTagline = buildClubHead({ fallbackPath: "/club/x", club: PUBLIC_CLUB });
    expect(descriptionOf(withTagline)).toBe("Energia i klimat");

    const noTagline = toClubHeadSource({
      name_pl: "Klub",
      name_en: "Club",
      tagline_pl: null,
      tagline_en: null,
      cover_image_url: null,
      visibility: "public",
    });
    expect(descriptionOf(buildClubHead({ fallbackPath: "/club/x", club: noTagline }))).toContain(
      "New European Strategies",
    );
  });

  it("opis podrzędny bije tagline", () => {
    requestUrl.value = "https://nes.test/club/x";

    const head = buildClubHead({
      fallbackPath: "/club/x",
      club: PUBLIC_CLUB,
      description: "Fragment wątku",
    });

    expect(descriptionOf(head)).toBe("Fragment wątku");
  });

  it("bez adresu żądania używa ścieżki awaryjnej", () => {
    requestUrl.value = "";

    const head = buildClubHead({ fallbackPath: "/club/awaryjny", club: PUBLIC_CLUB });

    expect(JSON.stringify(head)).toContain("/club/awaryjny");
  });
});

describe("buildClubApplyHead", () => {
  it("strona zgłoszenia JEST indeksowalna - to lejek pozyskania", () => {
    requestUrl.value = "https://nes.test/club/apply";

    const head = buildClubApplyHead();

    const meta = head.meta ?? [];
    expect(meta.find((m) => m.name === "robots")?.content).toBe("index, follow");
    expect(meta.find((m) => m.title !== undefined)?.title).toContain("New European Strategies");
  });

  it("wariant angielski bierze tytuł z mapy EN", () => {
    requestUrl.value = "https://nes.test/en/club/apply";

    const meta = buildClubApplyHead().meta ?? [];
    expect(meta.find((m) => m.title !== undefined)?.title).toContain("Apply to a discussion club");
  });

  it("bez adresu żądania spada na /club/apply", () => {
    requestUrl.value = "";

    expect(JSON.stringify(buildClubApplyHead())).toContain("/club/apply");
  });
});
