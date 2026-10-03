// WYBÓR GŁOSU LEKTORA AI - jedna kontrolka, dwa kontrakty.
//
// CO DOWODZI TEN PLIK. Atom stał na zerze, a jego typ rozłączny obiecuje dwie
// rzeczy, których kompilator nie sprawdzi w RUNTIME:
//   * wariant OBOWIĄZKOWY (ustawienia najemcy) nigdy nie oddaje `null` -
//     głos najemcy musi istnieć, bo bez niego `/api/tts` nie ma czym czytać;
//   * wariant DZIEDZICZĄCY (sekcja Audio wpisu) oddaje `null` dla pozycji
//     „dziedzicz" - pusty napis zapisałby się jako identyfikator głosu spoza
//     allowlisty i serwer odrzuciłby każde czytanie tego wpisu.
// Etykiety barw idą z prawdziwego słownika (PL i EN); nazwy głosów pochodzą
// od dostawcy i nie są tłumaczone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

import i18n from "@/lib/i18n";
import { TTS_VOICES } from "@/lib/audio/ttsCanonical";
import { TtsVoiceSelect } from "../TtsVoiceSelect";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

const [GEORGE, SARAH] = TTS_VOICES;

function options(): string[] {
  return Array.from(screen.getByRole("combobox").querySelectorAll("option")).map(
    (o) => o.textContent ?? "",
  );
}

describe("TtsVoiceSelect - wariant obowiązkowy (ustawienia najemcy)", () => {
  it("wylicza allowlistę głosów z nazwą i barwą ze słownika, bez pozycji pustej", () => {
    render(<TtsVoiceSelect ariaLabel="Głos lektora" value={GEORGE!.id} onChange={() => {}} />);
    const list = options();
    expect(list).toHaveLength(TTS_VOICES.length);
    expect(list[0]).toBe("George - ciepły baryton");
    expect(list).toContain("Sarah - miękki alt");
    expect(screen.getByRole("combobox", { name: "Głos lektora" })).toHaveProperty(
      "value",
      GEORGE!.id,
    );
  });

  it("wybór głosu oddaje jego identyfikator", () => {
    const onChange = vi.fn();
    render(<TtsVoiceSelect ariaLabel="Głos" value={GEORGE!.id} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: SARAH!.id } });
    expect(onChange).toHaveBeenCalledWith(SARAH!.id);
  });

  it("wyłączona kontrolka jest wyłączona", () => {
    render(<TtsVoiceSelect ariaLabel="Głos" value={GEORGE!.id} onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("po angielsku barwy idą ze słownika EN", async () => {
    await i18n.changeLanguage("en");
    render(<TtsVoiceSelect ariaLabel="Voice" value={GEORGE!.id} onChange={() => {}} />);
    expect(options()[0]).toBe("George - warm baritone");
  });
});

describe("TtsVoiceSelect - wariant dziedziczący (sekcja Audio wpisu)", () => {
  it("pierwsza pozycja to „dziedzicz”, a jej wybór oddaje `null`, nie pusty napis", () => {
    const onChange = vi.fn();
    render(
      <TtsVoiceSelect
        ariaLabel="Głos wpisu"
        value={GEORGE!.id}
        inheritLabel="Głos najemcy"
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox");
    const first = select.querySelector("option");
    expect(first?.textContent).toBe("Głos najemcy");

    fireEvent.change(select, { target: { value: first?.getAttribute("value") } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("brak własnego głosu (`null`) pokazuje pozycję „dziedzicz”", () => {
    render(
      <TtsVoiceSelect
        ariaLabel="Głos wpisu"
        value={null}
        inheritLabel="Głos najemcy"
        onChange={() => {}}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Głos najemcy");
  });

  it("wybór konkretnego głosu oddaje jego identyfikator", () => {
    const onChange = vi.fn();
    render(
      <TtsVoiceSelect
        ariaLabel="Głos wpisu"
        value={null}
        inheritLabel="Głos najemcy"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: SARAH!.id } });
    expect(onChange).toHaveBeenCalledWith(SARAH!.id);
  });
});
