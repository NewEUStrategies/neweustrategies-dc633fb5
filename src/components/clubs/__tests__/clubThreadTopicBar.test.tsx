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
import type { ClubThreadListRow } from "@/lib/clubs/types";

function thread(topic: string): ClubThreadListRow {
  return { id: topic, topic } as unknown as ClubThreadListRow;
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
