// Linki lejka (P15): `next` wyłącznie jako ścieżka względna w serwisie.
//
// Każdy wektor open redirect z karty S3 ma tu własny przypadek: `//evil.com`,
// `https://…`, `/\evil`, `%2F%2F` (także podwójnie zakodowane) - i pętle
// logowania, które zostawiłyby czytelnika na `/login` po zalogowaniu.
import { afterEach, describe, expect, it } from "vitest";
import {
  currentReturnPath,
  loginHref,
  loginSearch,
  parseLoginSearch,
  postLoginTarget,
  safeNextPath,
  signupRedirectPath,
  signupSourceForIntent,
} from "@/lib/access/paywallLinks";

const PLAN = "3f2b6a10-9c1d-4e5f-8a7b-1c2d3e4f5a6b";

describe("safeNextPath - odrzuca wszystko poza ścieżką względną", () => {
  it.each([
    ["//evil.com"],
    ["https://evil.com/artykul"],
    ["http://evil.com"],
    ["/\\evil.com"],
    ["\\\\evil.com"],
    ["%2F%2Fevil.com"],
    ["/%2F%2Fevil.com"],
    ["/%252F%252Fevil.com"],
    ["/%5Cevil.com"],
    ["javascript:alert(1)"],
    ["/javascript:alert(1)"],
    ["evil.com"],
    ["/arty kul"],
    ["/artykul\nSet-Cookie: x"],
    ["/login?next=/x"],
    ["/auth/callback"],
    ["/reset-password"],
    [""],
    [null],
    [42],
    ["/" + "a".repeat(400)],
  ])("%s -> null", (input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it.each([
    ["/artykul-o-europie"],
    ["/en/article?tab=2#sekcja"],
    ["/pricing?audience=b2c"],
    ["/club/rada/about"],
  ])("%s -> bez zmian", (input) => {
    expect(safeNextPath(input)).toBe(input);
  });
});

describe("parseLoginSearch", () => {
  it("przepuszcza tryb, bezpieczny next, intencję i uuid planu", () => {
    expect(
      parseLoginSearch({ mode: "signup", next: "/artykul", intent: "paywall", plan: PLAN }),
    ).toEqual({ mode: "signup", next: "/artykul", intent: "paywall", plan: PLAN });
  });

  it("odrzuca złe wartości pole po polu (bez wyjątku)", () => {
    expect(
      parseLoginSearch({ mode: "admin", next: "//evil.com", intent: "hack", plan: "1 OR 1=1" }),
    ).toEqual({});
  });
});

describe("budowanie linków", () => {
  it("loginSearch pomija puste pola i niebezpieczny next", () => {
    expect(loginSearch({ mode: "signin", next: null })).toEqual({ mode: "signin" });
    expect(loginSearch({ mode: "signup", next: "//evil.com", intent: "meter" })).toEqual({
      mode: "signup",
      intent: "meter",
    });
  });

  it("loginHref koduje next jako parametr", () => {
    expect(loginHref("signup", "/a?b=1", "paywall", PLAN)).toBe(
      `/login?mode=signup&next=%2Fa%3Fb%3D1&intent=paywall&plan=${PLAN}`,
    );
  });

  it("postLoginTarget: next, potem kasa planu, potem strona główna", () => {
    expect(postLoginTarget({ next: "/artykul", plan: PLAN })).toBe("/artykul");
    expect(postLoginTarget({ plan: PLAN })).toBe(`/checkout/${PLAN}`);
    expect(postLoginTarget({ next: "//evil.com" })).toBe("/");
    expect(postLoginTarget({}, "/profil")).toBe("/profil");
  });

  it("signupRedirectPath prowadzi przez /auth/callback z next", () => {
    expect(signupRedirectPath("/artykul", "/")).toBe("/auth/callback?next=%2Fartykul");
    expect(signupRedirectPath("//evil.com", "/")).toBe("/");
    expect(signupRedirectPath(undefined, "/start")).toBe("/start");
  });

  it("źródło rejestracji z intencji = biała lista account.registered.v1", () => {
    expect(signupSourceForIntent("paywall")).toBe("paywall");
    expect(signupSourceForIntent("meter")).toBe("paywall");
    expect(signupSourceForIntent("pricing")).toBe("pricing");
    expect(signupSourceForIntent("checkout")).toBe("checkout");
    expect(signupSourceForIntent("club")).toBe("club_gate");
    expect(signupSourceForIntent(undefined)).toBe("auth_page");
  });
});

describe("currentReturnPath", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("bieżąca ścieżka z zapytaniem i kotwicą", () => {
    window.history.replaceState(null, "", "/artykul?x=1#s2");
    expect(currentReturnPath()).toBe("/artykul?x=1#s2");
  });

  it("na /login nie wskazuje samego siebie", () => {
    window.history.replaceState(null, "", "/login?mode=signin");
    expect(currentReturnPath()).toBeUndefined();
  });
});
