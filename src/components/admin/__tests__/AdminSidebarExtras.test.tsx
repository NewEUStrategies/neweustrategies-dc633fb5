/**
 * `AdminSidebarExtras` - slot, przez który ekran panelu wstawia SWOJĄ nawigację
 * wtórną do globalnego sidebara (używa go m.in. edytor opcji motywu).
 *
 * CO TU JEST PRZEDMIOTEM DOWODU (a czego nie).
 *   * Sklejenie „ekran publikuje -> sidebar rysuje" mierzy `AdminShell.test.tsx`
 *     na prawdziwej powłoce. Tutaj chodzi o sam kontrakt kontekstu, w tym
 *     o jego DOMYŚLNĄ wartość: `useAdminSidebarExtrasSlot()` wywołane POZA
 *     dostawcą ma oddać pusty slot i BEZPIECZNIE zignorować zapis. To nie jest
 *     przypadek teoretyczny - panele publikują swoje menu w `useEffect`, a te
 *     same panele bywają montowane w testach i podglądach bez powłoki admina;
 *     rzucający `setExtras` wywracałby wtedy cały ekran.
 *   * Dostawca trzyma stan (nie przepisuje go przy każdym renderze), więc
 *     publikacja z jednego poddrzewa jest widoczna w drugim.
 */
import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  AdminSidebarExtrasProvider,
  useAdminSidebarExtrasSlot,
  type ExtraNav,
} from "@/components/admin/AdminSidebarExtras";

const NAV: ExtraNav = {
  title: "Sekcje wyglądu",
  items: [{ id: "header", label: "Nagłówek" }],
  onSelect: () => {},
};

/** Czytelnik slotu - odwzorowuje to, co robi sidebar powłoki. */
function SlotReader() {
  const { extras } = useAdminSidebarExtrasSlot();
  return <p>{extras ? `slot: ${extras.title ?? "bez tytułu"}` : "slot pusty"}</p>;
}

describe("AdminSidebarExtras", () => {
  it("bez dostawcy slot jest pusty, a publikacja nic nie robi i nie rzuca", () => {
    const { result } = renderHook(() => useAdminSidebarExtrasSlot());

    expect(result.current.extras).toBeNull();
    expect(() => act(() => result.current.setExtras(NAV))).not.toThrow();
    expect(result.current.extras).toBeNull();
  });

  it("publikacja z jednego poddrzewa dociera do drugiego i da się ją cofnąć", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdminSidebarExtrasProvider>
        <SlotReader />
        {children}
      </AdminSidebarExtrasProvider>
    );
    const { result } = renderHook(() => useAdminSidebarExtrasSlot(), { wrapper });

    expect(screen.getByText("slot pusty")).toBeInTheDocument();

    act(() => result.current.setExtras(NAV));
    expect(screen.getByText("slot: Sekcje wyglądu")).toBeInTheDocument();

    act(() => result.current.setExtras(null));
    expect(screen.getByText("slot pusty")).toBeInTheDocument();
  });

  it("dostawca przepuszcza treść ekranu bez zmian", () => {
    render(
      <AdminSidebarExtrasProvider>
        <h1>Opcje motywu</h1>
      </AdminSidebarExtrasProvider>,
    );

    expect(screen.getByRole("heading", { name: "Opcje motywu" })).toBeInTheDocument();
  });
});
