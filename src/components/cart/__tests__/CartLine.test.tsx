// Molekuła koszyka: JEDEN WIERSZ listy zakupowej.
//
// CO TU JEST PRZYPINANE. `CartLine` jest czystą prezentacją - nie zna sklepu
// ani Stripe'a, dostaje gotowe napisy i dwie procedury. Dowodzić trzeba więc
// trzech rzeczy, których nie widać w typach:
//
//   1. CENA JEST WYPISYWANA CO DO ZNAKU. Wołający podaje kwotę już
//      sformatowaną (`formatMoney`), więc każda ingerencja tej molekuły
//      w napis (obcięcie, dopisanie waluty, zaokrąglenie) byłaby kwotą
//      inną niż ta, którą zobaczy kupujący w kasie. Asercja jest na
//      DOKŁADNYM tekście węzła ceny, nie na `toContain`.
//
//   2. DWA DZIAŁANIA SĄ ROZŁĄCZNE. „Zapłać" nie może przy okazji usuwać
//      pozycji, a kosz nie może otwierać kasy. Mierzymy liczbę wywołań OBU
//      atrap przy każdym kliknięciu - test na samo „wywołano onPay"
//      przepuściłby wiersz, który woła jedno i drugie.
//
//   3. `busy` BLOKUJE WYŁĄCZNIE PŁATNOŚĆ. To jest stan „kasa się otwiera";
//      zablokowanie w nim kosza uwięziłoby kupującego z pozycją, której
//      zamówienie się nie powiodło. Osobny przypadek pilnuje, że kosz
//      w tym stanie DALEJ działa.
//
// GRANICA DOWODU: nic tutaj nie mówi o tym, skąd biorą się napisy i czy kwota
// jest poprawna - to jest przedmiotem `CartPanel.test.tsx`. Ten plik odpowiada
// za to, że wiersz oddaje otrzymane dane bez zmian i nie miesza działań.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CartLine } from "@/components/cart/molecules/CartLine";

type CartLineProps = Parameters<typeof CartLine>[0];

/** `Intl` wstawia spację nierozdzielającą przed symbolem waluty. */
function normalizeSpaces(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function renderLine(overrides: Partial<CartLineProps> = {}) {
  const onPay = vi.fn();
  const onRemove = vi.fn();
  const props: CartLineProps = {
    label: "Szczyt energetyczny - Wejściówka standard",
    price: "120,00 zł",
    eventLink: <a href="/events/szczyt-energetyczny">Strona wydarzenia</a>,
    busy: false,
    payLabel: "Zapłać",
    removeLabel: "Usuń",
    onPay,
    onRemove,
    ...overrides,
  };
  const view = render(
    <ul>
      <CartLine {...props} />
    </ul>,
  );
  return { ...view, onPay, onRemove };
}

describe("wiersz oddaje dane wołającego bez zmian", () => {
  it("wypisuje nazwę pozycji i cenę DOKŁADNIE tak, jak je dostał", () => {
    renderLine({ label: "Forum CEE - Bilet ulgowy", price: "59,50 zł" });

    expect(screen.getByText("Forum CEE - Bilet ulgowy")).toBeInTheDocument();
    // Dokładne porównanie, nie `toContain`: wiersz nie ma prawa niczego
    // dokleić ani obciąć w kwocie, którą kupujący czyta przed kasą.
    expect(normalizeSpaces(screen.getByText(/59,50/).textContent)).toBe("59,50 zł");
  });

  it("wstawia gotowy odnośnik do wydarzenia jako slot, nie buduje adresu sam", () => {
    renderLine({
      eventLink: <a href="/events/forum-cee">Event page</a>,
    });

    expect(screen.getByRole("link", { name: "Event page" })).toHaveAttribute(
      "href",
      "/events/forum-cee",
    );
  });

  it("jest elementem listy z własnym znacznikiem - lista koszyka je liczy", () => {
    renderLine();

    const line = screen.getByTestId("cart-line");
    expect(line.tagName).toBe("LI");
  });
});

describe("dwa działania wiersza są rozłączne", () => {
  it("klik w płatność woła WYŁĄCZNIE onPay", () => {
    const { onPay, onRemove } = renderLine({ payLabel: "Zapłać" });

    fireEvent.click(screen.getByRole("button", { name: "Zapłać" }));

    expect(onPay).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("klik w kosz woła WYŁĄCZNIE onRemove", () => {
    const { onPay, onRemove } = renderLine({ removeLabel: "Usuń" });

    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPay).not.toHaveBeenCalled();
  });

  it("kosz ma dostępną nazwę i podpowiedź z etykiety wołającego", () => {
    // Sam ikonowy przycisk bez `aria-label` byłby dla czytnika ekranu
    // przyciskiem bez nazwy - a to jedyne miejsce, w którym da się
    // pozycję usunąć.
    renderLine({ removeLabel: "Remove" });

    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toHaveAttribute("title", "Remove");
  });
});

describe("stan zajętości blokuje kasę, a nie kosz", () => {
  it("gdy kasa się otwiera, przycisk płatności jest wyłączony i klik nic nie robi", () => {
    const { onPay } = renderLine({ busy: true, payLabel: "Otwieram kasę..." });

    const pay = screen.getByRole("button", { name: "Otwieram kasę..." });
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(onPay).not.toHaveBeenCalled();
  });

  it("kosz DZIAŁA także w trakcie otwierania kasy", () => {
    // Gdyby `busy` blokowało oba przyciski, nieudana próba płatności
    // zostawiałaby kupującego z pozycją, której nie da się usunąć.
    const { onRemove } = renderLine({
      busy: true,
      payLabel: "Otwieram kasę...",
      removeLabel: "Usuń",
    });

    const remove = screen.getByRole("button", { name: "Usuń" });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("poza stanem zajętości przycisk płatności jest aktywny", () => {
    // Kontrola dodatnia dla przypadku wyżej: dowodzi, że `toBeDisabled`
    // mierzy stan `busy`, a nie to, że przycisk zawsze jest wyłączony.
    renderLine({ busy: false });

    expect(screen.getByRole("button", { name: "Zapłać" })).toBeEnabled();
  });
});
