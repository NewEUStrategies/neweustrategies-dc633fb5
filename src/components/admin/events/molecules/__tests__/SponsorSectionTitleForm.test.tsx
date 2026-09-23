// Molekuła „Tytuł sekcji sponsorów" - dwa pola (PL/EN) i zapis w bocznym panelu
// sekcji tablicy „Sponsorzy i reklama".
//
// CO TEN PLIK DOWODZI.
//   1. POLA STARTUJĄ OD TYTUŁÓW SEKCJI, z limitem 120 znaków i etykietami, które
//      wiążą się z polami (dostępność po nazwie).
//   2. STAN NIE JEST SYNCHRONIZOWANY Z PROPSAMI. Ponowny render z INNYMI
//      tytułami początkowymi (odświeżony wiersz tej samej sekcji) zostawia to,
//      co organizator wpisał; dopiero nowy `key` (inna sekcja) montuje formularz
//      od nowa. To jest poprawka błędu, w którym odświeżenie listy sekcji
//      kasowało niezapisany tytuł.
//   3. ZAPIS ODDAJE OBA TYTUŁY PRZYCIĘTE, a brakujący język dostaje tytuł
//      z drugiego. Oba puste nie wychodzą wcale.
//   4. W TRAKCIE ZAPISU PRZYCISK JEST ZGASZONY.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wywołania RPC i komunikatów po zapisie - to
// `organisms/__tests__/SponsorSectionDrawer.test.tsx`, gdzie molekuła siedzi
// w prawdziwym rodzicu z `key={tier.id}`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  SponsorSectionTitleForm,
  type SponsorSectionTitles,
} from "@/components/admin/events/molecules/SponsorSectionTitleForm";

type Props = ComponentProps<typeof SponsorSectionTitleForm>;

const PL = "sponsorBoard.add.titlePl";
const EN = "sponsorBoard.add.titleEn";
const ZAPISZ = "sponsorBoard.drawer.save";

let zapisy: SponsorSectionTitles[] = [];

function props(patch: Partial<Props> = {}): Props {
  return {
    initialNamePl: "Złoci partnerzy",
    initialNameEn: "Gold partners",
    isSaving: false,
    onSave: (titles) => {
      zapisy.push(titles);
    },
    ...patch,
  };
}

function pole(etykieta: string): HTMLInputElement {
  const el = screen.getByLabelText(etykieta);
  if (!(el instanceof HTMLInputElement)) throw new Error(`„${etykieta}” nie jest polem`);
  return el;
}

function przycisk(): HTMLButtonElement {
  const el = screen.getByRole("button", { name: ZAPISZ });
  if (!(el instanceof HTMLButtonElement)) throw new Error("zapis nie jest przyciskiem");
  return el;
}

function wpisz(etykieta: string, wartosc: string): void {
  fireEvent.change(pole(etykieta), { target: { value: wartosc } });
}

beforeEach(() => {
  zapisy = [];
});

describe("pola tytułu", () => {
  it("startują od tytułów sekcji, z limitem 120 znaków", () => {
    render(<SponsorSectionTitleForm {...props()} />);
    expect(pole(PL).value).toBe("Złoci partnerzy");
    expect(pole(EN).value).toBe("Gold partners");
    expect(pole(PL).getAttribute("maxlength")).toBe("120");
    expect(pole(EN).getAttribute("maxlength")).toBe("120");
  });

  it("nowe tytuły początkowe przy tym samym `key` nie nadpisują wpisanego tekstu", () => {
    const widok = render(<SponsorSectionTitleForm key="t1" {...props()} />);
    wpisz(PL, "Roboczy tytuł");
    widok.rerender(
      <SponsorSectionTitleForm
        key="t1"
        {...props({ initialNamePl: "Z bazy", initialNameEn: "From the database" })}
      />,
    );
    expect(pole(PL).value).toBe("Roboczy tytuł");
    expect(pole(EN).value).toBe("Gold partners");
  });

  it("nowy `key` montuje formularz od nowa z tytułami tamtej sekcji", () => {
    const widok = render(<SponsorSectionTitleForm key="t1" {...props()} />);
    wpisz(PL, "Roboczy tytuł");
    widok.rerender(
      <SponsorSectionTitleForm
        key="t2"
        {...props({ initialNamePl: "Srebrni", initialNameEn: "Silver" })}
      />,
    );
    expect(pole(PL).value).toBe("Srebrni");
    expect(pole(EN).value).toBe("Silver");
  });
});

describe("zapis", () => {
  it("oddaje oba tytuły przycięte", () => {
    render(<SponsorSectionTitleForm {...props()} />);
    wpisz(PL, "  Partnerzy główni ");
    wpisz(EN, " Main partners ");
    fireEvent.click(przycisk());
    expect(zapisy).toEqual([{ namePl: "Partnerzy główni", nameEn: "Main partners" }]);
  });

  it.each<[string, string, string, SponsorSectionTitles]>([
    ["tylko polski", "Złoci", "  ", { namePl: "Złoci", nameEn: "Złoci" }],
    ["tylko angielski", "", " Gold ", { namePl: "Gold", nameEn: "Gold" }],
  ])("%s tytuł idzie także jako drugi język", (_nazwa, pl, en, oczekiwane) => {
    render(<SponsorSectionTitleForm {...props()} />);
    wpisz(PL, pl);
    wpisz(EN, en);
    fireEvent.click(przycisk());
    expect(zapisy).toEqual([oczekiwane]);
  });

  it("oba tytuły puste nie wychodzą wcale", () => {
    render(<SponsorSectionTitleForm {...props()} />);
    wpisz(PL, " ");
    wpisz(EN, "");
    fireEvent.click(przycisk());
    expect(zapisy).toEqual([]);
  });

  it("w trakcie zapisu przycisk jest zgaszony", () => {
    render(<SponsorSectionTitleForm {...props({ isSaving: true })} />);
    expect(przycisk().disabled).toBe(true);
  });
});
