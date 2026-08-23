// Molekuła: wiersz "nic tu nie ma" dla tabel panelu reklam.
//
// W trasie stały DWIE kopie tego wiersza (sloty i pozycje) - z różnym
// `colSpan` i z osobnymi, twardymi napisami. Jedna kopia zamiast dwóch znaczy,
// że podmiana literalu na klucz i18n będzie zmianą w JEDNYM miejscu; tekst
// przychodzi propsem, więc molekuła nie zna słownika.
import type { ReactNode } from "react";

export function AdTableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-6 text-center text-muted-foreground text-sm">
        {children}
      </td>
    </tr>
  );
}
