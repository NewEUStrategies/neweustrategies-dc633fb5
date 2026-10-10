// PRÓBNIK KOLORU SERII - klawiatura grupy radiowej.
//
// Próbki są ogłaszane jako „przycisk opcji, n z m", więc użytkownik czytnika
// ekranu sięga po strzałki, jak obiecuje wzorzec ARIA - a do tej poprawki
// strzałki nie robiły nic, a Tab przechodził po wszystkich czternastu
// próbkach po kolei. Teraz każda grupa to JEDEN przystanek Tabu (próbka
// wybrana, a w grupie bez wyboru - pierwsza), strzałki, Home i End chodzą
// po próbkach grupy z zawinięciem, a Enter albo spacja wybiera.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import { ChartColorPicker } from "../ChartColorPicker";
import { PICKER_OTHER, PICKER_RECOMMENDED } from "../chartColorSlots";

function zamontuj(slot: number) {
  const onChange = vi.fn<(slot: number) => void>();
  render(
    <ChartColorPicker
      slot={slot}
      paint={`var(--chart-${slot})`}
      label="Kolor serii Eksport"
      open
      onOpenChange={() => {}}
      onChange={onChange}
      lang="pl"
    />,
  );
  const grupy = screen.getAllByRole("radiogroup");
  return { onChange, grupy };
}

const przystanki = (grupa: HTMLElement) =>
  within(grupa)
    .getAllByRole("radio")
    .filter((r) => r.tabIndex === 0);

describe("ChartColorPicker - jedna grupa, jeden przystanek Tabu", () => {
  it("w każdej grupie Tab zatrzymuje się raz: na wybranej próbce albo na pierwszej", () => {
    const wybrany = PICKER_RECOMMENDED[2];
    const { grupy } = zamontuj(wybrany);
    expect(grupy).toHaveLength(2);
    const [polecane, pozostale] = grupy;
    expect(przystanki(polecane)).toHaveLength(1);
    expect(przystanki(polecane)[0].getAttribute("data-slot")).toBe(String(wybrany));
    expect(przystanki(pozostale)).toHaveLength(1);
    expect(przystanki(pozostale)[0].getAttribute("data-slot")).toBe(String(PICKER_OTHER[0]));
  });

  it("strzałki, Home i End przenoszą fokus po próbkach grupy, z zawinięciem", () => {
    const { grupy, onChange } = zamontuj(PICKER_RECOMMENDED[0]);
    const radia = within(grupy[0]).getAllByRole("radio");
    radia[0].focus();
    fireEvent.keyDown(radia[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radia[1]);
    fireEvent.keyDown(radia[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(radia[2]);
    fireEvent.keyDown(radia[2], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radia[1]);
    fireEvent.keyDown(radia[1], { key: "End" });
    expect(document.activeElement).toBe(radia[radia.length - 1]);
    fireEvent.keyDown(radia[radia.length - 1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radia[0]);
    fireEvent.keyDown(radia[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(radia[radia.length - 1]);
    fireEvent.keyDown(radia[radia.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(radia[0]);
    // Ruch fokusu niczego nie wybiera - wybór zamyka próbnik i zapisuje krok.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przystanek Tabu idzie za fokusem, a wybór dalej robi klik (Enter, spacja)", () => {
    const { grupy, onChange } = zamontuj(PICKER_RECOMMENDED[0]);
    const radia = within(grupy[0]).getAllByRole("radio");
    radia[0].focus();
    fireEvent.keyDown(radia[0], { key: "ArrowRight" });
    expect(przystanki(grupy[0])).toEqual([radia[1]]);
    fireEvent.click(radia[1]);
    expect(onChange).toHaveBeenCalledWith(PICKER_RECOMMENDED[1]);
  });
});
