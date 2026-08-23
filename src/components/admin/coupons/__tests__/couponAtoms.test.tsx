// Atomy tabeli kuponów B2B - sześć komórek, w których liczba na ekranie jest
// jedyną podstawą decyzji operatora: wypuścić kupon czy nie.
//
// CO TEN PLIK DOWODZI.
//   1. KOMÓRKA RABATU KŁAMIE NA WARTOŚCIACH BRZEGOWYCH: brak kwoty renderuje
//      się jako „0.00” (kupon wygląda na darmowy), brak waluty zostawia
//      wiszącą liczbę, a rabat procentowy bez wartości wypisuje „null%”.
//      Trzy pary `it.fails` + `it` opisują, co powinno się dziać, i co się
//      dzieje dziś.
//   2. ZAKRES WAŻNOŚCI ma dwa znaki zastępcze o RÓŻNYM znaczeniu: „—” to brak
//      początku (kupon ważny od zawsze), „∞” to brak końca (kupon
//      bezterminowy). Pomylenie ich zamienia kupon czasowy w wieczny.
//   3. LICZNIK UŻYĆ ROZRÓŻNIA `null` OD `0`: brak limitu nie dopisuje nic,
//      limit zerowy wypisuje „ / 0”. Baza dopuszcza wyłącznie
//      `max_redemptions > 0`, więc „ / 0” na ekranie oznacza wiersz spoza panelu.
//   4. PLAKIETKA WARSTWY WYPISUJE „0” ZAMIAST NICZEGO dla zerowej liczby dni -
//      klasyczna pułapka `{liczba && ...}` w JSX-ie, niewidoczna w tsc.
//   5. PLAKIETKA WARSTWY POKAZUJE SUROWY KLUCZ Z BAZY (`gold`), a nie nazwę
//      warstwy, którą operator wybrał w formularzu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki i napisów - te mają tabele
// w `lib/billing/__tests__/couponAdminList.test.ts`; tutaj dowodzimy, że atomy
// z nich KORZYSTAJĄ i co z tego widać w DOM-ie. Języka interfejsu (`lang`)
// dowodzi tamten plik; tu sprawdzamy tylko, że atom przekazuje go dalej.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CouponActiveBadge } from "../atoms/CouponActiveBadge";
import { CouponDiscountCell } from "../atoms/CouponDiscountCell";
import { CouponStatCard } from "../atoms/CouponStatCard";
import { CouponTierBadge } from "../atoms/CouponTierBadge";
import { CouponUsesCell } from "../atoms/CouponUsesCell";
import { CouponValidityRange } from "../atoms/CouponValidityRange";

describe("komórka rabatu", () => {
  it("rabat procentowy pokazuje wartość ze znakiem procentu", () => {
    render(<CouponDiscountCell kind="percent" percent={20} cents={null} currency={null} />);
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("rabat kwotowy pokazuje złotówki z walutą, nie grosze", () => {
    render(<CouponDiscountCell kind="fixed" percent={null} cents={2500} currency="PLN" />);
    expect(screen.getByText("25.00 PLN")).toBeInTheDocument();
  });

  it.fails("rabat procentowy BEZ wartości nie powinien pokazywać słowa „null”", () => {
    render(<CouponDiscountCell kind="percent" percent={null} cents={null} currency={null} />);
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("STAN FAKTYCZNY: procent null renderuje literalne „null%”", () => {
    // Para do usunięcia RAZEM po naprawie.
    render(<CouponDiscountCell kind="percent" percent={null} cents={null} currency={null} />);
    expect(screen.getByText("null%")).toBeInTheDocument();
  });

  it.fails("kupon kwotowy BEZ kwoty nie powinien wyglądać na darmowy", () => {
    render(<CouponDiscountCell kind="fixed" percent={null} cents={null} currency="PLN" />);
    expect(screen.queryByText("0.00 PLN")).toBeNull();
  });

  it("STAN FAKTYCZNY: brak kwoty renderuje „0.00 PLN”", () => {
    render(<CouponDiscountCell kind="fixed" percent={null} cents={null} currency="PLN" />);
    expect(screen.getByText("0.00 PLN")).toBeInTheDocument();
  });

  it("kwota UJEMNA wychodzi na ekran bez żadnego ostrzeżenia", () => {
    render(<CouponDiscountCell kind="fixed" percent={null} cents={-2500} currency="PLN" />);
    expect(screen.getByText("-25.00 PLN")).toBeInTheDocument();
  });
});

describe("zakres ważności", () => {
  it("brak obu dat daje „— → ∞”, czyli kupon bez ograniczenia czasowego", () => {
    const { container } = render(<CouponValidityRange from={null} until={null} lang="pl" />);
    expect(container.textContent).toBe("— → ∞");
  });

  it("obie daty są sformatowane w języku interfejsu", () => {
    const { container } = render(
      <CouponValidityRange
        from="2026-01-05T10:00:00.000Z"
        until="2026-03-01T10:00:00.000Z"
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("2026");
    expect(container.textContent).toContain(" → ");
  });

  it("sam początek bez końca zostawia „∞” po prawej (kupon otwarty)", () => {
    const { container } = render(
      <CouponValidityRange from="2026-01-05T10:00:00.000Z" until={null} lang="pl" />,
    );
    expect(container.textContent?.endsWith("∞")).toBe(true);
  });

  it.fails("data nieparsowalna powinna dać znak zastępczy, nie napis diagnostyczny", () => {
    const { container } = render(<CouponValidityRange from="not-a-date" until={null} lang="pl" />);
    expect(container.textContent).not.toContain("Invalid Date");
  });

  it("STAN FAKTYCZNY: uszkodzona data renderuje „Invalid Date → ∞” i nie wywala wiersza", () => {
    const { container } = render(<CouponValidityRange from="not-a-date" until={null} lang="pl" />);
    expect(container.textContent).toBe("Invalid Date → ∞");
  });
});

describe("licznik użyć", () => {
  it("brak limitu pokazuje samą liczbę realizacji", () => {
    const { container } = render(<CouponUsesCell used={7} max={null} />);
    expect(container.textContent).toBe("7");
  });

  it("limit dopisuje się po ukośniku", () => {
    const { container } = render(<CouponUsesCell used={7} max={100} />);
    expect(container.textContent).toBe("7 / 100");
  });

  it("limit ZEROWY jest czymś innym niż brak limitu - wypisuje się wprost", () => {
    // Baza dopuszcza tylko `max_redemptions > 0`, więc „ / 0” oznacza wiersz,
    // który powstał z pominięciem panelu - i musi być widoczny, nie ukryty.
    const { container } = render(<CouponUsesCell used={0} max={0} />);
    expect(container.textContent).toBe("0 / 0");
  });
});

describe("plakietka warstwy członkostwa", () => {
  it("brak warstwy pokazuje znak zastępczy, a nie pustą komórkę", () => {
    const { container } = render(<CouponTierBadge tierKey={null} durationDays={null} />);
    expect(container.textContent).toBe("—");
  });

  it("warstwa z liczbą dni pokazuje jedno i drugie", () => {
    const { container } = render(<CouponTierBadge tierKey="gold" durationDays={30} />);
    expect(container.textContent).toBe("gold30d");
  });

  it("warstwa bezterminowa nie dopisuje liczby dni", () => {
    const { container } = render(<CouponTierBadge tierKey="gold" durationDays={null} />);
    expect(container.textContent).toBe("gold");
  });

  it("plakietka pokazuje SUROWY klucz warstwy z bazy, nie jej nazwę", () => {
    // Formularz każe wybrać „Złoty”, a tabela wypisuje `gold` - operator nie ma
    // jak połączyć jednego z drugim bez zaglądania do bazy.
    render(<CouponTierBadge tierKey="gold" durationDays={null} />);
    expect(screen.getByText("gold")).toBeInTheDocument();
  });

  it.fails("zerowa liczba dni nie powinna niczego dopisywać", () => {
    const { container } = render(<CouponTierBadge tierKey="gold" durationDays={0} />);
    expect(container.textContent).toBe("gold");
  });

  it("STAN FAKTYCZNY: zero renderuje się jako „0” doklejone do klucza warstwy", () => {
    // Pułapka `{liczba && ...}`: React wypisuje `0`, bo to nie jest `false`.
    const { container } = render(<CouponTierBadge tierKey="gold" durationDays={0} />);
    expect(container.textContent).toBe("gold0");
  });
});

describe("plakietka aktywności", () => {
  it("kupon aktywny dostaje etykietę aktywności podaną przez wołającego", () => {
    render(<CouponActiveBadge active activeLabel="Aktywny" inactiveLabel="Nieaktywny" />);
    expect(screen.getByText("Aktywny")).toBeInTheDocument();
    expect(screen.queryByText("Nieaktywny")).toBeNull();
  });

  it("kupon wyłączony dostaje etykietę przeciwną - nigdy obie naraz", () => {
    render(<CouponActiveBadge active={false} activeLabel="Aktywny" inactiveLabel="Nieaktywny" />);
    expect(screen.getByText("Nieaktywny")).toBeInTheDocument();
    expect(screen.queryByText("Aktywny")).toBeNull();
  });
});

describe("kafel liczbowy", () => {
  it("kafel pokazuje etykietę i wartość jako GOTOWY napis (formatuje wołający)", () => {
    render(<CouponStatCard label="Wygasłe" value="0" />);
    expect(screen.getByText("Wygasłe")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
