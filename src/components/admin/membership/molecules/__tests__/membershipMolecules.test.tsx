// Molekuły panelu członkostwa: edytor warstwy, mapowanie planów, okno nowej
// warstwy - 0 z 12 funkcji pokrytych do 18.08.2026 (mieszkały w pliku trasy
// `/admin/membership`, 898 linii).
//
// Trzy rzeczy pilnowane tu twardo, bo każda z nich wprost dotyczy tego, CO
// dostaje płacący członek:
//   - warstwy DOMYŚLNEJ nie da się usunąć (bez niej nowy użytkownik nie
//     dostałby żadnej warstwy),
//   - plan bez warstwy sprzedaje się, ale nie otwiera bramek - „bez warstwy"
//     musi być jawną pozycją listy, nie pustym polem,
//   - klucz nowej warstwy wchodzi do `access_plans.tier_key`, więc zły format
//     albo kolizja blokują utworzenie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  membershipTier,
  radixSelectStub,
  radixSwitchStub,
  radixTabsStub,
  reactI18nextStub,
} from "@/test/admin/pricingFixtures";
import { accessPlan } from "@/test/billing/fixtures";

let lang: "pl" | "en" = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));

/** Karta warstwy ma trzy zakładki - test wchodzi w tę, której dotyczy. */
function openTierTab(key: "basics" | "benefits" | "capabilities") {
  fireEvent.click(screen.getByRole("tab", { name: `adminMembership.tierTabs.${key}` }));
}

const { TierEditorCard } = await import("@/components/admin/membership/molecules/TierEditorCard");
const { PlanTierMappingList } =
  await import("@/components/admin/membership/molecules/PlanTierMappingList");
const { NewTierDialog } = await import("@/components/admin/membership/molecules/NewTierDialog");
const { draftFromTier } = await import("@/lib/admin/membershipDrafts");

beforeEach(() => {
  lang = "pl";
});

describe("TierEditorCard - nagłówek warstwy", () => {
  function renderCard(tier = membershipTier(), overrides: Record<string, unknown> = {}) {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={onChange}
        onSave={onSave}
        onDelete={onDelete}
        {...overrides}
      />,
    );
    return { onChange, onSave, onDelete };
  }

  it("pokazuje klucz warstwy i jej rangę", () => {
    renderCard(membershipTier({ key: "patron", rank: 30 }));

    expect(screen.getByText("patron")).toBeInTheDocument();
    expect(screen.getByText(/adminMembership\.rankBadge/)).toBeInTheDocument();
  });

  it("warstwa DOMYŚLNA jest oznaczona i jej kosz jest WYŁĄCZONY", () => {
    // Bez warstwy domyślnej nowy użytkownik nie dostałby żadnej.
    renderCard(membershipTier({ is_default: true }));

    expect(screen.getByText("adminMembership.defaultBadge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deleteDefaultDisabled/ })).toBeDisabled();
  });

  it("warstwa NIEAKTYWNA jest oznaczona osobno", () => {
    renderCard(membershipTier({ active: false }));

    expect(screen.getByText("adminMembership.inactiveBadge")).toBeInTheDocument();
    expect(screen.queryByText("adminMembership.defaultBadge")).not.toBeInTheDocument();
  });

  it("kosz zwykłej warstwy pyta o potwierdzenie przed usunięciem", () => {
    const confirmStub = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmStub);
    const { onDelete } = renderCard(membershipTier({ key: "member" }));

    fireEvent.click(screen.getByRole("button", { name: /deleteTitle/ }));

    expect(confirmStub).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("ODWOŁANE potwierdzenie nie usuwa warstwy", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const { onDelete } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /deleteTitle/ }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("trwające usuwanie wyłącza kosz", () => {
    renderCard(membershipTier(), { deleting: true });

    expect(screen.getByRole("button", { name: /deleteTitle/ })).toBeDisabled();
  });
});

describe("TierEditorCard - pola formularza", () => {
  function renderCard(tier = membershipTier()) {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={onChange}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    return { onChange, onSave };
  }

  it("grupy pól są nazwanymi zbiorami, nie płaską listą", () => {
    renderCard();

    const groups = screen.getAllByRole("group");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0].tagName).toBe("FIELDSET");
  });

  /** Pole rangi - w karcie są też inne pola liczbowe (limit zapytań). */
  function rankField(): HTMLElement {
    const status = screen.getByRole("group", { name: /groups\.status/ });
    return within(status).getByRole("spinbutton");
  }

  it("zmiana rangi zgłasza LICZBĘ, nie tekst z pola", () => {
    const { onChange } = renderCard();

    fireEvent.change(rankField(), { target: { value: "25" } });

    expect(onChange).toHaveBeenCalledWith({ rank: 25 });
  });

  it("pusta ranga schodzi na zero, a nie na NaN", () => {
    // `Number("") || 0` - ranga NaN wywróciłaby porządek warstw wszędzie.
    const { onChange } = renderCard();

    fireEvent.change(rankField(), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith({ rank: 0 });
  });

  it("możliwości pokazują się jako jednolinijkowy JSON do ręcznej edycji", () => {
    renderCard(membershipTier({ features: { briefings: true } }));
    openTierTab("capabilities");

    expect(screen.getByDisplayValue('{"briefings":true}')).toBeInTheDocument();
  });

  it("przycisk zapisu woła zapis raz", () => {
    const { onSave } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /adminMembership\.save/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("zmiana każdej z czterech nazw i opisów zgłasza swoje pole", () => {
    const { onChange } = renderCard();

    fireEvent.change(screen.getByDisplayValue("Członek"), { target: { value: "Czytelnik" } });
    expect(onChange).toHaveBeenCalledWith({ name_pl: "Czytelnik" });

    fireEvent.change(screen.getByDisplayValue("Member"), { target: { value: "Reader" } });
    expect(onChange).toHaveBeenCalledWith({ name_en: "Reader" });
  });

  it("opisy w obu językach mają osobne pola wielowierszowe", () => {
    const tier = membershipTier({ description_pl: "Opis PL", description_en: "Description EN" });
    const onChange = vi.fn();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={onChange}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const pl = screen.getByDisplayValue("Opis PL");
    const en = screen.getByDisplayValue("Description EN");

    expect(pl).toHaveAttribute("rows", "4");
    expect(en).toHaveAttribute("rows", "4");
    expect(pl).toHaveClass("min-h-[88px]");
    expect(en).toHaveClass("min-h-[88px]");

    fireEvent.change(pl, { target: { value: "Nowy opis" } });
    expect(onChange).toHaveBeenCalledWith({ description_pl: "Nowy opis" });

    fireEvent.change(en, { target: { value: "New" } });
    expect(onChange).toHaveBeenCalledWith({ description_en: "New" });
  });

  it("przełącznik aktywności i flagi domyślności zgłaszają osobne pola", () => {
    const { onChange } = renderCard(membershipTier({ active: true, is_default: false }));

    const status = screen.getByRole("group", { name: /groups\.status/ });
    const switches = within(status).getAllByRole("switch");
    fireEvent.click(switches[0]);
    expect(onChange).toHaveBeenCalledWith({ active: false });

    fireEvent.click(switches[1]);
    expect(onChange).toHaveBeenCalledWith({ is_default: true });
  });

  it("edycja surowego JSON-a bramek zgłasza tekst, a walidacja jest wyżej", () => {
    // Molekuła nie waliduje - świadomie. Sprawdzenie składni należy do reguły
    // wywoływanej przy zapisie, żeby redakcja mogła dokończyć wpisywanie.
    const { onChange } = renderCard();
    openTierTab("capabilities");

    fireEvent.change(screen.getByDisplayValue('{"briefings":true}'), {
      target: { value: "{niedokonczony" },
    });

    expect(onChange).toHaveBeenCalledWith({ features: "{niedokonczony" });
  });

  it("benefity i możliwości mieszkają w osobnych ZAKŁADKACH, nie w jednej kolumnie", () => {
    // Katalog warstw przewijał się kilka ekranów - rozdział na zakładki jest
    // częścią kontraktu UI, nie kosmetyką.
    renderCard();

    openTierTab("benefits");
    expect(screen.getByRole("group", { name: /groups\.benefits/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /groups\.capabilities/ })).not.toBeInTheDocument();

    openTierTab("capabilities");
    expect(screen.getByRole("group", { name: /groups\.capabilities/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /groups\.benefits/ })).not.toBeInTheDocument();
  });

  it("trwający zapis wyłącza przycisk", () => {
    const tier = membershipTier();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving
        deleting={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /adminMembership\.save/ })).toBeDisabled();
  });
});

describe("PlanTierMappingList - co klient dostaje za zakup", () => {
  const PLANS = [
    accessPlan({ id: "p1", name_pl: "Miesięczny", name_en: "Monthly", tier_key: "member" }),
    accessPlan({ id: "p2", name_pl: "Roczny", name_en: "Annual", tier_key: null }),
  ];
  const TIERS = [
    membershipTier({ key: "member", name_pl: "Członek", name_en: "Member" }),
    membershipTier({ id: "t2", key: "patron", name_pl: "Patron", name_en: "Patron" }),
  ];

  function renderList(plans = PLANS, overrides: Record<string, unknown> = {}) {
    const onAssign = vi.fn();
    render(
      <PlanTierMappingList
        plans={plans}
        tierOptions={TIERS}
        lang={lang}
        saving={false}
        onAssign={onAssign}
        {...overrides}
      />,
    );
    return { onAssign };
  }

  it("pokazuje nazwę planu w języku panelu", () => {
    renderList();

    expect(screen.getByText("Miesięczny")).toBeInTheDocument();
    expect(screen.getByText("Roczny")).toBeInTheDocument();
  });

  it("plan BEZ warstwy pokazuje jawną pozycję „bez warstwy”, nie puste pole", () => {
    // Puste pole czytałoby się jak „nie wczytało się", a to stan celowy:
    // plan sprzedaje się, ale nie otwiera bramek.
    renderList();

    const selects = screen.getAllByRole("combobox");
    expect((selects[1] as HTMLSelectElement).value).toBe("none");
    expect(screen.getAllByText("adminMembership.mapping.noTier").length).toBeGreaterThan(0);
  });

  it("wybór warstwy zapisuje się NATYCHMIAST, bez osobnego przycisku", () => {
    const { onAssign } = renderList();

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "patron" } });

    expect(onAssign).toHaveBeenCalledWith("p2", "patron");
  });

  it("wybór „bez warstwy” zgłasza `null`, a nie napis „none”", () => {
    const { onAssign } = renderList();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });

    expect(onAssign).toHaveBeenCalledWith("p1", null);
  });

  it("trwający zapis wyłącza WSZYSTKIE listy, żeby nie nałożyć zmian", () => {
    renderList(PLANS, { saving: true });

    for (const select of screen.getAllByRole("combobox")) {
      expect(select).toBeDisabled();
    }
  });

  it("cena planu w PLN pokazuje orientacyjne przeliczenie na EUR dla wersji angielskiej", () => {
    renderList([accessPlan({ price_cents: 4900, currency: "PLN" })]);

    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/49\.00 PLN/)).toBeInTheDocument();
  });

  it("plan w EUR nie dostaje drugiego przeliczenia", () => {
    renderList([accessPlan({ price_cents: 1200, currency: "EUR" })]);

    expect(screen.queryByText(/· EN:/)).not.toBeInTheDocument();
    expect(screen.getByText(/12\.00 EUR/)).toBeInTheDocument();
  });

  it("pusta lista planów nie wywala widoku", () => {
    renderList([]);

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});

describe("NewTierDialog - klucz wchodzący do mapowania planów", () => {
  function openDialog(existingKeys: string[] = [], suggestedRank = 20) {
    const onCreate = vi.fn();
    render(
      <NewTierDialog
        existingKeys={existingKeys}
        suggestedRank={suggestedRank}
        onCreate={onCreate}
        isPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));
    return { onCreate };
  }

  /** Pola okna: klucz, ranga, nazwa PL, nazwa EN. */
  function fill(values: { key?: string; namePl?: string; nameEn?: string }) {
    const dialog = screen.getByRole("dialog");
    const textboxes = within(dialog).getAllByRole("textbox");
    if (values.key !== undefined) fireEvent.change(textboxes[0], { target: { value: values.key } });
    if (values.namePl !== undefined)
      fireEvent.change(textboxes[1], { target: { value: values.namePl } });
    if (values.nameEn !== undefined)
      fireEvent.change(textboxes[2], { target: { value: values.nameEn } });
  }

  it("przycisk „utwórz” jest wyłączony, dopóki brakuje klucza albo nazw", () => {
    openDialog();

    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeDisabled();

    fill({ key: "patron", namePl: "Patron" });
    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeDisabled();

    fill({ nameEn: "Patron" });
    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeEnabled();
  });

  it("WIELKIE LITERY są sprowadzane do małych już przy wpisywaniu", () => {
    // Zachowanie przypięte świadomie: pole normalizuje klucz, zamiast blokować
    // utworzenie. Redakcja nie musi wiedzieć o formacie, a do bazy i tak trafia
    // klucz, który da się odczytać.
    const { onCreate } = openDialog([], 10);

    fill({ key: "Patron", namePl: "Patron", nameEn: "Patron" });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ key: "patron" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("klucz ze SPACJĄ blokuje utworzenie - normalizacja nie ratuje formatu", () => {
    openDialog();

    fill({ key: "dla firm", namePl: "Firmy", nameEn: "Companies" });

    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeDisabled();
  });

  it("klucz JEDNOZNAKOWY blokuje utworzenie", () => {
    openDialog();

    fill({ key: "a", namePl: "Firmy", nameEn: "Companies" });

    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeDisabled();
  });

  it("klucz JUŻ ZAJĘTY blokuje utworzenie", () => {
    openDialog(["patron"]);

    fill({ key: "patron", namePl: "Patron", nameEn: "Patron" });

    expect(screen.getByRole("button", { name: /newTierDialog\.create/ })).toBeDisabled();
  });

  it("nowa warstwa dostaje PODPOWIEDZIANĄ rangę - staje na końcu drabinki", () => {
    const { onCreate } = openDialog([], 40);

    fill({ key: "patron", namePl: "Patron", nameEn: "Patron" });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    expect(onCreate).toHaveBeenCalledWith({
      key: "patron",
      rank: 40,
      name_pl: "Patron",
      name_en: "Patron",
    });
  });

  it("utworzenie zamyka okno", () => {
    openDialog();

    fill({ key: "patron", namePl: "Patron", nameEn: "Patron" });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DOSTĘPNOŚĆ pól panelu członkostwa (bramka po defekcie)", () => {
  // Do 19.08.2026 pola karty warstwy nie miały dostępnych nazw, a etykiety
  // czterech z nich były TWARDYMI polskimi napisami - wersja angielska panelu
  // pokazywała „Nazwa PL" i „Opis PL". Klucze słownika istniały od początku;
  // komponent ich nie używał.
  it("nazwy i opisy warstwy dają się znaleźć po etykiecie ZE SŁOWNIKA", () => {
    const tier = membershipTier();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    openTierTab("capabilities");
    expect(
      screen.getByLabelText("adminMembership.capabilities.advanced.heading"),
    ).toBeInTheDocument();
    openTierTab("basics");

    for (const key of [
      "fields.namePl",
      "fields.nameEn",
      "fields.descriptionPl",
      "fields.descriptionEn",
      "fields.rank",
    ]) {
      expect(screen.getByLabelText(`adminMembership.${key}`)).toBeInTheDocument();
    }
  });

  it("bramki są opisane po ludzku, a surowy JSON schowany w sekcji zaawansowanej", () => {
    const tier = membershipTier();
    render(
      <TierEditorCard
        tier={tier}
        draft={draftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    openTierTab("capabilities");

    expect(screen.getByText("adminMembership.capabilities.heading")).toBeInTheDocument();
    expect(
      screen.getByLabelText("adminMembership.capabilities.labels.premium_content"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("adminMembership.capabilities.advanced.heading"),
    ).toBeInTheDocument();
  });

  it("pola okna nowej warstwy mają dostępne nazwy", () => {
    render(
      <NewTierDialog existingKeys={[]} suggestedRank={10} onCreate={vi.fn()} isPending={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("adminMembership.newTierDialog.key")).toBeInTheDocument();
    expect(dialog.getByLabelText("adminMembership.fields.rank")).toBeInTheDocument();
  });
});
