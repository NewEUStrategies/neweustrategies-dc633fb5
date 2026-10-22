// Parser karty „Retencja danych": kształty z PRAWDZIWYCH RPC (baza pgTAP po
// migracjach 20261020161000-161400, 2026-10-20) i rozjazdy kontraktu, które
// mają być głośne (ścieżka pola), a nie zamienione na pustą kartę.
import { describe, expect, it } from "vitest";

import {
  DataRetentionShapeError,
  parseCrmExtension,
  parseDataRetentionCrmDue,
  parseDataRetentionNewsletterDue,
  parseDataRetentionPreview,
  parseDataRetentionRunResult,
  parseDataRetentionState,
  parseNewsletterExclusionResult,
} from "../dataRetentionParse";
import {
  EnforcementSchema,
  ExtendContactSchema,
  SaveCategorySchema,
  mapDataRetentionError,
} from "../dataRetention.functions";

const CATEGORY = {
  key: "paywall_metering",
  cutoff: "2025-09-20T18:14:17.727283+00:00",
  stored: true,
  enabled: true,
  editable: true,
  enforced: false,
  last_run: {
    mode: "preview",
    cutoff: "2025-09-20T00:00:00+00:00",
    backlog: false,
    affected: 0,
    error_code: null,
    started_at: "2026-10-20T17:53:53.52155+00:00",
    finished_at: "2026-10-20T17:53:53.527989+00:00",
    run_trigger: "schedule",
  },
  max_months: 25,
  min_months: 3,
  updated_at: "2026-10-20T17:49:38.164871+00:00",
  enforce_after: "2026-11-03T17:49:38.164871+00:00",
  period_months: 13,
  default_months: 13,
};

const STATUTORY = {
  ...CATEGORY,
  key: "consent_log",
  cutoff: null,
  editable: false,
  last_run: null,
  max_months: null,
  min_months: null,
  period_months: null,
  default_months: null,
};

const STATE = {
  grace: {
    enforced: false,
    any_preview: true,
    enforce_after: "2026-11-03T17:49:38.164871+00:00",
    enforce_after_max: "2026-11-03T17:49:38.164871+00:00",
  },
  rules: { batch_max: 50000, grace_days: 14 },
  categories: [CATEGORY, STATUTORY],
  funnel_cut: "2025-09-20",
  journey_sealed: "2025-09-19",
  last_scheduled_run_at: "2026-10-20T17:53:53.561254+00:00",
  open_tracking_enabled: true,
  journey_settings_updated_at: null,
};

const clone = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));

function shapePath(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DataRetentionShapeError);
    return (err as DataRetentionShapeError).path;
  }
  throw new Error("parser przyjął zły kształt");
}

describe("admin_data_retention_get", () => {
  it("kategoria edytowalna, ustawowa, karencja, agregaty i piksel", () => {
    const state = parseDataRetentionState(STATE);
    expect(state.categories[0]).toMatchObject({
      key: "paywall_metering",
      periodMonths: 13,
      minMonths: 3,
      maxMonths: 25,
      enforced: false,
      lastRun: { mode: "preview", trigger: "schedule", affected: 0, errorCode: null },
    });
    expect(state.categories[1]).toMatchObject({
      key: "consent_log",
      editable: false,
      periodMonths: null,
      lastRun: null,
    });
    expect(state.grace).toEqual({
      enforceAfter: "2026-11-03T17:49:38.164871+00:00",
      enforceAfterMax: "2026-11-03T17:49:38.164871+00:00",
      enforced: false,
      anyPreview: true,
    });
    expect(state).toMatchObject({
      funnelCut: "2025-09-20",
      journeySealed: "2025-09-19",
      openTrackingEnabled: true,
      journeySettingsUpdatedAt: null,
    });
  });

  it("wszystkie kategorie wyłączone: karencja bez dat (agregat SQL po pustym zbiorze)", () => {
    const raw = clone(STATE);
    raw.grace = { enforced: null, any_preview: null, enforce_after: null, enforce_after_max: null };
    expect(parseDataRetentionState(raw).grace).toEqual({
      enforceAfter: null,
      enforceAfterMax: null,
      enforced: true,
      anyPreview: false,
    });
  });

  it("kategoria nowsza niż front: wiersz pominięty, reszta karty działa (I9d-Y1)", () => {
    // Baza po migracji katalogu wdrożonej przed frontem - karta całego
    // najemcy nie może przez to pokazać „nie udało się wczytać".
    const newer = clone(STATE);
    (newer.categories as Record<string, unknown>[])[0].key = "hologramy";
    expect(parseDataRetentionState(newer).categories.map((c) => c.key)).toEqual(["consent_log"]);
    const preview = parseDataRetentionPreview({
      cap: 100000,
      categories: [
        { key: "hologramy", mode: "preview", count: 1, capped: false, cutoff: null, enabled: true },
        {
          key: "newsletter_inactive",
          mode: "preview",
          count: 4,
          capped: false,
          cutoff: "2025-10-20T00:00:00+00:00",
          enabled: true,
        },
      ],
    });
    expect(preview.categories).toEqual([
      {
        key: "newsletter_inactive",
        mode: "preview",
        count: 4,
        capped: false,
        cutoff: "2025-10-20T00:00:00+00:00",
        enabled: true,
      },
    ]);
  });

  it("nowe kategorie I9d-Y1 parsują się jak pozostałe (baza po migracji 20261020162200)", () => {
    const raw = clone(STATE);
    raw.categories = ["metered_views", "newsletter_inactive", "event_attendees", "club_applications"].map(
      (key) => ({ ...CATEGORY, key }),
    );
    expect(parseDataRetentionState(raw).categories.map((c) => c.key)).toEqual([
      "metered_views",
      "newsletter_inactive",
      "event_attendees",
      "club_applications",
    ]);
  });

  it("rozjazd kontraktu: klucz kategorii nie-napis, ujemny okres, zły tryb przebiegu", () => {
    const unknown = clone(STATE);
    (unknown.categories as Record<string, unknown>[])[0].key = 7;
    expect(shapePath(() => parseDataRetentionState(unknown))).toBe("categories[0].key");
    const negative = clone(STATE);
    (negative.categories as Record<string, unknown>[])[0].period_months = -1;
    expect(shapePath(() => parseDataRetentionState(negative))).toBe("categories[0].period_months");
    const badRun = clone(STATE);
    ((badRun.categories as Record<string, unknown>[])[0].last_run as Record<string, unknown>).mode =
      "dry";
    expect(shapePath(() => parseDataRetentionState(badRun))).toBe("categories[0].last_run.mode");
    expect(shapePath(() => parseDataRetentionState([]))).toBe("$");
  });
});

describe("podgląd, lista do anonimizacji, przebieg, przedłużenie", () => {
  it("podgląd: liczba, sufit i kategoria wyłączona (null)", () => {
    const preview = parseDataRetentionPreview({
      cap: 100000,
      categories: [
        {
          key: "crm_customers",
          mode: "preview",
          count: 0,
          capped: false,
          cutoff: "2024-10-20T18:14:17.727283+00:00",
          enabled: true,
        },
        {
          key: "audit_log",
          mode: "execute",
          count: null,
          capped: false,
          cutoff: null,
          enabled: false,
        },
      ],
    });
    expect(preview.cap).toBe(100000);
    expect(preview.categories[1]).toEqual({
      key: "audit_log",
      mode: "execute",
      count: null,
      capped: false,
      cutoff: null,
      enabled: false,
    });
  });

  it("lista do anonimizacji: kontakt-klient i kontakt bez transakcji", () => {
    const due = parseDataRetentionCrmDue({
      items: [
        {
          lead_id: "6f9e6f6e-0000-4000-8000-0000000000aa",
          email: "anna@example.test",
          first_name: "Anna",
          last_name: null,
          company: null,
          last_activity: "2024-10-01T10:00:00+00:00",
          due_at: "2026-10-31T00:00:00+00:00",
          customer: true,
        },
      ],
      enabled: true,
      enforced: false,
      notice_days: 30,
    });
    expect(due.items[0]).toMatchObject({ firstName: "Anna", lastName: null, customer: true });
    expect(
      shapePath(() =>
        parseDataRetentionCrmDue({ items: [{}], enabled: true, enforced: false, notice_days: 30 }),
      ),
    ).toBe("items[0].lead_id");
  });

  it("wynik przebiegu: kategorie w kolejności katalogu, błąd kategorii i zajętość", () => {
    expect(
      parseDataRetentionRunResult({
        audit_log: { mode: "execute", affected: 3, backlog: false },
        paywall_metering: { error: "57014", mode: "preview" },
      }),
    ).toEqual({
      busy: false,
      categories: [
        { key: "paywall_metering", mode: "preview", affected: null, error: "57014" },
        { key: "audit_log", mode: "execute", affected: 3, error: null },
      ],
    });
    expect(parseDataRetentionRunResult({ busy: true })).toEqual({ busy: true, categories: [] });
    // Kategoria wygaszania zwraca dodatkowe liczniki (requested, deleted,
    // reset) - wynik przebiegu czyta wspólne pola, reszty nie odrzuca.
    expect(
      parseDataRetentionRunResult({
        newsletter_inactive: {
          mode: "execute",
          affected: 5,
          requested: 3,
          deleted: 2,
          reset: 1,
          backlog: false,
          cutoff: "2025-10-20T00:00:00+00:00",
        },
        hologramy: { mode: "execute", affected: 1 },
      }).categories,
    ).toEqual([{ key: "newsletter_inactive", mode: "execute", affected: 5, error: null }]);
    expect(
      parseCrmExtension({ lead_id: "l1", extended_until: "2027-10-20T10:00:00+00:00" }),
    ).toEqual({ leadId: "l1", extendedUntil: "2027-10-20T10:00:00+00:00" });
  });
});

describe("lista „do wygaszenia\" (admin_data_retention_newsletter_due)", () => {
  // Kształt z PRAWDZIWEGO RPC (20261020162100) - cykl wysłany, cykl czekający
  // na wysyłkę i kandydat najbliższego przebiegu.
  const DUE = {
    items: [
      {
        email: "s1@example.test",
        state: "mailed",
        language: "en",
        last_name: null,
        first_name: "Ann",
        mailed_at: "2026-09-01T08:03:00+00:00",
        delete_after: "2026-10-01T08:03:00+00:00",
        mail_outcome: "suppressed",
        requested_at: "2026-09-01T02:07:00+00:00",
        subscriber_id: "6f9e6f6e-0000-4000-8000-0000000000b1",
        last_engaged_at: "2025-06-01T10:00:00+00:00",
      },
      {
        email: "s2@example.test",
        state: "requested",
        language: "pl",
        last_name: "Nowak",
        first_name: null,
        mailed_at: null,
        delete_after: null,
        mail_outcome: null,
        requested_at: "2026-10-22T02:07:00+00:00",
        subscriber_id: "6f9e6f6e-0000-4000-8000-0000000000b2",
        last_engaged_at: "2025-05-01T10:00:00+00:00",
      },
      {
        email: "s3@example.test",
        state: "candidate",
        language: "pl",
        last_name: null,
        first_name: null,
        mailed_at: null,
        delete_after: null,
        mail_outcome: null,
        requested_at: null,
        subscriber_id: "6f9e6f6e-0000-4000-8000-0000000000b3",
        last_engaged_at: "2025-04-01T10:00:00+00:00",
      },
    ],
    counts: { due: 1, mailed: 1, excluded: 1, requested: 1, candidates: 1 },
    cutoff: "2025-10-22T05:00:00+00:00",
    enabled: true,
    enforced: true,
    excluded: [
      {
        email: "partner@example.test",
        reason: "Prenumerata instytucjonalna",
        created_at: "2026-10-20T10:00:00+00:00",
        subscriber_id: "6f9e6f6e-0000-4000-8000-0000000000b4",
      },
    ],
    daily_cap: 200,
    period_months: 12,
    response_days: 30,
    open_tracking_enabled: false,
  };

  it("liczby, etapy, wynik wysyłki, wykluczeni z powodem, reguły i pomiar otwarć", () => {
    const due = parseDataRetentionNewsletterDue(DUE);
    expect(due.counts).toEqual({ candidates: 1, requested: 1, mailed: 1, due: 1, excluded: 1 });
    expect(due.items.map((i) => i.state)).toEqual(["mailed", "requested", "candidate"]);
    expect(due.items[0]).toMatchObject({
      language: "en",
      mailOutcome: "suppressed",
      deleteAfter: "2026-10-01T08:03:00+00:00",
    });
    expect(due.excluded[0]).toEqual({
      subscriberId: "6f9e6f6e-0000-4000-8000-0000000000b4",
      email: "partner@example.test",
      reason: "Prenumerata instytucjonalna",
      createdAt: "2026-10-20T10:00:00+00:00",
    });
    expect(due).toMatchObject({
      responseDays: 30,
      dailyCap: 200,
      openTrackingEnabled: false,
      enabled: true,
      enforced: true,
      periodMonths: 12,
    });
  });

  it("baza bez katalogu Y1 (kategoria nieznana bazie): okres i próg puste, lista pusta", () => {
    const due = parseDataRetentionNewsletterDue({
      ...DUE,
      items: [],
      excluded: [],
      enabled: false,
      enforced: false,
      cutoff: null,
      period_months: null,
    });
    expect(due).toMatchObject({ enabled: false, cutoff: null, periodMonths: null, items: [] });
  });

  it("rozjazd kontraktu: nieznany etap, zły język, wynik spoza CHECK", () => {
    const badState = clone(DUE);
    (badState.items as Record<string, unknown>[])[0].state = "deleted";
    expect(shapePath(() => parseDataRetentionNewsletterDue(badState))).toBe("items[0].state");
    const badLang = clone(DUE);
    (badLang.items as Record<string, unknown>[])[1].language = "de";
    expect(shapePath(() => parseDataRetentionNewsletterDue(badLang))).toBe("items[1].language");
    const badOutcome = clone(DUE);
    (badOutcome.items as Record<string, unknown>[])[0].mail_outcome = "failed";
    expect(shapePath(() => parseDataRetentionNewsletterDue(badOutcome))).toBe(
      "items[0].mail_outcome",
    );
  });

  it("wynik wykluczenia i cofnięcia", () => {
    expect(
      parseNewsletterExclusionResult({
        subscriber_id: "s",
        excluded: true,
        cycle_cancelled: true,
      }),
    ).toEqual({ subscriberId: "s", excluded: true, cycleCancelled: true });
    expect(parseNewsletterExclusionResult({ subscriber_id: "s", excluded: false })).toEqual({
      subscriberId: "s",
      excluded: false,
      cycleCancelled: false,
    });
  });
});

describe("kody błędów RPC -> kod panelu", () => {
  it.each([
    ["42501", "forbidden"],
    ["40001", "conflict"],
    ["P0002", "not_found"],
    ["22023", "invalid"],
    ["23514", "invalid"],
    ["PGRST202", "unavailable"],
    ["57014", "failed"],
  ])("%s -> %s", (code, expected) => {
    expect(mapDataRetentionError({ message: "period_out_of_range", code })).toEqual({
      ok: false,
      error: expected,
      reason: "period_out_of_range",
    });
  });
});

describe("walidator serwera (te same zakresy co CHECK bazy)", () => {
  const TOKEN = "2026-10-20T17:49:38.164871+00:00";

  it("okres spoza zakresu kategorii ODRZUCONY - nigdy przycięty do granicy", () => {
    expect(
      SaveCategorySchema.safeParse({
        category: "email_send_log",
        periodMonths: 5,
        enabled: true,
        expectedUpdatedAt: TOKEN,
      }).success,
    ).toBe(false);
    expect(
      SaveCategorySchema.safeParse({
        category: "audit_log",
        periodMonths: 61,
        enabled: true,
        expectedUpdatedAt: null,
      }).success,
    ).toBe(false);
    const parsed = SaveCategorySchema.parse({
      category: "audit_log",
      periodMonths: 60,
      enabled: false,
      expectedUpdatedAt: TOKEN,
    });
    expect(parsed.periodMonths).toBe(60);
  });

  it("kategoria ustawowa nie jest do zapisu z panelu", () => {
    expect(
      SaveCategorySchema.safeParse({
        category: "consent_log",
        periodMonths: 12,
        enabled: true,
        expectedUpdatedAt: null,
      }).success,
    ).toBe(false);
  });

  it("karencja: włącz teraz albo dzień lokalny; nic więcej", () => {
    expect(EnforcementSchema.parse({ action: "enable_now" })).toEqual({ action: "enable_now" });
    expect(EnforcementSchema.parse({ action: "postpone", until: "2026-11-30" })).toEqual({
      action: "postpone",
      until: "2026-11-30",
    });
    expect(
      EnforcementSchema.safeParse({ action: "postpone", until: "2026-11-30T00:00:00Z" }).success,
    ).toBe(false);
    expect(EnforcementSchema.safeParse({ action: "enable_now", tenantId: "x" }).success).toBe(
      false,
    );
  });

  it("przedłużenie: powód 3-500 znaków po obcięciu brzegów, za długi odrzucony", () => {
    const lead = "6f9e6f6e-0000-4000-8000-0000000000aa";
    expect(ExtendContactSchema.safeParse({ leadId: lead, reason: "  ok " }).success).toBe(false);
    expect(ExtendContactSchema.safeParse({ leadId: lead, reason: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      ExtendContactSchema.safeParse({ leadId: lead, reason: "Negocjacje umowy ramowej" }).success,
    ).toBe(true);
    expect(
      ExtendContactSchema.safeParse({ leadId: "nie-uuid", reason: "Negocjacje" }).success,
    ).toBe(false);
  });
});
