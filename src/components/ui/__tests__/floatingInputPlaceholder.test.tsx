// Regresja: pływająca etykieta zjadała placeholder.
//
// `FloatingInput` / `FloatingTextarea` (a także wrappery `Field` w
// ContactFormView i `FieldWrap` w NewsletterForm) wymuszały `placeholder=" "`,
// więc KAŻDA wartość wpisana w panelu buildera była martwa. Poprawny wzorzec
// Material: realny placeholder trafia do DOM, CSS ukrywa go dopóki pole nie ma
// focusu, a etykieta unosi się na `:focus` LUB `:not(:placeholder-shown)`.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup, screen } from "@testing-library/react";
import {
  FloatingInput,
  FloatingTextarea,
  FLOATING_LABEL_SPACER,
  floatingPlaceholder,
} from "../floating-input";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => cleanup());

describe("floatingPlaceholder()", () => {
  it("przepuszcza realny placeholder bez zmian", () => {
    expect(floatingPlaceholder("jan@firma.pl")).toBe("jan@firma.pl");
    expect(floatingPlaceholder("np. +48 600 000 000")).toBe("np. +48 600 000 000");
  });

  it("dla braku wartości oddaje spacer, nigdy pusty string", () => {
    expect(floatingPlaceholder(undefined)).toBe(FLOATING_LABEL_SPACER);
    expect(floatingPlaceholder(null)).toBe(FLOATING_LABEL_SPACER);
    expect(floatingPlaceholder("")).toBe(FLOATING_LABEL_SPACER);
    expect(floatingPlaceholder("   ")).toBe(FLOATING_LABEL_SPACER);
    // Spacer MUSI być niepusty: `:placeholder-shown` (warunek spoczynkowej
    // pozycji etykiety) nie zadziała dla pustego atrybutu.
    expect(FLOATING_LABEL_SPACER.length).toBeGreaterThan(0);
  });
});

describe("FloatingInput renderuje placeholder z ustawień", () => {
  it("atrybut w DOM to wartość edytora, nie spacja", () => {
    render(<FloatingInput label="E-mail" placeholder="jan@firma.pl" />);
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("placeholder", "jan@firma.pl");
    expect(input.getAttribute("placeholder")).not.toBe(" ");
  });

  it("bez placeholdera zachowuje dotychczasowe zachowanie (spacer)", () => {
    render(<FloatingInput label="Hasło" />);
    expect(screen.getByLabelText("Hasło")).toHaveAttribute("placeholder", FLOATING_LABEL_SPACER);
  });

  it("FloatingTextarea działa tak samo", () => {
    render(<FloatingTextarea label="Wiadomość" placeholder="W czym możemy pomóc?" />);
    const ta = screen.getByLabelText("Wiadomość");
    expect(ta).toHaveAttribute("placeholder", "W czym możemy pomóc?");
    expect(ta.getAttribute("placeholder")).not.toBe(" ");
  });

  it("nie gubi pozostałych atrybutów pola", () => {
    render(<FloatingInput label="Telefon" placeholder="+48 ..." type="tel" required />);
    const input = screen.getByLabelText("Telefon");
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toBeRequired();
  });
});

/**
 * Odwzorowanie warunku unoszenia etykiety zapisanego w CSS:
 * `.input-group > .input:focus ~ .user-label` LUB
 * `.input-group > .input:not(:placeholder-shown) ~ .user-label`.
 *
 * happy-dom nie implementuje `:placeholder-shown` (`matches()` zwraca zawsze
 * false), więc warunek liczymy z DOM-u; obecność samych reguł pilnuje blok
 * "kontrakt CSS" niżej.
 */
function labelFloats(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  const placeholderShown = el.placeholder.length > 0 && el.value === "";
  return document.activeElement === el || !placeholderShown;
}

describe("mechanizm unoszenia etykiety przetrwał realny placeholder", () => {
  it("puste pole z realnym placeholderem trzyma etykietę w środku", () => {
    render(<FloatingInput label="E-mail" placeholder="jan@firma.pl" />);
    const input = screen.getByLabelText("E-mail") as HTMLInputElement;
    // To jest sedno poprawki: `:placeholder-shown` NADAL jest prawdą przy
    // pustej wartości, mimo że placeholder nie jest już spacją.
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("jan@firma.pl");
    expect(labelFloats(input)).toBe(false);
  });

  it("etykieta unosi się po wpisaniu wartości", () => {
    render(<FloatingInput label="E-mail" placeholder="jan@firma.pl" />);
    const input = screen.getByLabelText("E-mail") as HTMLInputElement;
    input.value = "kto@to.pl";
    expect(labelFloats(input)).toBe(true);
  });

  it("etykieta unosi się na focusie, odsłaniając placeholder", () => {
    render(<FloatingInput label="E-mail" placeholder="jan@firma.pl" />);
    const input = screen.getByLabelText("E-mail") as HTMLInputElement;
    input.focus();
    expect(labelFloats(input)).toBe(true);
  });

  it("pole bez placeholdera zachowuje się identycznie jak przed zmianą", () => {
    render(<FloatingInput label="Hasło" />);
    const input = screen.getByLabelText("Hasło") as HTMLInputElement;
    expect(labelFloats(input)).toBe(false);
    input.value = "sekret";
    expect(labelFloats(input)).toBe(true);
  });
});

describe("kontrakt CSS pływającej etykiety (src/styles.css)", () => {
  it("placeholder jest przezroczysty TYLKO poza focusem", () => {
    expect(CSS).toContain(".input-group > .input:not(:focus)::placeholder");
    // Bezwarunkowe ukrycie zabijałoby widoczność placeholdera także po focusie.
    expect(CSS).not.toMatch(/\.input-group > \.input::placeholder\s*\{/);
    expect(CSS).not.toMatch(/\.input-group--on-dark > \.input::placeholder\s*\{/);
  });

  it("ma osobny kolor placeholdera po focusie dla trybu jasnego i ciemnego", () => {
    expect(CSS).toContain(".input-group > .input:focus::placeholder");
    expect(CSS).toContain(".dark .input-group > .input:focus::placeholder");
    expect(CSS).toContain("--gc-input-placeholder-focus");
    expect(CSS).toContain("--gc-input-placeholder-focus-dark");
  });

  it("nie rusza warunku unoszenia etykiety", () => {
    expect(CSS).toContain(".input-group > .input:focus ~ .user-label");
    expect(CSS).toContain(".input-group > .input:not(:placeholder-shown) ~ .user-label");
  });

  it("etykieta jest centrowana względem kontrolki, a nie wrappera z błędem", () => {
    // `.input-group` musi być jednokolumnową siatką, a etykieta i kontrolka
    // muszą jawnie zajmować wiersz 1 - dopiero wtedy `top: 50%` etykiety liczy
    // się względem obszaru pola, a komunikat o błędzie (wiersz 2) nie zsuwa
    // placeholdera w dół.
    const group = CSS.slice(CSS.indexOf(".input-group {"));
    expect(group.slice(0, group.indexOf("}"))).toMatch(/display:\s*grid/);
    expect(CSS).toMatch(
      /\.input-group > \.input,\s*\.input-group > \.user-label \{[^}]*grid-row:\s*1 \/ 2[^}]*grid-column:\s*1 \/ 2[^}]*\}/,
    );
  });

  it("respektuje prefers-reduced-motion", () => {
    const idx = CSS.indexOf(".input-group > .user-label {");
    expect(idx).toBeGreaterThan(-1);
    const reducedMotionBlocks = CSS.matchAll(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.input-group[^}]*\}[^}]*\}/g,
    );
    const hit = [...reducedMotionBlocks].some((m) => m[0].includes(".input-group > .user-label"));
    expect(hit, "brak wyciszenia animacji etykiety dla prefers-reduced-motion").toBe(true);
  });
});
