// /admin/permissions - SKLEJENIE trasy macierzy uprawnień.
//
// Do tego pliku trasa i cztery jej składniki (pasek filtrów, legenda, siatka
// kart aktorów, nota źródła) stały na ZERZE: test tabeli
// (`permissionMatrixTable.test.tsx`) montuje wyłącznie organizm tabeli.
//
// PRZEDMIOT DOWODU - to, czego tabela sama nie widzi:
//   * kafle KPI pokazują liczby Z TEJ SAMEJ macierzy, którą rysuje tabela,
//     w tym naprawiony licznik „bramek bez current_tenant_id()" liczony po
//     bramce (patrz `permissionMatrixBranches.test.ts`);
//   * filtr z paska faktycznie zawęża WIERSZE i KOLUMNY, a „wyczyść" wraca do
//     stanu wyjściowego i sam znika;
//   * trzy stany warstw (błąd / ładowanie / brak warstw) są rozłączne -
//     błąd odczytu nie może wyglądać jak „ten obszar nie ma warstw".
//
// DOSTĘP do trasy egzekwuje layout `/admin` i baza - patrz
// `adminRouteAuthority.gate.test.ts`; ten plik dowodzi stanu i sklejenia.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TierInput } from "@/lib/authz/permissionMatrix";

const h = vi.hoisted(() => ({
  tiers: [] as TierInput[],
  isLoading: false,
  error: null as Error | null,
  lang: "pl" as "pl" | "en",
}));

vi.mock("@/lib/authz/permissionMatrixQuery", () => ({
  useTenantMembershipTiers: () => ({
    tiers: h.tiers,
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    isLoading: h.isLoading,
    error: h.error,
  }),
}));
vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => h.lang }));

import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-admin-permissions";
import { AUTHZ_SNAPSHOT } from "@/lib/authz/authzSnapshot.generated";
import { buildPermissionMatrix } from "@/lib/authz/permissionMatrix";
import { Route } from "@/routes/admin.permissions";

const TIERS: TierInput[] = [
  {
    key: "reader",
    rank: 0,
    name_pl: "Czytelnik",
    name_en: "Reader",
    features: {},
    is_default: true,
  },
  {
    key: "corporate",
    rank: 40,
    name_pl: "Korporacyjny",
    name_en: "Corporate",
    features: { premium_content: true, pro_briefings: true },
    is_default: false,
  },
];

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`adminPermissions.${key}`, options);

function renderPage() {
  const Page = Route.options.component;
  if (!Page) throw new Error("trasa bez komponentu");
  return render(<Page />);
}

/** Wartość kafla KPI o danej etykiecie. */
function kpi(labelKey: string): string {
  const label = screen.getByText(t(labelKey));
  const tile = label.parentElement;
  return tile?.lastElementChild?.textContent ?? "";
}

function tableRows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row");
}

beforeAll(() => {
  ensureI18n();
});

beforeEach(async () => {
  h.tiers = TIERS;
  h.isLoading = false;
  h.error = null;
  h.lang = "pl";
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("/admin/permissions - nagłówek i KPI", () => {
  it("kafle pokazują liczby tej samej macierzy, którą rysuje tabela", () => {
    renderPage();
    const matrix = buildPermissionMatrix({ tiers: TIERS });
    expect(screen.getByRole("heading", { level: 1, name: t("title") })).toBeInTheDocument();
    expect(kpi("kpi.rows")).toBe(String(matrix.summary.rows));
    expect(kpi("kpi.enforced")).toBe(String(matrix.summary.enforcedRows));
    expect(kpi("kpi.decorative")).toBe(String(matrix.summary.decorativeRows));
    expect(kpi("kpi.tiers")).toBe("2");
    expect(kpi("kpi.gatesWithoutCallerTenant")).toBe(
      String(matrix.summary.gatesWithoutCallerTenant),
    );
  });

  it("kafel bramek bez tenanta wołającego świeci ostrzeżeniem, gdy jest cokolwiek do przeglądu", () => {
    renderPage();
    const matrix = buildPermissionMatrix({ tiers: TIERS });
    const tile = screen.getByText(t("kpi.gatesWithoutCallerTenant")).closest("div[title]");
    expect(tile).toHaveAttribute("title", t("tenant.rowHint"));
    if (matrix.summary.gatesWithoutCallerTenant > 0) {
      expect(tile?.className).toContain("border-brand/70");
    } else {
      expect(tile?.className).toContain("border-border/60");
    }
  });

  it("nota źródła podaje liczby ze snapshotu bramek, nie z ręki", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: t("sourceTitle") })).toBeInTheDocument();
    expect(
      screen.getByText(
        t("generatedFrom", {
          migrations: AUTHZ_SNAPSHOT.stats.migrations,
          functions: AUTHZ_SNAPSHOT.stats.functions,
          policies: AUTHZ_SNAPSHOT.stats.policies,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("karty warstw pokazują nazwę w języku interfejsu, rangę i licznik egzekwowanych flag", async () => {
    h.lang = "en";
    await i18n.changeLanguage("en");
    renderPage();
    const grid = screen.getByRole("region", { name: t("table.caption") });
    expect(within(grid).getByRole("heading", { name: "Corporate" })).toBeInTheDocument();
    expect(within(grid).getByText(t("tierRank", { rank: 40 }))).toBeInTheDocument();
    // Licznik flag warstwy z bramką: `enforced/total`.
    const keyLine = within(grid).getByText("corporate").parentElement;
    expect(keyLine?.textContent).toMatch(/^corporate - .+: \d+\/2$/);
    expect(within(grid).getByText(t("tierDefaultBadge"))).toBeInTheDocument();
  });

  it("legenda pokazuje cztery poziomy, oba stany egzekwowania i trzy odniesienia do tenanta", () => {
    renderPage();
    const legend = screen.getByText(`${t("table.legend")}:`).parentElement as HTMLElement;
    expect(legend.children.length).toBeGreaterThanOrEqual(1 + 4 + 2 + 3);
  });
});

describe("/admin/permissions - pasek filtrów", () => {
  it("fraza zawęża wiersze; licznik wyników i przycisk czyszczenia reagują", () => {
    renderPage();
    const before = tableRows().length;
    expect(screen.queryByRole("button", { name: t("toolbar.reset") })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t("toolbar.searchLabel")), {
      target: { value: "nie-ma-takiego-wiersza-zzz" },
    });
    expect(screen.getByText(t("toolbar.results", { count: 0 }))).toBeInTheDocument();
    expect(tableRows().length).toBeLessThan(before);

    fireEvent.click(screen.getByRole("button", { name: t("toolbar.reset") }));
    expect(screen.getByLabelText(t("toolbar.searchLabel"))).toHaveValue("");
    expect(tableRows()).toHaveLength(before);
    expect(screen.queryByRole("button", { name: t("toolbar.reset") })).not.toBeInTheDocument();
  });

  it("wybór „role” zostawia same karty ról; „warstwy” - same karty warstw", () => {
    renderPage();
    const grid = () => screen.getByRole("region", { name: t("table.caption") });
    const cards = () => within(grid()).getAllByRole("article");
    const all = cards().length;

    fireEvent.click(screen.getByRole("radio", { name: t("toolbar.actorTier") }));
    expect(cards()).toHaveLength(TIERS.length);
    expect(screen.getByRole("button", { name: t("toolbar.reset") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: t("toolbar.actorRole") }));
    expect(cards()).toHaveLength(all - TIERS.length);

    fireEvent.click(screen.getByRole("radio", { name: t("toolbar.actorAll") }));
    expect(cards()).toHaveLength(all);
  });

  it("„tylko egzekwowane” zostawia wiersze z realną bramką i włącza czyszczenie", () => {
    renderPage();
    const matrix = buildPermissionMatrix({ tiers: TIERS });
    fireEvent.click(screen.getByRole("switch", { name: t("toolbar.onlyEnforced") }));
    expect(
      screen.getByText(t("toolbar.results", { count: matrix.summary.enforcedRows })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("toolbar.reset") }));
    expect(
      screen.getByText(t("toolbar.results", { count: matrix.summary.rows })),
    ).toBeInTheDocument();
  });
});

describe("/admin/permissions - stany warstw obszaru roboczego", () => {
  it("błąd odczytu warstw to komunikat błędu - NIE „ten obszar nie ma warstw” i nie „ładowanie”", () => {
    h.tiers = [];
    h.error = new Error("permission denied");
    h.isLoading = true;
    renderPage();
    expect(screen.getByText(t("empty.error"))).toBeInTheDocument();
    expect(screen.queryByText(t("empty.tiers"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("empty.loading"))).not.toBeInTheDocument();
  });

  it("w trakcie ładowania - tylko komunikat ładowania", () => {
    h.tiers = [];
    h.isLoading = true;
    renderPage();
    expect(screen.getByText(t("empty.loading"))).toBeInTheDocument();
    expect(screen.queryByText(t("empty.tiers"))).not.toBeInTheDocument();
  });

  it("po załadowaniu bez warstw - komunikat o braku warstw, a kolumny ról zostają", () => {
    h.tiers = [];
    renderPage();
    expect(screen.getByText(t("empty.tiers"))).toBeInTheDocument();
    expect(kpi("kpi.tiers")).toBe("0");
    expect(
      within(screen.getByRole("region", { name: t("table.caption") })).getAllByRole("article")
        .length,
    ).toBeGreaterThan(0);
  });
});
