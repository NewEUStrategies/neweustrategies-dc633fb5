// Wybór kroju w panelach ustawień (`FontPicker`). Do tego pliku jedenaście linii
// i osiem funkcji na zerze: konsumenci w testach (`TypographyControl`, trasy
// ustawień) nie otwierali listy ani nie wybierali opcji.
//
// PRZEDMIOT DOWODU: podgląd fontów ładuje się RAZ na dokument, własne fonty
// najemcy stoją przed katalogiem, wybór oddaje PEŁNY stos `font-family`
// (to on idzie do bazy), „domyślny" oddaje `undefined`, a klik poza listą ją
// zamyka. NAPRAWA: wartość spoza listy nie podpisuje się już jako „domyślny".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { FontPicker } from "@/components/admin/settings/FontPicker";
import type { CustomFont } from "@/lib/theme/customFonts";

const t = (key: string) => i18n.t(`adminPanesMisc.fontPicker.${key}`);
const LINK_ID = "__brand-font-picker-fonts";

const CUSTOM: CustomFont[] = [
  { id: "brand-sans", label: "Brand Sans", url: "https://cdn.example.com/brand.woff2" },
];

beforeEach(async () => {
  document.getElementById(LINK_ID)?.remove();
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

function trigger(): HTMLElement {
  return screen.getAllByRole("button")[0];
}

describe("FontPicker", () => {
  it("dokleja arkusz Google Fonts RAZ, nawet przy kilku pickerach", () => {
    render(
      <>
        <FontPicker value={undefined} onChange={() => {}} />
        <FontPicker value={undefined} onChange={() => {}} />
      </>,
    );
    const links = document.querySelectorAll(`#${LINK_ID}`);
    expect(links).toHaveLength(1);
    const href = (links[0] as HTMLLinkElement).href;
    expect(href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    expect(href).toContain("display=swap");
  });

  it("bez wartości: etykieta „domyślny”, podgląd stosem domyślnym i własnym tekstem próbki", () => {
    render(<FontPicker value={undefined} onChange={() => {}} sampleText="Zażółć gęślą jaźń" />);
    expect(trigger()).toHaveTextContent(t("defaultLabel"));
    const sample = screen.getByText("Zażółć gęślą jaźń");
    expect(sample.style.fontFamily).toContain("Red Hat Display");
  });

  it("lista: „domyślny” z zaznaczeniem, własne fonty NAJPIERW z dopiskiem, potem katalog", () => {
    render(<FontPicker value={undefined} onChange={() => {}} customFonts={CUSTOM} />);
    fireEvent.click(trigger());
    const options = screen.getAllByRole("button").slice(1);
    expect(options[0]).toHaveTextContent(t("defaultLabel"));
    expect(options[0].querySelector("svg")).not.toBeNull();
    expect(options[1]).toHaveTextContent(`Brand Sans ${t("customSuffix")} · ${t("customHint")}`);
    expect(options[2]).toHaveTextContent("Red Hat Display");
    expect(options.length).toBeGreaterThan(10);
  });

  it("wybór oddaje PEŁNY stos font-family i zamyka listę", () => {
    const onChange = vi.fn();
    render(<FontPicker value={undefined} onChange={onChange} customFonts={CUSTOM} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText(/^Inter ·/).closest("button") as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("Inter, system-ui, sans-serif");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(trigger());
    fireEvent.click(screen.getByText(/^Brand Sans/).closest("button") as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith('"brand-sans", system-ui, sans-serif');
  });

  it("wybrana wartość: etykieta opcji na przycisku i zaznaczenie przy niej, nie przy „domyślnym”", () => {
    render(<FontPicker value="Lora, Georgia, serif" onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Lora");
    fireEvent.click(trigger());
    const options = screen.getAllByRole("button").slice(1);
    expect(options[0].querySelector("svg")).toBeNull();
    const lora = screen.getByText(/^Lora ·/).closest("button") as HTMLElement;
    expect(lora.querySelector("svg")).not.toBeNull();
    expect(lora.className).toContain("bg-muted/40");
  });

  it("„domyślny” oddaje `undefined` - kasuje nadpisanie zamiast zapisywać stos", () => {
    const onChange = vi.fn();
    render(<FontPicker value="Lora, Georgia, serif" onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("klik poza listą ją zamyka, klik w środku - nie", () => {
    render(
      <div>
        <span>poza</span>
        <FontPicker value={undefined} onChange={() => {}} />
      </div>,
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByText(/^Inter ·/));
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    fireEvent.mouseDown(screen.getByText("poza"));
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("przycisk przełącza listę", () => {
    render(<FontPicker value={undefined} onChange={() => {}} />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("NAPRAWA: wartość spoza listy podpisuje się swoją rodziną, nie „domyślnym”", () => {
    render(<FontPicker value={"'Fira Sans', sans-serif"} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Fira Sans");
    expect(trigger()).not.toHaveTextContent(t("defaultLabel"));
  });

  it("dwa własne fonty o tej samej nazwie są dwiema opcjami", () => {
    render(
      <FontPicker
        value={undefined}
        onChange={() => {}}
        customFonts={[...CUSTOM, { ...CUSTOM[0], id: "brand-sans-2" }]}
      />,
    );
    fireEvent.click(trigger());
    expect(screen.getAllByText(/^Brand Sans/)).toHaveLength(2);
  });
});
