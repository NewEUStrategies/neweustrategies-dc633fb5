// Atom: pigulka statusu linku prezentowego (aktywny / cofniety / wygasl).
//
// PO CO TEN PLIK ISTNIEJE. Tabela linkow ma SIEDEM kolumn, z ktorych tylko ta
// jedna mowi, czy link nadal odblokowuje tresc. Trzy stany maja trzy rozne
// konsekwencje operacyjne (nic nie rob / juz cofnieto / wygaslo samo), wiec
// pomylenie tonacji albo zlanie dwoch stanow w jedna klase odbiera adminowi
// jedyny sygnal, po ktory tu przychodzi. Etykieta idzie z zewnatrz (i18n),
// wiec atom odpowiada wylacznie za TONACJE i za to, ze tekst dociera do DOM.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { StatusPill } from "@/components/admin/gifting/atoms/StatusPill";

const STATUSES = ["active", "revoked", "expired"] as const;

describe("StatusPill", () => {
  it.each(STATUSES)("renderuje etykiete dla statusu %s", (status) => {
    render(<StatusPill status={status} label={`etykieta-${status}`} />);
    expect(screen.getByText(`etykieta-${status}`)).toBeTruthy();
  });

  it("aktywny link dostaje tonacje pozytywna (emerald)", () => {
    render(<StatusPill status="active" label="aktywny" />);
    expect(screen.getByText("aktywny").className).toContain("emerald");
  });

  it("cofniety link dostaje tonacje destrukcyjna", () => {
    // Cofniecie jest DECYZJA REDAKCJI - musi sie roznic wizualnie od
    // wygasniecia, ktore dzieje sie samo. Ta sama tonacja dla obu znaczylaby,
    // ze admin nie odroznia wlasnej akcji od uplywu czasu.
    render(<StatusPill status="revoked" label="cofniety" />);
    expect(screen.getByText("cofniety").className).toContain("destructive");
  });

  it("wygasly link dostaje tonacje neutralna (muted)", () => {
    render(<StatusPill status="expired" label="wygasl" />);
    expect(screen.getByText("wygasl").className).toContain("muted");
  });

  it("kazdy status ma INNA tonacje", () => {
    const classes = STATUSES.map((status) => {
      const { unmount } = render(<StatusPill status={status} label={status} />);
      const cls = screen.getByText(status).className;
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(STATUSES.length);
  });

  it("pigulka niesie ramke i tlo w kazdym wariancie", () => {
    for (const status of STATUSES) {
      const { unmount } = render(<StatusPill status={status} label={status} />);
      const cls = screen.getByText(status).className;
      expect(cls, `${status} bez ramki`).toMatch(/\bborder\b/);
      expect(cls, `${status} bez tla`).toMatch(/\bbg-/);
      unmount();
    }
  });

  it("pusta etykieta nie wywraca renderu (i18n moze jeszcze nie miec klucza)", () => {
    const { container } = render(<StatusPill status="active" label="" />);
    expect(container.querySelector("span")).toBeTruthy();
  });

  it("nie wnosi naruszen dostepnosci", async () => {
    const { container } = render(<StatusPill status="revoked" label="cofniety" />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
