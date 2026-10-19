// TeamMemberWidget: zamykanie karty osoby i powrót fokusu.
//
// Co udowadniamy i dlaczego: karta otwiera prawdziwy Radix Dialog z bio i
// kontaktem. Czytelnik klawiatury musi móc ją zamknąć klawiszem Escape; po
// zamknięciu fokus WRACA na kafelek osoby
// (`onCloseAutoFocus` -> triggerRef), inaczej ląduje na <body> i użytkownik
// klawiatury traci miejsce na stronie. Dialog bez kontaktu nie renderuje pustej
// listy definicji, a nazwa okna ma fallback, gdy redakcja nie podała nazwiska.
//
// Zamykanie z zewnątrz należy do Radix (domyślne zachowanie okna modalnego):
// klik poza kartą zamyka ją i oddaje fokus kafelkowi, ale prawy klik (menu
// kontekstowe) karty NIE zamyka. Dawne własne `onPointerDownOutside` /
// `onInteractOutside` wołały `setOpen(false)` bez względu na decyzję Radix,
// więc zamykały kartę także prawym klikiem.
//
// Granice: klient Supabase (BrandIcon czyta bibliotekę ikon) -> pusty łańcuch;
// Dialog, sanitizeHtml i sam widget są prawdziwe.
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { WidgetContent } from "@/lib/builder/types";
import { TeamMemberWidget } from "../TeamMemberWidget";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "is", "order", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () =>
    Promise.resolve({ data: null, error: null });
  return { supabase: chain };
});

afterEach(cleanup);

/** Otwarte okno; Radix podpina słuchaczy „poza oknem" dopiero w następnym zadaniu. */
async function openedDialog(name: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name });
  await settle();
  return dialog;
}

/** Jedno zadanie makro - czas na timery Radix i ewentualne zamknięcie. */
function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

function renderWidget(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamMemberWidget
        node={{ id: "tm-dismiss", kind: "widget", type: "team-member", content }}
        lang={lang}
      />
    </QueryClientProvider>,
  );
}

describe("TeamMemberWidget - zamykanie karty", () => {
  it("Escape zamyka kartę, a fokus wraca na kafelek osoby", async () => {
    renderWidget({ name: "Anna Kowalska", position_pl: "Dyrektorka" });
    const trigger = screen.getByRole("button", { name: "Anna Kowalska" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Anna Kowalska" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("klik poza kartą zamyka ją, a fokus wraca na kafelek osoby", async () => {
    renderWidget({ name: "Anna Kowalska" });
    const trigger = screen.getByRole("button", { name: "Anna Kowalska" });
    trigger.focus();
    fireEvent.click(trigger);
    await openedDialog("Anna Kowalska");

    // Okno modalne Radix odracza zamknięcie lewym przyciskiem do kliku -
    // pełny gest: wciśnięcie i klik na tle.
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("prawy klik poza kartą (menu kontekstowe) jej nie zamyka", async () => {
    renderWidget({ name: "Anna Kowalska" });
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    await openedDialog("Anna Kowalska");

    fireEvent.pointerDown(document.body, { button: 2 });
    await settle();
    expect(screen.getByRole("dialog", { name: "Anna Kowalska" })).toBeInTheDocument();
  });

  it("bez nazwiska okno ma nazwę zastępczą, a bez kontaktu nie ma pustej listy", async () => {
    renderWidget({ position_en: "Advisor" }, "en");
    fireEvent.click(screen.getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "Team member" });
    expect(dialog.querySelector("dl")).toBeNull();
    // Opis okna = stanowisko w bieżącym języku.
    expect(screen.getAllByText("Advisor").length).toBeGreaterThan(0);
  });
});
