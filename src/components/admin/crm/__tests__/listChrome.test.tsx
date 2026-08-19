// Obudowa list CRM: chipy filtrów, menedżery kolumn i zakładki zapisanych
// widoków - po jednej parze dla osób i firm.
//
// Te panele nie mają własnych zapytań: dostają wartość i oddają zmianę, więc
// test sprawdza dokładnie to, co jest ich zadaniem - że klik zmienia STAN
// FILTRA/KOLUMN zgodnie z regułą, a nie że coś się wyrenderowało.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_LEAD_FILTER, DEFAULT_LEAD_VIEW_CONFIG } from "@/lib/crm/leadViews";
import { DEFAULT_COMPANY_FILTER, DEFAULT_COMPANY_VIEW_CONFIG } from "@/lib/crm/companyViews";

import { LeadFilterChips } from "../LeadFilterChips";
import { CompanyFilterChips } from "../CompanyFilterChips";
import { LeadColumnManager } from "../LeadColumnManager";
import { CompanyColumnManager } from "../CompanyColumnManager";
import { LeadViewTabs } from "../LeadViewTabs";
import { CompanyViewTabs } from "../CompanyViewTabs";

const STAGE_LABELS = {
  new: "Nowy",
  contacted: "Kontakt",
  qualified: "Zakwalifikowany",
  proposal: "Oferta",
  won: "Wygrany",
  lost: "Przegrany",
  archived: "Archiwum",
};

describe("LeadFilterChips", () => {
  it("aktywny filtr pokazuje swoją wartość na chipie", () => {
    render(
      <LeadFilterChips
        lang="pl"
        value={{ ...DEFAULT_LEAD_FILTER, stage: "won", country: "Poland" }}
        onChange={() => {}}
        stageLabels={STAGE_LABELS}
        countries={["Poland", "Belgium"]}
      />,
    );
    expect(screen.getByText("Wygrany")).toBeInTheDocument();
    expect(screen.getByText("Poland")).toBeInTheDocument();
  });

  it("czyszczenie chipa zeruje TYLKO jego filtr", () => {
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={{ ...DEFAULT_LEAD_FILTER, stage: "won", band: "hot" }}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    const stageChip = screen.getByText("Wygrany").closest("button");
    fireEvent.click(within(stageChip as HTMLElement).getByLabelText("Clear"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTER, stage: "any", band: "hot" });
  });

  it("przycisk czyszczenia pojawia się dopiero przy niedomyślnym filtrze", () => {
    const { rerender } = render(
      <LeadFilterChips
        lang="pl"
        value={DEFAULT_LEAD_FILTER}
        onChange={() => {}}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    expect(screen.queryByText("Wyczyść filtry")).toBeNull();

    rerender(
      <LeadFilterChips
        lang="pl"
        value={{ ...DEFAULT_LEAD_FILTER, consentOnly: true }}
        onChange={() => {}}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    expect(screen.getByText("Wyczyść filtry")).toBeInTheDocument();
  });

  it("„Wyczyść filtry” przywraca komplet wartości domyślnych", () => {
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={{ ...DEFAULT_LEAD_FILTER, stage: "won", company: "Acme", consentOnly: true }}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    fireEvent.click(screen.getByText("Wyczyść filtry"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_LEAD_FILTER);
  });

  it("etykiety są w języku panelu", () => {
    render(
      <LeadFilterChips
        lang="en"
        value={DEFAULT_LEAD_FILTER}
        onChange={() => {}}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(screen.getByText("Consent")).toBeInTheDocument();
  });
});

describe("CompanyFilterChips", () => {
  it("aktywne filtry pokazują wartości, czyszczenie zeruje jeden z nich", () => {
    const onChange = vi.fn();
    render(
      <CompanyFilterChips
        lang="pl"
        value={{ ...DEFAULT_COMPANY_FILTER, country: "Poland", branch: "Energetyka" }}
        onChange={onChange}
        countries={["Poland"]}
        branches={["Energetyka"]}
      />,
    );
    expect(screen.getByText("Poland")).toBeInTheDocument();
    const branchChip = screen.getByText("Energetyka").closest("button");
    fireEvent.click(within(branchChip as HTMLElement).getByLabelText("Clear"));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_COMPANY_FILTER,
      country: "Poland",
      branch: null,
    });
  });

  it("„Wyczyść filtry” wraca do domyślnych", () => {
    const onChange = vi.fn();
    render(
      <CompanyFilterChips
        lang="pl"
        value={{ ...DEFAULT_COMPANY_FILTER, country: "Poland" }}
        onChange={onChange}
        countries={["Poland"]}
        branches={[]}
      />,
    );
    fireEvent.click(screen.getByText("Wyczyść filtry"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COMPANY_FILTER);
  });
});

describe("menedżery kolumn", () => {
  it("licznik pokazuje liczbę widocznych kolumn", () => {
    render(
      <LeadColumnManager lang="pl" active={["name", "email", "company"]} onChange={() => {}} />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("zaznaczenie kolumny wstawia ją w kolejności tabeli", () => {
    const onChange = vi.fn();
    render(<LeadColumnManager lang="pl" active={["name", "company"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Kolumny"));
    fireEvent.click(screen.getByText("E-mail"));
    expect(onChange).toHaveBeenCalledWith(["name", "email", "company"]);
  });

  it("kolumny wymaganej nie da się odznaczyć (checkbox wyłączony)", () => {
    const onChange = vi.fn();
    render(<LeadColumnManager lang="pl" active={["name", "email"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Kolumny"));
    expect(screen.getByText("stałe")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Osoba"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("„Domyślne” przywraca zestaw z konfiguracji widoku", () => {
    const onChange = vi.fn();
    render(<LeadColumnManager lang="pl" active={["name"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Kolumny"));
    fireEvent.click(screen.getByText("Domyślne"));
    expect(onChange).toHaveBeenCalledWith([...DEFAULT_LEAD_VIEW_CONFIG.columns]);
  });

  it("menedżer kolumn firm działa tą samą regułą", () => {
    const onChange = vi.fn();
    render(<CompanyColumnManager lang="en" active={["name"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Columns"));
    fireEvent.click(screen.getByText("Reset"));
    expect(onChange).toHaveBeenCalledWith([...DEFAULT_COMPANY_VIEW_CONFIG.columns]);
  });
});

describe("zakładki zapisanych widoków", () => {
  const savedLead = [
    {
      id: "view-1",
      name: "Moje gorące",
      config: { ...DEFAULT_LEAD_VIEW_CONFIG, filter: { ...DEFAULT_LEAD_FILTER, band: "hot" } },
      is_shared: false,
      user_id: "u1",
    },
  ];

  it("pokazuje widoki wbudowane i widok użytkownika", () => {
    render(
      <LeadViewTabs
        lang="pl"
        activeId="builtin:all"
        onSelect={() => {}}
        saved={savedLead}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onCreate={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    expect(screen.getByText("Wszystkie osoby")).toBeInTheDocument();
    expect(screen.getByText("Gorące (hot)")).toBeInTheDocument();
    expect(screen.getByText("Moje gorące")).toBeInTheDocument();
  });

  it("wybór widoku wbudowanego oddaje jego konfigurację", () => {
    const onSelect = vi.fn();
    render(
      <LeadViewTabs
        lang="pl"
        activeId="builtin:all"
        onSelect={onSelect}
        saved={[]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onCreate={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByText("Gorące (hot)"));
    expect(onSelect).toHaveBeenCalledWith(
      "builtin:hot",
      expect.objectContaining({ filter: expect.objectContaining({ band: "hot" }) }),
    );
  });

  it("wybór zapisanego widoku przepuszcza config przez parser (odporność na zepsuty JSONB)", () => {
    const onSelect = vi.fn();
    render(
      <LeadViewTabs
        lang="pl"
        activeId="builtin:all"
        onSelect={onSelect}
        saved={[
          {
            id: "view-2",
            name: "Zepsuty",
            config: { columns: [] },
            is_shared: false,
            user_id: "u1",
          },
        ]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onCreate={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByText("Zepsuty"));
    expect(onSelect).toHaveBeenCalledWith("view-2", DEFAULT_LEAD_VIEW_CONFIG);
  });

  it("nowy widok powstaje z nazwą i flagą udostępnienia", async () => {
    const onCreate = vi.fn(async () => {});
    render(
      <LeadViewTabs
        lang="pl"
        activeId="builtin:all"
        onSelect={() => {}}
        saved={[]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onCreate={onCreate}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(screen.getByPlaceholderText(/Gorące leady/), {
      target: { value: "Nowy widok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(onCreate).toHaveBeenCalledWith("Nowy widok", false);
  });

  it("zakładki firm pokazują widoki wbudowane w języku panelu", () => {
    render(
      <CompanyViewTabs
        lang="en"
        activeId="builtin:all"
        onSelect={() => {}}
        saved={[]}
        currentConfig={DEFAULT_COMPANY_VIEW_CONFIG}
        onCreate={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    expect(screen.getByText("All companies")).toBeInTheDocument();
  });
});

describe("edycja filtrów w chipach", () => {
  /** Radix Select otwiera listę klawiszem - w happy-dom to najpewniejsza droga. */
  function pickOption(comboboxIndex: number, optionName: string) {
    const trigger = screen.getAllByRole("combobox")[comboboxIndex];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: optionName }));
  }

  it("każdy chip osób edytuje swój filtr", () => {
    const onChange = vi.fn();
    const render1 = (value = DEFAULT_LEAD_FILTER) =>
      render(
        <LeadFilterChips
          lang="pl"
          value={value}
          onChange={onChange}
          stageLabels={STAGE_LABELS}
          countries={["Poland"]}
        />,
      );

    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["Etap", "Wygrany", { stage: "won" }],
      ["Poziom", "Gorący", { band: "hot" }],
      ["Źródło", "Newsletter", { source: "newsletter" }],
      ["Kraj", "Poland", { country: "Poland" }],
      ["Utworzono", "Ostatnie 30 dni", { createdRange: "30d" }],
      ["Aktywność", "Ostatnie 7 dni", { activityRange: "7d" }],
    ];

    for (const [chip, option, patch] of cases) {
      onChange.mockClear();
      const view = render1();
      fireEvent.click(screen.getByText(chip));
      pickOption(0, option);
      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTER, ...patch });
      view.unmount();
    }
  });

  it("chip firmy przyjmuje wpisaną nazwę, a pusty tekst czyści filtr", () => {
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={DEFAULT_LEAD_FILTER}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    fireEvent.click(screen.getByText("Firma"));
    const input = screen.getByPlaceholderText("Dokładna nazwa firmy");
    fireEvent.change(input, { target: { value: "Acme" } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTER, company: "Acme" });

    onChange.mockClear();
    fireEvent.change(input, { target: { value: "   " } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTER, company: null });
  });

  it("chip zgody przełącza się jednym kliknięciem", () => {
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={DEFAULT_LEAD_FILTER}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    fireEvent.click(screen.getByText("Zgoda mkt."));
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTER, consentOnly: true });
  });

  it("chipy firm edytują kraj, branżę i zakres aktualizacji", () => {
    const onChange = vi.fn();
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["Kraj", "Poland", { country: "Poland" }],
      ["Branża", "Energetyka", { branch: "Energetyka" }],
    ];
    for (const [chip, option, patch] of cases) {
      onChange.mockClear();
      const view = render(
        <CompanyFilterChips
          lang="pl"
          value={DEFAULT_COMPANY_FILTER}
          onChange={onChange}
          countries={["Poland"]}
          branches={["Energetyka"]}
        />,
      );
      fireEvent.click(screen.getByText(chip));
      const trigger = screen.getAllByRole("combobox")[0];
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(screen.getByRole("option", { name: option }));
      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMPANY_FILTER, ...patch });
      view.unmount();
    }
  });
});

describe("zarządzanie zapisanym widokiem", () => {
  const saved = [
    {
      id: "view-1",
      name: "Moje gorące",
      config: DEFAULT_LEAD_VIEW_CONFIG,
      is_shared: false,
      user_id: "u1",
    },
  ];

  function renderTabs(handlers: Record<string, ReturnType<typeof vi.fn>>) {
    render(
      <LeadViewTabs
        lang="pl"
        activeId="view-1"
        onSelect={handlers.onSelect ?? (() => {})}
        saved={saved}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onCreate={handlers.onCreate ?? (async () => {})}
        onRename={handlers.onRename ?? (async () => {})}
        onDelete={handlers.onDelete ?? (async () => {})}
        onToggleShared={handlers.onToggleShared ?? (async () => {})}
      />,
    );
    fireEvent.click(screen.getByLabelText("Opcje widoku"));
  }

  it("udostępnienie zespołowi wysyła odwrotność bieżącego stanu", () => {
    const onToggleShared = vi.fn(async () => {});
    renderTabs({ onToggleShared });
    fireEvent.click(screen.getByText("Udostępnij zespołowi"));
    expect(onToggleShared).toHaveBeenCalledWith("view-1", true);
  });

  it("usunięcie widoku woła handler z jego identyfikatorem", () => {
    const onDelete = vi.fn(async () => {});
    renderTabs({ onDelete });
    fireEvent.click(screen.getByText("Usuń widok"));
    expect(onDelete).toHaveBeenCalledWith("view-1");
  });

  it("zmiana nazwy zapisuje nową wartość", () => {
    const onRename = vi.fn(async () => {});
    renderTabs({ onRename });
    fireEvent.click(screen.getByText("Zmień nazwę"));
    const input = screen.getByDisplayValue("Moje gorące");
    fireEvent.change(input, { target: { value: "  Nowa nazwa  " } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    // Nazwa jest przycinana przed zapisem.
    expect(onRename).toHaveBeenCalledWith("view-1", "Nowa nazwa");
  });
});

describe("zakładki widoków firm", () => {
  const saved = [
    {
      id: "cview-1",
      name: "Firmy z UE",
      config: DEFAULT_COMPANY_VIEW_CONFIG,
      is_shared: true,
      user_id: "u1",
    },
  ];

  function renderCompanyTabs(handlers: Record<string, ReturnType<typeof vi.fn>> = {}) {
    return render(
      <CompanyViewTabs
        lang="pl"
        activeId="cview-1"
        onSelect={handlers.onSelect ?? (() => {})}
        saved={saved}
        currentConfig={DEFAULT_COMPANY_VIEW_CONFIG}
        onCreate={handlers.onCreate ?? (async () => {})}
        onRename={handlers.onRename ?? (async () => {})}
        onDelete={handlers.onDelete ?? (async () => {})}
        onToggleShared={handlers.onToggleShared ?? (async () => {})}
      />,
    );
  }

  it("wybór widoku wbudowanego oddaje jego konfigurację", () => {
    const onSelect = vi.fn();
    renderCompanyTabs({ onSelect });
    fireEvent.click(screen.getByText("Wszystkie firmy"));
    expect(onSelect).toHaveBeenCalledWith("builtin:all", DEFAULT_COMPANY_VIEW_CONFIG);
  });

  it("wybór zapisanego widoku przepuszcza config przez parser", () => {
    const onSelect = vi.fn();
    renderCompanyTabs({ onSelect });
    fireEvent.click(screen.getByText("Firmy z UE"));
    expect(onSelect).toHaveBeenCalledWith("cview-1", DEFAULT_COMPANY_VIEW_CONFIG);
  });

  it("nowy widok firm powstaje z nazwą i flagą udostępnienia", () => {
    const onCreate = vi.fn(async () => {});
    renderCompanyTabs({ onCreate });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(screen.getByPlaceholderText(/Firmy z UE/), {
      target: { value: "  Nowy widok  " },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(onCreate).toHaveBeenCalledWith("Nowy widok", true);
  });

  it("opcje widoku: zmiana nazwy, udostępnienie i usunięcie", () => {
    const onRename = vi.fn(async () => {});
    const onToggleShared = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    const view = renderCompanyTabs({ onRename, onToggleShared, onDelete });

    fireEvent.click(screen.getByLabelText("Opcje widoku"));
    fireEvent.click(screen.getByText("Udostępnij zespołowi"));
    // Widok jest już udostępniony - klik ma go WYŁĄCZYĆ.
    expect(onToggleShared).toHaveBeenCalledWith("cview-1", false);

    fireEvent.click(screen.getByText("Usuń widok"));
    expect(onDelete).toHaveBeenCalledWith("cview-1");

    fireEvent.click(screen.getByText("Zmień nazwę"));
    fireEvent.change(screen.getByDisplayValue("Firmy z UE"), { target: { value: "Inna nazwa" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(onRename).toHaveBeenCalledWith("cview-1", "Inna nazwa");
    view.unmount();
  });
});

describe("chipy filtrów - kompletność reguł", () => {
  /** Otwiera dymek chipa i zwraca jego zawartość (Radix renderuje ją w portalu). */
  const openChip = async (name: RegExp) => {
    fireEvent.click(screen.getAllByRole("button", { name })[0]);
    return (await waitFor(() => {
      const el = document.querySelector("[data-radix-popper-content-wrapper]");
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
  };

  const pickOption = async (popover: HTMLElement, name: string) => {
    fireEvent.keyDown(within(popover).getByRole("combobox"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  afterEach(() => cleanup());

  it("czyszczenie KAŻDEGO chipa leadów zeruje dokładnie jeden filtr", () => {
    const full = {
      stage: "won" as const,
      band: "hot" as const,
      source: "form" as const,
      country: "Poland",
      company: "Acme",
      createdRange: "30d" as const,
      activityRange: "7d" as const,
      consentOnly: true,
    };
    const expected: Array<[string, Record<string, unknown>]> = [
      ["Wygrany", { stage: "any" }],
      ["Gorący", { band: "any" }],
      ["Poland", { country: null }],
      ["Acme", { company: null }],
      ["Tylko ze zgodą", { consentOnly: false }],
    ];
    for (const [chipValue, patch] of expected) {
      const onChange = vi.fn();
      render(
        <LeadFilterChips
          lang="pl"
          value={full}
          onChange={onChange}
          stageLabels={STAGE_LABELS}
          countries={["Poland"]}
        />,
      );
      const chip = screen.getByText(chipValue).closest("button") as HTMLElement;
      fireEvent.click(within(chip).getByLabelText("Clear"));
      expect(onChange).toHaveBeenCalledWith({ ...full, ...patch });
      cleanup();
    }
  });

  it("zakresy dat leadów czyszczą się osobno", () => {
    const full = {
      stage: "any" as const,
      band: "any" as const,
      source: "any" as const,
      country: null,
      company: null,
      createdRange: "30d" as const,
      activityRange: "7d" as const,
      consentOnly: false,
    };
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={full}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    const created = screen.getByText("Ostatnie 30 dni").closest("button") as HTMLElement;
    fireEvent.click(within(created).getByLabelText("Clear"));
    expect(onChange).toHaveBeenLastCalledWith({ ...full, createdRange: "any" });
    const activity = screen.getByText("Ostatnie 7 dni").closest("button") as HTMLElement;
    fireEvent.click(within(activity).getByLabelText("Clear"));
    expect(onChange).toHaveBeenLastCalledWith({ ...full, activityRange: "any" });
  });

  it("każdy chip leadów ustawia swój filtr i nie rusza pozostałych", async () => {
    // Każdy chip w osobnym renderze: Radix trzyma otwarty dymek w portalu,
    // więc dwa chipy naraz czytałyby się nawzajem.
    const cases: Array<[RegExp, string, Record<string, unknown>]> = [
      [/^Poziom/, "Gorący", { band: "hot" }],
      [/^Źródło/, "Formularz", { source: "form" }],
      [/^Kraj/, "Belgium", { country: "Belgium" }],
      [/^Utworzono/, "Ostatnie 7 dni", { createdRange: "7d" }],
      [/^Aktywność/, "Ostatnie 30 dni", { activityRange: "30d" }],
    ];
    for (const [chip, option, patch] of cases) {
      const onChange = vi.fn();
      render(
        <LeadFilterChips
          lang="pl"
          value={DEFAULT_LEAD_FILTER}
          onChange={onChange}
          stageLabels={STAGE_LABELS}
          countries={["Poland", "Belgium"]}
        />,
      );
      await pickOption(await openChip(chip), option);
      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, ...patch });
      cleanup();
    }
  });

  it("chip firmy i chip zgody leadów sterują swoimi polami", async () => {
    const onChange = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={DEFAULT_LEAD_FILTER}
        onChange={onChange}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    const companyChip = await openChip(/^Firma/);
    fireEvent.change(within(companyChip).getByRole("textbox"), { target: { value: "Acme" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, company: "Acme" });
    cleanup();

    const onChange2 = vi.fn();
    render(
      <LeadFilterChips
        lang="pl"
        value={DEFAULT_LEAD_FILTER}
        onChange={onChange2}
        stageLabels={STAGE_LABELS}
        countries={[]}
      />,
    );
    const consentChip = await openChip(/Zgoda mkt\./);
    fireEvent.click(within(consentChip).getByRole("switch"));
    expect(onChange2).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, consentOnly: true });
  });

  it("czyszczenie KAŻDEGO chipa firm zeruje dokładnie jeden filtr", () => {
    const full = {
      country: "Poland",
      branch: "Energetyka",
      hasLeads: "with" as const,
      createdRange: "30d" as const,
      activityRange: "7d" as const,
      minLeads: 5,
    };
    const expected: Array<[string, Record<string, unknown>]> = [
      ["Poland", { country: null }],
      ["Energetyka", { branch: null }],
      ["Z leadami", { hasLeads: "any" }],
      ["Ostatnie 30 dni", { createdRange: "any" }],
      ["Ostatnie 7 dni", { activityRange: "any" }],
      ["5", { minLeads: null }],
    ];
    for (const [chipValue, patch] of expected) {
      const onChange = vi.fn();
      render(
        <CompanyFilterChips
          lang="pl"
          value={full}
          onChange={onChange}
          countries={["Poland"]}
          branches={["Energetyka"]}
        />,
      );
      const chip = screen.getByText(chipValue).closest("button") as HTMLElement;
      fireEvent.click(within(chip).getByLabelText("Clear"));
      expect(onChange).toHaveBeenCalledWith({ ...full, ...patch });
      cleanup();
    }
  });

  it("każdy chip firm ustawia swój filtr", async () => {
    const cases: Array<[RegExp, string, Record<string, unknown>]> = [
      [/^Kraj/, "Belgium", { country: "Belgium" }],
      [/^Branża/, "Transport", { branch: "Transport" }],
      [/^Leady/, "Bez leadów", { hasLeads: "without" }],
      [/^Utworzono/, "Ostatnie 90 dni", { createdRange: "90d" }],
      [/^Aktywność/, "Ostatnie 90 dni", { activityRange: "90d" }],
    ];
    for (const [chip, option, patch] of cases) {
      const onChange = vi.fn();
      render(
        <CompanyFilterChips
          lang="pl"
          value={DEFAULT_COMPANY_FILTER}
          onChange={onChange}
          countries={["Poland", "Belgium"]}
          branches={["Energetyka", "Transport"]}
        />,
      );
      await pickOption(await openChip(chip), option);
      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_COMPANY_FILTER, ...patch });
      cleanup();
    }
  });

  it("minimalna liczba leadów przyjmuje tylko wartość dodatnią", async () => {
    const onChange = vi.fn();
    render(
      <CompanyFilterChips
        lang="pl"
        value={DEFAULT_COMPANY_FILTER}
        onChange={onChange}
        countries={[]}
        branches={[]}
      />,
    );
    const minChip = await openChip(/Min\. leadów/);
    const input = within(minChip).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_COMPANY_FILTER, minLeads: 3 });
    // Zero i wartość niepoprawna to BRAK filtra, nie „co najmniej 0”.
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_COMPANY_FILTER, minLeads: null });
  });
});

describe("zakładki widoków - anulowanie i stan przełącznika", () => {
  const savedLead = {
    id: "v1",
    name: "Moi klienci",
    entity: "lead",
    is_shared: true,
    config: { columns: ["name"], filter: {}, sort: { key: "created", dir: "desc" } },
  };

  afterEach(() => cleanup());

  it("anulowanie zapisu widoku leadów nie woła serwera", async () => {
    const onCreate = vi.fn();
    render(
      <LeadViewTabs
        lang="pl"
        activeId="builtin:all"
        saved={[]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onSelect={() => {}}
        onCreate={onCreate}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np\./), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/np\./)).toBeNull());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("anulowanie zmiany nazwy widoku leadów nie woła serwera", async () => {
    const onRename = vi.fn();
    render(
      <LeadViewTabs
        lang="pl"
        activeId="v1"
        saved={[savedLead]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onSelect={() => {}}
        onCreate={async () => {}}
        onRename={onRename}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Moi klienci")).toBeNull());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("widok udostępniony ma przełącznik w pozycji włączonej", async () => {
    render(
      <LeadViewTabs
        lang="pl"
        activeId="v1"
        saved={[savedLead]}
        currentConfig={DEFAULT_LEAD_VIEW_CONFIG}
        onSelect={() => {}}
        onCreate={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Opcje widoku"));
    const toggle = await screen.findByRole("switch");
    expect(toggle).toBeChecked();
    // Sam przełącznik nie jest osobnym sterowaniem - klik idzie do wiersza menu.
    fireEvent.click(toggle);
  });

  it("anulowanie zapisu i zmiany nazwy widoku firm też nie woła serwera", async () => {
    const onCreate = vi.fn();
    const onRename = vi.fn();
    render(
      <CompanyViewTabs
        lang="pl"
        activeId="v1"
        saved={[{ ...savedLead, entity: "company" }]}
        currentConfig={DEFAULT_COMPANY_VIEW_CONFIG}
        onSelect={() => {}}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={async () => {}}
        onToggleShared={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np\./), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/np\./)).toBeNull());

    fireEvent.click(screen.getByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Moi klienci")).toBeNull());
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});
