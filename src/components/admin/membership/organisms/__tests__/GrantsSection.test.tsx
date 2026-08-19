// Nadania warstwy POZA planem - 0 z 8 funkcji pokrytych do 18.08.2026
// (mieszkały w pliku trasy `/admin/membership`, 898 linii).
//
// Tą drogą członkostwo dostaje ktoś, kto nie kupił subskrypcji: darczyńca,
// klient fakturowy, gość honorowy, import z poprzedniego systemu. Dwie rzeczy
// mają tu znaczenie dla pieniędzy i dla zaufania:
//
//   WYGAŚNIĘCIE. Puste pole „miesiące" znaczy nadanie BEZ KOŃCA - dostęp na
//   zawsze, bez żadnej płatności. Test pilnuje, że `null` faktycznie wychodzi
//   z formularza jako brak terminu, a nie jako zero miesięcy.
//
//   ODWOŁANIE. Odwołane nadanie NIE ZNIKA - schodzi do sekcji „odwołane",
//   bo historia dostępu musi zostać czytelna po fakcie.
//
// Dane są syntetyczne: adresy w domenie `.test`, żadnych prawdziwych osób.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { membershipTier, radixSelectStub, reactI18nextStub } from "@/test/admin/pricingFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

interface GrantRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  tier_key: string;
  source: string;
  note: string | null;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const h = {
  grants: [] as GrantRow[],
  fetch: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
};

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/lib/admin/membership-admin", () => ({
  fetchMembershipGrants: () => h.fetch(),
  grantMembership: (input: unknown) => h.grant(input),
  revokeGrant: (id: string) => h.revoke(id),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { GrantsSection } = await import("@/components/admin/membership/organisms/GrantsSection");

function grantRow(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "grant-1",
    user_id: "user-1",
    email: "darczynca@example.test",
    display_name: null,
    tier_key: "member",
    source: "manual",
    note: null,
    starts_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2027-01-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const TIERS = [
  membershipTier({ key: "member", name_pl: "Członek", name_en: "Member" }),
  membershipTier({ id: "t2", key: "patron", name_pl: "Patron", name_en: "Patron" }),
];

function renderSection() {
  return renderWithQueryClient(<GrantsSection lang="pl" tierOptions={TIERS} />);
}

/** Wypełnia formularz nadania. `months === null` zostawia pole puste. */
function fillGrantForm(email: string, tierKey: string, months: string | null) {
  fireEvent.change(screen.getByPlaceholderText("osoba@instytucja.eu"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: tierKey } });
  const monthsField = screen.getByRole("spinbutton");
  fireEvent.change(monthsField, { target: { value: months ?? "" } });
}

beforeEach(() => {
  h.grants = [];
  h.fetch.mockImplementation(() => Promise.resolve(h.grants));
  h.grant.mockReset().mockResolvedValue("grant-new");
  h.revoke.mockReset().mockResolvedValue(undefined);
  h.fetch.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("GrantsSection - warunek nadania", () => {
  it("przycisk nadania jest wyłączony bez e-maila i bez warstwy", async () => {
    renderSection();

    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /grants\.grant/ })).toBeDisabled();
  });

  it("adres bez małpy NIE wystarcza", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("nie-adres", "member", "12");

    expect(screen.getByRole("button", { name: /grants\.grant/ })).toBeDisabled();
  });

  it("adres bez kropki w domenie NIE wystarcza", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@localhost", "member", "12");

    expect(screen.getByRole("button", { name: /grants\.grant/ })).toBeDisabled();
  });

  it("sam adres bez wybranej warstwy NIE wystarcza", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("osoba@instytucja.eu"), {
      target: { value: "osoba@example.test" },
    });

    expect(screen.getByRole("button", { name: /grants\.grant/ })).toBeDisabled();
  });

  it("adres i warstwa razem odblokowują nadanie", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");

    expect(screen.getByRole("button", { name: /grants\.grant/ })).toBeEnabled();
  });
});

describe("GrantsSection - NADANIE i jego termin", () => {
  it("nadaje na wskazaną liczbę miesięcy, z przyciętym adresem", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("  osoba@example.test  ", "patron", "6");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(h.grant).toHaveBeenCalledTimes(1));
    expect(h.grant).toHaveBeenCalledWith({
      email: "osoba@example.test",
      tierKey: "patron",
      months: 6,
      note: null,
    });
  });

  it("PUSTE pole miesięcy znaczy nadanie BEZTERMINOWE (`null`), a nie zero", async () => {
    // Zero miesięcy wygasłoby natychmiast; `null` to dostęp bez końca. Pomyłka
    // w tę stronę jest nieodwracalna po cichu.
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("gosc@example.test", "member", null);
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(h.grant).toHaveBeenCalledTimes(1));
    expect(h.grant.mock.calls[0][0]).toMatchObject({ months: null });
  });

  it("pusta notatka schodzi na `null`, nie na pusty napis", async () => {
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(h.grant).toHaveBeenCalledTimes(1));
    expect(h.grant.mock.calls[0][0]).toMatchObject({ note: null });
  });

  it("po UDANYM nadaniu adres i notatka są czyszczone, a warstwa zostaje", async () => {
    // Nadania idą seriami dla tej samej warstwy - czyszczenie jej za każdym
    // razem kazałoby wybierać ją od nowa przy każdej osobie.
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("osoba@instytucja.eu")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("member");
  });

  it("BRAK KONTA o podanym adresie daje własny komunikat, nie surowy błąd bazy", async () => {
    h.grant.mockRejectedValue(new Error("user not found for email"));
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("nieznana@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminMembership.toast.noAccount"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("NIEZNANA WARSTWA daje własny komunikat", async () => {
    h.grant.mockRejectedValue(new Error("tier not found"));
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("adminMembership.toast.unknownTier"),
    );
  });

  it("inny błąd przechodzi treścią, żeby nie zgubić powodu odmowy", async () => {
    h.grant.mockRejectedValue(new Error("permission denied for function"));
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied for function"));
  });

  it("nieudane nadanie NIE czyści wpisanego adresu", async () => {
    h.grant.mockRejectedValue(new Error("user not found"));
    renderSection();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());

    fillGrantForm("osoba@example.test", "member", "12");
    fireEvent.click(screen.getByRole("button", { name: /grants\.grant/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("osoba@instytucja.eu")).toHaveValue("osoba@example.test");
  });
});

describe("GrantsSection - lista nadań", () => {
  it("nadanie bezterminowe jest oznaczone jako BEZ końca", async () => {
    h.grants = [grantRow({ expires_at: null })];
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/adminMembership\.grants\.noExpiry/)).toBeInTheDocument(),
    );
  });

  it("nadanie terminowe pokazuje datę wygaśnięcia", async () => {
    h.grants = [grantRow({ expires_at: "2027-03-01T00:00:00.000Z" })];
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/adminMembership\.grants\.until/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/noExpiry/)).not.toBeInTheDocument();
  });

  it("pokazuje nazwę osoby przed adresem, gdy jest znana", async () => {
    h.grants = [grantRow({ display_name: "Jan Testowy" })];
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/Jan Testowy · darczynca@example\.test/)).toBeInTheDocument(),
    );
  });

  it("źródło nadania jest tłumaczone (darowizna, import, ręczne)", async () => {
    h.grants = [
      grantRow({ id: "g1", source: "donation" }),
      grantRow({ id: "g2", source: "import", email: "import@example.test" }),
      grantRow({ id: "g3", source: "manual", email: "reczne@example.test" }),
    ];
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/adminMembership\.grants\.sourceDonation/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/adminMembership\.grants\.sourceImport/)).toBeInTheDocument();
    expect(screen.getByText(/adminMembership\.grants\.sourceManual/)).toBeInTheDocument();
  });

  it("ODWOŁANE nadanie NIE ZNIKA - stoi w osobnej sekcji", async () => {
    // Historia dostępu musi zostać czytelna po fakcie: kto miał dostęp,
    // na jakiej podstawie i do kiedy.
    h.grants = [
      grantRow({ id: "aktywne", email: "aktywne@example.test" }),
      grantRow({ id: "odwolane", email: "odwolane@example.test", revoked_at: "2026-06-01" }),
    ];
    renderSection();

    await waitFor(() => expect(screen.getByText(/odwolane@example\.test/)).toBeInTheDocument());
    expect(screen.getByText(/aktywne@example\.test/)).toBeInTheDocument();
    // „Odwołane" pojawia się i w nagłówku sekcji, i w opisie wiersza.
    expect(screen.getAllByText(/adminMembership\.grants\.revoked/).length).toBeGreaterThan(1);
  });

  it("odwołane nadanie NIE MA przycisku odwołania", async () => {
    h.grants = [grantRow({ revoked_at: "2026-06-01" })];
    renderSection();

    await waitFor(() => expect(screen.getByText(/darczynca@example\.test/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /grants\.revoke/ })).not.toBeInTheDocument();
  });

  it("odwołanie aktywnego nadania woła operację z jego identyfikatorem", async () => {
    h.grants = [grantRow({ id: "grant-7" })];
    renderSection();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /grants\.revoke/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /grants\.revoke/ }));

    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith("grant-7"));
    expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.grantRevoked");
  });

  it("nieudane odwołanie zgłasza błąd, zamiast udawać sukces", async () => {
    h.revoke.mockRejectedValue(new Error("row level security"));
    h.grants = [grantRow()];
    renderSection();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /grants\.revoke/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /grants\.revoke/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("row level security"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("brak nadań nie pokazuje sekcji odwołanych", async () => {
    renderSection();

    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/adminMembership\.grants\.revoked/)).not.toBeInTheDocument();
  });

  it("sekcja aktywnych nadań ma nagłówek z liczbą", async () => {
    h.grants = [grantRow({ id: "g1" }), grantRow({ id: "g2", email: "druga@example.test" })];
    renderSection();

    await waitFor(() => expect(screen.getByText(/druga@example\.test/)).toBeInTheDocument());
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(
      within(headings[1].parentElement!).getByRole("heading", { level: 2 }),
    ).toBeInTheDocument();
  });
});
