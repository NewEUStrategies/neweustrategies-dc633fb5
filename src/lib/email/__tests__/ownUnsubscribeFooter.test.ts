// Znaczniki własnej stopki wypisu (Z-S5-05): jedna stopka w skrzynce.
//
// Dowód jest na czystych funkcjach, bo to one decydują o treści, która trafi
// do odbiorcy: wycięcie na drodze nadawcy platformy (ten dokleja własną
// stopkę) i zdjęcie samych znaczników na drodze z własnym wypisem.
import { describe, expect, it } from "vitest";

import {
  OWN_UNSUBSCRIBE_END,
  OWN_UNSUBSCRIBE_START,
  markOwnUnsubscribe,
  stripOwnUnsubscribe,
  unmarkOwnUnsubscribe,
} from "@/lib/email/ownUnsubscribeFooter";

const FOOT = '<p>Nie chcesz kolejnych? <a href="https://a.test/u?t=1">Wypisz się</a>.</p>';

describe("znaczniki własnej stopki wypisu", () => {
  it("owijają fragment; pusty fragment nie dostaje pustych znaczników", () => {
    expect(markOwnUnsubscribe(FOOT)).toBe(`${OWN_UNSUBSCRIBE_START}${FOOT}${OWN_UNSUBSCRIBE_END}`);
    expect(markOwnUnsubscribe("")).toBe("");
  });

  it("droga platformy: blok znika razem ze znacznikami, reszta treści bez zmian", () => {
    const html = `<div><p>Treść</p>${markOwnUnsubscribe(FOOT)}<p>Pomiar</p></div>`;
    expect(stripOwnUnsubscribe(html)).toBe("<div><p>Treść</p><p>Pomiar</p></div>");

    // Tekst: stopka po pustej linii - po wycięciu bez wiszących odstępów.
    const text = `Treść\n\n${markOwnUnsubscribe("Wypisz się: https://a.test/u")}\nPomiar: https://a.test/m`;
    expect(stripOwnUnsubscribe(text)).toBe("Treść\nPomiar: https://a.test/m");
  });

  it("droga z własnym wypisem: znikają same znaczniki, stopka zostaje", () => {
    const html = `<p>Treść</p>${markOwnUnsubscribe(FOOT)}`;
    expect(unmarkOwnUnsubscribe(html)).toBe(`<p>Treść</p>${FOOT}`);
    expect(unmarkOwnUnsubscribe(html)).not.toContain("nes:unsub");
  });

  it("treść bez znaczników przechodzi bez zmian (kampanie, poczta transakcyjna)", () => {
    const plain = "<p>Treść</p><!-- zwykły komentarz -->";
    expect(stripOwnUnsubscribe(plain)).toBe(plain);
    expect(unmarkOwnUnsubscribe(plain)).toBe(plain);
  });

  it("kilka bloków i osierocony znacznik: nic z nich nie wycieka do skrzynki", () => {
    const twice = `A${markOwnUnsubscribe("x")}B${markOwnUnsubscribe("y")}C`;
    expect(stripOwnUnsubscribe(twice)).toBe("ABC");
    expect(stripOwnUnsubscribe(`A${OWN_UNSUBSCRIBE_START}B`)).toBe("AB");
    // Bez chciwości: treść MIĘDZY blokami zostaje.
    expect(stripOwnUnsubscribe(twice)).toContain("B");
  });
});
