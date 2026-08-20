// Menu konta czytelnika: pozycje w trzech sekcjach (gość / zalogowany /
// stopka menu), każda jednego z pięciu rodzajów (preset, strona, własny link,
// separator, wylogowanie).
//
// Reguły przypięte tutaj, bo to na nich menu psuje się w praktyce:
//  1. PRZENOSZENIE działa w obrębie WIDOCZNEJ sekcji, ale zapisuje pozycje
//     w globalnej liście - pomyłka w tłumaczeniu indeksów przestawia pozycję
//     w innej sekcji.
//  2. Wybór presetu dobiera ikonę i etykiety, ale NIE nadpisuje etykiet już
//     wpisanych przez redakcję.
//  3. Strona bez tytułu w edytowanym języku ma opisać się tytułem polskim,
//     a w ostateczności adresem - lista bez opisu jest bezużyteczna.
//  4. Pozycja o nieznanym rodzaju (zapis z przyszłej wersji) nie może wywalić
//     panelu; nagłówek pokazuje wtedy surowy rodzaj.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { AccountLinkEditor } from "../AccountLinkEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));

function renderEditor(initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <AccountLinkEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const items = (): Array<Record<string, unknown>> =>
    (written.filter(([k]) => k === "items").at(-1)?.[1] ?? []) as Array<Record<string, unknown>>;
  return { ...view, written, items };
}

const item = (over: Record<string, Json> = {}): Record<string, Json> => ({
  id: "i1",
  kind: "preset",
  section: "guest",
  presetKey: "profile",
  label_pl: "Profil",
  label_en: "Profile",
  ...over,
});

/**
 * Lista PRESETÓW, a nie rodzajów pozycji ani sekcji. Wszystkie trzy mają po
 * kilka opcji, więc rozpoznajemy po zawartości: presety mają "profile"
 * i NIE mają "separator" (ten jest rodzajem pozycji).
 */
const presetSelect = (container: HTMLElement): HTMLSelectElement => {
  const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
    (sel) =>
      !!sel.querySelector('option[value="profile"]') &&
      !sel.querySelector('option[value="separator"]'),
  );
  if (!found) throw new Error("test: brak listy presetów");
  return found;
};

const selectWith = (container: HTMLElement, value: string): HTMLSelectElement => {
  const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
    sel.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją "${value}"`);
  return found;
};

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("pages", ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AccountLinkEditor - lista stron z bazy", () => {
  it("strona bez tytułu w edytowanym języku opisuje się tytułem polskim", async () => {
    db.current.setResponse("pages", ok([{ slug: "kontakt", title_pl: "Kontakt", title_en: "" }]));
    const { container } = renderEditor({ items: [item({ kind: "page", slug: "kontakt" })] }, "en");
    // Redakcja tłumaczy strony etapami - lista bez opisu byłaby bezużyteczna.
    await waitFor(() => expect(container.textContent).toContain("Kontakt"));
  });

  it("strona bez żadnego tytułu opisuje się adresem", async () => {
    db.current.setResponse("pages", ok([{ slug: "regulamin", title_pl: "", title_en: "" }]));
    const { container } = renderEditor({ items: [item({ kind: "page", slug: "regulamin" })] });
    await waitFor(() => expect(container.textContent).toContain("regulamin"));
  });

  it("pyta bazę tylko o strony opublikowane i sortuje je po tytule", async () => {
    renderEditor({ items: [item({ kind: "page" })] });
    await waitFor(() => expect(db.current.lastChain("pages")).toBeTruthy());
    const chain = db.current.lastChain("pages");
    // Szkice w menu konta byłyby linkiem do strony 404.
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.has("order")).toBe(true);
  });
});

describe("AccountLinkEditor - rodzaje pozycji", () => {
  it.each([
    ["preset", "preset"],
    ["strona", "page"],
    ["własny link", "custom"],
    ["separator", "separator"],
    ["wylogowanie", "logout"],
  ])("pozycja rodzaju %s ma swój zestaw pól", (_label, kind) => {
    const { container } = renderEditor({ items: [item({ kind })] });
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("undefined");
  });

  it("pozycja o NIEZNANYM rodzaju nie wywala panelu", () => {
    const { container } = renderEditor({ items: [item({ kind: "rodzaj-z-przyszlosci" })] });
    // Zapis z nowszej wersji panelu musi dać się otworzyć i naprawić, a nie
    // zabrać całe menu.
    expect(container.textContent).toContain("rodzaj-z-przyszlosci");
  });

  it("pozycja BEZ rodzaju jest traktowana jako preset", () => {
    const { container } = renderEditor({ items: [{ id: "i1", section: "guest" }] });
    expect(container.textContent).toContain("builder.accountLinkEditor.preset");
  });

  it("zmiana rodzaju wymienia zestaw pól", () => {
    const { container, items } = renderEditor({ items: [item()] });
    fireEvent.change(selectWith(container, "custom"), { target: { value: "custom" } });
    expect(items()[0]?.kind).toBe("custom");
  });
});

describe("AccountLinkEditor - preset dobiera dane, ale nie nadpisuje wpisanych", () => {
  it("pozycja bez etykiet bierze je z presetu", () => {
    const { container, items } = renderEditor({
      items: [{ id: "i1", kind: "preset", section: "guest" }],
    });
    const list = presetSelect(container);
    const option = Array.from(list.querySelectorAll("option")).at(-1);
    if (!option) throw new Error("test: lista presetów bez opcji");
    fireEvent.change(list, { target: { value: option.value } });
    const saved = items()[0];
    expect(saved?.presetKey).toBe(option.value);
    expect(typeof saved?.label_pl === "string" && (saved.label_pl as string).length > 0).toBe(true);
  });

  it("etykieta wpisana przez redakcję zostaje", () => {
    const { container, items } = renderEditor({
      items: [{ id: "i1", kind: "preset", section: "guest", label_pl: "Moje konto" }],
    });
    const list = presetSelect(container);
    const option = Array.from(list.querySelectorAll("option")).at(-1);
    fireEvent.change(list, { target: { value: option!.value } });
    // Nazwy w menu konta są redakcyjne - wybór presetu nie może ich zdeptać.
    expect(items()[0]?.label_pl).toBe("Moje konto");
  });
});

describe("AccountLinkEditor - przenoszenie w obrębie sekcji", () => {
  const twoInGuest = {
    items: [
      item({ id: "i1", label_pl: "Pierwsza" }),
      item({ id: "i2", label_pl: "Druga" }),
      item({ id: "i3", section: "user", label_pl: "Z innej sekcji" }),
    ],
  };

  it("przeniesienie w dół zamienia kolejność TYLKO w widocznej sekcji", () => {
    const { container, items } = renderEditor(twoInGuest);
    const downButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => b.querySelector("svg.lucide-chevron-down"),
    );
    const enabled = downButtons.find((b) => !b.disabled);
    if (!enabled) throw new Error("test: brak czynnego przycisku przenoszenia");
    fireEvent.click(enabled);
    const saved = items();
    expect(saved.map((x) => x.id)).toEqual(["i2", "i1", "i3"]);
  });

  it("krańce sekcji mają przyciski wyłączone", () => {
    const { container } = renderEditor(twoInGuest);
    const ups = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) =>
      b.querySelector("svg.lucide-chevron-up"),
    );
    const downs = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) =>
      b.querySelector("svg.lucide-chevron-down"),
    );
    // Pozycja z innej sekcji nie jest widoczna, więc krańce liczą się w obrębie
    // sekcji, a nie całej listy.
    expect(ups[0]?.disabled).toBe(true);
    expect(downs.at(-1)?.disabled).toBe(true);
  });

  it("dodanie pozycji dopisuje ją do BIEŻĄCEJ sekcji", () => {
    const { container, items } = renderEditor({ items: [] });
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").trim().startsWith("+"),
    );
    if (!add) throw new Error("test: brak przycisku dodawania");
    fireEvent.click(add);
    expect(items()[0]?.section).toBe("guest");
  });

  it("usunięcie pozycji zabiera właściwą, nie pierwszą z listy", () => {
    const { container, items } = renderEditor(twoInGuest);
    const removes = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => (b.textContent ?? "").trim() === "builder.common.delete",
    );
    if (removes.length < 2) throw new Error("test: brak przycisków usuwania");
    fireEvent.click(removes[1]!);
    expect(items().map((x) => x.id)).toEqual(["i1", "i3"]);
  });
});
