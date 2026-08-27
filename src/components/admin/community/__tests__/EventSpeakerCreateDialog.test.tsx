// Popup „Nowy prelegent" - kontrakt renderu i kontrakt PAYLOADU.
//
// CO TEN PLIK DOWODZI. To jedyne miejsce w panelu, w ktorym powstaje prelegent
// BEZ KONTA na platformie, wiec przedmiotem dowodu jest ksztalt tego, co
// wychodzi do bazy, a nie wyglad formularza:
//
//   1. WYMAGANE POLA. Przycisk jest wylaczony do wpisania imienia i nazwiska -
//      i WLACZONY bez adresu poczty. Adres jest u nas kluczem DOPASOWANIA
//      w kartotece, a nie loginem zakladanego konta (wzorzec ma go jako
//      wymagany, bo tam popup zaklada konto - my kont nie zakladamy).
//   2. PUSTE POLE NIE WCHODZI DO PAYLOADU. RPC czyta `p_payload->>'phone'`,
//      wiec brak klucza znaczy „zostaw kolumne", a pusty napis wysylany
//      w kazdym zapisie wymazywalby telefon wpisany przez samego uczestnika.
//   3. „BEZ GRUPY" NIE JEST GRUPA. Wartosc-wartownik `__none__` nie moze
//      trafic do `group_id` - baza odrzucilaby ja jako niepoprawny uuid,
//      a redaktor zobaczylby blad typu przy poprawnie wypelnionym formularzu.
//   4. KOMUNIKAT BAZY WCHODZI NA EKRAN. Ograniczenia sa nazwane (https na
//      zdjeciu, format adresu, unikalnosc w kartotece); zamiana ich na jedno
//      „nie udalo sie" kosztuje redaktora zgadywanie, ktore pole poprawic.
//   5. ZERO SUROWYCH KLUCZY i18n na ekranie.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const createEventSpeakerPerson = vi.fn();
const fetchEventGroups = vi.fn();

vi.mock("@/lib/admin/community", () => ({
  createEventSpeakerPerson: (...args: unknown[]) => createEventSpeakerPerson(...args),
}));

vi.mock("@/lib/events/termsGroupsApi", () => ({
  fetchEventGroups: (...args: unknown[]) => fetchEventGroups(...args),
  fetchEventTerms: () => Promise.resolve([]),
  saveEventGroup: () => Promise.resolve(""),
  deleteEventGroup: () => Promise.resolve(true),
  setEventGroupMember: () => Promise.resolve(true),
  saveEventTerm: () => Promise.resolve(""),
  deleteEventTerm: () => Promise.resolve(true),
}));

import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakerCreateDialog } =
  await import("@/components/admin/community/EventSpeakerCreateDialog");

ensureCommunityEventsI18n();

const onCreated = vi.fn();
const onOpenChange = vi.fn();

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventSpeakerCreateDialog
        eventId="ev-1"
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
}

/** Etykiety sa i18n-owane, wiec pola bierzemy po widocznym tekscie etykiety. */
function fill(label: string, value: string): void {
  const field = screen.getByText(label).closest("div");
  if (field === null) throw new Error(`test: brak pola "${label}"`);
  const input = field.querySelector("input, textarea");
  if (input === null) throw new Error(`test: pole "${label}" bez kontrolki`);
  fireEvent.change(input, { target: { value } });
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /Utwórz prelegenta/ });
}

describe("EventSpeakerCreateDialog", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset();
    fetchEventGroups.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    fetchEventGroups.mockResolvedValue([
      { id: "grp-1", name_pl: "Prelegenci", name_en: "Speakers" },
    ]);
  });

  it("zapis jest wylaczony bez imienia i nazwiska, a WLACZONY bez adresu poczty", () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();

    fill("Imię", "Lech");
    expect(submitButton()).toBeDisabled();

    fill("Nazwisko", "Kurkliński");
    // Adres poczty pusty - i to ma wystarczyc: mowca zaproszony telefonicznie
    // przez sekretariat nie ma czym wypelnic tego pola.
    expect(submitButton()).toBeEnabled();
  });

  it("sam bialy znak nie jest nazwiskiem", () => {
    renderDialog();
    fill("Imię", "  ");
    fill("Nazwisko", "  ");
    expect(submitButton()).toBeDisabled();
  });

  it("wysyla tylko WYPELNIONE pola i nie wysyla wartownika grupy", async () => {
    createEventSpeakerPerson.mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    renderDialog();

    fill("Imię", "  Lech  ");
    fill("Nazwisko", "Kurkliński");
    fill("Stanowisko", "Profesor");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.eventId).toBe("ev-1");
    // `trim` po stronie klienta: baza tez to robi, ale nazwa w toascie
    // („Dodano prelegenta: …") jedzie z tego samego zrodla.
    expect(payload.firstName).toBe("Lech");
    expect(payload.lastName).toBe("Kurkliński");
    expect(payload.jobTitle).toBe("Profesor");
    // Pola nietkniete NIE MAJA byc pustym napisem - inaczej PATCH w RPC
    // wymazywalby kolumny wpisane inna droga.
    expect(payload.email).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    expect(payload.photoUrl).toBeUndefined();
    expect(payload.bioPl).toBeUndefined();
    // Wartownik „bez grupy" nie jest identyfikatorem grupy.
    expect(payload.groupId).toBeUndefined();
    // Domyslnie opis sceniczny jest widoczny.
    expect(payload.isPublic).toBe(true);
  });

  it("tematy i jezyki ida jako TABLICE, jezyki malymi literami", async () => {
    createEventSpeakerPerson.mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    renderDialog();

    fill("Imię", "Lech");
    fill("Nazwisko", "Kurkliński");
    fill("Tematy PL", " bankowość , regulacje ,, ");
    fill("Języki", "PL, En");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    // Puste elementy po przecinku odsiane - inaczej na profilu wisialby
    // pusty chip, ktorego redaktor nie umie usunac.
    expect(payload.topicsPl).toEqual(["bankowość", "regulacje"]);
    // Kody jezykow czyta widget publiczny - musza byc malymi literami.
    expect(payload.languages).toEqual(["pl", "en"]);
    // Pole nietkniete to `undefined`, czyli „nie dotykaj", a NIE `[]`,
    // ktore w RPC znaczy „wyczysc".
    expect(payload.topicsEn).toBeUndefined();
  });

  it("po zapisie oddaje wynik i nazwe rodzicowi oraz zamyka popup", async () => {
    const result = {
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    };
    createEventSpeakerPerson.mockResolvedValue(result);
    renderDialog();

    fill("Imię", "Lech");
    fill("Nazwisko", "Kurkliński");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(result, "Lech Kurkliński"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("nazwany blad bazy trafia na ekran, a popup zostaje otwarty", async () => {
    createEventSpeakerPerson.mockRejectedValue(
      new Error('new row for relation "event_people" violates check constraint'),
    );
    renderDialog();

    fill("Imię", "Ktos");
    fill("Nazwisko", "Bez-Https");
    fill("Zdjęcie (adres)", "http://cdn.example.com/x.jpg");
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent ?? "").toContain("check constraint");
    // Zamkniecie popupu po bledzie skasowalo by kilkanascie wpisanych pol.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("pokazuje note o zgodach i NIE pyta o zgode marketingowa", () => {
    renderDialog();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Zgód marketingowych");
    // Zgoda marketingowa i partnerska zostaja w sciezce rejestracji - popup
    // organizatora nie moze ich udzielic za kogos.
    expect(screen.queryByText(/zgoda marketingowa/i)).toBeNull();
    expect(screen.queryByText(/partner/i)).toBeNull();
  });

  it("nie wypuszcza surowych kluczy i18n", () => {
    renderDialog();
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
  });
});
