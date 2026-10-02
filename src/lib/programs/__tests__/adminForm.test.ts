// Reguły wspólne paneli programów (`lib/programs/adminForm.ts`).
//
// CO TU JEST DOWODEM. `bindDraft` zastąpił trzydzieści kilka ręcznych
// domknięć `onChange` w dwóch panelach, więc jego reguły zapisu są teraz
// regułami KAŻDEGO pola tych paneli naraz:
//   1. PUSTE pole kolumny opcjonalnej to `NULL`, nie `""` - strona publiczna
//      spada wtedy na drugi język (`pickLocalized`), a pusty ciąg w kolumnie
//      uuid/e-mail to błąd zapisu;
//   2. pole tekstowe NIEOPCJONALNE niesie wartość dosłownie (także `""`) -
//      walidacja „nazwa wymagana" musi zobaczyć pustkę, a nie `NULL`;
//   3. śmieci w polu liczbowym to `0`, nie `NaN` (NaN w `sort_order` to błąd
//      typu w PostgREST);
//   4. zapis jednego pola NIE rusza pozostałych (aktualizacja funkcyjna -
//      dwa szybkie zdarzenia z rzędu nie gubią pierwszego).
// `writeOrToast`: odmowa bazy to toast z JEJ komunikatem i `false`; sukces
// to `true` bez toastu.
//
// Przypisanie pola do KOLUMNY (czy `tagline_en` nie siedzi w polu PL)
// dowodzą testy tras - tam żyją wywołania `field.text("...")`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";

const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));

import { PROGRAM_SLUG_PATTERN, bindDraft, writeOrToast } from "@/lib/programs/adminForm";

interface Draft {
  name: string;
  tagline: string | null;
  status: "draft" | "published";
  sort: number;
  active: boolean;
}

const INITIAL: Draft = { name: "", tagline: null, status: "draft", sort: 0, active: false };

/** Stan wersji roboczej z PRAWDZIWĄ semantyką `setState` (aktualizacja funkcyjna). */
function draftState() {
  let state = INITIAL;
  const setDraft = (action: SetStateAction<Draft>) => {
    state = typeof action === "function" ? action(state) : action;
  };
  return {
    get: () => state,
    field: () => bindDraft(state, setDraft, "t"),
  };
}

const typed = (value: string) => ({ target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bindDraft - reguły zapisu pól", () => {
  it("PUSTE pole opcjonalne zapisuje NULL, a niepuste - wartość dosłownie", () => {
    const d = draftState();
    d.field().optionalText("tagline").onChange(typed("Teza"));
    expect(d.get().tagline).toBe("Teza");

    d.field().optionalText("tagline").onChange(typed(""));
    expect(d.get().tagline).toBeNull();
    // NULL wraca do kontrolki jako pusty ciąg - `<input value={null}>` to
    // ostrzeżenie Reacta o przejściu w tryb niekontrolowany.
    expect(d.field().optionalText("tagline").value).toBe("");
  });

  it("pole NIEOPCJONALNE niesie pusty ciąg dosłownie - walidacja ma zobaczyć pustkę", () => {
    const d = draftState();
    d.field().text("name").onChange(typed("Obronność"));
    d.field().text("name").onChange(typed(""));

    expect(d.get().name).toBe("");
  });

  it("śmieci i puste pole liczbowe to 0, liczba - liczba", () => {
    const d = draftState();
    d.field().number("sort").onChange(typed("12"));
    expect(d.get().sort).toBe(12);

    d.field().number("sort").onChange(typed("abc"));
    expect(d.get().sort).toBe(0);
  });

  it("wybór z listy i przełącznik piszą WYŁĄCZNIE swoją kolumnę", () => {
    const d = draftState();
    d.field().text("name").onChange(typed("Obronność"));
    d.field().choice("status").onValueChange("published");
    d.field().flag("active").onCheckedChange(true);

    expect(d.get()).toEqual({
      name: "Obronność",
      tagline: null,
      status: "published",
      sort: 0,
      active: true,
    });
  });

  it("identyfikator pola wiąże je z etykietą: `${prefiks}-${kolumna}`", () => {
    const d = draftState();

    expect(d.field().text("name").id).toBe("t-name");
    expect(d.field().id("status")).toBe("t-status");
    expect(d.field().flag("active").id).toBe("t-active");
  });
});

describe("writeOrToast - reakcja panelu na wynik zapisu", () => {
  it("odmowa bazy: toast z komunikatem BAZY i `false`", async () => {
    const saved = await writeOrToast(
      Promise.resolve({ error: { message: "new row violates row-level security policy" } }),
    );

    expect(saved).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy");
  });

  it("sukces: `true` i ŻADNEGO toastu błędu", async () => {
    expect(await writeOrToast(Promise.resolve({ error: null }))).toBe(true);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("PROGRAM_SLUG_PATTERN - slug jako adres strony publicznej", () => {
  it.each(["obrona", "bezpieczenstwo-europy", "g7-2026"])("przyjmuje %s", (slug) => {
    expect(PROGRAM_SLUG_PATTERN.test(slug)).toBe(true);
  });

  it.each(["Obrona", "nowy program", "a", "bezpieczeństwo", "x".repeat(81)])(
    "odrzuca %s",
    (slug) => {
      expect(PROGRAM_SLUG_PATTERN.test(slug)).toBe(false);
    },
  );
});
