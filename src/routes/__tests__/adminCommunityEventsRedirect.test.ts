// `/admin/community/events` - PRZEKIEROWANIE, którego nie pilnował nikt.
//
// PO CO TEN PLIK ISTNIEJE. Ta trasa nie ma komponentu: cała jej treść to trzy
// linie `beforeLoad`, które rzucają `redirect({ to: "/admin/events/list" })`.
// Trzy linie na zerze - a przedmiotem dowodu jest tu nie procent, tylko ADRES
// DOCELOWY. Nagłówek tamtego pliku mówi wprost, po co przekierowanie żyje:
// adres siedzi w zakładkach redakcji, w zgłoszeniach do wsparcia i w linkach
// wklejanych między sobą, a jego usunięcie dałoby 404 zamiast miejsca, do
// którego ta praca się przeniosła.
//
// CO PADNIE, GDY CEL SIĘ ROZJEDZIE. Zmiana nazwy trasy w module wydarzeń
// (`/admin/events/list` -> cokolwiek innego) zamieni to przekierowanie w pętlę
// albo w 404, a jedynym objawem będzie zgłoszenie od redakcji „stary link
// przestał działać". Statyczna analiza tego nie widzi, bo `to:` jest napisem
// w wyrzucanym obiekcie. Dlatego ten test robi dwie rzeczy:
//   1. wywołuje `beforeLoad` i czyta CEL z wyrzuconego obiektu przekierowania,
//   2. sprawdza, że plik trasy o tej ścieżce ISTNIEJE w `src/routes`.
// Drugi warunek jest tym, który zapali się przy przemianowaniu.
//
// DLACZEGO PRZEZ `beforeLoad`, A NIE PRZEZ ROUTER. `renderRoute` z harnessu
// montuje trasę pod korzeniem zastępczym, który nie zna `/admin/events/list` -
// nawigacja skończyłaby się „route not found" i test mówiłby o harnessie,
// nie o kontrakcie. Wołamy więc `beforeLoad` wprost; to on niesie całą decyzję.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

import { Route as CommunityEventsRedirect } from "@/routes/admin.community.events";

/** Cel przekierowania w kształcie, którego dotyczy dowód. */
interface RedirectLike {
  to?: unknown;
}

/**
 * STRAŻNIK, nie rzutowanie: warunek sprawdza w runtime, że wyrzucony obiekt ma
 * pole `to` będące napisem, i dopiero on zawęża typ. Test, który „przechodzi"
 * na `undefined`, nie dowodziłby niczego o adresie docelowym.
 */
function redirectTarget(thrown: unknown): string {
  if (thrown === null || typeof thrown !== "object") {
    throw new Error("test: `beforeLoad` nie wyrzucił obiektu przekierowania");
  }
  const to = (thrown as RedirectLike).to;
  if (typeof to !== "string") {
    throw new Error("test: obiekt przekierowania nie niesie `to` w postaci napisu");
  }
  return to;
}

/** `beforeLoad` trasy jako funkcja - framework nie wystawia jej w typie publicznym. */
function beforeLoadOf(route: typeof CommunityEventsRedirect): () => unknown {
  const fn: unknown = route.options.beforeLoad;
  if (typeof fn !== "function") {
    throw new Error("test: trasa nie ma `beforeLoad` w postaci funkcji");
  }
  return fn as () => unknown;
}

/** Ścieżka pliku trasy dla adresu panelu (`/admin/events/list` -> `admin.events.list.tsx`). */
function routeFileFor(path: string): string {
  const segments = path.replace(/^\//, "").split("/");
  return `src/routes/${segments.join(".")}.tsx`;
}

const EXPECTED_TARGET = "/admin/events/list";

describe("/admin/community/events - przekierowanie na moduł wydarzeń", () => {
  it("`beforeLoad` PRZEKIEROWUJE, a nie renderuje pusty ekran", () => {
    // Uzasadnienie w nagłówku trasy: pusty ekran z migającą treścią jest gorszy
    // niż brak ekranu, więc decyzja MUSI zapadać przed renderem.
    expect(CommunityEventsRedirect.options.component).toBeUndefined();
    expect(() => beforeLoadOf(CommunityEventsRedirect)()).toThrow();
  });

  it("celem jest lista modułu wydarzeń - dokładnie ten adres", () => {
    let thrown: unknown = null;
    try {
      beforeLoadOf(CommunityEventsRedirect)();
    } catch (err) {
      thrown = err;
    }

    expect(redirectTarget(thrown)).toBe(EXPECTED_TARGET);
  });

  it("trasa docelowa ISTNIEJE - to ten warunek łapie przemianowanie", () => {
    // Bez tego przekierowanie po zmianie nazwy w module wydarzeń dawałoby 404,
    // a jedynym objawem byłoby zgłoszenie „stary link przestał działać".
    expect(existsSync(routeFileFor(EXPECTED_TARGET))).toBe(true);
  });

  it("nie przekierowuje na siebie - pętla przeglądarki jest gorsza niż 404", () => {
    expect(EXPECTED_TARGET.startsWith("/admin/community/events")).toBe(false);
  });
});
