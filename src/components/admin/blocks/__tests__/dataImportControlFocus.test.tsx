// IMPORT SKOROSZYTU Z KILKOMA ARKUSZAMI - fokus po zamknięciu podglądu.
//
// Przycisk arkusza otwiera podgląd i w tym samym renderze znika z drzewa
// (lista arkuszy ustępuje fazie podglądu). Okno nie ma wyzwalacza, a jego
// zapamiętany „otwierający" to już `<body>`, więc po „Zastosuj" albo
// „Anuluj" fokus lądował na `<body>` i użytkownik klawiatury zaczynał od
// początku edytora. Fokus wraca teraz do przycisku importu - kontrolki, od
// której zaczął, która stoi w drzewie przez cały czas.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import "@/lib/i18n-admin-blocks";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/lib/charts/importTable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/charts/importTable")>();
  return {
    ...actual,
    readWorkbook: async () => ({
      problems: [],
      sheets: [
        {
          name: "Arkusz1",
          rows: [
            ["", "A"],
            ["2021", "1"],
          ],
          problems: [],
        },
        {
          name: "Arkusz2",
          rows: [
            ["", "B"],
            ["2022", "2"],
          ],
          problems: [],
        },
      ],
    }),
  };
});

async function wybierzDrugiArkusz() {
  const { container } = render(<DataImportControl onRows={() => []} preview="chart" />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("brak pola pliku");
  fireEvent.change(input, { target: { files: [new File(["x"], "zeszyt.xlsx")] } });
  const arkusz = await screen.findByRole("button", { name: /Arkusz2/ });
  arkusz.focus();
  fireEvent.click(arkusz);
  await screen.findByRole("dialog");
}

describe("DataImportControl - fokus po podglądzie arkusza wybranego z listy", () => {
  it.each(["Zastosuj", "Anuluj"])("„%s” oddaje fokus przyciskowi importu", async (przycisk) => {
    await wybierzDrugiArkusz();
    fireEvent.click(screen.getByRole("button", { name: przycisk }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Importuj z pliku" })),
    );
  });
});
