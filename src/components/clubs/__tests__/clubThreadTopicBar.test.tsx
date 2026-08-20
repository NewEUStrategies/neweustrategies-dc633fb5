// Pasek obszarów tematycznych nad strumieniem.
//
// CO TEN TEST PILNUJE. Dwie obietnice nie do sprawdzenia na czystej funkcji:
// że pasek znika, gdy w klubie żyje najwyżej jeden obszar (nie ma czego
// wybierać), i że kliknięcie obszaru przełącza go tam i z powrotem.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));

import { ClubThreadTopicBar } from "@/components/clubs/molecules/ClubThreadTopicBar";
import { clubThreadListRow } from "@/test/clubs/fixtures";
import type { ClubThreadListRow } from "@/lib/clubs/types";

/**
 * Wiersz wątku z FIXTURE'A, nie z rzutowania. Wcześniej stało tu
 * `{ id, topic } as unknown as ClubThreadListRow` - a rzutowanie przez `unknown`
 * znosi gwarancję, że test w ogóle testuje ten kształt: zniknięcie kolumny
 * `topic` z RPC przeszłoby przez `tsc` bez słowa.
 */
let licznikWatkow = 0;
function thread(topic: string): ClubThreadListRow {
  licznikWatkow += 1;
  return clubThreadListRow({ id: `thread-${licznikWatkow}`, topic });
}

const CATALOG = [
  { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
  { key: "cybersecurity", label_pl: "Cyberbezpieczeństwo", label_en: "Cyber", sort_order: 20 },
];

describe("ClubThreadTopicBar", () => {
  it("znika, gdy w klubie żyje najwyżej jeden obszar", () => {
    const { container, rerender } = render(
      <ClubThreadTopicBar threads={[]} catalog={CATALOG} value={null} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("energy")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje chip na obszar z liczbą wątków i chip 'wszystkie' z sumą", () => {
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("Cyberbezpieczeństwo")).toBeInTheDocument();
    const all = screen.getByRole("button", { name: /club.hub.allTopics/ });
    expect(all).toHaveTextContent("3");
  });

  it("zawęża kliknięciem i zdejmuje ponownym kliknięciem tego samego obszaru", () => {
    const onChange = vi.fn();
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Energetyka"));
    expect(onChange).toHaveBeenCalledWith("energy");
  });

  it("chip „wszystkie” ZDEJMUJE zawężenie - to jego jedyne zadanie", () => {
    // Bez tego przycisku obszar wybrany raz zostaje na zawsze: pozostałe chipy
    // przełączają się tylko między sobą, a „ten sam obszar drugi raz" wymaga
    // trafienia w dokładnie ten sam chip.
    const onChange = vi.fn();
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value="energy"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /club\.hub\.allTopics/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("ponowne kliknięcie AKTYWNEGO obszaru zdejmuje zawężenie, nie ustawia go drugi raz", () => {
    const onChange = vi.fn();
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value="energy"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Energetyka"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("kliknięcie INNEGO obszaru przy aktywnym zawężeniu przestawia je, a nie zdejmuje", () => {
    const onChange = vi.fn();
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value="energy"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Cyberbezpieczeństwo"));
    expect(onChange).toHaveBeenCalledWith("cybersecurity");
  });

  it("obszar spoza katalogu pokazuje SWÓJ klucz, a nie pustą etykietę", () => {
    // `topic` w bazie jest zwykłym tekstem, więc wątek może nieść obszar, który
    // wypadł z katalogu. Pusty chip byłby nieklikalnym białym polem.
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("obszar-poza-katalogiem")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/obszar-poza-katalogiem/)).toBeInTheDocument();
  });

  it("`className` z zewnątrz ląduje na kontenerze, a jego brak nie dokłada atrybutu", () => {
    const { container, unmount } = render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
        className="mb-4"
      />,
    );
    expect(container.firstElementChild?.className).toBe("mb-4");
    unmount();

    const bez = render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(bez.container.firstElementChild?.getAttribute("class")).toBeNull();
  });

  it("pasek jest nawigacją Z OPISEM - czytnik ekranu musi wiedzieć, co to za lista", () => {
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("club.topic.label");
  });

  it("chip aktywnego obszaru ma aria-pressed", () => {
    render(
      <ClubThreadTopicBar
        threads={[thread("energy"), thread("cybersecurity")]}
        catalog={CATALOG}
        value="energy"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Energetyka/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
