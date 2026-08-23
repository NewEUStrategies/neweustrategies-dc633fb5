// Trasa edytora popupu `/admin/popups/$id` - jedenaście linii, jedna decyzja
// i 0% pokrycia przed tą pracą.
//
// CO TU JEST DO ZEPSUCIA. Trasa czyta parametr ścieżki i podaje go panelowi
// jako `popupId`. Zgubienie tego parametru (albo podanie złej nazwy w
// `useParams`) daje edytor otwarty na NIEZDEFINIOWANYM popupie: panel ładuje
// pustkę, redaktor wpisuje treść i zapisuje ją albo donikąd, albo do nowego
// rekordu - a popup, który chciał poprawić, dalej wisi na stronie w starej
// wersji. Awaria jest cicha po obu stronach.
//
// Dowód jest wąski i celowo taki: parametr dojeżdża do panelu, a trasa nie
// dokłada od siebie żadnej treści. Zachowanie samego edytora ma własne testy
// w `src/components/admin/popups/__tests__/`.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/popups/PopupEditorPane", () => ({
  PopupEditorPane: ({ popupId }: { popupId: string }) => (
    <div data-testid="edytor-popupu" data-popup-id={popupId} />
  ),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route } from "@/routes/admin.popups.$id";

async function renderEditor(id: string) {
  return renderRoute({
    route: Route,
    path: "/admin/popups/$id",
    initialEntry: `/admin/popups/${id}`,
  });
}

describe("trasa edytora popupu /admin/popups/$id", () => {
  it("przekazuje identyfikator z adresu do panelu edytora", async () => {
    const { getByTestId } = await renderEditor("11111111-1111-4111-8111-111111111111");

    expect(getByTestId("edytor-popupu")).toBeTruthy();
    expect(getByTestId("edytor-popupu").getAttribute("data-popup-id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("DWA różne adresy otwierają DWA różne popupy - kanarek na zgubionym parametrze", async () => {
    // Gdyby `useParams` czytał złą nazwę, oba adresy dałyby to samo (puste)
    // wejście, a redaktor edytowałby nie ten popup, na który patrzy.
    const pierwszy = await renderEditor("popup-a");
    const idA = pierwszy.getByTestId("edytor-popupu").getAttribute("data-popup-id");
    pierwszy.unmount();

    const drugi = await renderEditor("popup-b");
    const idB = drugi.getByTestId("edytor-popupu").getAttribute("data-popup-id");

    expect(idA).toBe("popup-a");
    expect(idB).toBe("popup-b");
  });

  it("trasa nie dokłada własnej treści obok panelu", async () => {
    // Powłoka ma zostać powłoką: treść dołożona tutaj pokazywałaby się nad
    // KAŻDYM edytowanym popupem, także w podglądzie.
    const { container } = await renderEditor("popup-a");

    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("[data-testid='edytor-popupu']")).toHaveLength(1);
  });
});
