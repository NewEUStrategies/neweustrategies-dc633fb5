// Zakładka „Warstwy i benefity" wraz z kartą marketingu warstwy - 0 z 11
// funkcji pokrytych do 18.08.2026 (mieszkała w pliku trasy `/admin/pricing`).
//
// To tutaj redakcja ustawia, jak warstwa WYGLĄDA na stronie cennika: w której
// zakładce stoi, czy jest kotwicą wyboru, czy ma przycisk zakupu, czy kontakt
// z działem. Najważniejsza rzecz w tej zakładce to koszyk NIEPRZYPISANYCH:
// warstwa wskazująca nieistniejący segment nie pokaże się klientowi w żadnej
// zakładce cennika, więc panel musi ją wyświetlić osobno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  membershipTier,
  ok,
  pricingAudience,
  radixSelectStub,
  radixSwitchStub,
  reactI18nextStub,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;
let lang = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));
// Najemca z sesji (mutatory S1) - bez montowania warstwy uwierzytelniania.
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => "tenant-test" }));

const { TiersTab } = await import("@/components/admin/pricing/organisms/TiersTab");

const AUDIENCES = [
  pricingAudience({ key: "individual", name_pl: "Osoba prywatna", name_en: "Individual" }),
  pricingAudience({ id: "a2", key: "b2b", name_pl: "Firmy", name_en: "Companies" }),
];

function renderTab(tiers = [membershipTier()], audiences = AUDIENCES) {
  return renderWithQueryClient(<TiersTab audiences={audiences} tiers={tiers} />);
}

function tierWrites() {
  return chain.chainsFor("membership_tiers").filter((c) => c.has("update"));
}

function lastTierPatch(): Record<string, unknown> {
  return tierWrites().at(-1)!.argsOf("update")?.[0] as Record<string, unknown>;
}

/** Filtr `.eq(kolumna, …)` zapisu - token współbieżności i identyfikator. */
function lastTierFilter(column: string): unknown {
  return tierWrites()
    .at(-1)!
    .calls.find((call) => call.method === "eq" && call.args[0] === column)?.args[1];
}

/**
 * Baza warstw: UPDATE trafia, gdy token z `.eq("updated_at")` równa się
 * wersji wiersza (zwraca wiersz z nową wersją), inaczej 0 wierszy - jak
 * Postgres przy współbieżności optymistycznej.
 */
function tiersDb(rows: ReturnType<typeof membershipTier>[]) {
  let current = rows;
  chain.setResponse("membership_tiers", (c) => {
    if (!c.has("update")) return ok(current);
    const id = c.calls.find((call) => call.method === "eq" && call.args[0] === "id")?.args[1];
    const token = c.calls.find((call) => call.method === "eq" && call.args[0] === "updated_at")
      ?.args[1];
    const row = current.find((r) => r.id === id);
    if (!row || row.updated_at !== token) return ok([]);
    const next = { ...row, ...(c.argsOf("update")?.[0] as object), updated_at: `${token}+1` };
    current = current.map((r) => (r.id === id ? next : r));
    return ok([next]);
  });
  return {
    /** Zapis z innej karty: nowa wersja wiersza (i ewentualnie nowe pola). */
    touch(id: string, patch: Partial<ReturnType<typeof membershipTier>> = {}) {
      current = current.map((r) =>
        r.id === id ? { ...r, ...patch, updated_at: `${r.updated_at}#other` } : r,
      );
    },
  };
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("membership_tiers", ok([]));
  lang = "pl";
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
});

describe("TiersTab - liczniki nad zakładką", () => {
  it("liczy warstwy, segmenty, wyróżnienia i przypisania", () => {
    renderTab(
      [
        membershipTier({ id: "t1", audience_key: "individual", highlight: true }),
        membershipTier({ id: "t2", audience_key: "b2b" }),
        membershipTier({ id: "t3", audience_key: null }),
      ],
      AUDIENCES,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("warstwa wskazująca NIEISTNIEJĄCY segment nie liczy się jako przypisana", () => {
    renderTab([membershipTier({ audience_key: "skasowany" })], AUDIENCES);

    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
});

describe("TiersTab - grupowanie po segmencie", () => {
  it("warstwa stoi w nagłówku swojego segmentu", () => {
    renderTab([membershipTier({ audience_key: "individual" })], AUDIENCES);

    expect(screen.getByRole("heading", { name: "Osoba prywatna" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Firmy" })).not.toBeInTheDocument();
  });

  it("segment BEZ warstw nie dostaje pustej sekcji", () => {
    renderTab([membershipTier({ audience_key: "b2b" })], AUDIENCES);

    expect(screen.getByRole("heading", { name: "Firmy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Osoba prywatna" })).not.toBeInTheDocument();
  });

  it("warstwa wskazująca skasowany segment trafia do NIEPRZYPISANYCH, nie ginie", () => {
    renderTab([membershipTier({ name_pl: "Sierota", audience_key: "skasowany" })], AUDIENCES);

    expect(
      screen.getByRole("heading", { name: "adminPricing.tiers.unassigned" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sierota")).toBeInTheDocument();
  });

  it("bez nieprzypisanych warstw sekcja „nieprzypisane” w ogóle się nie pokazuje", () => {
    renderTab([membershipTier({ audience_key: "individual" })], AUDIENCES);

    expect(
      screen.queryByRole("heading", { name: "adminPricing.tiers.unassigned" }),
    ).not.toBeInTheDocument();
  });
});

describe("TierMarketingCard - co widzi klient", () => {
  it("pokazuje nazwę warstwy w języku panelu i jej rangę", () => {
    renderTab([membershipTier({ name_pl: "Członek", name_en: "Member", rank: 20 })]);

    expect(screen.getByText("Członek")).toBeInTheDocument();
    expect(screen.getByText(/adminPricing\.tiers\.rankBadge/)).toBeInTheDocument();
  });

  it("po angielsku pokazuje nazwę angielską", () => {
    lang = "en";
    renderTab([membershipTier({ name_pl: "Członek", name_en: "Member" })]);

    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.queryByText("Członek")).not.toBeInTheDocument();
  });

  it("WYRÓŻNIONA warstwa dostaje znacznik kotwicy", () => {
    renderTab([membershipTier({ highlight: true })]);

    expect(screen.getAllByText("adminPricing.tiers.highlight").length).toBeGreaterThan(0);
  });

  it("badge redakcyjny pokazuje się w nagłówku karty", () => {
    renderTab([membershipTier({ badge_pl: "Najpopularniejszy" })]);

    expect(screen.getByText("Najpopularniejszy")).toBeInTheDocument();
  });

  it("cztery grupy pól są nazwanymi zbiorami, nie płaską listą", () => {
    renderTab();

    expect(screen.getAllByRole("group").length).toBeGreaterThanOrEqual(4);
  });
});

describe("TiersTab - ZAPIS marketingu warstwy", () => {
  it("zapisuje przypisanie do segmentu wybrane z listy", async () => {
    tiersDb([membershipTier({ id: "t9", audience_key: "individual" })]);
    renderTab([membershipTier({ id: "t9", audience_key: "individual" })]);

    const audienceSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(audienceSelect, { target: { value: "b2b" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().audience_key).toBe("b2b");
    expect(lastTierFilter("id")).toBe("t9");
  });

  it("wybór „brak segmentu” zapisuje `null`, a nie napis „none”", async () => {
    tiersDb([membershipTier({ audience_key: "individual" })]);
    renderTab([membershipTier({ audience_key: "individual" })]);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().audience_key).toBeNull();
  });

  it("wyczyszczone badge i link kontaktowy schodzą do bazy jako `null`", async () => {
    // ZMIANA ZAMIERZONA (S1 def. 11): zapis niesie WYŁĄCZNIE zmienione
    // kolumny. Dawniej sam klik „Zapisz" na nietkniętej karcie z „  " w bazie
    // normalizował pola; teraz nietknięta karta nie ma czego zapisać, a
    // normalizacja pustych pól działa na polach, które redakcja wyczyściła.
    const tier = membershipTier({ badge_pl: "Top", contact_url: "/kontakt" });
    tiersDb([tier]);
    renderTab([tier]);

    fireEvent.change(screen.getByDisplayValue("Top"), { target: { value: "  " } });
    fireEvent.change(screen.getByDisplayValue("/kontakt"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch()).toEqual({ badge_pl: null, contact_url: null });
  });

  it("nietknięta karta nie ma czego zapisać - przycisk jest wyłączony", () => {
    renderTab([membershipTier({ badge_pl: "  ", contact_url: "   " })]);

    expect(screen.getByRole("button", { name: /tiers\.save/ })).toBeDisabled();
  });

  it("przełącznik wyróżnienia zmienia zapisywaną wartość", async () => {
    tiersDb([membershipTier({ highlight: false })]);
    renderTab([membershipTier({ highlight: false })]);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().highlight).toBe(true);
  });

  it("tryb przycisku zakupu zapisuje się wybraną wartością", async () => {
    tiersDb([membershipTier({ cta_mode: "auto" })]);
    renderTab([membershipTier({ cta_mode: "auto" })]);

    const ctaSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(ctaSelect, { target: { value: "contact" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().cta_mode).toBe("contact");
  });

  it("badge angielski, nota cenowa i link kontaktowy mają osobne pola", async () => {
    const tier = membershipTier({
      badge_en: "Most popular",
      contact_url: "/kontakt",
      price_note_pl: "2-20 miejsc",
      price_note_en: "2-20 seats",
    });
    tiersDb([tier]);
    renderTab([tier]);

    fireEvent.change(screen.getByDisplayValue("Most popular"), { target: { value: "Top pick" } });
    fireEvent.change(screen.getByDisplayValue("/kontakt"), {
      target: { value: "mailto:a@b.test" },
    });
    fireEvent.change(screen.getByDisplayValue("2-20 seats"), { target: { value: "2-50 seats" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    // ZMIANA ZAMIERZONA (def. 11): nietknięta polska nota NIE jedzie w zapisie
    // - pełny marketing w każdym zapisie cofał zmiany z drugiej karty.
    expect(lastTierPatch()).toEqual({
      badge_en: "Top pick",
      contact_url: "mailto:a@b.test",
      price_note_en: "2-50 seats",
    });
  });

  it("przełącznik „za miejsce” zapisuje się razem z notą cenową", async () => {
    tiersDb([membershipTier({ per_seat: false })]);
    renderTab([membershipTier({ per_seat: false })]);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[switches.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().per_seat).toBe(true);
  });

  it("edytor benefitów zapisuje listę par PL/EN, nie surowy tekst", async () => {
    const tier = membershipTier({ benefits: [{ pl: "Briefing", en: "Briefing" }] });
    tiersDb([tier]);
    renderTab([tier]);

    fireEvent.change(screen.getByLabelText("adminPricing.benefits.labelEn #1"), {
      target: { value: "Morning briefing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch().benefits).toEqual([{ pl: "Briefing", en: "Morning briefing" }]);
  });

  it("nazwy i opisy warstwy edytuje cennik (właściciel kolumn marketingu, def. 11)", async () => {
    const tier = membershipTier({ name_pl: "Członek", name_en: "Member", description_en: null });
    tiersDb([tier]);
    renderTab([tier]);

    fireEvent.change(screen.getByLabelText("adminPricing.tiers.namePl"), {
      target: { value: " Członek Plus " },
    });
    fireEvent.change(screen.getByLabelText("adminPricing.tiers.descriptionEn"), {
      target: { value: "For daily readers" },
    });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierPatch()).toEqual({
      name_pl: "Członek Plus",
      description_en: "For daily readers",
    });
  });

  it("pusta nazwa blokuje zapis i mówi dlaczego", () => {
    renderTab([membershipTier({ name_en: "Member" })]);

    fireEvent.change(screen.getByLabelText("adminPricing.tiers.nameEn"), {
      target: { value: "  " },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("adminPricing.tiers.nameRequired");
    expect(screen.getByRole("button", { name: /tiers\.save/ })).toBeDisabled();
  });

  it("zapis niesie SUROWY token `updated_at` wiersza, na którym redakcja zaczęła edycję", async () => {
    const token = "2026-10-19T10:00:00.123456+00:00";
    const tier = membershipTier({ id: "t1", badge_pl: null, updated_at: token });
    tiersDb([tier]);
    renderTab([tier]);

    fireEvent.change(screen.getAllByRole("textbox")[4], { target: { value: "Nowy" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    // Mikrosekundy zostają - `new Date()` zgubiłby je i każdy zapis byłby konfliktem.
    expect(lastTierFilter("updated_at")).toBe(token);
    expect(Object.keys(lastTierPatch())).not.toEqual(
      expect.arrayContaining(["id", "tenant_id", "updated_at", "key", "rank", "features"]),
    );
  });

  it("zapis z drugiej karty po naszym odczycie = konflikt z akcją „Wczytaj aktualne”, szkic zostaje", async () => {
    const tier = membershipTier({ id: "t1", badge_pl: "A", price_note_pl: null });
    const db = tiersDb([tier]);
    renderTab([tier]);
    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "Moje" } });
    // Druga karta zmienia INNE pole tej samej warstwy.
    db.touch("t1", { price_note_pl: "cudza nota" });

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "adminPaywall.sync.staleWrite",
        expect.objectContaining({
          action: expect.objectContaining({ onClick: expect.any(Function) }),
        }),
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Moje")).toBeInTheDocument();

    const [, options] = toastError.mock.calls[0] as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("adminPaywall.sync.reloaded"));
    // Szkic nałożony na świeży wiersz: nasza zmiana i cudza naraz.
    expect(screen.getByDisplayValue("Moje")).toBeInTheDocument();
    expect(screen.getByDisplayValue("cudza nota")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.tierSaved"));
    // Ponowny zapis z NOWYM tokenem i bez cudzej kolumny w patchu.
    expect(lastTierFilter("updated_at")).toBe(`${tier.updated_at}#other`);
    expect(lastTierPatch()).toEqual({ badge_pl: "Moje" });
  });

  it("błąd zapisu idzie wspólnym kanałem błędów, sukces nie jest ogłaszany", async () => {
    chain.setResponse("membership_tiers", {
      data: null,
      error: Object.assign(new Error("check constraint"), { name: "PostgrestError" }),
    });
    renderTab([membershipTier({ badge_pl: null })]);

    fireEvent.change(screen.getAllByRole("textbox")[4], { target: { value: "Nowy" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    // ZMIANA ZAMIERZONA: surowy komunikat bazy nie trafia już do redakcji -
    // `toastError` tłumaczy błąd na zdanie po polsku/angielsku.
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalledWith("check constraint");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("udany zapis potwierdza komunikatem", async () => {
    tiersDb([membershipTier({ badge_pl: null })]);
    renderTab([membershipTier({ badge_pl: null })]);

    fireEvent.change(screen.getAllByRole("textbox")[4], { target: { value: "Nowy" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.tierSaved"));
  });

  it("edycja JEDNEJ warstwy nie zmienia szkicu drugiej", async () => {
    const tiers = [
      membershipTier({ id: "t1", name_pl: "Pierwsza", badge_pl: "A" }),
      membershipTier({ id: "t2", name_pl: "Druga", badge_pl: "B" }),
    ];
    tiersDb(tiers);
    renderTab(tiers);

    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "Zmienione" } });
    const firstCard = screen.getByText("Pierwsza").closest("div.overflow-hidden")!;
    const secondCard = screen.getByText("Druga").closest("div.overflow-hidden")!;
    // Szkic drugiej karty jest nietknięty - nie ma czego zapisać.
    expect(
      within(secondCard as HTMLElement).getByRole("button", { name: /tiers\.save/ }),
    ).toBeDisabled();
    fireEvent.click(within(firstCard as HTMLElement).getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(tierWrites()).toHaveLength(1));
    expect(lastTierFilter("id")).toBe("t1");
    expect(lastTierPatch()).toEqual({ badge_pl: "Zmienione" });
  });
});

describe("TiersTab - skok do panelu członkostwa", () => {
  it("rangi i bramki są w innym panelu - zakładka o tym mówi i tam prowadzi", () => {
    renderTab();

    const link = screen.getByRole("link", { name: /tiers\.openMembership/ });
    expect(link).toHaveAttribute("href", "/admin/membership");
    expect(screen.getByText("adminPricing.tiers.coreHint")).toBeInTheDocument();
  });
});
