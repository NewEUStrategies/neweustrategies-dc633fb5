// Blok zapisow strony wydarzenia: TRZY przypadki, ktore najlatwiej zepsuc.
//
// Test idzie CALA sciezka produkcyjna - regula czysta
// (`resolveRegistrationSurface`) -> mapowanie ksztaltu
// (`eventRegistrationActionFrom`) -> molekula. Zaden krok nie jest w tescie
// przepisany, bo przepisany krok sprawdza kopie, a nie kod, ktory pojdzie na
// produkcje.
//
// WEJSCIE UDAJE WIERSZ `event_page_header()`, a nie wymyslony ksztalt: kolumny
// nazywaja sie tak jak w RPC, zeby zmiana kontraktu bazy zlamala ten test,
// a nie ekran uzytkownika.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  resolveRegistrationSurface,
  waitlistPositionOf,
  type RegistrationSurfaceInput,
} from "@/lib/events/registrationSurface";
import {
  EventRegistrationSurface,
  eventRegistrationActionFrom,
} from "@/components/events/molecules/EventRegistrationSurface";

// Molekula rysuje `<Link to="/pricing">` tylko w wariancie czlonkostwa; zaden
// z trzech przypadkow ponizej go nie dotyka, ale atrapa musi istniec, bo
// komponent i tak importuje router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/pricing">{children}</a>,
}));

const HEADER_ROW = {
  registration_mode: "rsvp",
  registration_flow: "instant",
  registration_state: "open",
  external_registration_url: null as string | null,
  seats_left: 25 as number | null,
  my_registration_status: null as string | null,
  my_rsvp_status: null as string | null,
  my_waitlist_position: null as number | null,
  tier_locked: false,
  chatham_house_locked: false,
  has_ended: false,
};

const REGISTER_LABEL = "Zapisz się";
const WAITLIST_LABEL = "Dopisz się na listę rezerwową";
const EXTERNAL_LABEL = "Przejdź do rejestracji";
const FORM_MESSAGE = "Zapis prowadzi organizator formularzem, którego tu nie ma.";

/** Napisy podstawiamy per klucz - trasa robi to samo wywolaniem `t()`. */
const LABELS: Record<string, string> = {
  "eventFront.registrationAction.register": REGISTER_LABEL,
  "eventFront.registrationAction.joinWaitlist": WAITLIST_LABEL,
  "eventFront.registrationAction.registerExternal": EXTERNAL_LABEL,
  "eventFront.registrationSurface.formRequired": FORM_MESSAGE,
  "eventFront.registrationStateHint.sold_out": "Wszystkie miejsca są zajęte.",
  "eventFront.registrationStateHint.open": "Zapisz się i zabierz swoje miejsce.",
  "eventFront.registrationStateHint.registration_external":
    "Zapis prowadzi organizator we własnym narzędziu.",
};

function label(key: string): string {
  return LABELS[key] ?? key;
}

function renderBlock(row: Partial<typeof HEADER_ROW>) {
  const header = { ...HEADER_ROW, ...row };
  const input: RegistrationSurfaceInput = {
    registrationMode: header.registration_mode,
    registrationFlow: header.registration_flow,
    registrationState: header.registration_state,
    externalRegistrationUrl: header.external_registration_url,
    seatsLeft: header.seats_left,
    myRegistrationStatus: header.my_registration_status,
    myRsvpStatus: header.my_rsvp_status,
    myWaitlistPosition: header.my_waitlist_position,
    tierLocked: header.tier_locked,
    chathamHouseLocked: header.chatham_house_locked,
    hasEnded: header.has_ended,
    isSignedIn: true,
  };
  const surface = resolveRegistrationSurface(input);
  const position = waitlistPositionOf(surface);
  const utils = render(
    <EventRegistrationSurface
      message={label(surface.messageKey)}
      note={position === null ? null : `Twoje miejsce w kolejce: ${position}`}
      action={eventRegistrationActionFrom(
        surface.control,
        surface.control === null ? "" : label(surface.control.labelKey),
        false,
      )}
      onAction={() => {}}
      groupLabel="Zapisy"
    />,
  );
  return { ...utils, surface };
}

describe("blok zapisow: tryb form", () => {
  it("NIE POKAZUJE przycisku zapisu i mowi, dlaczego", () => {
    // To jest ten defekt: trzy z szesciu zasianych rodzajow wydarzen (okragly
    // stol, stacjonarne, hybrydowe) maja `default_registration_mode = 'form'`,
    // a `rsvp_event()` odmawia im statusu `going`. Przycisk zapisu byl tu
    // kontrolka prowadzaca w sciane.
    const { surface } = renderBlock({ registration_mode: "form" });
    expect(surface.kind).toBe("registrationForm");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(FORM_MESSAGE)).toBeTruthy();
  });
});

describe("blok zapisow: tryb external", () => {
  it("prowadzi do adresu organizatora, nie do naszego RPC", () => {
    renderBlock({
      registration_mode: "external",
      registration_state: "registration_external",
      external_registration_url: "https://rejestracja.example.org/panel-cee",
    });
    const link = screen.getByRole("link", { name: EXTERNAL_LABEL });
    expect(link).toHaveAttribute("href", "https://rejestracja.example.org/panel-cee");
    expect(link).toHaveAttribute("target", "_blank");
    // `noreferrer noopener` odcina obcej stronie referrer i uchwyt
    // `window.opener` do naszej karty.
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("noopener");
    // Zaden przycisk wolajacy rsvp_event nie moze tu istniec.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brak adresu przy trybie external nie daje ZADNEJ kontrolki", () => {
    const { surface } = renderBlock({
      registration_mode: "external",
      registration_state: "registration_external",
      external_registration_url: null,
    });
    expect(surface.kind).toBe("registrationExternalMisconfigured");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("blok zapisow: brak miejsc", () => {
  it("pokazuje LISTE REZERWOWA, a nie blad", () => {
    const { surface } = renderBlock({ registration_state: "sold_out", seats_left: 0 });
    expect(surface.kind).toBe("soldOut");
    const button = screen.getByRole("button", { name: WAITLIST_LABEL });
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: REGISTER_LABEL })).toBeNull();
    expect(screen.getByText("Wszystkie miejsca są zajęte.")).toBeTruthy();
  });

  it("stojac JUZ w kolejce nie proponuje dopisania sie do niej po raz drugi", () => {
    const { surface } = renderBlock({
      registration_state: "sold_out",
      seats_left: 0,
      my_rsvp_status: "waitlist",
      my_waitlist_position: 3,
    });
    expect(surface.kind).toBe("waitlistedRsvp");
    expect(screen.queryByRole("button", { name: WAITLIST_LABEL })).toBeNull();
    expect(screen.getByText("Twoje miejsce w kolejce: 3")).toBeTruthy();
  });
});

describe("blok zapisow: zapisy otwarte", () => {
  it("daje czynny przycisk zapisu - kontrolka, ktora ma szanse sie udac", () => {
    renderBlock({});
    expect(screen.getByRole("button", { name: REGISTER_LABEL })).not.toBeDisabled();
  });
});
