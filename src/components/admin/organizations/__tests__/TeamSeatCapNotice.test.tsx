// Reguła Zespołu „3-20 miejsc" w panelu organizacji (I9b, decyzja właściciela
// 2026-10-20) - komunikaty PL/EN i powiązanie z polem.
//
// CO TEN PLIK DOWODZI.
//   1. Zespół pokazuje stan „x/20" aktywnych miejsc; inne progi - nic.
//   2. Liczba, którą baza odrzuci (zakładanie z 21, podniesienie ponad 20,
//      wejście na Zespół z limitem 25), daje `role="alert"` z sugestią
//      Enterprise - odrzucenie, nie przycięcie (wartość zostaje 21).
//   3. Poniżej minimum v6.2 (3) - ostrzeżenie BEZ alertu (warunek sprzedaży).
//   4. Organizacja ponad limitem sprzed reguły: limit zostaje, obniżanie
//      bez alertu, dodawanie przy 20 aktywnych zablokowane.
//   5. Po angielsku te same liczby; brak naruszeń axe.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { TeamSeatCapNotice } from "@/components/admin/organizations/TeamSeatCapNotice";
import "@/lib/i18n-admin-organizations";

h.fixedT = realT;

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("TeamSeatCapNotice", () => {
  it("inny próg niż Zespół: nic", () => {
    const { container } = render(
      <TeamSeatCapNotice
        tierKey="corporate"
        requestedSeats={40}
        base={{ tierKey: "corporate", seatsLimit: 30 }}
        activeSeats={30}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("PL: stan x/20 aktywnych miejsc bez alertu w granicach 3-20", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={12}
        base={{ tierKey: "team", seatsLimit: 12 }}
        activeSeats={9}
      />,
    );
    expect(
      screen.getByText("Zespół: 9/20 aktywnych miejsc (cennik v6.2: 3-20)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PL: zakładanie Zespołu z 21 miejscami - alert z sugestią Enterprise, wartość nieprzycięta", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={21}
        base={null}
        activeSeats={null}
        alertId="team-cap"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("id", "team-cap");
    expect(alert).toHaveTextContent("Zespół ma najwyżej 20 miejsc - 21 to oferta Enterprise.");
  });

  it("PL: wejście na Zespół z limitem 25 (Enterprise -> Zespół) - alert", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={25}
        base={{ tierKey: "corporate", seatsLimit: 25 }}
        activeSeats={null}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("25 to oferta Enterprise");
  });

  it("PL: poniżej minimum v6.2 - ostrzeżenie, nie alert", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={2}
        base={{ tierKey: "team", seatsLimit: 2 }}
        activeSeats={2}
      />,
    );
    expect(screen.getByText(/Poniżej minimum v6\.2 \(3\)/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PL: limit sprzed reguły (25) zostaje, obniżenie do 22 bez alertu, dodawanie przy 20 aktywnych zablokowane", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={22}
        base={{ tierKey: "team", seatsLimit: 25 }}
        activeSeats={20}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Limit 25 miejsc sprzed reguły 3-20 zostaje/)).toBeInTheDocument();
    expect(screen.getByText(/Zespół ma już 20 aktywnych miejsc/)).toBeInTheDocument();
    expect(
      screen.getByText("Zespół: 20/20 aktywnych miejsc (cennik v6.2: 3-20)."),
    ).toBeInTheDocument();
  });

  it("PL: podniesienie limitu sprzed reguły (25 -> 26) - alert", () => {
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={26}
        base={{ tierKey: "team", seatsLimit: 25 }}
        activeSeats={20}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("26 to oferta Enterprise");
  });

  it("EN: te same liczby po angielsku", () => {
    h.lang = "en";
    render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={21}
        base={{ tierKey: "team", seatsLimit: 20 }}
        activeSeats={20}
      />,
    );
    expect(screen.getByText("Team: 20/20 active seats (pricing v6.2: 3-20).")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Team allows at most 20 seats - 21 is an Enterprise offer.",
    );
  });

  it("brak naruszeń axe", async () => {
    const { container } = render(
      <TeamSeatCapNotice
        tierKey="team"
        requestedSeats={21}
        base={{ tierKey: "team", seatsLimit: 20 }}
        activeSeats={20}
        alertId="team-cap-axe"
      />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
