/**
 * Reguła podziału tras (`scripts/lib/routeCodeSplitting.ts`) - kontrakt,
 * którego dotąd nie pilnował żaden test, a który decyduje o zawartości chunku
 * wejściowego dla KAŻDEGO odwiedzającego.
 *
 * DLACZEGO TEST, SKORO TO TRZY LINIE. Lista wyjątków ma naturalną tendencję do
 * rośnięcia („ta trasa też jest ważna"): 2026-10-02 pięć pozornie tanich
 * wyjątków (`/blog`, `/post/`, `/category/`, `/tag/`, `/author/`) kosztowało
 * ~75 KB kodu przed minifikacją w entry. Test przypina ZAMKNIĘTĄ listę
 * gorących ścieżek i dowodzi na kontrprzykładach, że archiwa i profile autora
 * są dzielone jak każda inna trasa.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */
import { describe, expect, it } from "vitest";
import { routeSplitBehavior } from "../../../../scripts/lib/routeCodeSplitting";

const SPLIT_ALL = [["loader"], ["component"], ["errorComponent"], ["notFoundComponent"]];

describe("routeSplitBehavior - zamknięta lista gorących ścieżek", () => {
  it.each(["__root__", "/", "/$", "/en", "/en/", "/en/$"])(
    "%s zostaje w całości w chunku wejściowym",
    (routeId) => {
      expect(routeSplitBehavior({ routeId })).toBeUndefined();
    },
  );

  it.each([
    "/blog/",
    "/post/$slug",
    "/category/$slug",
    "/tag/$slug",
    "/author/$slug",
    "/search",
    "/club/",
    "/admin/settings",
  ])("%s jest dzielony na loader/komponenty", (routeId) => {
    expect(routeSplitBehavior({ routeId })).toEqual(SPLIT_ALL);
  });

  it("prefiks `/en` nie łapie tras, które tylko zaczynają się od tych liter", () => {
    expect(routeSplitBehavior({ routeId: "/english-digest" })).toEqual(SPLIT_ALL);
    expect(routeSplitBehavior({ routeId: "/events/" })).toEqual(SPLIT_ALL);
  });

  it("kokpit `/admin/` trzyma loader w grupie z komponentem, a reszta panelu nie", () => {
    // Loader i komponent dzielą dynamiczny import pulpitu analityki. Osobne
    // grupy wydzielały go do mikromodułu `tsr-shared`, który Rollup doklejał do
    // przypadkowego (także publicznego) chunku - patrz komentarz reguły.
    expect(routeSplitBehavior({ routeId: "/admin/" })).toEqual([
      ["loader", "component"],
      ["errorComponent"],
      ["notFoundComponent"],
    ]);
    expect(routeSplitBehavior({ routeId: "/admin/analytics" })).toEqual(SPLIT_ALL);
  });

  it("splitter nie dzieli `pendingComponent` - szkielet pokazuje się bez skoku po chunk", () => {
    // Celowo: pending jest widoczny PRZED załadowaniem komponentu, więc jego
    // wydzielenie dodałoby round-trip dokładnie tam, gdzie ma go zasłaniać.
    const groups = routeSplitBehavior({ routeId: "/organization/$slug" }) ?? [];
    expect(groups.flat()).not.toContain("pendingComponent");
  });
});
