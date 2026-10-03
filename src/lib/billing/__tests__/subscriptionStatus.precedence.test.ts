// Pierwszeństwo źródeł w czytelnym statusie subskrypcji: operator, wiersz
// lokalny i nadania (`membership_grants`).
//
// Ryzyko, które przypinamy: klient z PRAWEM do treści (dożywotni VIP eksperta,
// nadanie czasowe) albo z opłaconym okresem widzi na karcie „brak subskrypcji"
// lub „wstrzymana" - i kupuje drugi raz to, co już ma. Odwrotny błąd jest tak
// samo groźny: subskrypcja z nieukończoną pierwszą płatnością (`incomplete`)
// albo zwrócona (`refunded`) nie może wyglądać jak aktywna.
//
// `now` podajemy jawnie (moduł jest czysty), a zegar i tak jest zamrożony -
// daty w fixture'ach liczymy względem `FIXED_NOW`, więc przebieg za rok jest
// tym samym przebiegiem co dziś.
import { describe, expect, it } from "vitest";

import { DZIEN, FIXED_NOW_MS, freezeClock, relativeIso } from "@/test/time";
import { deriveSubscriptionStatus, type AccessGrantInput } from "@/lib/billing/subscriptionStatus";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";
import type { UserSubscriptionRow } from "@/lib/billing/types";

freezeClock();

const NOW = FIXED_NOW_MS;
const FUTURE = relativeIso(30 * DZIEN);
const PAST = relativeIso(-30 * DZIEN);
/**
 * Koniec nadania CELOWO inny niż koniec okresu subskrypcji (`FUTURE`) - przy
 * równych datach test nie odróżniłby „data nadania" od „data okresu".
 */
const GRANT_END = relativeIso(90 * DZIEN);

const LIFETIME_VIP: AccessGrantInput = { tierKey: "vip", expiresAt: null, source: "expert" };
const SUPPORTER: AccessGrantInput = {
  tierKey: "supporter",
  expiresAt: GRANT_END,
  source: "donation",
};

function provider(patch: Partial<StripeSubscriptionRow> = {}): StripeSubscriptionRow {
  return {
    id: "row-1",
    provider_subscription_id: "sub_1",
    provider_customer_id: "cus_1",
    product_id: "plan_plus",
    price_id: "plus_monthly",
    status: "active",
    quantity: 1,
    current_period_start: PAST,
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    environment: "sandbox",
    created_at: PAST,
    ...patch,
  };
}

function local(patch: Partial<UserSubscriptionRow> = {}): UserSubscriptionRow {
  return {
    id: "local-1",
    user_id: "user-me",
    plan_id: "plan-member-monthly",
    status: "active",
    started_at: PAST,
    current_period_end: FUTURE,
    canceled_at: null,
    ...patch,
  };
}

describe("subskrypcja wstrzymana u operatora a nadanie", () => {
  it("dożywotni VIP przykrywa wstrzymaną subskrypcję - klient nie widzi „wstrzymana”", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: provider({ status: "paused" }),
      grants: [LIFETIME_VIP],
      now: NOW,
    });

    expect(view).toEqual({
      key: "grantLifetime",
      tone: "success",
      renewsAt: null,
      endsAt: null,
      hasAccess: true,
      grant: LIFETIME_VIP,
    });
  });

  it("nadanie czasowe przy wstrzymaniu pokazuje SWOJĄ datę wygaśnięcia", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: provider({ status: "paused" }),
      grants: [SUPPORTER],
      now: NOW,
    });

    expect(view.key).toBe("grantActive");
    // Data NADANIA, nie koniec okresu wstrzymanej subskrypcji (`FUTURE`).
    expect(view.endsAt).toBe(GRANT_END);
    expect(view.renewsAt).toBeNull();
    expect(view.hasAccess).toBe(true);
    expect(view.grant).toEqual(SUPPORTER);
  });

  it("przy kilku nadaniach wygrywa dożywotnie, nie pierwsze na liście", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: null,
      grants: [SUPPORTER, LIFETIME_VIP],
      now: NOW,
    });

    expect(view.key).toBe("grantLifetime");
    expect(view.grant).toEqual(LIFETIME_VIP);
  });
});

describe("status operatora spoza słownika (incomplete) - decyduje wiersz lokalny", () => {
  it("nieukończona pierwsza płatność bez wiersza lokalnego to „brak subskrypcji” bez dostępu", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: provider({ status: "incomplete" }),
      now: NOW,
    });

    expect(view.key).toBe("none");
    expect(view.hasAccess).toBe(false);
    expect(view.renewsAt).toBeNull();
  });

  it("przy `incomplete` z aktywnym wierszem lokalnym status bierze się z wiersza lokalnego", () => {
    const view = deriveSubscriptionStatus({
      local: local(),
      provider: provider({ status: "incomplete" }),
      now: NOW,
    });

    expect(view.key).toBe("active");
    expect(view.renewsAt).toBe(FUTURE);
    expect(view.hasAccess).toBe(true);
  });
});

describe("wiersz lokalny anulowany a nadanie", () => {
  it("po końcu opłaconego okresu nadanie zastępuje „anulowanie zaplanowane”", () => {
    const view = deriveSubscriptionStatus({
      local: local({ status: "canceled", current_period_end: PAST }),
      provider: null,
      grants: [LIFETIME_VIP],
      now: NOW,
    });

    expect(view.key).toBe("grantLifetime");
    expect(view.hasAccess).toBe(true);
  });

  it("W TRAKCIE opłaconego okresu klient widzi datę końca subskrypcji, nie nadanie", () => {
    const view = deriveSubscriptionStatus({
      local: local({ canceled_at: PAST }),
      provider: null,
      grants: [LIFETIME_VIP],
      now: NOW,
    });

    expect(view.key).toBe("cancelScheduled");
    expect(view.endsAt).toBe(FUTURE);
    expect(view.renewsAt).toBeNull();
    expect(view.hasAccess).toBe(true);
    expect(view.grant).toBeNull();
  });

  // Po końcu okresu NIE ma już czego „planować" - badge „anulowanie
  // zaplanowane" z datą wygaśnięcia sprzed miesiąca myliłby klienta.
  it("anulowanie lokalne po końcu okresu i bez nadania to „anulowana” bez dostępu", () => {
    const view = deriveSubscriptionStatus({
      local: local({ status: "canceled", current_period_end: PAST }),
      provider: null,
      now: NOW,
    });

    expect(view.key).toBe("canceled");
    expect(view.tone).toBe("muted");
    expect(view.hasAccess).toBe(false);
    expect(view.renewsAt).toBeNull();
    expect(view.endsAt).toBe(PAST);
    expect(view.grant).toBeNull();
  });

  it("lokalne anulowanie (sam `canceled_at` przy statusie `active`) po końcu okresu to „anulowana”", () => {
    // Tak zapisuje lokalna ścieżka anulowania: status zostaje `active`,
    // dochodzi tylko `canceled_at`, a nic potem nie przestawia wiersza.
    const view = deriveSubscriptionStatus({
      local: local({ canceled_at: PAST, current_period_end: PAST }),
      provider: null,
      now: NOW,
    });

    expect(view.key).toBe("canceled");
    expect(view.hasAccess).toBe(false);
    expect(view.endsAt).toBe(PAST);
  });

  it("anulowanie wiersza BEZ daty końca okresu (zakup bezterminowy) nie zamienia się w „anulowaną”", () => {
    // `has_content_access()` czyta pusty `current_period_end` jako dostęp bez
    // końca i nie patrzy na `canceled_at` - klient dalej czyta treści, więc
    // „anulowana” byłaby nieprawdą. „Po końcu okresu” wymaga DATY końca.
    const view = deriveSubscriptionStatus({
      local: local({ canceled_at: PAST, current_period_end: null }),
      provider: null,
      now: NOW,
    });

    expect(view.key).toBe("cancelScheduled");
    expect(view.renewsAt).toBeNull();
    expect(view.endsAt).toBeNull();
  });
});

describe("wiersz lokalny wygasły albo zwrócony", () => {
  it.each(["expired", "refunded"] as const)(
    "status `%s` to subskrypcja zakończona - bez dostępu i bez daty odnowienia",
    (status) => {
      const view = deriveSubscriptionStatus({
        local: local({ status, current_period_end: FUTURE }),
        provider: null,
        now: NOW,
      });

      expect(view.key).toBe("canceled");
      expect(view.tone).toBe("muted");
      expect(view.hasAccess).toBe(false);
      expect(view.renewsAt).toBeNull();
    },
  );

  it("zwrot pieniędzy nie odbiera prawa wynikającego z nadania", () => {
    const view = deriveSubscriptionStatus({
      local: local({ status: "refunded" }),
      provider: null,
      grants: [SUPPORTER],
      now: NOW,
    });

    expect(view.key).toBe("grantActive");
    expect(view.hasAccess).toBe(true);
    // Zwrócona subskrypcja kończyła się w `FUTURE` - liczy się data nadania.
    expect(view.endsAt).toBe(GRANT_END);
  });
});

describe("wiersz lokalny aktywny - daty okresu", () => {
  it("aktywny wiersz BEZ daty końca okresu (dostęp bezterminowy) zachowuje dostęp", () => {
    const view = deriveSubscriptionStatus({
      local: local({ current_period_end: null }),
      provider: null,
      now: NOW,
    });

    expect(view.key).toBe("active");
    expect(view.hasAccess).toBe(true);
    expect(view.renewsAt).toBeNull();
    expect(view.endsAt).toBeNull();
  });

  // Wiersz z minionym końcem okresu nikt nie przestawia na `expired`, więc
  // status musi wynikać z daty: zielone „Aktywna" z „Odnawia się" w
  // przeszłości przeczyłoby brakowi dostępu.
  it("aktywny wiersz z minionym końcem okresu to „anulowana” bez dostępu i bez odnowienia", () => {
    const view = deriveSubscriptionStatus({
      local: local({ current_period_end: PAST }),
      provider: null,
      now: NOW,
    });

    expect(view.key).toBe("canceled");
    expect(view.tone).toBe("muted");
    expect(view.hasAccess).toBe(false);
    expect(view.renewsAt).toBeNull();
    expect(view.endsAt).toBe(PAST);
  });

  it("aktywny wiersz z minionym okresem ustępuje nadaniu, które wciąż trwa", () => {
    const view = deriveSubscriptionStatus({
      local: local({ current_period_end: PAST }),
      provider: null,
      grants: [SUPPORTER],
      now: NOW,
    });

    expect(view.key).toBe("grantActive");
    expect(view.hasAccess).toBe(true);
    expect(view.endsAt).toBe(GRANT_END);
  });

  it("nieczytelna data końca okresu nie jest traktowana jak przyszła", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: provider({ status: "canceled", current_period_end: "nie-data" }),
      now: NOW,
    });

    expect(view.key).toBe("canceled");
    expect(view.hasAccess).toBe(false);
  });

  it("bez jawnego `now` liczy względem bieżącego (zamrożonego) zegara", () => {
    const view = deriveSubscriptionStatus({
      local: null,
      provider: provider({ status: "canceled", current_period_end: relativeIso(DZIEN) }),
    });

    expect(view.key).toBe("canceled");
    expect(view.hasAccess).toBe(true);
    expect(view.endsAt).toBe(relativeIso(DZIEN));
  });
});
