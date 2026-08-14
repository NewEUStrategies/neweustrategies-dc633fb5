// Trasa `/checkout/cancel` - sklejenie, a nie sam widok.
//
// Ta trasa jest ostatnim przystankiem kupującego, który przerwał płatność:
// operator odsyła go tu z `?order=<id>`. Ryzyka mieszkają WYŁĄCZNIE w warstwie
// sklejenia, dlatego test montuje prawdziwą trasę w routerze pamięciowym:
//   1. `validateSearch` musi przepuścić `order` i ODRZUCIĆ każdą inną formę
//      (powtórzony klucz, obiekt) - inaczej cudzy payload wchodzi do stanu trasy,
//   2. strona anulowania nie może trafić do indeksu wyszukiwarki (`noindex`),
//   3. wyjście z lejka musi prowadzić do cennika, a nie donikąd,
//   4. treść jest dwujęzyczna (PL/EN) - kupujący EN nie może zobaczyć polskiego
//      komunikatu o nieudanej płatności.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as CancelRoute } from "@/routes/checkout.cancel";

const PATH = "/checkout/cancel";

async function mount(entry = PATH) {
  return renderRoute({ route: CancelRoute, path: PATH, initialEntry: entry });
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /checkout/cancel", () => {
  it("montuje się pod własną ścieżką i renderuje komunikat anulowania (PL)", async () => {
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Płatność anulowana");
    expect(screen.getByText(/Nie pobraliśmy żadnych środków/)).toBeInTheDocument();
  });

  it("przepuszcza `order` przez validateSearch", async () => {
    const view = await mount(`${PATH}?order=ord_42`);

    expect(view.search().order).toBe("ord_42");
  });

  it("odrzuca `order` w formie innej niż pojedynczy string", async () => {
    // Powtórzony klucz parsuje się do tablicy, a wartość w formie JSON-a do
    // obiektu - walidator ma w obu wypadkach zwrócić `undefined`, żeby dalej
    // w trasie `order` był zawsze stringiem albo niczym.
    const repeated = await mount(`${PATH}?order=a&order=b`);
    expect(repeated.search().order).toBeUndefined();
    cleanup();

    const structured = await mount(`${PATH}?order=${encodeURIComponent('{"id":"ord_1"}')}`);
    expect(structured.search().order).toBeUndefined();
  });

  it("nie wpuszcza wyszukiwarek na stronę płatności", async () => {
    const view = await mount(`${PATH}?order=ord_42`);

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("wyprowadza z lejka linkiem do cennika", async () => {
    await mount();

    const back = screen.getByRole("link", { name: "Wróć do cennika" });
    expect(back).toHaveAttribute("href", "/pricing");
  });

  it("mówi po angielsku, gdy język interfejsu to EN", async () => {
    await i18n.changeLanguage("en");
    await mount(`${PATH}?order=ord_42`);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payment canceled");
    expect(screen.getByRole("link", { name: "Back to pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });
});
