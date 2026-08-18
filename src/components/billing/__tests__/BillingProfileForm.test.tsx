// Dane do faktury - 290 linii na ZERZE pokrycia do 18.08.2026, mimo że to
// formularz, z którego dane trafiają wprost na dokument księgowy.
//
// Reguła NIP/VAT (`validateTaxId`) ma własny test jednostkowy (`nip.test.ts`)
// i tego nie duplikujemy. Tu sprawdzamy jej UŻYCIE, bo w formularzu decyduje
// o trzech rzeczach, których sama reguła nie pilnuje:
//
//   1. WALIDACJA OBOWIĄZUJE TYLKO FIRMĘ. Osoba prywatna nie ma NIP-u, więc
//      wymuszanie go blokowałoby zakup konsumencki.
//   2. BŁĘDNY NIP BLOKUJE ZAPIS. Faktura z literówką w NIP jest bezwartościowa
//      dla księgowości kupującego - audyt wytknął to pole jako wolny tekst.
//   3. ZAPISUJE SIĘ POSTAĆ ZNORMALIZOWANA (bez separatorów i prefiksu kraju),
//      żeby eksporty księgowe dostawały jeden format.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { BillingProfile } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  profile: { current: null as BillingProfile | null },
  saved: [] as Array<Record<string, unknown>>,
  saveThrows: { current: false },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub();
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSwitchStub(react);
});

vi.mock("@/lib/billing/queries", () => ({
  fetchMyBillingProfile: () => Promise.resolve(h.profile.current),
  upsertMyBillingProfile: (input: Record<string, unknown>) => {
    h.saved.push(input);
    return h.saveThrows.current ? Promise.reject(new Error("baza padła")) : Promise.resolve();
  },
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { BillingProfileForm } from "@/components/billing/BillingProfileForm";

/** NIP-y SYNTETYCZNE. `1234563218` ma poprawną sumę kontrolną PL. */
const NIP_OK = "1234563218";
const NIP_BAD_CHECKSUM = "1234563219";

const companySwitch = () => screen.getByRole("switch");
const countryField = () => screen.getByLabelText("profile.billing.country") as HTMLInputElement;

/**
 * Pole NIP istnieje TYLKO w trybie firmy - osoba prywatna go nie widzi, bo go
 * nie ma. Ten helper zakłada włączony przełącznik.
 */
const taxField = () => screen.getByLabelText("profile.billing.taxId") as HTMLInputElement;

/**
 * Przycisk zapisu po `type="submit"`, nie po nazwie: etykiety podpowiedzi
 * (`aria-label` przy ikonach „i") też zaczynają się od `profile.billing`,
 * więc szukanie po nazwie trafiałoby w nie.
 */
const submitButton = (): HTMLButtonElement =>
  document.querySelector("form button[type=submit]") as HTMLButtonElement;

const alertText = () => screen.getByRole("alert").textContent;

/** Włącza tryb firmy - dopiero wtedy pojawia się pole NIP. */
function enableCompany(): void {
  fireEvent.click(companySwitch());
}

/**
 * Wysyła formularz zdarzeniem `submit`, a nie kliknięciem w przycisk: happy-dom
 * nie zamienia kliknięcia w przycisk `type="submit"` na submit formularza, więc
 * `onSubmit` nigdy by się nie odpalił i każdy test zapisu byłby fałszywie
 * czerwony.
 */
function submitForm(): void {
  fireEvent.submit(document.querySelector("form")!);
}

function fillTaxId(value: string): void {
  fireEvent.change(taxField(), { target: { value } });
}

beforeEach(() => {
  h.profile.current = null;
  h.saved.length = 0;
  h.saveThrows.current = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("BillingProfileForm - wczytanie danych", () => {
  it("bez zapisanego profilu startuje z krajem PL i BEZ pola NIP", async () => {
    renderWithQueryClient(<BillingProfileForm />);

    await waitFor(() => expect(countryField()).toBeTruthy());
    expect(countryField().value).toBe("PL");
    // Osoba prywatna NIE MA NIP-u, więc pola też nie ma - wymuszanie go
    // blokowałoby zakup konsumencki.
    expect(screen.queryByLabelText("profile.billing.taxId")).toBeNull();
  });

  it("zapisany profil firmowy wypełnia pola i włącza tryb firmy", async () => {
    h.profile.current = {
      id: "bp-1",
      user_id: "user-me",
      tenant_id: "tenant-alfa",
      full_name: "Jan Syntetyczny",
      company: "Firma Testowa",
      tax_id: NIP_OK,
      email: "syntetyczny@example.test",
      phone: null,
      address_line1: "Testowa 1",
      address_line2: null,
      city: "Warszawa",
      postal_code: "00-001",
      region: null,
      country_code: "PL",
      is_company: true,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    renderWithQueryClient(<BillingProfileForm />);

    await waitFor(() => expect(taxField().value).toBe(NIP_OK));
    expect(companySwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("pola pustego profilu nie pokazują „null” zamiast pustki", async () => {
    h.profile.current = {
      id: "bp-1",
      user_id: "user-me",
      tenant_id: "tenant-alfa",
      full_name: null,
      company: null,
      tax_id: null,
      email: null,
      phone: null,
      address_line1: null,
      address_line2: null,
      city: null,
      postal_code: null,
      region: null,
      country_code: "PL",
      is_company: false,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    renderWithQueryClient(<BillingProfileForm />);

    await waitFor(() => expect(countryField()).toBeTruthy());
    expect(screen.queryByDisplayValue("null")).toBeNull();
    expect(countryField().value).toBe("PL");
  });
});

describe("BillingProfileForm - NIP obowiązuje TYLKO firmę", () => {
  it("osoba prywatna nie widzi błędu ani pola NIP", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    expect(screen.queryByRole("alert")).toBeNull();
    expect(companySwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("osoba prywatna zapisuje się BEZ NIP-u", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.toastSuccess).toHaveBeenCalledWith("profile.billing.saved");
  });

  // LUKA UDOKUMENTOWANA, NIE NAPRAWIONA W TYM COMMICIE.
  //
  // `validateTaxId` wprost dopuszcza pustą wartość i w komentarzu deleguje
  // decyzję dalej: „Pusta wartość jest dozwolona (pole opcjonalne) - decyzję
  // »wymagane dla firm« podejmuje UI". UI tej decyzji nigdy nie podjął, więc
  // firma zapisuje dane rozliczeniowe BEZ NIP-u, a faktura dla firmy bez NIP-u
  // nie jest w Polsce poprawną fakturą VAT.
  //
  // Test PRZYPINA obecne zachowanie, zamiast je zmieniać: wymuszenie NIP-u
  // zablokowałoby zapis danych i - przez wspólny formularz w kasie - sam zakup.
  // To decyzja właściciela produktu o skutku przychodowym, nie sprzątanie przy
  // testach. Zgłoszone w dokumencie wdrożenia.
  it("firma z PUSTYM NIP-em zapisuje się (obecne zachowanie - luka zgłoszona)", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    // Brak jakiegokolwiek komunikatu o brakującym identyfikatorze podatkowym.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("po wpisaniu ŚMIECI w tryb firmy pojawia się błąd formatu", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
    fillTaxId("abc");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(alertText()).toBe("profile.billing.taxIdFormat");
  });
});

describe("BillingProfileForm - błędny NIP BLOKUJE zapis", () => {
  beforeEach(async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());
    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
  });

  it("NIP o poprawnym formacie, ale ZŁEJ SUMIE KONTROLNEJ jest odrzucany", async () => {
    fillTaxId(NIP_BAD_CHECKSUM);

    await waitFor(() => expect(alertText()).toBe("profile.billing.taxIdChecksum"));
    // Przycisk zapisu jest WYŁĄCZONY - błędny NIP nie ma jak wyjść na fakturę.
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    expect(h.saved).toHaveLength(0);
  });

  it("NIP o złym formacie ma inny komunikat niż zła suma kontrolna", async () => {
    fillTaxId("abc");

    await waitFor(() => expect(alertText()).toBe("profile.billing.taxIdFormat"));
    expect(alertText()).not.toBe("profile.billing.taxIdChecksum");
  });

  it("POPRAWNY NIP kasuje błąd i przepuszcza zapis", async () => {
    fillTaxId(NIP_OK);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    submitForm();
    await waitFor(() => expect(h.saved).toHaveLength(1));
  });

  it("ZAPISUJE POSTAĆ ZNORMALIZOWANĄ - bez separatorów", async () => {
    fillTaxId("123-456-32-18");

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0].tax_id).toBe(NIP_OK);
  });

  it("prefiks kraju w NIP-ie też jest normalizowany", async () => {
    fillTaxId(`PL${NIP_OK}`);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0].tax_id).toBe(NIP_OK);
  });

  it("tryb firmy jedzie razem z danymi", async () => {
    fillTaxId(NIP_OK);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0].is_company).toBe(true);
  });
});

describe("BillingProfileForm - kraj inny niż Polska", () => {
  beforeEach(async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());
    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
  });

  it("dla kraju spoza PL komunikat mówi o formacie VAT, nie o NIP", async () => {
    fireEvent.change(countryField(), { target: { value: "DE" } });
    fillTaxId("x");

    await waitFor(() => expect(alertText()).toBe("profile.billing.taxIdVatFormat"));
    expect(alertText()).not.toBe("profile.billing.taxIdFormat");
  });

  it("poprawny numer VAT spoza PL przechodzi", async () => {
    fireEvent.change(countryField(), { target: { value: "DE" } });
    fillTaxId("DE123456789");

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    submitForm();
    await waitFor(() => expect(h.saved).toHaveLength(1));
  });
});

describe("BillingProfileForm - skutki zapisu", () => {
  it("po zapisie ODŚWIEŻA dane rozliczeniowe i woła wywołanie zwrotne", async () => {
    const onSaved = vi.fn();
    const { queryClient } = renderWithQueryClient(<BillingProfileForm onSaved={onSaved} />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(countryField()).toBeTruthy());

    submitForm();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["my-billing"] });
  });

  it("NIEUDANY ZAPIS nie pokazuje surowego błędu z bazy", async () => {
    h.saveThrows.current = true;
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.billing.saveError"));
    expect(h.toastError).not.toHaveBeenCalledWith(expect.stringContaining("baza padła"));
  });

  it("nieudany zapis NIE woła wywołania zwrotnego (checkout nie idzie dalej)", async () => {
    h.saveThrows.current = true;
    const onSaved = vi.fn();
    renderWithQueryClient(<BillingProfileForm onSaved={onSaved} />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("własna etykieta przycisku wypiera domyślną (checkout: „zapisz i kontynuuj”)", async () => {
    renderWithQueryClient(<BillingProfileForm submitLabel="Zapisz i kontynuuj" />);

    await waitFor(() => expect(screen.getByText("Zapisz i kontynuuj")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Zapisz i kontynuuj" })).toBeTruthy();
  });
});

describe("BillingProfileForm - wszystkie pola faktury trafiają do zapisu", () => {
  // Każde pole ma własny `onChange`. Test przechodzi po WSZYSTKICH, bo dane
  // z tego formularza idą wprost na dokument księgowy: pominięte pole to
  // faktura bez adresu albo bez nazwy nabywcy, czyli dokument do korekty.
  // `company` i `fullName` WYKLUCZAJĄ SIĘ: tryb firmy pokazuje nazwę firmy,
  // tryb prywatny - imię i nazwisko. Pola wspólne są tu, nazwa nabywcy osobno.
  const SHARED_FIELDS: Array<[string, string]> = [
    ["profile.billing.email", "syntetyczny@example.test"],
    ["profile.billing.phone", "+48000000000"],
    ["profile.billing.addressLine1", "Testowa 1"],
    ["profile.billing.addressLine2", "lok. 2"],
    ["profile.billing.postalCode", "00-001"],
    ["profile.billing.city", "Warszawa"],
    ["profile.billing.region", "mazowieckie"],
  ];

  function fillShared(): void {
    for (const [label, value] of SHARED_FIELDS) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
  }

  it("tryb PRYWATNY: imię i nazwisko oraz adres idą do zapisu w całości", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    fireEvent.change(screen.getByLabelText("profile.billing.fullName"), {
      target: { value: "Jan Syntetyczny" },
    });
    fillShared();
    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0]).toMatchObject({
      full_name: "Jan Syntetyczny",
      email: "syntetyczny@example.test",
      phone: "+48000000000",
      address_line1: "Testowa 1",
      address_line2: "lok. 2",
      postal_code: "00-001",
      city: "Warszawa",
      region: "mazowieckie",
    });
  });

  it("tryb FIRMY: nazwa firmy zastępuje imię i nazwisko na dokumencie", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());
    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());

    fireEvent.change(screen.getByLabelText("profile.billing.company"), {
      target: { value: "Firma Syntetyczna" },
    });
    fillShared();
    fillTaxId(NIP_OK);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    submitForm();

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0]).toMatchObject({
      company: "Firma Syntetyczna",
      tax_id: NIP_OK,
      city: "Warszawa",
      is_company: true,
    });
    // Pole imienia i nazwiska nie istnieje w trybie firmy.
    expect(screen.queryByLabelText("profile.billing.fullName")).toBeNull();
  });

  it("KOD KRAJU jest normalizowany do wielkich liter", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    fireEvent.change(countryField(), { target: { value: "de" } });

    expect(countryField().value).toBe("DE");
    submitForm();
    await waitFor(() => expect(h.saved[0].country_code).toBe("DE"));
  });

  it("wyłączenie trybu firmy usuwa pole NIP z formularza", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());

    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
    fireEvent.click(companySwitch());

    await waitFor(() => expect(screen.queryByLabelText("profile.billing.taxId")).toBeNull());
    expect(companySwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("BŁĘDNY NIP po wyłączeniu trybu firmy przestaje blokować zapis", async () => {
    renderWithQueryClient(<BillingProfileForm />);
    await waitFor(() => expect(countryField()).toBeTruthy());
    enableCompany();
    await waitFor(() => expect(taxField()).toBeTruthy());
    fillTaxId(NIP_BAD_CHECKSUM);
    await waitFor(() => expect(submitButton().hasAttribute("disabled")).toBe(true));

    fireEvent.click(companySwitch());

    await waitFor(() => expect(submitButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
