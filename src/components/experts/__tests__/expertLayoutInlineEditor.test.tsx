// Inline-edytor layoutu na publicznej stronie eksperta.
//
// 565 linii, zero wykonanych. Ten edytor NIE zapisuje ustawień - zapisuje
// RÓŻNICĘ wobec ustawień tenanta. Cała jego poprawność sprowadza się więc do
// jednej reguły, którą łamie się jednym znakiem:
//
//   „dziedzicz" = KLUCZA NIE MA w nadpisaniach.
//
// Zapisanie w tym miejscu `false`, `null` albo pustego obiektu wygląda w UI
// identycznie, a znaczy coś zupełnie innego: strona eksperta zamraża dzisiejszą
// wartość tenanta i przestaje za nim nadążać. Redakcja zmienia preset dla
// całej organizacji, a ten jeden profil zostaje na starym - i nikt nie wie
// dlaczego, bo w edytorze wszystko stoi na „dziedzicz".
// Każdy setter ma tu więc asercję na KSZTAŁT różnicy, nie na wygląd kontrolki.
//
// Druga rzecz pod bramką: dirty-check. Przycisk „Zapisz" ma być martwy, dopóki
// nic się nie zmieniło, a zamknięcie z niezapisanymi zmianami musi pytać -
// inaczej godzina układania sekcji znika po jednym Escape.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ensureI18n as ensureEditorI18n } from "@/lib/i18n-expert-layout-editor";
import { ensureI18n as ensureAdminLayoutsI18n } from "@/lib/i18n-admin-layouts";
import {
  DEFAULT_EXPERT_SECTION_ORDER,
  type ExpertLayoutDraft,
  type ExpertLayoutOverrides,
  type ExpertLayoutSettings,
} from "@/lib/expertLayouts";
import { expertSettings } from "@/test/experts/fixtures";

const save = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => undefined),
  isPending: false,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/useExpertLayoutSettings", () => ({
  useSaveExpertLayoutOverrides: () => save,
}));

vi.mock("sonner", () => ({ toast: toasts }));

const { default: ExpertLayoutInlineEditor } =
  await import("@/components/experts/ExpertLayoutInlineEditor");

ensureEditorI18n();
ensureAdminLayoutsI18n();
const t = realT("pl");
const label = (key: string, opts?: Record<string, unknown>) => String(t(key, opts));

const EXPERT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

let onDraftChange: Mock<(draft: ExpertLayoutDraft | null) => void>;

function editor(
  opts: { saved?: ExpertLayoutOverrides | null; tenant?: ExpertLayoutSettings } = {},
) {
  return renderWithQueryClient(
    <ExpertLayoutInlineEditor
      expertId={EXPERT_ID}
      tenantId={TENANT_ID}
      tenantSettings={opts.tenant ?? expertSettings()}
      savedOverrides={opts.saved ?? null}
      onDraftChange={onDraftChange}
    />,
  );
}

/** Otwiera panel edytora (domyślnie renderuje się zwinięty pływający przycisk). */
function openEditor(opts: Parameters<typeof editor>[0] = {}) {
  const view = editor(opts);
  // Nazwa dostępna przycisku niesie też odznakę z liczbą nadpisań, więc
  // dopasowanie musi być częściowe.
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(label("expertLayoutEditor.open")) }),
  );
  return view;
}

/** Ostatnia opublikowana różnica - to ona pojedzie do bazy. */
function lastDraft(): ExpertLayoutOverrides | null {
  const call = onDraftChange.mock.calls.at(-1)?.[0] as { overrides: ExpertLayoutOverrides | null };
  return call.overrides;
}

/** Klik w segment tri-state wewnątrz grupy o danej etykiecie. */
function clickSegment(groupLabel: string, optionLabel: string | RegExp) {
  const group = screen.getByRole("radiogroup", { name: groupLabel });
  fireEvent.click(within(group).getByRole("radio", { name: optionLabel }));
}

const SECTION_LABEL = (key: string) => label(`adminLayouts.expertLayouts.sections.${key}`);
const VIS_GROUP = (key: string) =>
  label("expertLayoutEditor.visibilityLabel", { section: SECTION_LABEL(key) });

beforeEach(() => {
  onDraftChange = vi.fn<(draft: ExpertLayoutDraft | null) => void>();
  save.mutateAsync = vi.fn(async () => undefined);
  save.isPending = false;
  toasts.success.mockClear();
  toasts.error.mockClear();
});

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExpertLayoutInlineEditor - stan zwinięty", () => {
  it("pokazuje pływający przycisk, a nie panel", () => {
    editor();
    expect(
      screen.getByRole("button", { name: new RegExp(label("expertLayoutEditor.open")) }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("bez nadpisań nie ma odznaki z licznikiem", () => {
    const { container } = editor();
    expect(container.querySelector("span.bg-brand")).toBeNull();
  });

  it("odznaka liczy ZAPISANE nadpisania, nie klucze draftu", () => {
    // Właściciel profilu widzi po tej liczbie, czy jego strona w ogóle
    // odbiega od ustawień organizacji - zanim otworzy panel.
    editor({ saved: { preset: "minimal", center_hero: true } });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("otwarcie publikuje ZAPISANE nadpisania jako draft podglądu", () => {
    // Podgląd na żywo startuje od stanu, który czytelnik już widzi - inaczej
    // otwarcie edytora samo przestawiałoby stronę.
    openEditor({ saved: { preset: "editorial" } });
    expect(lastDraft()).toEqual({ preset: "editorial" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ExpertLayoutInlineEditor - preset", () => {
  it("wybór presetu zapisuje TYLKO jego klucz", () => {
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: /Minimal/i }));
    expect(lastDraft()).toEqual({ preset: "minimal" });
  });

  it("powrót na „dziedzicz” USUWA klucz, zamiast zapisywać null", () => {
    // `preset: null` w różnicy zamroziłby dzisiejszy preset tenanta na tym
    // profilu - w UI nie do odróżnienia od dziedziczenia.
    openEditor({ saved: { preset: "minimal" } });
    fireEvent.click(screen.getByRole("button", { name: /Dziedzicz/ }));
    expect(lastDraft()).toBeNull();
  });

  it("kafel dziedziczenia nazywa preset tenanta po imieniu", () => {
    openEditor({ tenant: expertSettings({ default_preset: "editorial" }) });
    expect(
      screen.getByText(label("expertLayoutEditor.tenantPreset", { label: "Redakcyjny" })),
    ).toBeInTheDocument();
  });

  it("aktywny preset jest oznaczony dla czytnika ekranu", () => {
    openEditor({ saved: { preset: "minimal" } });
    expect(screen.getByRole("button", { name: /Minimal/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ExpertLayoutInlineEditor - widoczność sekcji", () => {
  const KEY = DEFAULT_EXPERT_SECTION_ORDER[1];

  it("„ukryj” zapisuje wartość FAŁSZ pod kluczem sekcji", () => {
    openEditor();
    clickSegment(VIS_GROUP(KEY), label("expertLayoutEditor.hide"));
    expect(lastDraft()).toEqual({ visibility: { [KEY]: false } });
  });

  it("„pokaż” zapisuje PRAWDĘ - to nadpisanie, nie brak zdania", () => {
    // Sekcja ukryta przez tenanta, a odkryta przez eksperta, musi mieć
    // jawne `true`; brak klucza oznaczałby powrót do ukrycia.
    openEditor();
    clickSegment(VIS_GROUP(KEY), label("expertLayoutEditor.show"));
    expect(lastDraft()).toEqual({ visibility: { [KEY]: true } });
  });

  it("powrót na „dziedzicz” usuwa CAŁY blok widoczności, gdy był ostatni", () => {
    // Pusty obiekt `visibility: {}` liczyłby się jako nadpisanie: licznik
    // pokazywałby zmianę, której nie ma, a dirty-check nie wróciłby do zera.
    openEditor({ saved: { visibility: { [KEY]: false } } });
    clickSegment(VIS_GROUP(KEY), new RegExp(label("expertLayoutEditor.inherit")));
    expect(lastDraft()).toBeNull();
  });

  it("dziedziczenie jednej sekcji zostawia pozostałe", () => {
    const other = DEFAULT_EXPERT_SECTION_ORDER[2];
    openEditor({ saved: { visibility: { [KEY]: false, [other]: true } } });
    clickSegment(VIS_GROUP(KEY), new RegExp(label("expertLayoutEditor.inherit")));
    expect(lastDraft()).toEqual({ visibility: { [other]: true } });
  });

  it("segment dziedziczenia MÓWI, co dziedziczy", () => {
    // Bez tego „dziedzicz" jest ślepym strzałem: użytkownik nie wie, czy
    // sekcja będzie widoczna, czy nie.
    openEditor({ tenant: expertSettings({ show_expertise_bar: false }) });
    const group = screen.getByRole("radiogroup", { name: VIS_GROUP("expertise_bar") });
    expect(
      within(group).getByRole("radio", {
        name: new RegExp(label("expertLayoutEditor.inheritedHidden")),
      }),
    ).toBeInTheDocument();
  });

  it("sekcja niewidoczna efektywnie jest przekreślona na liście", () => {
    const { container } = openEditor({ saved: { visibility: { [KEY]: false } } });
    expect(container.querySelector(".line-through")).toHaveTextContent(SECTION_LABEL(KEY));
  });
});

describe("ExpertLayoutInlineEditor - kolejność sekcji", () => {
  it("przesunięcie w dół zamienia sąsiadów miejscami", () => {
    openEditor();
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(
      within(rows[0]).getByRole("button", { name: label("adminLayouts.expertLayouts.moveDown") }),
    );
    const expected = [...DEFAULT_EXPERT_SECTION_ORDER];
    [expected[0], expected[1]] = [expected[1], expected[0]];
    expect(lastDraft()?.section_order).toEqual(expected);
  });

  it("przesunięcie w górę jest odwrotnością", () => {
    openEditor();
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(
      within(rows[1]).getByRole("button", { name: label("adminLayouts.expertLayouts.moveUp") }),
    );
    const expected = [...DEFAULT_EXPERT_SECTION_ORDER];
    [expected[0], expected[1]] = [expected[1], expected[0]];
    expect(lastDraft()?.section_order).toEqual(expected);
  });

  it("krańce listy mają wyłączone strzałki - nie da się wypchnąć poza zakres", () => {
    openEditor();
    const rows = screen.getAllByRole("listitem");
    expect(
      within(rows[0]).getByRole("button", { name: label("adminLayouts.expertLayouts.moveUp") }),
    ).toBeDisabled();
    expect(
      within(rows.at(-1)!).getByRole("button", {
        name: label("adminLayouts.expertLayouts.moveDown"),
      }),
    ).toBeDisabled();
  });

  it("przywrócenie kolejności tenanta USUWA klucz kolejności", () => {
    openEditor({ saved: { section_order: [...DEFAULT_EXPERT_SECTION_ORDER].reverse() } });
    fireEvent.click(
      screen.getByRole("button", { name: label("expertLayoutEditor.restoreTenantOrder") }),
    );
    expect(lastDraft()).toBeNull();
  });

  it("przycisk przywracania pojawia się dopiero przy nadpisanej kolejności", () => {
    openEditor();
    expect(
      screen.queryByRole("button", { name: label("expertLayoutEditor.restoreTenantOrder") }),
    ).not.toBeInTheDocument();
  });
});

describe("ExpertLayoutInlineEditor - wycentrowanie", () => {
  it("„włącz” zapisuje prawdę pod kluczem hero", () => {
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    expect(lastDraft()).toEqual({ center_hero: true });
  });

  it("„wyłącz” zapisuje fałsz - to nadpisanie tenanta, nie brak zdania", () => {
    openEditor();
    clickSegment(
      label("adminLayouts.expertLayouts.centerDetails"),
      label("expertLayoutEditor.off"),
    );
    expect(lastDraft()).toEqual({ center_details: false });
  });

  it("„dziedzicz” usuwa klucz", () => {
    openEditor({ saved: { center_hero: true } });
    clickSegment(
      label("adminLayouts.expertLayouts.centerHero"),
      label("expertLayoutEditor.inherit"),
    );
    expect(lastDraft()).toBeNull();
  });
});

describe("ExpertLayoutInlineEditor - kolor akcentu", () => {
  const lightLabel = () => label("adminLayouts.expertLayouts.accentLight");

  it("poprawny kolor trafia do różnicy", () => {
    openEditor();
    const [, textInput] = screen.getAllByLabelText(lightLabel());
    fireEvent.change(textInput, { target: { value: "#ff0000" } });
    expect(lastDraft()).toEqual({ accent_color: "#ff0000" });
  });

  it("wartość NIEBĘDĄCA kolorem nie zostaje zapisana", () => {
    // Pole jest tekstowe (żeby dało się wpisać `oklch(...)`), więc jest też
    // wejściem na wstrzyknięcie do atrybutu `style` renderowanej strony.
    openEditor();
    const [, textInput] = screen.getAllByLabelText(lightLabel());
    fireEvent.change(textInput, { target: { value: "red; background:url(javascript:1)" } });
    expect(lastDraft()).toBeNull();
  });

  it("wyczyszczenie pola usuwa klucz", () => {
    openEditor({ saved: { accent_color: "#ff0000" } });
    const [, textInput] = screen.getAllByLabelText(lightLabel());
    fireEvent.change(textInput, { target: { value: "" } });
    expect(lastDraft()).toBeNull();
  });

  it("przycisk czyszczenia jest tylko przy nadpisanym kolorze", () => {
    openEditor();
    expect(
      screen.queryByRole("button", { name: label("adminLayouts.expertLayouts.clearTitle") }),
    ).not.toBeInTheDocument();

    openEditor({ saved: { accent_color: "#ff0000" } });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: label("adminLayouts.expertLayouts.clearTitle"),
      })[0],
    );
    expect(lastDraft()).toBeNull();
  });

  it("próbnik koloru startuje od wartości dziedziczonej", () => {
    // Bez tego picker otwiera się na czerni i pierwszy ruch myszą wywraca
    // kolor marki na przypadkowy.
    openEditor({ tenant: expertSettings({ accent_color: "#123456" }) });
    const [colorInput] = screen.getAllByLabelText(lightLabel());
    expect(colorInput).toHaveValue("#123456");
  });

  it("wariant CIEMNY ma własny klucz - nie nadpisuje jasnego", () => {
    // Dwa pola obok siebie, ten sam kształt, różny cel. Podpięcie obu pod
    // `accent_color` dałoby stronę, która w ciemnym motywie ma kolor jasnego.
    openEditor();
    const [, darkText] = screen.getAllByLabelText(label("adminLayouts.expertLayouts.accentDark"));
    fireEvent.change(darkText, { target: { value: "#00ff00" } });
    expect(lastDraft()).toEqual({ accent_color_dark: "#00ff00" });
  });

  it("próbnik systemowy zapisuje kolor tak samo jak pole tekstowe", () => {
    openEditor();
    const [colorInput] = screen.getAllByLabelText(lightLabel());
    fireEvent.change(colorInput, { target: { value: "#abcdef" } });
    expect(lastDraft()).toEqual({ accent_color: "#abcdef" });
  });

  it("wpisywanie NIE zjada spacji w trakcie - bufor tekstu jest lokalny", () => {
    // `oklch(0.6 0.1 240)` przechodzi przez stany pośrednie z odstępami;
    // kontrolowanie inputa zsanityzowanym draftem ucinałoby je przy każdym
    // znaku i pole byłoby nie do wypełnienia.
    openEditor();
    const [, textInput] = screen.getAllByLabelText(lightLabel());
    fireEvent.change(textInput, { target: { value: "oklch(0.6 0.1 " } });
    expect(textInput).toHaveValue("oklch(0.6 0.1 ");
  });
});

describe("ExpertLayoutInlineEditor - zapis i zamknięcie", () => {
  it("„Zapisz” jest martwy, dopóki nic się nie zmieniło", () => {
    openEditor({ saved: { preset: "minimal" } });
    expect(screen.getByRole("button", { name: label("common.save") })).toBeDisabled();
  });

  it("zapis wysyła eksperta, tenanta i RÓŻNICĘ", () => {
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    fireEvent.click(screen.getByRole("button", { name: label("common.save") }));
    expect(save.mutateAsync).toHaveBeenCalledWith({
      userId: EXPERT_ID,
      tenantId: TENANT_ID,
      overrides: { center_hero: true },
    });
  });

  it("po udanym zapisie przycisk znów gaśnie - baseline się przesunął", async () => {
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    fireEvent.click(screen.getByRole("button", { name: label("common.save") }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: label("common.save") })).toBeDisabled();
  });

  it("błąd zapisu melduje się komunikatem, a zmiany zostają w panelu", async () => {
    save.mutateAsync = vi.fn(async () => {
      throw new Error("RLS odmówił");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    fireEvent.click(screen.getByRole("button", { name: label("common.save") }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(toasts.error).toHaveBeenCalledWith(
      label("expertLayoutEditor.saveErrorToast", { msg: "RLS odmówił" }),
    );
    expect(screen.getByRole("button", { name: label("common.save") })).not.toBeDisabled();
    spy.mockRestore();
  });

  it("czyszczenie wszystkich nadpisań publikuje pustą różnicę", () => {
    openEditor({ saved: { preset: "minimal", center_hero: true } });
    fireEvent.click(screen.getByRole("button", { name: label("expertLayoutEditor.resetAll") }));
    expect(lastDraft()).toBeNull();
  });

  it("przycisk czyszczenia jest martwy, gdy nie ma czego czyścić", () => {
    openEditor();
    expect(
      screen.getByRole("button", { name: label("expertLayoutEditor.resetAll") }),
    ).toBeDisabled();
  });

  it("zamknięcie bez zmian nie pyta o potwierdzenie", () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: label("expertLayoutEditor.close") }));
    expect(confirm).not.toHaveBeenCalled();
    // `null` zamiast `{ overrides: null }`: to koniec edycji, a nie różnica
    // pusta - strona ma wrócić do stanu ZAPISANEGO, nie do dziedziczenia.
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("zamknięcie z niezapisanymi zmianami PYTA", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    fireEvent.click(screen.getByRole("button", { name: label("expertLayoutEditor.close") }));
    expect(confirm).toHaveBeenCalledWith(label("expertLayoutEditor.discardConfirm"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("odmowa porzucenia zostawia panel otwarty ze zmianami", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    openEditor();
    clickSegment(label("adminLayouts.expertLayouts.centerHero"), label("expertLayoutEditor.on"));
    fireEvent.click(screen.getByRole("button", { name: label("expertLayoutEditor.close") }));
    expect(screen.getByRole("button", { name: label("common.save") })).not.toBeDisabled();
  });

  it("Escape zamyka panel", () => {
    openEditor();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("inny klawisz nie zamyka panelu", () => {
    openEditor();
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("odmontowanie sprząta draft - nawigacja nie zostawia podglądu na stronie", () => {
    // Bez tego wyjście z profilu w trakcie edycji zostawiałoby stronę w
    // stanie podglądu, którego nikt nie zapisał.
    const view = openEditor();
    onDraftChange.mockClear();
    view.unmount();
    expect(onDraftChange).toHaveBeenCalledWith(null);
  });
});
