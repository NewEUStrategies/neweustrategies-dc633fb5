// CO DOWODZI TEN PLIK: dwa atomy panelu SEO, wyprowadzone z większych molekuł
// właśnie po to, żeby dały się dowieść tabelą wejść, a nie renderem całego
// panelu:
//
//   1. `isAtHardLimit` + `CharCounter` - GRANICA twardego limitu znaków.
//      Predykat jest domknięty od góry (`>=`), więc długość RÓWNA limitowi już
//      jest "na limicie" - to jedyny sygnał, po którym redakcja widzi, że
//      `maxLength` zaczął cicho ucinać pisanie (przeglądarka nie mówi nic).
//      Test przypina granicę dokładnie: poniżej / dokładnie na / powyżej,
//      plus zdegenerowany limit 0 (pole, które nie przyjmie ani znaku).
//   2. `severityHeadingKey` / `severityLiveRole` + `SeverityBadge` - PARA
//      "klucz nagłówka + rola ARIA" dla poziomu istotności. `alert` (błąd,
//      czytnik przerywa) i `status` (ostrzeżenie, czytnik tylko dopowiada) to
//      RÓŻNE zachowania asystujące; rozjazd między poziomem a rolą jest
//      niewidoczny w typach (oba zwracają napis) i niewidoczny na ekranie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `SeoTextField.test.tsx` - tam licznik jest sprawdzany JAKO CZĘŚĆ pola
//     (razem z `aria-invalid`, komunikatem i metryką pikselową); tutaj wyłącznie
//     sam atom, bez formularza.
//   - `SeoValidationSummary` / listy uwag SEO - plakietka jest tu renderowana
//     samodzielnie, bez żadnej reguły walidacji.
//   - `RobotsTxtPreview.test.tsx` - inna powierzchnia (treść dla crawlera).
//   - `e2e/seo.spec.ts` - ten plik NIE styka się z e2e: cała suita e2e SEO
//     dotyczy powierzchni publicznych (sitemapy, robots.txt, feedy, kontrakt
//     <head>), a jedyny test panelu, "/admin/seo is auth-gated (redirects to
//     /auth or /login)", dowodzi wyłącznie bramki auth i nigdy nie wchodzi do
//     środka panelu - żadnego atomu SEO nie renderuje.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { CharCounter, isAtHardLimit } from "@/components/admin/seo/atoms/CharCounter";
import {
  SeverityBadge,
  severityHeadingKey,
  severityLiveRole,
  type SeoSeverity,
} from "@/components/admin/seo/atoms/SeverityBadge";

afterEach(cleanup);

describe("isAtHardLimit", () => {
  // Granica przypięta DOKŁADNIE: 159/160 to jeszcze wolne pole, 160/160 to już
  // limit (kolejny znak nie wejdzie), 161/160 to wartość wklejona/przywieziona
  // z bazy sprzed zmiany limitu - musi być nadal traktowana jako przekroczenie.
  it.each([
    ["o jeden znak poniżej limitu", 159, 160, false],
    ["dokładnie na limicie", 160, 160, true],
    ["o jeden znak powyżej limitu (wartość wklejona)", 161, 160, true],
    ["pole o limicie 0 nie przyjmie ani znaku", 0, 0, true],
  ])("%s -> %s", (_opis, length, max, expected) => {
    expect(isAtHardLimit(length, max)).toBe(expected);
  });
});

describe("CharCounter", () => {
  function counter(length: number, max: number): HTMLElement {
    render(<CharCounter length={length} max={max} />);
    return screen.getByTestId("seo-char-counter");
  }

  it("pokazuje 'N/M' surowymi liczbami - bez zaokrągleń i bez limitu w nawiasie", () => {
    expect(counter(72, 160).textContent).toBe("72/160");
  });

  it("poniżej limitu nie zapala tonacji ostrzegawczej", () => {
    const el = counter(159, 160);
    expect(el).toHaveAttribute("data-at-limit", "false");
    expect(el.className).toContain("text-muted-foreground");
  });

  it("dokładnie na limicie zapala tonację limitu (ten sam próg co predykat)", () => {
    const el = counter(160, 160);
    expect(el).toHaveAttribute("data-at-limit", "true");
    expect(el.className).toContain("text-destructive");
    expect(el.textContent).toBe("160/160");
  });

  it("wartość dłuższa niż limit nadal raportuje faktyczną długość, nie limit", () => {
    // Gdyby licznik zaciskał się do limitu, redakcja nie wiedziałaby, ILE
    // znaków musi usunąć z wpisu przywiezionego z importu.
    const el = counter(180, 160);
    expect(el.textContent).toBe("180/160");
    expect(el).toHaveAttribute("data-at-limit", "true");
  });

  it("zero znaków przy niezerowym limicie to stan neutralny", () => {
    const el = counter(0, 160);
    expect(el.textContent).toBe("0/160");
    expect(el).toHaveAttribute("data-at-limit", "false");
  });
});

describe("severityHeadingKey / severityLiveRole", () => {
  it.each([
    ["error", "admin.seo.validation.errorHeading", "alert"],
    ["warning", "admin.seo.validation.warnHeading", "status"],
  ] satisfies Array<[SeoSeverity, string, "alert" | "status"]>)(
    "poziom %s -> klucz %s i rola %s",
    (severity, key, role) => {
      expect(severityHeadingKey(severity)).toBe(key);
      expect(severityLiveRole(severity)).toBe(role);
    },
  );

  it("błąd i ostrzeżenie NIE dzielą ani klucza, ani roli ARIA", () => {
    // Wspólny klucz/rola = ostrzeżenie przerywające czytnik (albo błąd, którego
    // czytnik nie ogłasza) - dokładnie ten rozjazd, przed którym stoi ten atom.
    expect(severityHeadingKey("error")).not.toBe(severityHeadingKey("warning"));
    expect(severityLiveRole("error")).not.toBe(severityLiveRole("warning"));
  });
});

describe("SeverityBadge", () => {
  it.each([
    ["error", "admin.seo.validation.errorHeading"],
    ["warning", "admin.seo.validation.warnHeading"],
  ] satisfies Array<[SeoSeverity, string]>)(
    "poziom %s renderuje KLUCZ nagłówka %s",
    (severity, key) => {
      render(<SeverityBadge severity={severity} />);
      const badge = screen.getByTestId("seo-severity-badge");
      expect(badge).toHaveAttribute("data-severity", severity);
      // Asercja na KLUCZU: plakietka nie może mieć własnego, wklejonego napisu.
      expect(badge).toHaveTextContent(key);
      expect(badge.textContent).toBe(key);
    },
  );

  it("ikona jest dekoracją - czytnik czyta wyłącznie nagłówek", () => {
    const { container } = render(<SeverityBadge severity="error" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden");
  });
});
