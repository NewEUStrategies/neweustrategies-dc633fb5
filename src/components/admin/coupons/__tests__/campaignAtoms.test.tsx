// Atomy tabeli kampanii kuponowych: rabat, warstwa, status i kafel liczbowy.
// RYZYKIEM jest tu formatowanie wartości BRZEGOWYCH - to po tych napisach
// operator decyduje, czy wypuścić kampanię rabatową.
//
// CO TEN PLIK DOWODZI.
//   1. Rabat procentowy z pustą kolumną wypisuje literalne „null%", a rabat
//      kwotowy z pustą kolumną udaje kupon DARMOWY („0.00"). Oba wyrażenia
//      przechodzą przez `tsc` (interpolacja przyjmuje `null`), przez recenzję
//      (to jedna linijka) i przez ekran (coś się wyświetla) - łapie je tylko
//      test wartości brzegowej.
//   2. Kwota UJEMNA wychodzi na ekran ze znakiem minus, czyli rabat wygląda
//      jak dopłata.
//   3. Brak waluty zostawia wiszącą liczbę - a kolumna `currency` nie ma
//      w bazie żadnego CHECK-a, więc taki wiersz jest osiągalny.
//   4. Plakietka warstwy pokazuje SUROWY klucz („gold"), a nie nazwę, którą
//      operator widział przy wyborze; przy zerze dni React wypisuje „0".
//   5. Plakietka statusu wyróżnia wizualnie WYŁĄCZNIE kampanię wysłaną.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguły „która akcja dla którego statusu"
// (`couponCampaignForm.test.ts`) ani sklejenia wiersza (`CampaignsTable.test.tsx`).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CampaignDiscountCell } from "@/components/admin/coupons/atoms/CampaignDiscountCell";
import { CampaignStatusBadge } from "@/components/admin/coupons/atoms/CampaignStatusBadge";
import { CampaignTierBadge } from "@/components/admin/coupons/atoms/CampaignTierBadge";
import { CouponStatTile } from "@/components/admin/coupons/atoms/CouponStatTile";

afterEach(cleanup);

describe("komórka rabatu", () => {
  it("rabat procentowy pokazuje wartość z procentem", () => {
    render(<CampaignDiscountCell kind="percent" percent={20} cents={null} currency={null} />);
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("rabat kwotowy pokazuje kwotę w jednostkach głównych razem z walutą", () => {
    render(<CampaignDiscountCell kind="fixed" percent={null} cents={2500} currency="PLN" />);
    expect(screen.getByText("25.00 PLN")).toBeInTheDocument();
  });

  it("PUSTY procent wypisuje literalne 'null%' - operator widzi słowo z JavaScriptu", () => {
    render(<CampaignDiscountCell kind="percent" percent={null} cents={null} currency={null} />);
    expect(screen.getByText("null%")).toBeInTheDocument();
  });

  it("PUSTA kwota udaje kupon DARMOWY, zamiast powiedzieć, że danych brakuje", () => {
    render(<CampaignDiscountCell kind="fixed" percent={null} cents={null} currency="PLN" />);
    expect(screen.getByText("0.00 PLN")).toBeInTheDocument();
  });

  it("kwota UJEMNA wychodzi na ekran - rabat wygląda jak dopłata", () => {
    render(<CampaignDiscountCell kind="fixed" percent={null} cents={-2500} currency="PLN" />);
    expect(screen.getByText("-25.00 PLN")).toBeInTheDocument();
  });

  it("BRAK waluty zostawia samą liczbę - nie wiadomo, w czym liczony jest rabat", () => {
    const { container } = render(
      <CampaignDiscountCell kind="fixed" percent={null} cents={1000} currency={null} />,
    );
    expect(container.textContent).toBe("10.00 ");
  });

  it("zero groszy pokazuje '0.00', czyli tak samo jak brak wartości", () => {
    const { container } = render(
      <CampaignDiscountCell kind="fixed" percent={null} cents={0} currency="PLN" />,
    );
    expect(container.textContent).toBe("0.00 PLN");
  });
});

describe("plakietka warstwy subskrypcji", () => {
  it("brak warstwy daje myślnik, a nie pustą komórkę", () => {
    const { container } = render(<CampaignTierBadge tierKey={null} durationDays={30} />);
    expect(container.textContent).toBe("—");
  });

  it("warstwa z liczbą dni pokazuje jedno i drugie", () => {
    const { container } = render(<CampaignTierBadge tierKey="gold" durationDays={30} />);
    expect(container.textContent).toBe("gold · 30d");
  });

  it("warstwa bez liczby dni pokazuje sam klucz - subskrypcja BEZTERMINOWA", () => {
    const { container } = render(<CampaignTierBadge tierKey="gold" durationDays={null} />);
    expect(container.textContent).toBe("gold");
  });

  it("ZERO dni wypisuje '0' doklejone do klucza - React renderuje zero, nie nic", () => {
    // `{liczba && ...}` przy zerze oddaje liczbę 0, a React ją rysuje.
    const { container } = render(<CampaignTierBadge tierKey="gold" durationDays={0} />);
    expect(container.textContent).toBe("gold0");
  });

  it("plakietka pokazuje KLUCZ warstwy, a nie jej nazwę z listy wyboru", () => {
    const { container } = render(<CampaignTierBadge tierKey="gold" durationDays={null} />);
    expect(container.textContent).not.toContain("Złoty");
  });
});

describe("plakietka statusu kampanii", () => {
  it("napis przychodzi z zewnątrz - atom niczego nie tłumaczy sam", () => {
    render(<CampaignStatusBadge status="draft" label="Wersja robocza" />);
    expect(screen.getByText("Wersja robocza")).toBeInTheDocument();
  });

  it("WYŁĄCZNIE kampania wysłana jest wyróżniona wizualnie", () => {
    const wyslana = render(<CampaignStatusBadge status="sent" label="sent" />);
    const klasyWyslanej = wyslana.container.firstElementChild?.className ?? "";
    cleanup();
    const robocza = render(<CampaignStatusBadge status="draft" label="draft" />);
    const klasyRoboczej = robocza.container.firstElementChild?.className ?? "";
    expect(klasyWyslanej).not.toBe(klasyRoboczej);
  });

  it.each(["draft", "generated", "archived"] as const)(
    "status %s dzieli wygląd z pozostałymi niewysłanymi",
    (status) => {
      const wzorzec = render(<CampaignStatusBadge status="draft" label="draft" />);
      const klasyWzorca = wzorzec.container.firstElementChild?.className ?? "";
      cleanup();
      const badany = render(<CampaignStatusBadge status={status} label={status} />);
      expect(badany.container.firstElementChild?.className).toBe(klasyWzorca);
    },
  );
});

describe("kafel liczbowy", () => {
  it("pokazuje etykietę i wartość GOTOWĄ - atom nie formatuje kwot", () => {
    render(<CouponStatTile label="Rabat udzielony" value="1234.50" />);
    expect(screen.getByText("Rabat udzielony")).toBeInTheDocument();
    expect(screen.getByText("1234.50")).toBeInTheDocument();
  });

  it("wartość 'NaN' jest wypisywana dosłownie - kafel nie ukrywa awarii danych", () => {
    render(<CouponStatTile label="Przychód netto" value="NaN" />);
    expect(screen.getByText("NaN")).toBeInTheDocument();
  });
});
