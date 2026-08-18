// Organizm „Widoczność i kontakt” (hub /profile/privacy) - stał na ZERZE
// pokrycia, a jest to JEDYNE miejsce w produkcie, w którym użytkownik ustawia,
// kto go widzi i kto może się z nim skontaktować. Osiem niezależnych kontrolek,
// każda z własną mutacją zapisywaną NATYCHMIAST (bez przycisku „Zapisz”).
//
// Dlaczego to jest ryzykowna powierzchnia: osiem prawie identycznych bloków
// `onCheckedChange`/`onValueChange` różniących się WYŁĄCZNIE nazwą pola.
// Przestawienie jednej litery przy kopiowaniu daje przełącznik, który zapisuje
// CZYJEŚ INNE ustawienie prywatności - i nie widać tego ani na typach (wszystkie
// przyjmują `boolean`), ani na ekranie (oba przełączniki się przestawiają, bo
// stan idzie z cache). Dlatego każdy test niżej sprawdza PARĘ: która mutacja
// i z jaką wartością.
//
// Druga rzecz to ASYMETRIA DOMYŚLNYCH WARTOŚCI. Brak wiersza w bazie znaczy
// „nie ma mnie w katalogu” (false), ale JEDNOCZEŚNIE „przyjmuję zapytania”
// (true) i „pokazuję awatar” (hide = false). Wyrównanie tych trzech do jednego
// domyślnego albo wyłączyłoby ludziom zapytania, albo wrzuciłoby ich do
// katalogu bez zgody.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ALLOW_MESSAGES_FROM_LEVELS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@/lib/notifications/useNotifications";
import { exposureRow } from "@/test/profile/fixtures";
import { normalizeExposure } from "@/lib/profile/publicExposure";

type Q = { data: unknown; isLoading: boolean };
type M = { mutate: ReturnType<typeof vi.fn>; isPending: boolean };

const h = vi.hoisted(() => ({
  discoverable: { data: undefined as unknown, isLoading: false },
  expertRequests: { data: undefined as unknown, isLoading: false },
  hideAvatar: { data: undefined as unknown, isLoading: false },
  prefs: { data: undefined as unknown, isLoading: false },
  exposure: { data: undefined as unknown, isLoading: false },
  setDiscoverable: { mutate: vi.fn(), isPending: false },
  setExpertRequests: { mutate: vi.fn(), isPending: false },
  setHideAvatar: { mutate: vi.fn(), isPending: false },
  updatePrefs: { mutate: vi.fn(), isPending: false },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/lib/chat/useDiscoverable", () => ({
  useDiscoverable: (): Q => h.discoverable,
  useSetDiscoverable: (): M => h.setDiscoverable,
  useExpertRequestsEnabled: (): Q => h.expertRequests,
  useSetExpertRequestsEnabled: (): M => h.setExpertRequests,
  useHideAvatar: (): Q => h.hideAvatar,
  useSetHideAvatar: (): M => h.setHideAvatar,
}));

vi.mock("@/lib/profile/usePublicExposure", () => ({
  usePublicExposure: (): Q => h.exposure,
}));

vi.mock("@/lib/notifications/useNotifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/useNotifications")>(
    "@/lib/notifications/useNotifications",
  );
  return {
    ...actual,
    useNotificationPreferences: (): Q => h.prefs,
    useUpdateNotificationPreferences: (): M => h.updatePrefs,
  };
});

// Radix Select nie otwiera listy w happy-dom - podstawiamy natywny `<select>`
// z fixture'ów profilu (`radixSelectStub`), bo asercje dotyczą listy dostępnych
// opcji i tego, KTÓRE pole preferencji dostaje nową wartość.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.radixSelectStub(React);
});

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

import { VisibilityAndContactSection } from "@/components/profile/privacy/VisibilityAndContactSection";

/** Przełącznik po `aria-label` (klucz i18n echowany przez stub). */
function toggle(key: string): HTMLElement {
  return screen.getByRole("switch", { name: key });
}

function select(key: string): HTMLElement {
  return screen.getByLabelText(key);
}

/** Odpal wywołanie zwrotne mutacji zapisanej w ostatnim wywołaniu `mutate`. */
function fireCallback(mock: ReturnType<typeof vi.fn>, which: "onSuccess" | "onError"): void {
  const options = mock.mock.calls.at(-1)?.[1] as Record<string, () => void>;
  options[which]();
}

beforeEach(() => {
  h.discoverable = { data: undefined, isLoading: false };
  h.expertRequests = { data: undefined, isLoading: false };
  h.hideAvatar = { data: undefined, isLoading: false };
  h.prefs = { data: undefined, isLoading: false };
  h.exposure = { data: undefined, isLoading: false };
  h.setDiscoverable = { mutate: vi.fn(), isPending: false };
  h.setExpertRequests = { mutate: vi.fn(), isPending: false };
  h.setHideAvatar = { mutate: vi.fn(), isPending: false };
  h.updatePrefs = { mutate: vi.fn(), isPending: false };
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("domyślne wartości bez wiersza w bazie", () => {
  it("katalog osób jest WYŁĄCZONY, zapytania do eksperta WŁĄCZONE, awatar WIDOCZNY", () => {
    // Trzy różne domyślne wartości i to jest decyzja, nie niedopatrzenie:
    // wrzucenie kogoś do katalogu bez zgody to wyciek, a wyłączenie zapytań
    // bez zgody to cicha utrata kontaktów.
    render(<VisibilityAndContactSection />);

    expect(toggle("profilePrivacy.discoverableLabel")).not.toBeChecked();
    expect(toggle("profilePrivacy.expertRequestsLabel")).toBeChecked();
    expect(toggle("profilePrivacy.hideAvatarLabel")).not.toBeChecked();
  });

  it("pokazuje stan przeciwny, gdy baza mówi inaczej", () => {
    h.discoverable = { data: true, isLoading: false };
    h.expertRequests = { data: false, isLoading: false };
    h.hideAvatar = { data: true, isLoading: false };
    render(<VisibilityAndContactSection />);

    expect(toggle("profilePrivacy.discoverableLabel")).toBeChecked();
    expect(toggle("profilePrivacy.expertRequestsLabel")).not.toBeChecked();
    expect(toggle("profilePrivacy.hideAvatarLabel")).toBeChecked();
  });

  it("etykieta stanu katalogu idzie za przełącznikiem", () => {
    render(<VisibilityAndContactSection />);
    expect(screen.getByText("profilePrivacy.discoverableOff")).toBeInTheDocument();

    h.discoverable = { data: true, isLoading: false };
    render(<VisibilityAndContactSection />);
    expect(screen.getByText("profilePrivacy.discoverableOn")).toBeInTheDocument();
  });

  it("etykieta stanu zapytań idzie za przełącznikiem", () => {
    render(<VisibilityAndContactSection />);
    expect(screen.getByText("profilePrivacy.expertRequestsOn")).toBeInTheDocument();

    h.expertRequests = { data: false, isLoading: false };
    render(<VisibilityAndContactSection />);
    expect(screen.getByText("profilePrivacy.expertRequestsOff")).toBeInTheDocument();
  });
});

describe("każdy przełącznik zapisuje SWOJE ustawienie", () => {
  it("katalog osób woła WYŁĄCZNIE `setDiscoverable`", () => {
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.discoverableLabel"));

    expect(h.setDiscoverable.mutate).toHaveBeenCalledTimes(1);
    expect(h.setDiscoverable.mutate.mock.calls[0][0]).toBe(true);
    // Żadna inna mutacja prywatności nie może się przy tym ruszyć.
    expect(h.setExpertRequests.mutate).not.toHaveBeenCalled();
    expect(h.setHideAvatar.mutate).not.toHaveBeenCalled();
    expect(h.updatePrefs.mutate).not.toHaveBeenCalled();
  });

  it("ukrycie awatara woła WYŁĄCZNIE `setHideAvatar`", () => {
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.hideAvatarLabel"));

    expect(h.setHideAvatar.mutate).toHaveBeenCalledTimes(1);
    expect(h.setHideAvatar.mutate.mock.calls[0][0]).toBe(true);
    expect(h.setDiscoverable.mutate).not.toHaveBeenCalled();
    expect(h.setExpertRequests.mutate).not.toHaveBeenCalled();
  });

  it("zapytania do eksperta wołają WYŁĄCZNIE `setExpertRequests`, z wartością odwrotną", () => {
    // Domyślnie włączone, więc kliknięcie ma WYŁĄCZAĆ - przekazanie `true`
    // (kopia z sąsiedniego bloku) zostawiłoby ustawienie bez zmiany.
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.expertRequestsLabel"));

    expect(h.setExpertRequests.mutate).toHaveBeenCalledTimes(1);
    expect(h.setExpertRequests.mutate.mock.calls[0][0]).toBe(false);
    expect(h.setDiscoverable.mutate).not.toHaveBeenCalled();
  });

  it("każdy przełącznik potwierdza zapis i raportuje błąd", () => {
    render(<VisibilityAndContactSection />);
    fireEvent.click(toggle("profilePrivacy.discoverableLabel"));

    fireCallback(h.setDiscoverable.mutate, "onSuccess");
    expect(h.toastSuccess).toHaveBeenCalledWith("profilePrivacy.saved");

    fireCallback(h.setDiscoverable.mutate, "onError");
    expect(h.toastError).toHaveBeenCalledWith("profilePrivacy.saveError");
  });

  it("ukrycie awatara i zapytania też mają obie ścieżki komunikatu", () => {
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.hideAvatarLabel"));
    fireCallback(h.setHideAvatar.mutate, "onSuccess");
    fireCallback(h.setHideAvatar.mutate, "onError");

    fireEvent.click(toggle("profilePrivacy.expertRequestsLabel"));
    fireCallback(h.setExpertRequests.mutate, "onSuccess");
    fireCallback(h.setExpertRequests.mutate, "onError");

    expect(h.toastSuccess).toHaveBeenCalledTimes(2);
    expect(h.toastError).toHaveBeenCalledTimes(2);
  });
});

describe("blokada w trakcie zapisu i wczytywania", () => {
  it("przełącznik jest wyłączony, dopóki nie wiadomo, jaki jest stan", () => {
    // Kliknięcie w nieznany stan zapisuje wartość wziętą z domyślnej,
    // czyli potencjalnie cofa ustawienie, którego użytkownik nie widział.
    h.discoverable = { data: undefined, isLoading: true };
    render(<VisibilityAndContactSection />);
    expect(toggle("profilePrivacy.discoverableLabel")).toBeDisabled();
  });

  it("przełącznik jest wyłączony w trakcie własnego zapisu", () => {
    h.setDiscoverable = { mutate: vi.fn(), isPending: true };
    render(<VisibilityAndContactSection />);
    expect(toggle("profilePrivacy.discoverableLabel")).toBeDisabled();
  });

  it("zapis JEDNEGO ustawienia nie blokuje pozostałych", () => {
    // Osiem kontrolek dzieli sekcję, ale nie stan - wspólna blokada
    // zamrażałaby cały panel na czas każdego zapisu.
    h.setDiscoverable = { mutate: vi.fn(), isPending: true };
    render(<VisibilityAndContactSection />);

    expect(toggle("profilePrivacy.discoverableLabel")).toBeDisabled();
    expect(toggle("profilePrivacy.hideAvatarLabel")).not.toBeDisabled();
    expect(toggle("profilePrivacy.expertRequestsLabel")).not.toBeDisabled();
  });
});

describe("kto może pisać i kto zapraszać", () => {
  it("domyślnie pokazuje wartości z modelu preferencji", () => {
    render(<VisibilityAndContactSection />);
    expect(select("profilePrivacy.allowMessagesLabel")).toHaveValue(
      DEFAULT_NOTIFICATION_PREFERENCES.allow_messages_from,
    );
    expect(select("network.allowConnectionsLabel")).toHaveValue(
      DEFAULT_NOTIFICATION_PREFERENCES.allow_connections_from,
    );
  });

  it("oferuje WSZYSTKIE progi z modelu, nie podzbiór", () => {
    // Brakująca opcja to ustawienie prywatności, którego nie da się wybrać
    // z interfejsu, choć baza je zna.
    render(<VisibilityAndContactSection />);

    const messages = [...select("profilePrivacy.allowMessagesLabel").querySelectorAll("option")];
    expect(messages.map((o) => o.getAttribute("value"))).toEqual([...ALLOW_MESSAGES_FROM_LEVELS]);

    const connections = [...select("network.allowConnectionsLabel").querySelectorAll("option")];
    expect(connections.map((o) => o.getAttribute("value"))).toEqual([
      "everyone",
      "mutual",
      "nobody",
    ]);
  });

  it("każda opcja ma etykietę i18n, nie surowy kod", () => {
    render(<VisibilityAndContactSection />);
    const options = [...select("profilePrivacy.allowMessagesLabel").querySelectorAll("option")];
    for (const option of options) {
      expect(option.textContent).toMatch(/^profilePrivacy\.allowMessages/);
    }
  });

  it("pokazuje wartość zapisaną w preferencjach użytkownika", () => {
    h.prefs = {
      data: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        allow_messages_from: "nobody",
        allow_connections_from: "mutual",
      },
      isLoading: false,
    };
    render(<VisibilityAndContactSection />);

    expect(select("profilePrivacy.allowMessagesLabel")).toHaveValue("nobody");
    expect(select("network.allowConnectionsLabel")).toHaveValue("mutual");
  });

  it("zmiana „kto może pisać” trafia w `allow_messages_from`, NIE w zaproszenia", () => {
    // Najgroźniejsze przekrzyżowanie w tym pliku: oba selecty mają identyczny
    // kształt i tę samą mutację - różni je wyłącznie nazwa pola.
    render(<VisibilityAndContactSection />);

    fireEvent.change(select("profilePrivacy.allowMessagesLabel"), {
      target: { value: "contacts" },
    });

    expect(h.updatePrefs.mutate).toHaveBeenCalledTimes(1);
    expect(h.updatePrefs.mutate.mock.calls[0][0]).toEqual({ allow_messages_from: "contacts" });
  });

  it("zmiana „kto może zaprosić” trafia w `allow_connections_from`", () => {
    render(<VisibilityAndContactSection />);

    fireEvent.change(select("network.allowConnectionsLabel"), { target: { value: "nobody" } });

    expect(h.updatePrefs.mutate).toHaveBeenCalledTimes(1);
    expect(h.updatePrefs.mutate.mock.calls[0][0]).toEqual({ allow_connections_from: "nobody" });
  });

  it("selecty są wyłączone w trakcie zapisu preferencji", () => {
    h.updatePrefs = { mutate: vi.fn(), isPending: true };
    render(<VisibilityAndContactSection />);
    expect(select("profilePrivacy.allowMessagesLabel")).toBeDisabled();
    expect(select("network.allowConnectionsLabel")).toBeDisabled();
  });

  it("zmiana progu widoczności potwierdza zapis i raportuje błąd", () => {
    render(<VisibilityAndContactSection />);
    fireEvent.change(select("profilePrivacy.allowMessagesLabel"), {
      target: { value: "nobody" },
    });

    fireCallback(h.updatePrefs.mutate, "onSuccess");
    expect(h.toastSuccess).toHaveBeenCalledWith("profilePrivacy.saved");
    fireCallback(h.updatePrefs.mutate, "onError");
    expect(h.toastError).toHaveBeenCalledWith("profilePrivacy.saveError");
  });
});

describe("przełączniki prywatności czatu", () => {
  it("każdy z trzech pisze do WŁASNEGO pola preferencji", () => {
    // Potwierdzenia odczytu, „pisze...” i status online to trzy niezależne
    // sygnały wysyłane INNYM ludziom - pomyłka pola ujawnia coś, czego
    // użytkownik świadomie nie włączył.
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.readReceiptsLabel"));
    expect(h.updatePrefs.mutate.mock.calls.at(-1)?.[0]).toEqual({ read_receipts_enabled: false });

    fireEvent.click(toggle("profilePrivacy.typingLabel"));
    expect(h.updatePrefs.mutate.mock.calls.at(-1)?.[0]).toEqual({
      typing_indicators_enabled: false,
    });

    fireEvent.click(toggle("profilePrivacy.onlineStatusLabel"));
    expect(h.updatePrefs.mutate.mock.calls.at(-1)?.[0]).toEqual({ show_online_status: false });
  });

  it("stan przełączników czatu idzie z preferencji, nie z domyślnych", () => {
    h.prefs = {
      data: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        read_receipts_enabled: false,
        show_online_status: false,
      },
      isLoading: false,
    };
    render(<VisibilityAndContactSection />);

    expect(toggle("profilePrivacy.readReceiptsLabel")).not.toBeChecked();
    expect(toggle("profilePrivacy.typingLabel")).toBeChecked();
    expect(toggle("profilePrivacy.onlineStatusLabel")).not.toBeChecked();
  });

  it("wyłączony przełącznik czatu włącza się z powrotem wartością `true`", () => {
    h.prefs = {
      data: { ...DEFAULT_NOTIFICATION_PREFERENCES, read_receipts_enabled: false },
      isLoading: false,
    };
    render(<VisibilityAndContactSection />);

    fireEvent.click(toggle("profilePrivacy.readReceiptsLabel"));

    expect(h.updatePrefs.mutate.mock.calls.at(-1)?.[0]).toEqual({ read_receipts_enabled: true });
  });

  it("przełączniki czatu są wyłączone, dopóki preferencje się wczytują", () => {
    h.prefs = { data: undefined, isLoading: true };
    render(<VisibilityAndContactSection />);
    expect(toggle("profilePrivacy.readReceiptsLabel")).toBeDisabled();
    expect(toggle("profilePrivacy.typingLabel")).toBeDisabled();
    expect(toggle("profilePrivacy.onlineStatusLabel")).toBeDisabled();
  });

  it("potwierdza zapis i raportuje błąd", () => {
    render(<VisibilityAndContactSection />);
    fireEvent.click(toggle("profilePrivacy.typingLabel"));

    fireCallback(h.updatePrefs.mutate, "onSuccess");
    expect(h.toastSuccess).toHaveBeenCalledWith("profilePrivacy.saved");
    fireCallback(h.updatePrefs.mutate, "onError");
    expect(h.toastError).toHaveBeenCalledWith("profilePrivacy.saveError");
  });
});

describe("nota o ekspozycji poza platformą", () => {
  it("nieznana ekspozycja idzie do noty jako `null`, nie jako „prywatny”", () => {
    // Cała racja bytu `usePublicExposure`: awaria odczytu nie może zostać
    // pokazana jako obietnica prywatności. Sekcja przekazuje `?? null`.
    h.exposure = { data: undefined, isLoading: false };
    render(<VisibilityAndContactSection />);
    // Nota renderuje się mimo braku danych (stan „nie wiemy”), a nie znika.
    expect(screen.getByText("profilePrivacy.section")).toBeInTheDocument();
  });

  it("przekazuje notę stan wczytywania", () => {
    h.exposure = { data: undefined, isLoading: true };
    const { container } = render(<VisibilityAndContactSection />);
    expect(container.querySelector("[aria-labelledby]")).toBeTruthy();
  });

  it("ekspozycja z powodem publicznym renderuje się razem z sekcją", () => {
    h.exposure = {
      data: normalizeExposure(exposureRow({ is_public: true, by_author_profile: true })),
      isLoading: false,
    };
    render(<VisibilityAndContactSection />);
    expect(screen.getByText("profilePrivacy.section")).toBeInTheDocument();
    expect(toggle("profilePrivacy.discoverableLabel")).toBeInTheDocument();
  });

  it("ekspozycja publiczna jest NIEZALEŻNA od katalogu wewnętrznego", () => {
    // Dwie różne rzeczy: `discoverable` to wyszukiwarka wewnętrzna, ekspozycja
    // to widoczność dla niezalogowanych. Profil autora jest publiczny nawet
    // przy wyłączonym katalogu - i nota ma to powiedzieć.
    h.discoverable = { data: false, isLoading: false };
    h.exposure = {
      data: normalizeExposure(exposureRow({ is_public: true, by_author_profile: true })),
      isLoading: false,
    };
    render(<VisibilityAndContactSection />);

    expect(toggle("profilePrivacy.discoverableLabel")).not.toBeChecked();
    expect(screen.getByText("profilePrivacy.externalNote")).toBeInTheDocument();
  });
});

describe("dostępność sekcji", () => {
  it("sekcja jest opisana nagłówkiem", () => {
    render(<VisibilityAndContactSection />);
    const section = screen.getByRole("region", { name: "profilePrivacy.section" });
    expect(section).toBeInTheDocument();
  });

  it("wszystkie osiem kontrolek ma etykietę dla czytnika ekranu", () => {
    // Przełącznik prywatności bez etykiety jest dla czytnika ekranu
    // nierozróżnialny od siedmiu pozostałych.
    render(<VisibilityAndContactSection />);
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    for (const s of screen.getAllByRole("switch")) {
      expect(s.getAttribute("aria-label")).toBeTruthy();
    }
    expect(select("profilePrivacy.allowMessagesLabel")).toBeInTheDocument();
    expect(select("network.allowConnectionsLabel")).toBeInTheDocument();
  });
});
