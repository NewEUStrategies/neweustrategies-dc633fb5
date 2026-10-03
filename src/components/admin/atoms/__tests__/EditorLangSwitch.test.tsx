// `EditorLangSwitch` - przełącznik WERSJI JĘZYKOWEJ TREŚCI w edytorach
// (builder Elementor, edytor bloków wpisu). W odróżnieniu od przełączników
// języka interfejsu jest sterowany: nie nawiguje i nie dotyka i18next, tylko
// zgłasza wybór rodzicowi. Plik pilnuje, że:
//   * zaznaczenie (`aria-pressed`, kod języka, położenie kciuka) idzie za
//     propsem `lang`,
//   * klik w język nieaktywny zgłasza zmianę dokładnie raz, a w aktywny - nic,
//   * klik i pointerdown NIE wychodzą poza przełącznik: kanwa buildera łapie
//     pointerdown do przeciągania, a klik w toolbarze nie może zaznaczać
//     widgetu pod spodem ani wysyłać formularza edytora,
//   * nazwy przycisków i etykieta grupy pochodzą ze słownika.
import "@/lib/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { realT } from "@/test/i18nReal";
import { EditorLangSwitch } from "../EditorLangSwitch";

const t = realT("pl");
const PL = t("common.lang.pl");
const EN = t("common.lang.en");

afterEach(cleanup);

describe("EditorLangSwitch - zaznaczenie", () => {
  it("dla PL: aktywny polski z kodem, kciuk na początku", () => {
    const { container } = render(<EditorLangSwitch lang="pl" onLangChange={() => {}} />);

    const pl = screen.getByRole("button", { name: PL });
    const en = screen.getByRole("button", { name: EN });
    expect(pl).toHaveAttribute("aria-pressed", "true");
    expect(pl.textContent).toBe("pl");
    expect(pl.className).toContain("is-active");
    expect(en).toHaveAttribute("aria-pressed", "false");
    // Nieaktywna połowa pokazuje samą flagę, bez kodu języka.
    expect(en.textContent).toBe("");
    expect(en.className).toContain("w-8");
    const thumb = container.querySelector(".lang__thumb") as HTMLElement;
    expect(thumb.style.transform).toBe("translateX(0)");
  });

  it("dla EN: aktywny angielski z kodem, kciuk przesunięty o zwiniętą połowę", () => {
    const { container } = render(<EditorLangSwitch lang="en" onLangChange={() => {}} />);

    expect(screen.getByRole("button", { name: EN })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: EN }).textContent).toBe("en");
    expect(screen.getByRole("button", { name: PL })).toHaveAttribute("aria-pressed", "false");
    const thumb = container.querySelector(".lang__thumb") as HTMLElement;
    expect(thumb.style.transform).toBe("translateX(32px)");
  });

  it("grupa ma etykietę ze słownika, a dodatkowa klasa trafia na korzeń", () => {
    render(<EditorLangSwitch lang="pl" onLangChange={() => {}} className="ml-auto" />);

    const group = screen.getByRole("group", { name: t("admin.language") });
    expect(group.className).toContain("ml-auto");
  });

  it("bez className nie dokleja 'undefined' do klas", () => {
    render(<EditorLangSwitch lang="pl" onLangChange={() => {}} />);

    expect(screen.getByRole("group").className).not.toContain("undefined");
  });
});

describe("EditorLangSwitch - zmiana wersji językowej", () => {
  it("klik w język nieaktywny zgłasza go dokładnie raz", () => {
    const onLangChange = vi.fn();
    render(<EditorLangSwitch lang="pl" onLangChange={onLangChange} />);

    fireEvent.click(screen.getByRole("button", { name: EN }));

    expect(onLangChange).toHaveBeenCalledTimes(1);
    expect(onLangChange).toHaveBeenCalledWith("en");
  });

  it("klik w język aktywny niczego nie zgłasza", () => {
    const onLangChange = vi.fn();
    render(<EditorLangSwitch lang="en" onLangChange={onLangChange} />);

    fireEvent.click(screen.getByRole("button", { name: EN }));

    expect(onLangChange).not.toHaveBeenCalled();
  });

  it("klik nie wychodzi poza przełącznik i ma zablokowaną akcję domyślną", () => {
    const outerClick = vi.fn();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onLangChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <div onClick={outerClick}>
          <EditorLangSwitch lang="pl" onLangChange={onLangChange} />
        </div>
      </form>,
    );

    // `fireEvent` zwraca false, gdy handler wywołał preventDefault().
    const notCancelled = fireEvent.click(screen.getByRole("button", { name: EN }));

    expect(notCancelled).toBe(false);
    expect(onLangChange).toHaveBeenCalledWith("en");
    expect(outerClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("pointerdown nie dociera do kanwy buildera (brak startu przeciągania)", () => {
    const canvasPointerDown = vi.fn();
    render(
      <div onPointerDown={canvasPointerDown}>
        <EditorLangSwitch lang="pl" onLangChange={() => {}} />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: PL }));
    fireEvent.pointerDown(screen.getByRole("button", { name: EN }));

    expect(canvasPointerDown).not.toHaveBeenCalled();
  });
});
