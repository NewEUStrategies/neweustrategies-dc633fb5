// Testy czystej logiki "Udostepnij pelny artykul": budowa/parsowanie URL-i,
// budzet klikniec, macierz faz popovera, mapowanie bledow RPC i powodow
// odmowy na warianty banera. Zero DOM/Supabase.
import { describe, it, expect } from "vitest";
import {
  buildGiftShareTargets,
  buildGiftUrl,
  GIFT_QUERY_PARAM,
  giftBannerVariant,
  giftClickBudget,
  isValidGiftCode,
  mapGiftError,
  normalizeGiftEligibility,
  normalizeRedeemReason,
  parseGiftCode,
  resolveGiftPhase,
  type GiftArticleState,
} from "@/lib/gifting/model";

const CODE = "abcDEF123_-xyzABC456pqr";

function state(partial: Partial<GiftArticleState>): GiftArticleState {
  return {
    enabled: true,
    canGift: true,
    requiresAuth: false,
    requiresSubscription: false,
    used: 0,
    monthlyLimit: 0,
    remaining: null,
    existingCode: null,
    expiresAt: null,
    eligibility: "registered",
    budget: giftClickBudget(0, 5),
    ...partial,
  };
}

describe("isValidGiftCode / parseGiftCode", () => {
  it("akceptuje kod base64url i odrzuca smieci", () => {
    expect(isValidGiftCode(CODE)).toBe(true);
    expect(isValidGiftCode("")).toBe(false);
    expect(isValidGiftCode(null)).toBe(false);
    expect(isValidGiftCode("za krotki")).toBe(false);
    expect(isValidGiftCode("ma spacje i polskie znaki ążź")).toBe(false);
    expect(isValidGiftCode("x".repeat(65))).toBe(false);
  });

  it("wyciaga kod z location.search (z ? i bez)", () => {
    expect(parseGiftCode(`?${GIFT_QUERY_PARAM}=${CODE}`)).toBe(CODE);
    expect(parseGiftCode(`${GIFT_QUERY_PARAM}=${CODE}&utm_source=nl`)).toBe(CODE);
    expect(parseGiftCode("")).toBeNull();
    expect(parseGiftCode("?other=1")).toBeNull();
    expect(parseGiftCode(`?${GIFT_QUERY_PARAM}=%%%`)).toBeNull();
  });
});

describe("buildGiftUrl", () => {
  it("dokleja parametr gift do czystego URL-a", () => {
    expect(buildGiftUrl("https://example.org/analizy/wpis", CODE)).toBe(
      `https://example.org/analizy/wpis?gift=${CODE}`,
    );
  });

  it("zachowuje istniejace parametry i hash, nadpisuje stary kod", () => {
    const url = buildGiftUrl(`https://example.org/a?x=1&gift=stary_kod_123#sekcja`, CODE);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("x")).toBe("1");
    expect(parsed.searchParams.get("gift")).toBe(CODE);
    expect(parsed.hash).toBe("#sekcja");
  });

  it("dla niepoprawnej bazy zwraca ja bez zmian (bez wyjatku)", () => {
    expect(buildGiftUrl("nie-url", CODE)).toBe("nie-url");
  });
});

describe("buildGiftShareTargets", () => {
  const targets = buildGiftShareTargets({
    url: `https://example.org/wpis?gift=${CODE}`,
    title: "Tytuł & spółka",
    emailSubject: "Artykuł dla Ciebie",
    emailBody: `Czytaj tu: https://example.org/wpis?gift=${CODE}`,
  });

  it("zwraca komplet kanalow platformy w stalej kolejnosci", () => {
    expect(targets.map((t) => t.id)).toEqual([
      "mail",
      "facebook",
      "linkedin",
      "whatsapp",
      "telegram",
      "x",
      "reddit",
    ]);
  });

  it("koduje URL i tytul w intentach", () => {
    const x = targets.find((t) => t.id === "x");
    expect(x?.href).toContain(encodeURIComponent(`https://example.org/wpis?gift=${CODE}`));
    expect(x?.href).toContain(encodeURIComponent("Tytuł & spółka"));
    const mail = targets.find((t) => t.id === "mail");
    expect(mail?.href.startsWith("mailto:?subject=")).toBe(true);
    expect(mail?.href).toContain(encodeURIComponent("Artykuł dla Ciebie"));
  });
});

describe("resolveGiftPhase", () => {
  it("wylaczona funkcja wygrywa ze wszystkim", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: false,
        state: state({}),
        stateLoading: false,
      }),
    ).toBe("disabled");
  });

  it("gosc dostaje CTA logowania bez czekania na RPC", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: false,
        settingsEnabled: true,
        state: null,
        stateLoading: false,
      }),
    ).toBe("requiresAuth");
  });

  it("zalogowany bez stanu = loading", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: null,
        stateLoading: true,
      }),
    ).toBe("loading");
  });

  it("zalogowany bez platnej subskrypcji dostaje CTA planow", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({ canGift: false, requiresSubscription: true }),
        stateLoading: false,
      }),
    ).toBe("requiresSubscription");
  });

  it("wyczerpany limit blokuje nowe wpisy...", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({ monthlyLimit: 5, used: 5, remaining: 0 }),
        stateLoading: false,
      }),
    ).toBe("limitReached");
  });

  it("...ale istniejacy kod dla wpisu nadal pozwala udostepniac (bez konsumpcji)", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({ monthlyLimit: 5, used: 5, remaining: 0, existingCode: CODE }),
        stateLoading: false,
      }),
    ).toBe("ready");
  });

  it("wyczerpany budzet klikniec linku wygrywa z istniejacym kodem", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({ existingCode: CODE, budget: giftClickBudget(5, 5) }),
        stateLoading: false,
      }),
    ).toBe("budgetExhausted");
  });

  it("link z wolnym budzetem zostaje w fazie ready", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({ existingCode: CODE, budget: giftClickBudget(4, 5) }),
        stateLoading: false,
      }),
    ).toBe("ready");
  });

  it("subskrybent bez limitu = ready", () => {
    expect(
      resolveGiftPhase({
        isLoggedIn: true,
        settingsEnabled: true,
        state: state({}),
        stateLoading: false,
      }),
    ).toBe("ready");
  });
});

describe("mapGiftError", () => {
  it("mapuje wyjatki SQL na klucze domenowe", () => {
    expect(mapGiftError("gift_auth_required")).toBe("authRequired");
    expect(mapGiftError('error: "gift_subscription_required"')).toBe("subscriptionRequired");
    expect(mapGiftError("gift_limit_reached")).toBe("limitReached");
    expect(mapGiftError("gift_disabled")).toBe("disabled");
    expect(mapGiftError("gift_post_not_found")).toBe("notFound");
    expect(mapGiftError("gift_post_not_gated")).toBe("notGated");
    expect(mapGiftError("cokolwiek innego")).toBe("unknown");
    expect(mapGiftError(null)).toBe("unknown");
  });
});

describe("giftClickBudget", () => {
  it("liczy pozostale otwarcia i wykrywa wyczerpanie", () => {
    expect(giftClickBudget(0, 5)).toEqual({
      used: 0,
      limit: 5,
      remaining: 5,
      exhausted: false,
      unlimited: false,
    });
    expect(giftClickBudget(3, 5).remaining).toBe(2);
    expect(giftClickBudget(5, 5).exhausted).toBe(true);
  });

  it("nie schodzi ponizej zera, gdy serwer przeskoczyl limit", () => {
    const budget = giftClickBudget(9, 5);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it("limit 0 znaczy bez limitu - nigdy nie jest wyczerpany", () => {
    const budget = giftClickBudget(120, 0);
    expect(budget.unlimited).toBe(true);
    expect(budget.remaining).toBeNull();
    expect(budget.exhausted).toBe(false);
  });

  it("odsiewa wartosci ujemne i ulamkowe (obrona przed smieciem z RPC)", () => {
    expect(giftClickBudget(-3, 5).used).toBe(0);
    expect(giftClickBudget(2.7, 5.9).limit).toBe(5);
    expect(giftClickBudget(2.7, 5.9).used).toBe(2);
  });
});

describe("normalizeGiftEligibility", () => {
  it("zawezia surowa wartosc, nieznana traktuje jak rejestracyjna", () => {
    expect(normalizeGiftEligibility("subscribers")).toBe("subscribers");
    expect(normalizeGiftEligibility("registered")).toBe("registered");
    expect(normalizeGiftEligibility("cokolwiek")).toBe("registered");
    expect(normalizeGiftEligibility(null)).toBe("registered");
  });
});

describe("normalizeRedeemReason / giftBannerVariant", () => {
  it("zawezia powod z RPC (nieznany = invalid)", () => {
    expect(normalizeRedeemReason("exhausted")).toBe("exhausted");
    expect(normalizeRedeemReason("owner")).toBe("owner");
    expect(normalizeRedeemReason("kosmos")).toBe("invalid");
    expect(normalizeRedeemReason(undefined)).toBe("invalid");
  });

  it("kazdy powod odmowy ma WLASNY baner (nie zlewa sie w 'invalid')", () => {
    expect(giftBannerVariant("ok")).toBe("gifted");
    expect(giftBannerVariant("owner")).toBe("gifted");
    expect(giftBannerVariant("entitled")).toBe("gifted");
    expect(giftBannerVariant("exhausted")).toBe("exhausted");
    expect(giftBannerVariant("expired")).toBe("expired");
    expect(giftBannerVariant("revoked")).toBe("invalid");
    expect(giftBannerVariant("invalid")).toBe("invalid");
  });
});
