// Toaster (sonner) - położenie listy i nazwa regionu. Kontrakt opakowania:
//  - lista toastów stoi nad zajętym pasem dolnej krawędzi: rezerwacją paska
//    członka (`--mbb-reserve`) i otwartym panelem narzędzia doku
//    (`--wd-panel-space`). Bez tego toast zasłaniał zakładki paska, kompozytor
//    skrzynki czatu albo pole wpisywania otwartego panelu. U gościa obu
//    zmiennych nie ma, więc zostają domyślne odstępy sonnera (24/16 px);
//  - region powiadomień ma nazwę w języku interfejsu (słownik rdzenia), a nie
//    angielskie „Notifications” biblioteki.
//
// Motyw i kolory pilnuje `sonnerTheme.test.tsx`, montaż bez odczytu stylów
// `sonner.test.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { realT } from "@/test/i18nReal";
import { Toaster } from "../sonner";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

async function showToast(): Promise<HTMLOListElement> {
  act(() => {
    toast("Nowa wiadomość");
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const list = document.querySelector<HTMLOListElement>("[data-sonner-toaster]");
  if (!list) throw new Error("test: lista toastów się nie wyrenderowała");
  return list;
}

describe("Toaster - położenie i nazwa regionu", () => {
  it("lista toastów (desktop i telefon) stoi nad paskiem członka i nad otwartym panelem doku", async () => {
    render(<Toaster />);
    const list = await showToast();
    const desktop = list.style.getPropertyValue("--offset-bottom");
    const mobile = list.style.getPropertyValue("--mobile-offset-bottom");

    for (const bottom of [desktop, mobile]) {
      expect(bottom).toContain("var(--mbb-reserve, 0px)");
      expect(bottom).toContain("var(--wd-panel-space, 0px)");
    }
    // Odstęp od zajętego pasa: domyślne odstępy sonnera, 24 px i 16 px.
    expect(desktop.endsWith("+ 24px)")).toBe(true);
    expect(mobile.endsWith("+ 16px)")).toBe(true);
  });

  it("boki listy zostają przy domyślnych odstępach sonnera", async () => {
    render(<Toaster />);
    const list = await showToast();
    expect(list.style.getPropertyValue("--offset-right")).toBe("24px");
    expect(list.style.getPropertyValue("--mobile-offset-right")).toBe("16px");
  });

  it("region powiadomień nazywa się w języku interfejsu, ze skrótem Alt+T", () => {
    render(<Toaster />);
    const name = `${realT("pl")("notifications.title")} alt+T`;
    expect(name.startsWith("Powiadomienia")).toBe(true);
    expect(screen.getByRole("region", { name })).toHaveAttribute("aria-live", "polite");
  });

  it("wywołujący może nadpisać położenie (np. panel administracyjny)", async () => {
    render(<Toaster offset={{ bottom: "8px" }} />);
    const list = await showToast();
    expect(list.style.getPropertyValue("--offset-bottom")).toBe("8px");
  });
});
