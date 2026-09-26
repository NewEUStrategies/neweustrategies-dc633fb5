// Molekuła „karta Twojego miejsca" - czysta prezentacja karty z bazy.
//
// CO TEN PLIK DOWODZI.
//   1. Nagłówek to TO SAMO zdanie miejsca, co w panelu organizatora
//      (`seatLabelMessage`), a pod nim nazwa planu.
//   2. Sala, piętro, uwaga, sesja, kategoria i dostępność pojawiają się
//      WYŁĄCZNIE, gdy baza je oddała - karta bez sali nie pokazuje „Sala: null".
//   3. Kategoria i sesja idą w języku interfejsu, z polskim zapasem.
//   4. Karta nie ma naruszeń dostępności.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-event-seating", () => ({ ensureEventSeatingI18n: () => undefined }));

import { MySeatCardView } from "@/components/events/participant/molecules/MySeatCardView";
import { mySeatCard } from "@/test/events/seatingFixtures";
import { axeViolations, summarize } from "@/test/axe";

describe("MySeatCardView", () => {
  it("pokazuje zdanie miejsca, plan i wszystko, co oddała baza", async () => {
    h.lang = "pl";
    const { container } = render(
      <MySeatCardView card={mySeatCard({ isAccessible: true })} />,
    );

    expect(
      screen.getByRole("heading", { name: "eventSeating.label.rows(row=A,seat=2,section=A)" }),
    ).toBeTruthy();
    expect(screen.getByText("eventSeating.card.plan(name=Gala)")).toBeTruthy();
    const pozycje = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(pozycje).toEqual([
      "eventSeating.card.room(name=Sala Kryształowa)",
      "eventSeating.card.floor(floor=2)",
      "Wejście od dziedzińca",
      "eventSeating.card.session(title=Gala wieczorna)",
      "eventSeating.card.category(name=Strefa VIP)",
      "eventSeating.card.accessible",
    ]);
    expect(
      screen.getByRole("img", {
        name: "eventSeating.map.label(seat=eventSeating.label.rows(row=A,seat=2,section=A))",
      }),
    ).toBeTruthy();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("po angielsku kategoria i sesja idą w wersji EN", () => {
    h.lang = "en";
    render(<MySeatCardView card={mySeatCard()} />);

    expect(screen.getByText("eventSeating.card.session(title=Evening gala)")).toBeTruthy();
    expect(screen.getByText("eventSeating.card.category(name=VIP zone)")).toBeTruthy();
  });

  it("karta stołu bez sali, sesji i kategorii nie pokazuje pustych pozycji", () => {
    h.lang = "pl";
    render(
      <MySeatCardView
        card={mySeatCard({
          sectionKind: "table",
          sectionLabel: "Stół 4",
          rowLabel: null,
          seatNumber: 7,
          roomName: null,
          roomFloor: null,
          roomNote: null,
          sessionTitlePl: null,
          sessionTitleEn: null,
          category: null,
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "eventSeating.label.table(row=,seat=7,section=Stół 4)" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});
