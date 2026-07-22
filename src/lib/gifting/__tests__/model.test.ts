// Testy czystej logiki Gift Articles: budowa/parsowanie URL-i podarunkowych,
// macierz faz popovera i mapowanie bledow RPC. Zero DOM/Supabase.
import { describe, it, expect } from "vitest";
import {
  buildGiftShareTargets,
  buildGiftUrl,
  GIFT_QUERY_PARAM,
  isValidGiftCode,
  mapGiftError,
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
    expect(mapGiftError("cokolwiek innego")).toBe("unknown");
    expect(mapGiftError(null)).toBe("unknown");
  });
});
