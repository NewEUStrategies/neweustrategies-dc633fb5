// Kafelek liczby w panelach kuponow.
//
// PO CO TEN PLIK ISTNIEJE. Ten atom jest wynikiem SCALENIA trzech kopii, ktore
// stały - znak w znak - w trzech plikach tras (`admin.coupons.index`,
// `admin.coupons.redemptions`, `admin.coupons.analytics`), przy czym jedna
// nazywala sie `StatCard`, a dwie `Stat`. Zadna z tych kopii nie miala testu.
// Teraz jest jeden egzemplarz i to on odpowiada za spojnosc CZTERECH kafelkow
// na liscie kuponow i wszystkich kafelkow w pozostalych panelach - wiec kazda
// zmiana w nim rozjezdza sie na cala sekcje kuponow naraz.
//
// Kafelek jest CZYSTO PREZENTACYJNY i celowo przyjmuje `value` jako NAPIS,
// a nie liczbe: wywolujacy sam decyduje o formatowaniu (`String(rows.length)`,
// kwota z waluta, procent). Test przybija wlasnie to - kafelek niczego nie
// formatuje po swojemu i niczego nie gubi.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { Stat } from "../Stat";

describe("Stat", () => {
  it("pokazuje etykiete i wartosc", () => {
    render(<Stat label="Aktywne" value="12" />);
    expect(screen.getByText("Aktywne")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("ZERO jest wyswietlane, a nie chowane jako wartosc falszywa", () => {
    // Klasyczna pulapka `{value && ...}`: kafelek „Wykorzystania: 0" znikalby,
    // a redakcja czytalaby brak kafelka jako brak danych, nie jako zero.
    render(<Stat label="Wykorzystania" value="0" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("nie formatuje wartosci po swojemu - napis idzie na ekran doslownie", () => {
    // Panele przekazuja tu gotowe napisy: kwoty z waluta, ulamki, liczniki.
    // Kazde „ulepszenie" formatowania w atomie zmienialoby je we wszystkich
    // panelach kuponow naraz.
    render(<Stat label="Suma rabatow" value="1 234,50 PLN" />);
    expect(screen.getByText("1 234,50 PLN")).toBeInTheDocument();
  });

  it("etykieta i wartosc sa ROZNYMI elementami - da sie je stylowac osobno", () => {
    // Gdyby wpadly do jednego wezla, czytnik ekranu przeczytalby
    // „Aktywne12" jednym ciagiem.
    render(<Stat label="Aktywne" value="12" />);
    expect(screen.getByText("Aktywne")).not.toBe(screen.getByText("12"));
  });

  it("nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = render(<Stat label="Aktywne" value="12" />);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
