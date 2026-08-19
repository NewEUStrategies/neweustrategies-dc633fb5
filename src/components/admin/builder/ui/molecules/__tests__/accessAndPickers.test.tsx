// Kontrolki „chrome” paneli: dostęp (kto widzi element), picker koloru
// z presetami, wstawiacz tagów dynamicznych, przełącznik wariantu, pasek akcji
// masowych i potwierdzenie usunięcia.
//
// `AccessControl` jest tu najważniejszy, bo jego zapis decyduje o TYM, KTO
// ZOBACZY treść na publicznej stronie. Test przypina normalizację zapisu:
// stan „dla wszystkich, bez ról” MUSI wyjść z dokumentu jako `undefined`,
// a nie jako `{ auth: "any" }` - inaczej każdy widget nosiłby regułę dostępu
// i renderer musiałby ją sprawdzać przy każdym renderze.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AdvancedSettings } from "@/lib/builder/types";
import { MutableHost } from "@/test/builder/panels";
import { AccessControl } from "../AccessControl";
import { ColorPicker } from "../ColorPicker";
import { DynamicTagInserter } from "../DynamicTagInserter";
import { VariantPicker } from "../VariantPicker";
import { BulkActionBar } from "../BulkActionBar";
import { ConfirmDeleteDialog } from "../ConfirmDeleteDialog";

// Język jest przełączany W TRAKCIE testu (katalog tagów dynamicznych ma
// etykiety PL i EN obok siebie), więc atrapa czyta go z pudełka `vi.hoisted`.
const lang = vi.hoisted(() => ({ current: "pl" }));
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => lang.current);
});

afterEach(() => {
  lang.current = "pl";
});

describe("AccessControl - tryb uwierzytelnienia", () => {
  function renderAccess(initial: AdvancedSettings = {}) {
    const applied: AdvancedSettings[] = [];
    render(
      <MutableHost<AdvancedSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <AccessControl value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  const authButton = (key: string) => screen.getByRole("button", { name: key });

  it("domyślnie widoczne dla wszystkich", () => {
    renderAccess();
    expect(authButton("builder.access.authAll").className).toContain("border-brand");
    expect(authButton("builder.access.authUser").className).toContain("border-border");
  });

  it("wybór „tylko zalogowani” zapisuje regułę", () => {
    const { last } = renderAccess();
    fireEvent.click(authButton("builder.access.authUser"));
    expect(last()?.access).toEqual({ auth: "user" });
  });

  it("powrót do „dla wszystkich” USUWA regułę z dokumentu", () => {
    const { last } = renderAccess({ access: { auth: "user" } });
    fireEvent.click(authButton("builder.access.authAll"));
    // `undefined`, nie `{ auth: "any" }` - to jest cała treść normalizacji.
    expect(last()?.access).toBeUndefined();
  });

  it("tryb gościa czyści role i blokuje ich wybór", () => {
    const { last } = renderAccess({ access: { auth: "user", roles: ["admin"] } });
    fireEvent.click(authButton("builder.access.authGuest"));
    // Gość nie ma roli - trzymanie roli razem z „tylko niezalogowani” dałoby
    // regułę, której nie da się spełnić.
    expect(last()?.access).toEqual({ auth: "guest" });
    const rolesBox = screen.getByText("builder.access.requiredRoles").closest("div")?.parentElement;
    expect(rolesBox?.className).toContain("pointer-events-none");
  });

  it("role są klikalne, gdy tryb nie jest gościem", () => {
    renderAccess({ access: { auth: "user" } });
    const rolesBox = screen.getByText("builder.access.requiredRoles").closest("div")?.parentElement;
    expect(rolesBox?.className).not.toContain("pointer-events-none");
  });
});

describe("AccessControl - role", () => {
  function renderAccess(initial: AdvancedSettings = {}) {
    const applied: AdvancedSettings[] = [];
    render(
      <MutableHost<AdvancedSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <AccessControl value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it.each([
    ["Admin", "admin"],
    ["Editor", "editor"],
    ["Author", "author"],
  ] as const)("dodaje rolę %s", (label, role) => {
    const { last } = renderAccess();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(last()?.access).toEqual({ roles: [role] });
  });

  it("ponowny klik zdejmuje rolę i czyści zapis", () => {
    const { last } = renderAccess({ access: { roles: ["admin"] } });
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(last()?.access).toBeUndefined();
  });

  it("zaznaczona rola jest wyróżniona", () => {
    renderAccess({ access: { roles: ["editor"] } });
    expect(screen.getByRole("button", { name: "Editor" }).className).toContain("border-brand");
    expect(screen.getByRole("button", { name: "Admin" }).className).toContain("border-border");
  });

  it("wybór trybu ról pojawia się dopiero przy dwóch rolach", () => {
    const { last } = renderAccess({ access: { roles: ["admin"] } });
    expect(screen.queryByText("builder.access.requirement")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(last()?.access?.roles).toEqual(["admin", "editor"]);
    expect(screen.getByText("builder.access.requirement")).toBeInTheDocument();
  });

  it("tryb „wszystkie role” zapisuje się, tryb „którakolwiek” nie", () => {
    const { last } = renderAccess({ access: { roles: ["admin", "editor"] } });
    fireEvent.click(screen.getByRole("button", { name: "builder.access.all" }));
    expect(last()?.access).toEqual({ roles: ["admin", "editor"], rolesMode: "all" });
    fireEvent.click(screen.getByRole("button", { name: "builder.access.any" }));
    // „Którakolwiek” jest domyślne - normalizacja nie zapisuje wartości
    // domyślnych, żeby dokument nie rósł o pola bez znaczenia.
    expect(last()?.access).toEqual({ roles: ["admin", "editor"] });
  });

  it("aktywny tryb ról jest wyróżniony", () => {
    renderAccess({ access: { roles: ["admin", "editor"], rolesMode: "all" } });
    expect(screen.getByRole("button", { name: "builder.access.all" }).className).toContain(
      "border-brand",
    );
    expect(screen.getByRole("button", { name: "builder.access.any" }).className).toContain(
      "border-border",
    );
  });

  it("tryb uwierzytelnienia i role żyją razem", () => {
    const { last } = renderAccess({ access: { auth: "user" } });
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(last()?.access).toEqual({ auth: "user", roles: ["admin"] });
  });
});

describe("ColorPicker", () => {
  const trigger = () => screen.getByLabelText("builder.colorPicker.pickColor");

  it("bez wartości pokazuje auto i próbkę bez koloru", () => {
    const { rerender } = render(<ColorPicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText("auto")).toBeInTheDocument();
    const swatch = () => trigger().firstElementChild as HTMLElement;
    // Brak wartości = brak tła w próbce (produkcja rysuje w tym miejscu
    // szachownicę gradientem stożkowym, którego happy-dom nie parsuje).
    expect(swatch().style.background).toBe("");
    rerender(<ColorPicker value="#123456" onChange={vi.fn()} />);
    expect(swatch().style.background).toBe("#123456");
  });

  it("hex pokazuje wielkimi literami, token pokazuje jako custom", () => {
    const { rerender } = render(<ColorPicker value="#a1b2c3" onChange={vi.fn()} />);
    expect(screen.getByText("#A1B2C3")).toBeInTheDocument();
    rerender(<ColorPicker value="var(--brand)" onChange={vi.fn()} />);
    // Wartość, której nie da się pokazać próbnikiem, ma być OZNACZONA,
    // a nie udawać hexa.
    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("wybór presetu zapisuje kolor i zamyka listę", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={undefined} onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByLabelText("#ef4444"));
    expect(onChange).toHaveBeenLastCalledWith("#ef4444");
    expect(screen.queryByLabelText("#ef4444")).toBeNull();
  });

  it("wyróżnia preset odpowiadający aktualnej wartości", () => {
    render(<ColorPicker value="#EF4444" onChange={vi.fn()} />);
    fireEvent.click(trigger());
    // Porównanie bez wielkości liter - dokument mógł zapisać hex wielkimi.
    expect(screen.getByLabelText("#ef4444").className).toContain("ring-2");
    expect(screen.getByLabelText("#f97316").className).toContain("border-border/60");
  });

  it("własna paleta zastępuje domyślną", () => {
    render(<ColorPicker value={undefined} onChange={vi.fn()} presets={["#000000", "#ffffff"]} />);
    fireEvent.click(trigger());
    expect(screen.getByLabelText("#000000")).toBeInTheDocument();
    expect(screen.queryByLabelText("#ef4444")).toBeNull();
  });

  it("natywny próbnik zapisuje wybrany kolor", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#112233" onChange={onChange} />);
    fireEvent.click(trigger());
    const native = document.querySelector<HTMLInputElement>('input[type="color"]');
    if (!native) throw new Error("test: brak natywnego próbnika");
    expect(native.value).toBe("#112233");
    fireEvent.change(native, { target: { value: "#445566" } });
    expect(onChange).toHaveBeenLastCalledWith("#445566");
  });

  it("dla wartości nie-hex próbnik startuje od koloru marki", () => {
    render(<ColorPicker value="var(--brand)" onChange={vi.fn()} />);
    fireEvent.click(trigger());
    const native = document.querySelector<HTMLInputElement>('input[type="color"]');
    expect(native?.value).toBe("#f59e42");
  });

  it("pole tekstowe w popoverze przyjmuje token i czyści wartość", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#112233" onChange={onChange} />);
    fireEvent.click(trigger());
    const field = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!field) throw new Error("test: brak pola tekstowego");
    fireEvent.change(field, { target: { value: "var(--brand)" } });
    expect(onChange).toHaveBeenLastCalledWith("var(--brand)");
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("przycisk czyszczenia zdejmuje wartość i zamyka popover", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#112233" onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: /builder.colorPicker.clear/ }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("bez zgody na czyszczenie nie ma przycisku czyszczenia", () => {
    render(<ColorPicker value="#112233" onChange={vi.fn()} allowClear={false} />);
    fireEvent.click(trigger());
    expect(screen.queryByRole("button", { name: /builder.colorPicker.clear/ })).toBeNull();
  });

  it("tryb z polem obok pokazuje DRUGIE pole tekstowe poza popoverem", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorPicker value="#112233" onChange={onChange} showInput className="mt-1" />,
    );
    const inline = container.querySelector<HTMLInputElement>("input.font-mono");
    if (!inline) throw new Error("test: brak pola obok próbnika");
    expect(container.firstElementChild?.className).toContain("mt-1");
    fireEvent.change(inline, { target: { value: "#654321" } });
    expect(onChange).toHaveBeenLastCalledWith("#654321");
    fireEvent.change(inline, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("własne etykieta i podpowiedź nadpisują słownikowe", () => {
    render(
      <ColorPicker
        value={undefined}
        onChange={vi.fn()}
        ariaLabel="kolor tytułu"
        placeholder="np. #fff"
        showInput
      />,
    );
    expect(screen.getByLabelText("kolor tytułu")).toBeInTheDocument();
    expect(document.querySelector('input[placeholder="np. #fff"]')).not.toBeNull();
  });

  it("domyślna podpowiedź pola pochodzi ze słownika", () => {
    render(<ColorPicker value={undefined} onChange={vi.fn()} showInput />);
    expect(
      document.querySelector('input[placeholder="builder.colorPicker.placeholder"]'),
    ).not.toBeNull();
  });
});

describe("DynamicTagInserter", () => {
  it("wstawia wybrany token i zamyka listę", () => {
    const onInsert = vi.fn();
    render(<DynamicTagInserter onInsert={onInsert} />);
    fireEvent.click(screen.getByLabelText("builder.dynamicTag.trigger"));
    expect(screen.getByText("builder.dynamicTag.title")).toBeInTheDocument();
    const first = document.querySelectorAll<HTMLElement>("ul button")[0];
    const token = first.querySelector("code")?.textContent ?? "";
    expect(token).toMatch(/^\{.+\}$/);
    fireEvent.click(first);
    expect(onInsert).toHaveBeenCalledWith(token);
    expect(screen.queryByText("builder.dynamicTag.title")).toBeNull();
  });

  it("własna etykieta nadpisuje słownikową", () => {
    render(<DynamicTagInserter onInsert={vi.fn()} label="wstaw tag" />);
    expect(screen.getByLabelText("wstaw tag")).toBeInTheDocument();
  });

  it("etykiety grup idą za językiem interfejsu", () => {
    const { unmount } = render(<DynamicTagInserter onInsert={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("builder.dynamicTag.trigger"));
    const plLabels = Array.from(document.querySelectorAll("div.uppercase")).map(
      (n) => n.textContent,
    );
    unmount();

    lang.current = "en-GB";
    render(<DynamicTagInserter onInsert={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("builder.dynamicTag.trigger"));
    const enLabels = Array.from(document.querySelectorAll("div.uppercase")).map(
      (n) => n.textContent,
    );
    // Katalog tagów nie przechodzi przez i18next - nazwy grup są w nim wpisane
    // dwujęzycznie, więc wybór języka MUSI działać na `i18n.language`, w tym
    // na kodzie regionalnym (en-GB, nie tylko en).
    expect(enLabels).not.toEqual(plLabels);
    expect(enLabels.length).toBe(plLabels.length);
  });

  it("tryb pełnowymiarowy zmienia rozmiar przycisku", () => {
    const { rerender } = render(<DynamicTagInserter onInsert={vi.fn()} />);
    expect(screen.getByLabelText("builder.dynamicTag.trigger").className).toContain("h-8");
    rerender(<DynamicTagInserter onInsert={vi.fn()} compact={false} />);
    expect(screen.getByLabelText("builder.dynamicTag.trigger").className).toContain("h-9");
  });
});

describe("VariantPicker", () => {
  const OPTIONS = [
    { value: "card", label: "Karta" },
    { value: "minimal", label: "Minimal" },
  ];

  it("wyróżnia aktywny wariant i zgłasza zmianę", () => {
    const onChange = vi.fn();
    render(
      <VariantPicker
        label="Styl"
        value="card"
        options={OPTIONS}
        onChange={onChange}
        hint="podp."
      />,
    );
    expect(screen.getByRole("button", { name: "Karta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Minimal" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Minimal" }));
    expect(onChange).toHaveBeenCalledWith("minimal");
    expect(screen.getByText("podp.")).toBeInTheDocument();
  });

  it("grupa ma nazwę dla czytnika ekranu", () => {
    render(<VariantPicker label="Styl" value="card" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Styl" })).toBeInTheDocument();
  });

  it("wartość spoza listy nie zaznacza niczego", () => {
    render(<VariantPicker label="Styl" value="brak" options={OPTIONS} onChange={vi.fn()} />);
    for (const o of OPTIONS) {
      expect(screen.getByRole("button", { name: o.label })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });
});

describe("BulkActionBar", () => {
  const handlers = () => ({
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onClear: vi.fn(),
  });

  it("przy zerowym zaznaczeniu nie renderuje się wcale", () => {
    const { container } = render(<BulkActionBar count={0} {...handlers()} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    [1, "builder.bulk.widget1"],
    [2, "builder.bulk.widgetFew"],
    [4, "builder.bulk.widgetFew"],
    [5, "builder.bulk.widgetMany"],
    [12, "builder.bulk.widgetMany"],
  ])("odmienia rzeczownik dla %i zaznaczonych", (count, key) => {
    render(<BulkActionBar count={count} {...handlers()} />);
    // Polska odmiana ma trzy formy - pomyłka daje „5 widget” na pasku, który
    // redaktor widzi przy każdym zaznaczeniu. Rzeczownik jest węzłem tekstowym
    // obok licznika, więc czytamy treść całego paska.
    const bar = screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" });
    expect(bar.textContent).toContain(key);
    expect(bar.textContent).toContain(String(count));
  });

  it("każda akcja woła swoją obsługę dokładnie raz", () => {
    const h = handlers();
    render(<BulkActionBar count={3} {...h} />);
    fireEvent.click(screen.getByTitle("builder.bulk.copyTitle"));
    fireEvent.click(screen.getByTitle("builder.bulk.duplicateTitle"));
    fireEvent.click(screen.getByTitle("builder.bulk.deleteTitle"));
    fireEvent.click(screen.getByTitle("builder.bulk.deselectTitle"));
    expect(h.onCopy).toHaveBeenCalledTimes(1);
    expect(h.onDuplicate).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onClear).toHaveBeenCalledTimes(1);
  });

  it("pasek jest oznaczony jako chrome buildera", () => {
    render(<BulkActionBar count={2} {...handlers()} />);
    const bar = screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" });
    // `data-builder-chrome` wyłącza pasek z eksportu i ze zrzutów kanwy.
    expect(bar).toHaveAttribute("data-builder-chrome");
  });
});

describe("ConfirmDeleteDialog", () => {
  it("bez elementu do usunięcia nie pokazuje dialogu", () => {
    render(<ConfirmDeleteDialog pending={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each([
    ["section", "builder.confirmDelete.sectionTitle", "builder.confirmDelete.sectionDesc"],
    ["column", "builder.confirmDelete.columnTitle", "builder.confirmDelete.columnDesc"],
    ["widget", "builder.confirmDelete.widgetTitle", "builder.confirmDelete.widgetDesc"],
  ] as const)("dla rodzaju %s pokazuje właściwy komunikat", (kind, title, desc) => {
    render(
      <ConfirmDeleteDialog pending={{ kind, id: "x1" }} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(desc)).toBeInTheDocument();
  });

  it("potwierdzenie woła onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        pending={{ kind: "widget", id: "x1" }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "builder.common.delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("anulowanie woła onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDeleteDialog
        pending={{ kind: "widget", id: "x1" }}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "builder.common.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("zamknięcie dialogu klawiszem Escape woła onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDeleteDialog
        pending={{ kind: "section", id: "s1" }}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
