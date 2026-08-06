// Atomy edycji „w miejscu" (InlineText / InlineTextarea) - fundament edytora
// profilu. Zapisy idą stąd wprost do bazy, więc kontrakt jest twardy:
//   * zapis WYŁĄCZNIE przy realnej zmianie (identyczna wartość nie generuje
//     ruchu do bazy - inaczej każde kliknięcie w pole byłoby zapisem),
//   * wartość jest przycinana przed zapisem (spójnie z CHECK-ami w bazie),
//   * Esc przywraca stan sprzed edycji,
//   * po zapisie komponent wraca do trybu odczytu także wtedy, gdy zapis rzucił.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineText } from "../inline/InlineText";
import { InlineTextarea } from "../inline/InlineTextarea";

/** Wejście w tryb edycji: kliknięcie w powierzchnię odczytu. */
function openEditor(ariaLabel: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: ariaLabel }));
  return screen.getByRole("textbox", { name: ariaLabel });
}

describe("InlineText", () => {
  it("pokazuje wartość, a puste pole zastępuje etykietą zastępczą", () => {
    const { rerender } = render(
      <InlineText value="Anna Kowalska" onSave={vi.fn()} ariaLabel="Imię i nazwisko" />,
    );
    expect(screen.getByRole("button", { name: "Imię i nazwisko" })).toHaveTextContent(
      "Anna Kowalska",
    );

    rerender(
      <InlineText
        value="   "
        onSave={vi.fn()}
        ariaLabel="Imię i nazwisko"
        emptyLabel="Dodaj imię"
      />,
    );
    expect(screen.getByRole("button", { name: "Imię i nazwisko" })).toHaveTextContent("Dodaj imię");
  });

  it("spada na placeholder, gdy nie ma etykiety pustego stanu", () => {
    render(
      <InlineText
        value={null}
        onSave={vi.fn()}
        ariaLabel="Stanowisko"
        placeholder="np. analityk"
      />,
    );
    expect(screen.getByRole("button", { name: "Stanowisko" })).toHaveTextContent("np. analityk");
  });

  it("zapisuje przyciętą wartość po Enterze", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineText value="stare" onSave={onSave} ariaLabel="Pole" />);

    const input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "  nowe  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("nowe"));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("NIE zapisuje, gdy wartość nie zmieniła się po przycięciu", async () => {
    const onSave = vi.fn();
    render(<InlineText value="Ala" onSave={onSave} ariaLabel="Pole" />);

    const input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "  Ala  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Esc porzuca zmiany i wraca do poprzedniej wartości", () => {
    const onSave = vi.fn();
    render(<InlineText value="Ala" onSave={onSave} ariaLabel="Pole" />);

    const input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "Ola" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pole" })).toHaveTextContent("Ala");
  });

  it('przycisk „Cancel" działa jak Esc, a „Save" jak Enter', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineText value="Ala" onSave={onSave} ariaLabel="Pole" />);

    let input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "AlaX" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();

    input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "AlaY" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("AlaY"));
  });

  it("utrata fokusu zapisuje (autosave na blur)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineText value="Ala" onSave={onSave} ariaLabel="Pole" />);

    const input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "Ala!" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Ala!"));
  });

  it("respektuje limit długości przekazany z formularza", () => {
    render(<InlineText value="" onSave={vi.fn()} ariaLabel="Pole" maxLength={5} />);
    expect(openEditor("Pole")).toHaveAttribute("maxLength", "5");
  });

  it("domyślny limit chroni kolumnę bazy nawet bez jawnej wartości", () => {
    render(<InlineText value="" onSave={vi.fn()} ariaLabel="Pole" />);
    expect(openEditor("Pole")).toHaveAttribute("maxLength", "200");
  });

  // commit() jest odpalany z `void`, więc nieprzechwycone odrzucenie wypłynęłoby
  // jako `unhandledrejection` do globalnego przechwytywania błędów i zgłosiło
  // nieudany zapis pola jako awarię platformy.
  it("wraca do trybu odczytu i nie zostawia wiszącego odrzucenia, gdy zapis rzucił", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("RLS"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<InlineText value="Ala" onSave={onSave} ariaLabel="Pole" />);

    const input = openEditor("Pole");
    fireEvent.change(input, { target: { value: "AlaX" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith("AlaX");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("klawisz bez przypisanej akcji nie zamyka edycji", () => {
    render(<InlineText value="Ala" onSave={vi.fn()} ariaLabel="Pole" />);
    const input = openEditor("Pole");
    fireEvent.keyDown(input, { key: "a" });
    expect(screen.getByRole("textbox", { name: "Pole" })).toBeInTheDocument();
  });

  it.each(["title", "subtitle", "muted", "plain"] as const)(
    "renderuje wariant %s bez zmiany kontraktu dostępności",
    (variant) => {
      render(<InlineText value="X" onSave={vi.fn()} ariaLabel="Pole" variant={variant} />);
      expect(screen.getByRole("button", { name: "Pole" })).toBeInTheDocument();
    },
  );

  it("aktualizuje wyświetlaną wartość, gdy zmieni ją rodzic", () => {
    const { rerender } = render(<InlineText value="A" onSave={vi.fn()} ariaLabel="Pole" />);
    rerender(<InlineText value="B" onSave={vi.fn()} ariaLabel="Pole" />);
    expect(screen.getByRole("button", { name: "Pole" })).toHaveTextContent("B");
  });
});

describe("InlineTextarea", () => {
  it("zapisuje skrótem Ctrl/Cmd+Enter, a zwykły Enter zostawia nową linię", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineTextarea value="Bio" onSave={onSave} ariaLabel="Bio" />);

    const area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "Bio\ndruga linia" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Bio\ndruga linia"));
  });

  it("skrót Cmd+Enter działa tak samo jak Ctrl+Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineTextarea value="Bio" onSave={onSave} ariaLabel="Bio" />);

    const area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "Bio 2" } });
    fireEvent.keyDown(area, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Bio 2"));
  });

  it("Esc porzuca zmiany", () => {
    const onSave = vi.fn();
    render(<InlineTextarea value="Bio" onSave={onSave} ariaLabel="Bio" />);

    const area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "zmiana" } });
    fireEvent.keyDown(area, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Bio" })).toHaveTextContent("Bio");
  });

  it("nie wysyła zapisu przy niezmienionej treści", async () => {
    const onSave = vi.fn();
    render(<InlineTextarea value="  Bio  " onSave={onSave} ariaLabel="Bio" />);

    const area = openEditor("Bio");
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("przyjmuje liczbę wierszy i limit znaków z formularza", () => {
    render(<InlineTextarea value="" onSave={vi.fn()} ariaLabel="Bio" rows={7} maxLength={120} />);
    const area = openEditor("Bio");
    expect(area).toHaveAttribute("rows", "7");
    expect(area).toHaveAttribute("maxLength", "120");
  });

  it("puste bio pokazuje etykietę zastępczą, a bez niej placeholder", () => {
    const { rerender } = render(
      <InlineTextarea
        value={null}
        onSave={vi.fn()}
        ariaLabel="Bio"
        emptyLabel="Opowiedz o sobie"
      />,
    );
    expect(screen.getByRole("button", { name: "Bio" })).toHaveTextContent("Opowiedz o sobie");

    rerender(
      <InlineTextarea value="" onSave={vi.fn()} ariaLabel="Bio" placeholder="Kilka zdań o Tobie" />,
    );
    expect(screen.getByRole("button", { name: "Bio" })).toHaveTextContent("Kilka zdań o Tobie");
  });

  it("przyciski akcji zapisują i anulują", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineTextarea value="Bio" onSave={onSave} ariaLabel="Bio" />);

    let area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "Bio!" } });
    fireEvent.click(screen.getByRole("button", { name: /Esc/ }));
    expect(onSave).not.toHaveBeenCalled();

    area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "Bio?" } });
    fireEvent.click(screen.getByRole("button", { name: /⌘⏎/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Bio?"));
  });

  it("wraca do odczytu i nie zostawia wiszącego odrzucenia, gdy zapis rzucił", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("RLS"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<InlineTextarea value="Bio" onSave={onSave} ariaLabel="Bio" />);

    const area = openEditor("Bio");
    fireEvent.change(area, { target: { value: "Bio X" } });
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
