// Edytor klubu w panelu - REGUŁY wyprowadzone z ciała trasy.
//
// CO TO DOWODZI. Cztery rzeczy, które przed wyprowadzeniem dały się sprawdzić
// wyłącznie przez zamontowanie edytora z dziewięcioma zakładkami i trzema
// atrapami zapytań:
//
//   1. DEGRADACJA WARTOŚCI Z RPC JEST WĘŻSZA, NIE NEUTRALNA. Generator Supabase
//      typuje kolumny CHECK-owe jako goły `string`, więc wersja robocza musi je
//      zawęzić słownikiem. Fallback nie jest kosmetyką: nieznana `visibility`
//      schodzi na `members` (nie `public`), `who_can_post` na `moderators`
//      (nie `members`), `moderation_mode` na `trusted`. Fallback, który
//      POSZERZA dostęp, otwierałby klub przy pierwszej nieznanej wartości
//      w bazie - i to jest błąd, którego nie widać w recenzji kodu, bo
//      `Record` przyjmie każdą wartość domyślną.
//   2. „PUSTE" ZNACZY „WYCZYŚĆ", NIE „NIE RUSZAJ". Pole wyczyszczone przez
//      administratora jedzie jako `null`; `""` zostawiałby puste zdanie
//      w treści, a brak klucza znaczyłby „nie ruszaj" i zmiana cicho by się
//      nie zapisała.
//   3. NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ - klub bez `name_en` pokazywałby
//      pusty tytuł na `/en/`.
//   4. WERSJA ROBOCZA JEST BRUDNA TYLKO PRZY REALNEJ ZMIANIE, a porównanie idzie
//      przez PRZEPISANIE wiersza na wersję roboczą. Porównanie z wierszem wprost
//      uznawałoby `tagline_pl = null` w bazie i `""` w formularzu za zmianę,
//      czyli przycisk „Zapisz" byłby aktywny zawsze - a przycisk, który nic nie
//      zapisuje, uczy ignorowania przycisku.
//
// Plus kontrakt adresu (`?tab=`), normalizacja sluga w locie i przeliczenie
// strony na okno RPC - każde z granicą trafianą DOKŁADNIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza, czy RPC przyjmie payload (to
// `admin_club_upsert` i pgTAP `discussion_clubs_a*`), ani czy administrator ma
// prawo zapisu (`isAdmin` w trasie + SECURITY DEFINER). Nie powtarza słownika
// kodów odmowy (`toClubSaveError` ma test w `clubTypes.test.ts`). Nie testuje
// renderu zakładek - to trasa i jej własny plik.
import { describe, expect, it } from "vitest";
import {
  CLUB_EDITOR_TABS,
  adminClubListFilters,
  clubEditorBlock,
  clubEditorPayload,
  clubEditorTab,
  hasAdminClubFilters,
  isClubEditorDirty,
  isClubSlugChanged,
  normalizeClubSlugInput,
  toClubAccessDraft,
  toClubGeneralDraft,
  type ClubAccessDraftValues,
  type ClubGeneralDraftValues,
} from "@/lib/clubs/adminClubEditor";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  type AdminClubDetailRow,
} from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";

/**
 * Wiersz `admin_club_get`. Świadomie lokalny, a nie w `fixtures.ts`: tylko ten
 * plik i test trasy edytora go potrzebują, a fixture współdzielony rósłby
 * o kształt używany w dwóch miejscach.
 */
function detailRow(overrides: Partial<AdminClubDetailRow> = {}): AdminClubDetailRow {
  return {
    id: CLUB_IDS.club,
    slug: "klub-energetyczny",
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia i klimat",
    tagline_en: "Energy and climate",
    description_pl: "Opis",
    description_en: "Description",
    rules_pl: "Zasady",
    rules_en: "Rules",
    accent_color: "#0f766e",
    icon: "zap",
    cover_image_url: "https://cdn.example.org/klub.jpg",
    layout: "cards",
    status: "active",
    visibility: "public",
    join_policy: "open",
    moderation_mode: "post",
    attribution_mode: "named",
    who_can_post: "members",
    min_tier_rank: 20,
    policy_area: "energy",
    member_count: 42,
    group_count: 3,
    thread_count: 12,
    pending_count: 0,
    created_at: CLUB_BASE_ISO,
    updated_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    ...overrides,
  };
}

function generalOf(overrides: Partial<ClubGeneralDraftValues> = {}): ClubGeneralDraftValues {
  return { ...toClubGeneralDraft(detailRow()), ...overrides };
}

function accessOf(overrides: Partial<ClubAccessDraftValues> = {}): ClubAccessDraftValues {
  return { ...toClubAccessDraft(detailRow()), ...overrides };
}

// --- ?tab= -----------------------------------------------------------------

describe("clubEditorTab - kontrakt adresu zakładki", () => {
  it.each(CLUB_EDITOR_TABS)("zakładka %s przechodzi bez zmiany", (tab) => {
    expect(clubEditorTab(tab)).toBe(tab);
  });

  it("słownik zakładek jest niepusty i zaczyna się od „Ogólnych”", () => {
    // Kanarek: gdyby lista się wyzerowała, tabela wyżej zrobiłaby się pusta
    // i milczała, a domyślna zakładka przestałaby istnieć.
    expect(CLUB_EDITOR_TABS.length).toBeGreaterThan(1);
    expect(CLUB_EDITOR_TABS[0]).toBe("general");
  });

  it.each([
    ["brak parametru", undefined],
    ["null", null],
    ["liczba", 3],
    ["tablica", ["general"]],
    ["obiekt", { tab: "general" }],
    ["wartość logiczna", true],
    ["pusty napis", ""],
    ["zakładka usunięta z produktu", "webhooks"],
    ["inna wielkość liter", "General"],
  ])("%s degraduje do „Ogólnych”, a nie wywala trasy", (_opis, raw) => {
    // Stary link z zakładką, której już nie ma, ma OTWORZYĆ edytor, a nie
    // pokazać ekran błędu routera.
    expect(clubEditorTab(raw)).toBe("general");
  });
});

// --- wersja robocza „Ogólnych” --------------------------------------------

describe("toClubGeneralDraft", () => {
  it("przepisuje wiersz na wersję roboczą bez gubienia pola", () => {
    const draft = toClubGeneralDraft(detailRow());
    expect(draft).toEqual({
      slug: "klub-energetyczny",
      namePl: "Klub energetyczny",
      nameEn: "Energy club",
      taglinePl: "Energia i klimat",
      taglineEn: "Energy and climate",
      descriptionPl: "Opis",
      descriptionEn: "Description",
      rulesPl: "Zasady",
      rulesEn: "Rules",
      policyArea: "energy",
      status: "active",
      cover: "https://cdn.example.org/klub.jpg",
      layout: "cards",
    });
  });

  it.each([
    ["tagline_pl", "taglinePl"],
    ["tagline_en", "taglineEn"],
    ["description_pl", "descriptionPl"],
    ["description_en", "descriptionEn"],
    ["rules_pl", "rulesPl"],
    ["rules_en", "rulesEn"],
    ["policy_area", "policyArea"],
    ["cover_image_url", "cover"],
  ] as const)("kolumna %s równa `null` staje się pustym napisem w polu %s", (column, field) => {
    // Pole formularza nie umie trzymać `null`; droga powrotna jest w payloadzie.
    const draft = toClubGeneralDraft(detailRow({ [column]: null }));
    expect(draft[field]).toBe("");
  });

  it.each(CLUB_STATUSES)("status %s przechodzi ze wiersza bez zmiany", (status) => {
    expect(toClubGeneralDraft(detailRow({ status })).status).toBe(status);
  });

  it.each([
    ["wartość spoza słownika", "retired"],
    ["pusty napis", ""],
    ["inna wielkość liter", "ACTIVE"],
  ])("status - %s degraduje do `draft`", (_opis, status) => {
    // `draft` jest najostrożniejszą wartością: klub w wersji roboczej nie jest
    // widoczny publicznie, więc pomyłka nie ujawnia niczego.
    expect(toClubGeneralDraft(detailRow({ status })).status).toBe("draft");
  });

  it("kolumna `status` równa `null` też degraduje do `draft`", () => {
    expect(toClubGeneralDraft(detailRow({ status: null })).status).toBe("draft");
  });

  it.each([
    ["nieznany układ", "gallery", "list"],
    ["pusty napis", "", "list"],
    ["układ ze słownika", "magazine", "magazine"],
  ])("układ - %s daje %s", (_opis, layout, expected) => {
    expect(toClubGeneralDraft(detailRow({ layout })).layout).toBe(expected);
  });

  it("kolumna `layout` równa `null` degraduje do listy", () => {
    expect(toClubGeneralDraft(detailRow({ layout: null })).layout).toBe("list");
  });
});

// --- wersja robocza „Dostępu” ---------------------------------------------

describe("toClubAccessDraft - fallbacki są WĘŻSZE, nie neutralne", () => {
  it("przepisuje wiersz na wersję roboczą bez gubienia pola", () => {
    expect(toClubAccessDraft(detailRow())).toEqual({
      visibility: "public",
      joinPolicy: "open",
      minTierRank: 20,
      attributionMode: "attributed",
      whoCanPost: "members",
      moderationMode: "post",
    });
  });

  it.each(CLUB_VISIBILITIES)("widoczność %s przechodzi bez zmiany", (visibility) => {
    expect(toClubAccessDraft(detailRow({ visibility })).visibility).toBe(visibility);
  });

  it.each(CLUB_JOIN_POLICIES)("polityka dołączania %s przechodzi bez zmiany", (join_policy) => {
    expect(toClubAccessDraft(detailRow({ join_policy })).joinPolicy).toBe(join_policy);
  });

  it.each(CLUB_ATTRIBUTION_MODES)("tryb atrybucji %s przechodzi bez zmiany", (attribution_mode) => {
    expect(toClubAccessDraft(detailRow({ attribution_mode })).attributionMode).toBe(
      attribution_mode,
    );
  });

  it.each(CLUB_POST_POLICIES)("polityka pisania %s przechodzi bez zmiany", (who_can_post) => {
    expect(toClubAccessDraft(detailRow({ who_can_post })).whoCanPost).toBe(who_can_post);
  });

  it.each(CLUB_MODERATION_MODES)("tryb moderacji %s przechodzi bez zmiany", (moderation_mode) => {
    expect(toClubAccessDraft(detailRow({ moderation_mode })).moderationMode).toBe(moderation_mode);
  });

  it.each([
    ["widoczność", "visibility", "members"],
    ["polityka dołączania", "join_policy", "request"],
    ["tryb atrybucji", "attribution_mode", "attributed"],
    ["polityka pisania", "who_can_post", "moderators"],
    ["tryb moderacji", "moderation_mode", "trusted"],
  ] as const)("%s spoza słownika degraduje do `%s`", (_opis, column, expected) => {
    const draft = toClubAccessDraft(detailRow({ [column]: "wartosc-ktorej-nie-ma" }));
    expect(Object.values(draft)).toContain(expected);
  });

  it("nieznana widoczność NIE otwiera klubu - schodzi na `members`, nie na `public`", () => {
    // To jest cała teza tej grupy testów: fallback, który poszerza dostęp,
    // wypuszczałby treść klubu zamkniętego przy pierwszej nieznanej wartości
    // CHECK-a w bazie.
    expect(toClubAccessDraft(detailRow({ visibility: "restricted" })).visibility).toBe("members");
    expect(toClubAccessDraft(detailRow({ visibility: null })).visibility).toBe("members");
  });

  it("nieznana polityka pisania NIE wpuszcza członków - schodzi na `moderators`", () => {
    expect(toClubAccessDraft(detailRow({ who_can_post: "everyone" })).whoCanPost).toBe(
      "moderators",
    );
  });

  it("ranga progu przechodzi liczbą, także zero", () => {
    // `0` znaczy „bez progu" i jest wartością prawidłową - nie wolno jej
    // zamienić na wartość domyślną.
    expect(toClubAccessDraft(detailRow({ min_tier_rank: 0 })).minTierRank).toBe(0);
    expect(toClubAccessDraft(detailRow({ min_tier_rank: 60 })).minTierRank).toBe(60);
  });
});

// --- brudna wersja robocza -------------------------------------------------

describe("isClubEditorDirty", () => {
  it("wersja robocza równa stanowi z serwera NIE jest brudna", () => {
    const club = detailRow();
    expect(isClubEditorDirty(club, toClubGeneralDraft(club), toClubAccessDraft(club))).toBe(false);
  });

  it("`null` w bazie i pusty napis w formularzu to NIE zmiana", () => {
    // Bez przepisania wiersza na wersję roboczą przycisk „Zapisz" byłby aktywny
    // zawsze - a przycisk, który nic nie zapisuje, uczy ignorowania przycisku.
    const club = detailRow({ tagline_pl: null, description_en: null, cover_image_url: null });
    expect(isClubEditorDirty(club, toClubGeneralDraft(club), toClubAccessDraft(club))).toBe(false);
  });

  it.each([
    ["slug", { slug: "inny-slug" }],
    ["nazwa polska", { namePl: "Inna nazwa" }],
    ["zajawka", { taglinePl: "Inna zajawka" }],
    ["status", { status: "archived" as const }],
    ["układ", { layout: "editorial" as const }],
    ["okładka", { cover: "" }],
  ])("zmiana w polu %s czyni wersję roboczą brudną", (_opis, patch) => {
    const club = detailRow();
    expect(isClubEditorDirty(club, generalOf(patch), toClubAccessDraft(club))).toBe(true);
  });

  it.each([
    ["widoczność", { visibility: "secret" as const }],
    ["polityka dołączania", { joinPolicy: "invite" as const }],
    ["ranga progu", { minTierRank: 40 }],
    ["tryb atrybucji", { attributionMode: "chatham" as const }],
    ["polityka pisania", { whoCanPost: "staff_only" as const }],
    ["tryb moderacji", { moderationMode: "pre" as const }],
  ])("zmiana w polu %s zakładki „Dostęp” też czyni wersję brudną", (_opis, patch) => {
    const club = detailRow();
    expect(isClubEditorDirty(club, toClubGeneralDraft(club), accessOf(patch))).toBe(true);
  });

  it("zmiana WYŁĄCZNIE białych znaków JEST zmianą - to pole tekstowe, nie payload", () => {
    // Przycinanie jest w payloadzie, nie w wykrywaniu zmiany: gdyby wykrywanie
    // też przycinało, użytkownik nie mógłby zapisać usunięcia spacji.
    const club = detailRow();
    expect(isClubEditorDirty(club, generalOf({ namePl: "Klub energetyczny " }), accessOf())).toBe(
      true,
    );
  });
});

// --- blokada zapisu --------------------------------------------------------

describe("clubEditorBlock - czego baza nie przyjmie", () => {
  it("kompletna wersja robocza nie jest zablokowana", () => {
    expect(clubEditorBlock(generalOf())).toBeNull();
  });

  it.each([
    ["pusty slug", { slug: "" }, "slug_required"],
    ["slug z samych spacji", { slug: "   " }, "slug_required"],
    ["pusta nazwa polska", { namePl: "" }, "name_required"],
    ["nazwa z samych spacji", { namePl: "\t\n " }, "name_required"],
  ] as const)("%s blokuje zapis kodem %s", (_opis, patch, expected) => {
    expect(clubEditorBlock(generalOf(patch))).toBe(expected);
  });

  it("brak SLUGA wygrywa nad brakiem nazwy - jeden komunikat na raz", () => {
    // Dwa błędy naraz w jednym toście są nieczytelne; slug jest pierwszy, bo
    // bez niego nie ma adresu klubu.
    expect(clubEditorBlock(generalOf({ slug: "", namePl: "" }))).toBe("slug_required");
  });

  it("pusta nazwa ANGIELSKA nie blokuje - dziedziczy po polskiej", () => {
    expect(clubEditorBlock(generalOf({ nameEn: "" }))).toBeNull();
  });
});

// --- payload zapisu --------------------------------------------------------

describe("clubEditorPayload", () => {
  it("składa payload z identyfikatorem klubu i wszystkimi polami", () => {
    expect(clubEditorPayload(CLUB_IDS.club, generalOf(), accessOf())).toEqual({
      id: CLUB_IDS.club,
      slug: "klub-energetyczny",
      name_pl: "Klub energetyczny",
      name_en: "Energy club",
      tagline_pl: "Energia i klimat",
      tagline_en: "Energy and climate",
      description_pl: "Opis",
      description_en: "Description",
      rules_pl: "Zasady",
      rules_en: "Rules",
      policy_area: "energy",
      status: "active",
      cover_image_url: "https://cdn.example.org/klub.jpg",
      layout: "cards",
      visibility: "public",
      join_policy: "open",
      min_tier_rank: 20,
      attribution_mode: "attributed",
      who_can_post: "members",
      moderation_mode: "post",
    });
  });

  it.each([
    ["tagline_pl", "taglinePl"],
    ["tagline_en", "taglineEn"],
    ["description_pl", "descriptionPl"],
    ["description_en", "descriptionEn"],
    ["rules_pl", "rulesPl"],
    ["rules_en", "rulesEn"],
    ["policy_area", "policyArea"],
    ["cover_image_url", "cover"],
  ] as const)("wyczyszczone pole %s jedzie jako `null`, nie jako pusty napis", (column, field) => {
    // `""` zostawiałby puste zdanie w treści, a brak klucza znaczyłby
    // „nie ruszaj" i zmiana cicho by się nie zapisała.
    const payload = clubEditorPayload(CLUB_IDS.club, generalOf({ [field]: "" }), accessOf());
    expect(payload[column]).toBeNull();
  });

  it.each([
    ["tagline_pl", "taglinePl"],
    ["policy_area", "policyArea"],
    ["cover_image_url", "cover"],
  ] as const)("pole %s z samych spacji też jedzie jako `null`", (column, field) => {
    const payload = clubEditorPayload(CLUB_IDS.club, generalOf({ [field]: "   " }), accessOf());
    expect(payload[column]).toBeNull();
  });

  it("nazwa angielska DZIEDZICZY po polskiej, gdy jest pusta", () => {
    // Klub bez `name_en` pokazywałby pusty tytuł na `/en/`.
    const payload = clubEditorPayload(
      CLUB_IDS.club,
      generalOf({ namePl: "Klub transportowy", nameEn: "" }),
      accessOf(),
    );
    expect(payload.name_en).toBe("Klub transportowy");
  });

  it("nazwa angielska z samych spacji też dziedziczy", () => {
    const payload = clubEditorPayload(
      CLUB_IDS.club,
      generalOf({ namePl: "Klub transportowy", nameEn: "   " }),
      accessOf(),
    );
    expect(payload.name_en).toBe("Klub transportowy");
  });

  it("slug i nazwy są PRZYCINANE - spacja łamie CHECK i psuje sortowanie", () => {
    const payload = clubEditorPayload(
      CLUB_IDS.club,
      generalOf({ slug: "  klub-nowy  ", namePl: "  Klub nowy  ", nameEn: "  New club  " }),
      accessOf(),
    );
    expect(payload.slug).toBe("klub-nowy");
    expect(payload.name_pl).toBe("Klub nowy");
    expect(payload.name_en).toBe("New club");
  });

  it("treść dłuższa jest przycinana, ale NIE opróżniana", () => {
    const payload = clubEditorPayload(
      CLUB_IDS.club,
      generalOf({ descriptionPl: "  Opis klubu.  " }),
      accessOf(),
    );
    expect(payload.description_pl).toBe("Opis klubu.");
  });

  it("ranga progu zero jedzie jako zero, a nie jako brak", () => {
    const payload = clubEditorPayload(CLUB_IDS.club, generalOf(), accessOf({ minTierRank: 0 }));
    expect(payload.min_tier_rank).toBe(0);
  });

  it("payload NIE niesie pól, których edytor nie edytuje", () => {
    // Klucz obecny znaczy „ustaw", więc wysyłanie `icon`/`accent_color`
    // nadpisywałoby wartości ustawione gdzie indziej.
    const payload = clubEditorPayload(CLUB_IDS.club, generalOf(), accessOf());
    expect(payload).not.toHaveProperty("icon");
    expect(payload).not.toHaveProperty("accent_color");
  });
});

// --- slug ------------------------------------------------------------------

describe("normalizeClubSlugInput", () => {
  it.each([
    ["wielkie litery", "Klub-Energetyczny", "klub-energetyczny"],
    ["spacje", "klub energetyczny", "klub-energetyczny"],
    // Diakrytyki NIE są rozkładane na ASCII (to robi `slugify` z nazwy) - tu
    // każdy niedozwolony znak staje się myślnikiem, a ciąg myślników jest
    // zwijany. Skutek: „kłub żółć" daje „k-ub-", nie „klub-zolc". To świadoma
    // różnica: pole slug jest ręczne, a podpowiedź z nazwy generuje `slugify`.
    ["polskie znaki", "kłub żółć", "k-ub-"],
    ["znaki interpunkcyjne", "klub!@#energia", "klub-energia"],
    ["zwielokrotnione myślniki", "klub---energia", "klub-energia"],
    ["podkreślenia", "klub_energia", "klub-energia"],
    ["cyfry zostają", "klub-2026", "klub-2026"],
    ["pusty napis", "", ""],
    ["same niedozwolone znaki", "!!!", "-"],
  ])("%s -> %s", (_opis, input, expected) => {
    expect(normalizeClubSlugInput(input)).toBe(expected);
  });

  it("wynik ZAWSZE pasuje do wzorca CHECK-a z bazy", () => {
    // Normalizujemy w locie właśnie po to, żeby nie dało się wpisać czegoś,
    // co baza i tak odrzuci.
    for (const input of ["Klub Energetyczny!", "ŁÓDŹ 2026", "a__b--c", "///"]) {
      expect(normalizeClubSlugInput(input)).toMatch(/^[a-z0-9-]*$/);
    }
  });
});

describe("isClubSlugChanged", () => {
  it("zmiana sluga istniejącego klubu JEST zmianą", () => {
    expect(isClubSlugChanged("klub-nowy", "klub-stary")).toBe(true);
  });

  it("ten sam slug nie jest zmianą", () => {
    expect(isClubSlugChanged("klub-stary", "klub-stary")).toBe(false);
  });

  it("wpisanie sluga przy ZAKŁADANIU klubu nie jest zmianą", () => {
    // Ostrzeżenie „zepsujesz istniejące linki" przy klubie, którego jeszcze nie
    // ma, jest bez sensu.
    expect(isClubSlugChanged("klub-nowy", "")).toBe(false);
  });

  it("wyczyszczenie sluga istniejącego klubu JEST zmianą", () => {
    expect(isClubSlugChanged("", "klub-stary")).toBe(true);
  });
});

// --- filtry listy ----------------------------------------------------------

describe("adminClubListFilters - strona na okno RPC", () => {
  it("pierwsza strona zaczyna się od zera", () => {
    expect(
      adminClubListFilters({ search: "", status: null, visibility: null, page: 1, pageSize: 50 }),
    ).toEqual({ search: "", status: null, visibility: null, limit: 50, offset: 0 });
  });

  it.each([
    [1, 50, 0],
    [2, 50, 50],
    [3, 50, 100],
    [1, 25, 0],
    [4, 25, 75],
  ])("strona %s po %s wierszy daje offset %s", (page, pageSize, offset) => {
    // Błąd o jeden w tym przeliczeniu gubił całą stronę wyników bez żadnego
    // komunikatu - lista chodziła na domyślnym limicie i nie czytała
    // `total_count`, który RPC zwraca w każdym wierszu.
    const filters = adminClubListFilters({
      search: "",
      status: null,
      visibility: null,
      page,
      pageSize,
    });
    expect(filters.offset).toBe(offset);
    expect(filters.limit).toBe(pageSize);
  });

  it("przenosi frazę i filtry bez zmiany", () => {
    const filters = adminClubListFilters({
      search: "energia",
      status: "active",
      visibility: "secret",
      page: 1,
      pageSize: 50,
    });
    expect(filters.search).toBe("energia");
    expect(filters.status).toBe("active");
    expect(filters.visibility).toBe("secret");
  });
});

describe("hasAdminClubFilters - który komunikat pustki pokazać", () => {
  it("brak filtrów to lista NIEZAWĘŻONA", () => {
    expect(hasAdminClubFilters({ search: "", status: null, visibility: null })).toBe(false);
  });

  it("fraza z samych spacji NIE jest filtrem", () => {
    // Inaczej użytkownik z przypadkową spacją w polu widziałby „nic nie pasuje
    // do filtrów" przy pustej bazie i szukałby filtra, którego nie ustawił.
    expect(hasAdminClubFilters({ search: "   ", status: null, visibility: null })).toBe(false);
  });

  it.each([
    ["fraza", { search: "energia", status: null, visibility: null }],
    ["status", { search: "", status: "draft" as const, visibility: null }],
    ["widoczność", { search: "", status: null, visibility: "secret" as const }],
  ])("%s czyni listę zawężoną", (_opis, input) => {
    expect(hasAdminClubFilters(input)).toBe(true);
  });
});
