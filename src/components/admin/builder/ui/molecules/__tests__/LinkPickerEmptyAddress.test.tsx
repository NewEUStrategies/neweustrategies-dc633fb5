// LinkPicker: link BEZ ADRESU nigdy nie trafia do widgetu.
//
// `update` w pickerze ma straż: gdy po scaleniu łatki nie ma `url`, zapisuje
// `undefined` (brak linku) zamiast obiektu `{ kind, refLabel }` bez adresu.
// Renderer bramkuje przycisk i owinięcie linkiem na samym `url`, więc obiekt
// bez adresu byłby niewidocznym śmieciem w dokumencie, a panel pokazywałby
// „wybrany plik" bez pliku. Do straży da się dojść z granicy: biblioteka
// mediów oddaje pozycję bez publicznego adresu (plik w trakcie przetwarzania,
// usunięty z magazynu). Atrapa biblioteki zwraca właśnie taki pusty adres.
//
// Pozostałe atrapy jak u sąsiada (`LinkPicker.test.tsx`): słownik, Switch
// i klient Supabase (zakładki wpisów/stron pytają bazę).
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub } from "@/test/supabaseChain";
import type { WidgetLink } from "@/lib/builder/types";
import { LinkPicker } from "../LinkPicker";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => supabaseFromStub().from(table) },
}));
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ open, onPick }: { open: boolean; onPick: (url: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick("")}>
        plik bez adresu
      </button>
    ) : null,
}));

function renderPicker(initial?: WidgetLink) {
  const onChange = vi.fn<(next: WidgetLink | undefined) => void>();
  function Host() {
    const [value, setValue] = useState<WidgetLink | undefined>(initial);
    return (
      <LinkPicker
        value={value}
        lang="pl"
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  renderWithQueryClient(<Host />);
  return { onChange };
}

describe("LinkPicker - link bez adresu", () => {
  it("pozycja biblioteki bez adresu zapisuje brak linku, nie obiekt bez url", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "linkPicker.tabs.media" }));
    fireEvent.click(screen.getByRole("button", { name: /linkPicker.chooseFromLibrary/ }));
    fireEvent.click(screen.getByRole("button", { name: "plik bez adresu" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("taki wybór zdejmuje też link, który był ustawiony wcześniej", () => {
    const { onChange } = renderPicker({
      url: "https://cdn.test/stary.pdf",
      kind: "media",
      refLabel: "stary.pdf",
      target: "_blank",
    });
    fireEvent.click(screen.getByRole("button", { name: /linkPicker.changeFile/ }));
    fireEvent.click(screen.getByRole("button", { name: "plik bez adresu" }));
    // Ustawienia wspólne (nowa karta) znikają razem z linkiem - bez adresu
    // nie ma czego otwierać w nowej karcie.
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText("linkPicker.newTab")).toBeNull();
  });
});
