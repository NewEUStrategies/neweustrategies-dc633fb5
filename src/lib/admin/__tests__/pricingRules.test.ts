// Reguły panelu Cennika 2.0 - 0 z 12 funkcji pokrytych do 18.08.2026.
//
// Wszystkie te funkcje mieszkały wewnątrz pliku trasy `/admin/pricing` (1821
// linii), więc jedynym sposobem sprawdzenia pojedynczego warunku zapisu było
// wyrenderowanie całego panelu razem z bazą. Tu są sprawdzane wprost, bo to
// one decydują, co redakcja zdoła opublikować na stronie, na której klient
// wybiera plan.
import { describe, expect, it } from "vitest";

import {
  CTA_MODES,
  EMPTY_FAQ_DRAFT,
  GLOBAL_FAQ,
  ICON_OPTIONS,
  NO_AUDIENCE,
  audienceDraftValid,
  audienceKeyValid,
  clampInt,
  draftFromAudience,
  draftFromFaq,
  draftFromTier,
  faqAudienceColumn,
  faqDraftValid,
  reasonDraftFromRow,
  settingsDraftFromRow,
  type AudienceDraft,
  type FaqDraft,
} from "@/lib/admin/pricingDrafts";
import { rankTone } from "@/lib/admin/rankTone";
import { groupTiersByAudience } from "@/lib/admin/tierGroups";
import { retentionStats } from "@/lib/admin/retentionStats";
import { SLUG_KEY_RE, slugKeyValid } from "@/lib/keyFormat";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import type { RetentionFeedbackRow, RetentionSettingsRow } from "@/lib/retention/queries";

// --- atomy danych (syntetyczne, bez cienia prawdziwego klienta) -------------

function audienceRow(overrides: Partial<PricingAudienceRow> = {}): PricingAudienceRow {
  return {
    id: "aud-1",
    tenant_id: "tenant-1",
    key: "individual",
    name_pl: "Osoba prywatna",
    name_en: "Individual",
    tagline_pl: null,
    tagline_en: null,
    trust_pl: null,
    trust_en: null,
    icon: "user",
    active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PricingAudienceRow;
}

function tierRow(overrides: Partial<MembershipTierRow> = {}): MembershipTierRow {
  return {
    id: "tier-1",
    tenant_id: "tenant-1",
    key: "member",
    name_pl: "Członek",
    name_en: "Member",
    description_pl: null,
    description_en: null,
    rank: 10,
    benefits: [],
    features: {},
    active: true,
    is_default: false,
    audience_key: "individual",
    badge_pl: null,
    badge_en: null,
    highlight: false,
    contact_url: null,
    cta_mode: "auto",
    per_seat: false,
    price_note_pl: null,
    price_note_en: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as MembershipTierRow;
}

function faqRow(overrides: Partial<PricingFaqItemRow> = {}): PricingFaqItemRow {
  return {
    id: "faq-1",
    tenant_id: "tenant-1",
    audience_key: null,
    question_pl: "Czy mogę zrezygnować?",
    question_en: "Can I cancel?",
    answer_pl: "Tak, w każdej chwili.",
    answer_en: "Yes, at any time.",
    sort_order: 0,
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PricingFaqItemRow;
}

const BASE_NOW = Date.parse("2026-08-18T12:00:00.000Z");
const daysAgo = (days: number) => new Date(BASE_NOW - days * 86_400_000).toISOString();

function feedbackRow(overrides: Partial<RetentionFeedbackRow> = {}): RetentionFeedbackRow {
  return {
    id: "fb-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    subscription_id: null,
    reason_code: "price",
    reason_label: "Za drogo",
    comment: null,
    offer_shown: true,
    offer_accepted: false,
    coupon_code: null,
    created_at: daysAgo(1),
    ...overrides,
  } as RetentionFeedbackRow;
}

// --- format klucza technicznego --------------------------------------------

describe("slugKeyValid - klucz, który da się odczytać po zapisie", () => {
  it("przyjmuje małe litery, cyfry, myślnik i podkreślenie", () => {
    expect(slugKeyValid("media-b2b_2026", [])).toBe(true);
    expect(SLUG_KEY_RE.test("media-b2b_2026")).toBe(true);
  });

  it("odrzuca WIELKIE LITERY - klucz zapisany, a nieodnajdywany przy odczycie", () => {
    expect(slugKeyValid("Media", [])).toBe(false);
    expect(slugKeyValid("media", [])).toBe(true);
  });

  it("odrzuca spacje i znaki spoza zestawu", () => {
    expect(slugKeyValid("dla firm", [])).toBe(false);
    expect(slugKeyValid("firmy!", [])).toBe(false);
  });

  it("odrzuca za krótkie i za długie", () => {
    expect(slugKeyValid("a", [])).toBe(false);
    expect(slugKeyValid("a".repeat(33), [])).toBe(false);
    expect(slugKeyValid("ab", [])).toBe(true);
    expect(slugKeyValid("a".repeat(32), [])).toBe(true);
  });

  it("odrzuca klucz JUŻ ZAJĘTY - dwa segmenty o tym samym kluczu to jeden zniknięty", () => {
    expect(slugKeyValid("media", ["media", "corporate"])).toBe(false);
    expect(slugKeyValid("press", ["media", "corporate"])).toBe(true);
  });

  it("`audienceKeyValid` to ta sama reguła (jedna, nie dwie)", () => {
    expect(audienceKeyValid("Media", [])).toBe(false);
    expect(audienceKeyValid("media", ["media"])).toBe(false);
  });
});

// --- segmenty odbiorców -----------------------------------------------------

describe("draftFromAudience - co redakcja widzi po wczytaniu", () => {
  it("puste kolumny schodzą na pusty tekst, a nie na napis „null”", () => {
    const draft = draftFromAudience(audienceRow({ tagline_pl: null, trust_en: null }));

    expect(draft.tagline_pl).toBe("");
    expect(draft.trust_en).toBe("");
  });

  it("przepisuje nazwy, ikonę i aktywność bez zmian", () => {
    const draft = draftFromAudience(
      audienceRow({ name_pl: "Media", name_en: "Media", icon: "landmark", active: false }),
    );

    expect(draft).toMatchObject({ name_pl: "Media", icon: "landmark", active: false });
    expect(draft.name_en).toBe("Media");
  });
});

describe("audienceDraftValid - segment bez nazwy nie trafia na stronę", () => {
  const base: AudienceDraft = draftFromAudience(audienceRow());

  it("wymaga nazwy w OBU językach", () => {
    expect(audienceDraftValid({ ...base, name_en: "" })).toBe(false);
    expect(audienceDraftValid({ ...base, name_pl: "" })).toBe(false);
  });

  it("same spacje to brak nazwy, nie nazwa", () => {
    expect(audienceDraftValid({ ...base, name_pl: "   " })).toBe(false);
    expect(audienceDraftValid(base)).toBe(true);
  });
});

describe("ICON_OPTIONS - zestaw ikon segmentu", () => {
  it("zawiera wszystkie sześć ikon, których używa strona publiczna", () => {
    expect(ICON_OPTIONS).toHaveLength(6);
    expect(ICON_OPTIONS).toContain("building-2");
  });
});

// --- marketing warstw -------------------------------------------------------

describe("draftFromTier - marketing warstwy", () => {
  it("warstwa bez segmentu dostaje wartość selecta, nie `null`", () => {
    const draft = draftFromTier(tierRow({ audience_key: null }));

    expect(draft.audience_key).toBe(NO_AUDIENCE);
    expect(draft.audience_key).not.toBeNull();
  });

  it("NIEZNANY tryb przycisku schodzi na „auto”, zamiast blokować zakup", () => {
    // Wartość wpisana ręcznie w SQL nie może zostawić klienta bez przycisku.
    const draft = draftFromTier(tierRow({ cta_mode: "wypełnij-formularz" }));

    expect(draft.cta_mode).toBe("auto");
    expect(CTA_MODES).toContain(draft.cta_mode);
  });

  it("znany tryb przechodzi bez zmiany", () => {
    expect(draftFromTier(tierRow({ cta_mode: "contact" })).cta_mode).toBe("contact");
    expect(draftFromTier(tierRow({ cta_mode: "none" })).cta_mode).toBe("none");
  });

  it("puste badge i nota cenowa schodzą na pusty tekst", () => {
    const draft = draftFromTier(tierRow({ badge_pl: null, price_note_en: null }));

    expect(draft.badge_pl).toBe("");
    expect(draft.price_note_en).toBe("");
  });
});

describe("groupTiersByAudience - żadna warstwa nie ginie", () => {
  it("warstwy trafiają do swojego segmentu", () => {
    const groups = groupTiersByAudience(
      [tierRow({ id: "a", audience_key: "individual" }), tierRow({ id: "b", audience_key: "b2b" })],
      new Set(["individual", "b2b"]),
    );

    expect(groups.byAudience.get("individual")).toHaveLength(1);
    expect(groups.unassigned).toEqual([]);
  });

  it("warstwa wskazująca NIEISTNIEJĄCY segment trafia do nieprzypisanych, nie do kosza", () => {
    // Na stronie publicznej taka warstwa nie pokaże się w żadnej zakładce -
    // panel musi ją pokazać, bo inaczej redakcja nie ma skąd o tym wiedzieć.
    const orphan = tierRow({ id: "orphan", audience_key: "skasowany-segment" });

    const groups = groupTiersByAudience([orphan], new Set(["individual"]));

    expect(groups.unassigned).toHaveLength(1);
    expect(groups.unassigned[0].id).toBe("orphan");
  });

  it("warstwa BEZ segmentu też trafia do nieprzypisanych", () => {
    const groups = groupTiersByAudience([tierRow({ audience_key: null })], new Set(["individual"]));

    expect(groups.unassigned).toHaveLength(1);
    expect(groups.byAudience.size).toBe(0);
  });

  it("kolejność w grupie jest prezentacyjna (ta sama, co u klienta), nie kolejnością wejścia", () => {
    const groups = groupTiersByAudience(
      [
        tierRow({ id: "high", rank: 30, audience_key: "individual" }),
        tierRow({ id: "low", rank: 5, audience_key: "individual" }),
      ],
      new Set(["individual"]),
    );

    const ids = (groups.byAudience.get("individual") ?? []).map((tier) => tier.id);
    expect(ids).toEqual(["low", "high"]);
    expect(ids).toHaveLength(2);
  });
});

describe("rankTone - hierarchia widoczna w panelu", () => {
  it("ranga premium (od 30) dostaje tonację złotą", () => {
    expect(rankTone(30).dot).toBe("bg-amber-500");
    expect(rankTone(99).dot).toBe("bg-amber-500");
  });

  it("progi są rosnące i rozłączne: 29 to marka, 14 pomocnicza, 4 neutralna", () => {
    expect(rankTone(29).dot).toBe("bg-primary");
    expect(rankTone(14).dot).toBe("bg-sky-500");
    expect(rankTone(4).dot).toBe("bg-muted-foreground/60");
  });

  it("granice należą do wyższej tonacji (15 i 5 włącznie)", () => {
    expect(rankTone(15).dot).toBe("bg-primary");
    expect(rankTone(5).dot).toBe("bg-sky-500");
  });

  it("ranga zerowa nie wygląda na premium", () => {
    expect(rankTone(0).dot).toBe("bg-muted-foreground/60");
    expect(rankTone(0).iconBg).toBe("bg-muted");
  });
});

// --- FAQ --------------------------------------------------------------------

describe("draftFromFaq i faqAudienceColumn - pytanie globalne kontra segmentowe", () => {
  it("pytanie bez segmentu jest pytaniem GLOBALNYM", () => {
    expect(draftFromFaq(faqRow({ audience_key: null })).audience_key).toBe(GLOBAL_FAQ);
    expect(faqAudienceColumn(GLOBAL_FAQ)).toBeNull();
  });

  it("wybrany segment wraca do bazy jako klucz, nie jako „global”", () => {
    expect(draftFromFaq(faqRow({ audience_key: "b2b" })).audience_key).toBe("b2b");
    expect(faqAudienceColumn("b2b")).toBe("b2b");
  });

  it("nowe pytanie startuje jako globalne i aktywne", () => {
    expect(EMPTY_FAQ_DRAFT.audience_key).toBe(GLOBAL_FAQ);
    expect(EMPTY_FAQ_DRAFT.active).toBe(true);
  });
});

describe("faqDraftValid - pełna para językowa albo nic", () => {
  const full: FaqDraft = draftFromFaq(faqRow());

  it("kompletne pytanie przechodzi", () => {
    expect(faqDraftValid(full)).toBe(true);
    expect(full.answer_en.length).toBeGreaterThan(0);
  });

  it.each([
    ["pytania po polsku", { question_pl: "" }],
    ["pytania po angielsku", { question_en: "" }],
    ["odpowiedzi po polsku", { answer_pl: "" }],
    ["odpowiedzi po angielsku", { answer_en: "" }],
  ])("brak %s blokuje zapis", (_label, patch) => {
    expect(faqDraftValid({ ...full, ...patch })).toBe(false);
    expect(faqDraftValid(full)).toBe(true);
  });

  it("same spacje to brak treści", () => {
    expect(faqDraftValid({ ...full, answer_en: "   \n  " })).toBe(false);
  });
});

// --- retencja ---------------------------------------------------------------

describe("settingsDraftFromRow - domyślna kontroferta", () => {
  it("BRAK wiersza w bazie nie wyłącza kontroferty (30% na 3 okresy, kod 14 dni)", () => {
    const draft = settingsDraftFromRow(null);

    expect(draft).toEqual({
      enabled: true,
      discount_pct: "30",
      discount_periods: "3",
      coupon_valid_days: "14",
    });
    expect(draft.enabled).toBe(true);
  });

  it("zapisane ustawienia mają pierwszeństwo nad domyślnymi", () => {
    const row = {
      enabled: false,
      discount_pct: 50,
      discount_periods: 6,
      coupon_valid_days: 7,
    } as RetentionSettingsRow;

    expect(settingsDraftFromRow(row)).toEqual({
      enabled: false,
      discount_pct: "50",
      discount_periods: "6",
      coupon_valid_days: "7",
    });
  });

  it("wyłączenie zapisane jako `false` NIE wraca do `true`", () => {
    // `row?.enabled ?? true` - gdyby użyto `||`, wyłączona kontroferta sama by
    // się włączała po każdym wczytaniu panelu.
    expect(settingsDraftFromRow({ enabled: false } as RetentionSettingsRow).enabled).toBe(false);
  });
});

describe("clampInt - rabat, który nie wyjdzie z panelu za daleko", () => {
  it("liczba w zakresie przechodzi bez zmiany", () => {
    expect(clampInt("42", 1, 90, 30)).toBe(42);
    expect(clampInt("1", 1, 90, 30)).toBe(1);
  });

  it("przycina rabat 900% do maksimum, zamiast go zapisać", () => {
    expect(clampInt("900", 1, 90, 30)).toBe(90);
    expect(clampInt("91", 1, 90, 30)).toBe(90);
  });

  it("przycina wartość ujemną do minimum (rabat -30% to podwyżka)", () => {
    expect(clampInt("-30", 1, 90, 30)).toBe(1);
    expect(clampInt("0", 1, 90, 30)).toBe(1);
  });

  it("tekst niebędący liczbą schodzi na wartość domyślną, nie na NaN", () => {
    expect(clampInt("", 1, 90, 30)).toBe(30);
    expect(clampInt("dużo", 1, 90, 30)).toBe(30);
  });

  it("ucina część dziesiętną zamiast zaokrąglać w górę", () => {
    expect(clampInt("30.9", 1, 90, 30)).toBe(30);
    expect(clampInt("29.4", 1, 90, 30)).toBe(29);
  });
});

describe("reasonDraftFromRow", () => {
  it("przepisuje etykiety i aktywność", () => {
    const draft = reasonDraftFromRow({
      label_pl: "Za drogo",
      label_en: "Too expensive",
      active: false,
    } as never);

    expect(draft).toEqual({ label_pl: "Za drogo", label_en: "Too expensive", active: false });
    expect(draft.active).toBe(false);
  });
});

describe("retentionStats - skuteczność kontroferty", () => {
  it("mianownikiem są POKAZANE oferty, nie wszystkie rezygnacje", () => {
    // 2 pokazane, 1 przyjęta, plus rezygnacja bez oferty. Poprawnie: 50%.
    // Gdyby dzielić przez wszystkie trzy, wyszłoby 33% i „rabat nie działa".
    const stats = retentionStats(
      [
        feedbackRow({ id: "a", offer_shown: true, offer_accepted: true }),
        feedbackRow({ id: "b", offer_shown: true, offer_accepted: false }),
        feedbackRow({ id: "c", offer_shown: false, offer_accepted: false }),
      ],
      BASE_NOW,
    );

    expect(stats.acceptRate).toBe(50);
    expect(stats.total).toBe(3);
  });

  it("BRAK pokazanych ofert to `null`, a nie 0% - brak próby nie jest porażką", () => {
    const stats = retentionStats(
      [feedbackRow({ offer_shown: false, offer_accepted: false })],
      BASE_NOW,
    );

    expect(stats.acceptRate).toBeNull();
    expect(stats.total).toBe(1);
  });

  it("odpowiedzi starsze niż 90 dni NIE wchodzą do statystyk", () => {
    const stats = retentionStats(
      [
        feedbackRow({ id: "stara", created_at: daysAgo(91), offer_accepted: true }),
        feedbackRow({ id: "nowa", created_at: daysAgo(2), offer_accepted: false }),
      ],
      BASE_NOW,
    );

    expect(stats.total).toBe(1);
    expect(stats.accepted).toBe(0);
  });

  it("odpowiedź z dokładnie 90 dni jeszcze się liczy (granica należy do okna)", () => {
    const stats = retentionStats([feedbackRow({ created_at: daysAgo(90) })], BASE_NOW);

    expect(stats.total).toBe(1);
    expect(stats.acceptRate).toBe(0);
  });

  it("trzy najczęstsze powody, malejąco, i nie więcej niż trzy", () => {
    const stats = retentionStats(
      [
        feedbackRow({ id: "1", reason_label: "Za drogo" }),
        feedbackRow({ id: "2", reason_label: "Za drogo" }),
        feedbackRow({ id: "3", reason_label: "Za drogo" }),
        feedbackRow({ id: "4", reason_label: "Brak czasu" }),
        feedbackRow({ id: "5", reason_label: "Brak czasu" }),
        feedbackRow({ id: "6", reason_label: "Inne narzędzie" }),
        feedbackRow({ id: "7", reason_label: "Coś jeszcze" }),
      ],
      BASE_NOW,
    );

    expect(stats.topReasons).toEqual([
      ["Za drogo", 3],
      ["Brak czasu", 2],
      ["Inne narzędzie", 1],
    ]);
    expect(stats.topReasons).toHaveLength(3);
  });

  it("pusta lista daje zera i brak powodów, nie wyjątek", () => {
    const stats = retentionStats([], BASE_NOW);

    expect(stats).toEqual({ total: 0, accepted: 0, acceptRate: null, topReasons: [] });
    expect(stats.topReasons).toEqual([]);
  });

  it("przyjęcie liczy się nawet bez znacznika „pokazana” (dane historyczne)", () => {
    // Nie chcemy zgubić przyjętej oferty tylko dlatego, że stary wiersz nie ma
    // `offer_shown` - liczba przyjęć jest niezależna od mianownika.
    const stats = retentionStats(
      [feedbackRow({ offer_shown: false, offer_accepted: true })],
      BASE_NOW,
    );

    expect(stats.accepted).toBe(1);
    expect(stats.acceptRate).toBeNull();
  });
});
