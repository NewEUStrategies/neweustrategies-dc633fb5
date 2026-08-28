// Molekuły „urządzenie skanujące" - WYDANIE POŚWIADCZENIA i JEDNORAZOWY POKAZ
// JAWNEGO TOKENU.
//
// CO TEN PLIK DOWODZI.
//   1. TOKEN WIDZI SIĘ RAZ. Baza trzyma wyłącznie skrót SHA-256 i nie ma
//      funkcji, która odtworzy jawny token. Zamknięcie okienka MUSI zabrać go
//      z drzewa razem z kodem QR - inaczej poświadczenie wpuszczające ludzi na
//      wydarzenie zostaje w DOM-ie po tym, jak operator uznał sprawę
//      za zamkniętą.
//   2. SPÓŹNIONY KOD QR NIE PODMIENIA AKTUALNEGO. Generowanie obrazka jest
//      asynchroniczne; gdyby odpowiedź dla POPRZEDNIEGO urządzenia dojechała
//      po wydaniu następnego, wolontariusz sparowałby telefon cudzym tokenem.
//   3. UPRAWNIENIE `lead` WYMAGA SPONSORA. Skan leada zapisuje zgodę
//      marketingową na czyjąś rzecz - bez wskazanego sponsora nie ma czyjej.
//   4. POŚWIADCZENIE BEZ ANI JEDNEGO UPRAWNIENIA NIE MA CO ROBIĆ. Urządzenie,
//      które nie może nic zeskanować, wygląda przy bramce jak awaria systemu.
//   5. WYDANIE ZACZYNA OD CZYSTEGO FORMULARZA. Etykieta poprzedniego urządzenia
//      w polu następnego kończy się dwoma „Wejście A" w wykazie poświadczeń.
//   6. TERMIN WAŻNOŚCI JEST OPCJONALNY, ale wpisany musi być PRZYSZŁY i jedzie
//      w UTC - poświadczenie z terminem wstecz jest martwe w chwili wydania.
//   7. NIEPEŁNY FORMULARZ NIE WOŁA WARSTWY WYDANIA - asercja na atrapie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej (długość etykiety,
// zbiór uprawnień, konwersja `datetime-local` -> ISO) - tabele przypadków są
// w `lib/events/onsiteDraft.test.ts`. (2) Samego wydania poświadczenia przez
// RPC i tego, że baza trzyma skrót - molekuły dostają `onSubmit`/`credential`
// w propsach. (3) Biblioteki kodów QR - jest atrapą, bo przedmiotem dowodu
// jest to, JAKI adres okienko każe zakodować i KIEDY obrazek znika.
//
// CZEGO NIE DA SIĘ TU DOSIĘGNĄĆ. Dwie wczesne odmowy w okienku tokenu
// (`if (pairingUrl === null) return` w kopiowaniu odnośnika i
// `if (credential === null) return` w kopiowaniu tokenu) są NIEOSIĄGALNE przez
// interfejs: stopka z tymi przyciskami istnieje wyłącznie przy otwartym
// okienku, a otwarcie znaczy dokładnie `credential !== null`. Zostają jako
// asekuracja na wypadek zmiany warunku otwarcia i są jedynymi niepokrytymi
// gałęziami tego pliku.
//
// Radix Dialog i Radix Select nie działają pod happy-dom bez pełnego pointer
// API - oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ScannerDeviceCredential, ScannerDeviceIssueInput } from "@/lib/events/onsiteApi";
import type { ScannerRelationOption } from "@/components/admin/events/molecules/ScannerDeviceDialog";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
  /** Każde żądanie kodu QR czeka na jawne rozwiązanie - stąd kontrola wyścigu. */
  qrCalls: [] as { url: string; resolve: (dataUrl: string) => void }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Klient bazy nie jest przedmiotem dowodu, a jego moduł domaga się konfiguracji
// środowiska przy imporcie - okno bierze z `onsiteApi` wyłącznie SŁOWNIK zakresów.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: (url: string) =>
      new Promise<string>((resolve) => {
        h.qrCalls.push({ url, resolve });
      }),
  },
}));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false, onOpenChange: null as ((next: boolean) => void) | null };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange ?? null;
      return <div data-testid="dialog-root">{children}</div>;
    },
    // Radix zgłasza zmianę stanu w OBIE strony (klawisz Esc, kliknięcie w tło,
    // ale też otwarcie wyzwalaczem). Oba kierunki mają tu przycisk, bo okienko
    // tokenu reaguje tylko na jeden z nich i to jest jego kontrakt.
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog">
          {children}
          <button type="button" onClick={() => stan.onOpenChange?.(true)}>
            radix-otwiera
          </button>
          <button type="button" onClick={() => stan.onOpenChange?.(false)}>
            radix-zamyka
          </button>
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    error,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    error?: string | null;
    "aria-label"?: string;
  }) => (
    <>
      <select
        id={id}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {String(option.label)}
          </option>
        ))}
      </select>
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));

const { ScannerCredentialDialog, ScannerDeviceDialog } =
  await import("@/components/admin/events/molecules/ScannerDeviceDialog");

const WYDARZENIE = "5d1e7f22-1111-4222-8333-444455556666";
const PUNKT = "cp-wejscie";
const SPONSOR = "sponsor-alfa";
const BLAD = "adminEventOnsite.errors.";
const D = "adminEventOnsite.devices.dialog.";
const C = "adminEventOnsite.devices.credential.";

const PUNKTY: ScannerRelationOption[] = [{ id: PUNKT, label: "Wejście główne" }];
const SPONSORZY: ScannerRelationOption[] = [{ id: SPONSOR, label: "Alfa sp. z o.o." }];

function renderujWydanie(props: { open?: boolean } = {}) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: ScannerDeviceIssueInput) => void>();
  const stan = { open: props.open ?? true, isSaving: false };
  const drzewo = () => (
    <ScannerDeviceDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      eventId={WYDARZENIE}
      checkpoints={PUNKTY}
      sponsors={SPONSORZY}
      isSaving={stan.isSaving}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(drzewo());
  const przerysuj = (zmiana: Partial<typeof stan>) => {
    Object.assign(stan, zmiana);
    wynik.rerender(drzewo());
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const etykieta = () => screen.getByLabelText(`${D}label`);
const punktKontrolny = () => screen.getByLabelText(`${D}checkpoint`);
const sponsorUrzadzenia = () => screen.getByLabelText(`${D}sponsor`);
const terminWaznosci = () => screen.getByLabelText(`${D}expiresAt`);
const zakres = (nazwa: string) =>
  screen.getByRole("checkbox", { name: `adminEventOnsite.scopes.${nazwa}` });
const wydaj = () => screen.getByRole("button", { name: /adminEventOnsite\.actions\.issueDevice/ });
const anuluj = () => screen.getByRole("button", { name: "adminEventOnsite.actions.cancel" });

beforeEach(() => {
  vi.clearAllMocks();
  h.qrCalls = [];
  h.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: h.writeText },
  });
});

describe("ScannerDeviceDialog - otwarcie i pozostałość", () => {
  it("okno ZAMKNIĘTE nie renderuje formularza", () => {
    renderujWydanie({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${D}createTitle`)).not.toBeInTheDocument();
  });

  it("otwarte okno startuje z jednym uprawnieniem i bez powiązań", () => {
    // `checkin` to domyślne urządzenie przy bramce; `lead` i wydruk to decyzje,
    // które ktoś musi podjąć świadomie.
    renderujWydanie();
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeInTheDocument();
    expect(etykieta()).toHaveValue("");
    expect(zakres("checkin")).toBeChecked();
    expect(zakres("lead")).not.toBeChecked();
    expect(zakres("badge_print")).not.toBeChecked();
    expect(punktKontrolny()).toHaveValue("__none__");
    expect(sponsorUrzadzenia()).toHaveValue("__none__");
    expect(terminWaznosci()).toHaveValue("");
  });

  it("PONOWNE OTWARCIE czyści pracę z poprzedniego wydania", () => {
    // Regresja, którą to łapie: drugie urządzenie dostaje etykietę, punkt
    // i termin pierwszego - a w wykazie poświadczeń stają dwa „Wejście A",
    // których nikt już nie odróżni przy unieważnianiu.
    const { przerysuj } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(punktKontrolny(), { target: { value: PUNKT } });
    fireEvent.click(zakres("badge_print"));

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(etykieta()).toHaveValue("");
    expect(punktKontrolny()).toHaveValue("__none__");
    expect(zakres("badge_print")).not.toBeChecked();
    expect(zakres("checkin")).toBeChecked();
  });
});

describe("ScannerDeviceDialog - uprawnienia urządzenia", () => {
  it("ODZNACZENIE JEDYNEGO uprawnienia blokuje wydanie", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(zakres("checkin"));
    expect(zakres("checkin")).not.toBeChecked();

    fireEvent.click(wydaj());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidScopes`)).toBeInTheDocument();
  });

  it("uprawnienia można dokładać i zdejmować, a komplet jedzie w żądaniu", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(zakres("badge_print"));
    fireEvent.click(zakres("checkin"));
    fireEvent.click(zakres("checkin"));
    fireEvent.click(wydaj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].scopes).toEqual(["badge_print", "checkin"]);
  });

  it("UPRAWNIENIE LEADOWE BEZ SPONSORA nie przechodzi - nie ma czyjej zgody zapisywać", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(zakres("lead"));
    fireEvent.click(wydaj());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${BLAD}sponsorRequired`);
    expect(sponsorUrzadzenia()).toHaveAttribute("aria-invalid", "true");
  });

  it("wskazany sponsor odblokowuje uprawnienie leadowe", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(zakres("lead"));
    fireEvent.change(sponsorUrzadzenia(), { target: { value: SPONSOR } });
    fireEvent.click(wydaj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      sponsorId: SPONSOR,
      scopes: ["checkin", "lead"],
    });
  });

  it("COFNIĘCIE wskazania sponsora znów blokuje uprawnienie leadowe", () => {
    // Wartownik „bez sponsora" wraca do pustego tekstu w szkicu; gdyby zostawał
    // napisem `__none__`, warunek „sponsor wskazany" byłby spełniony i wyszłoby
    // poświadczenie leadowe przypisane do nieistniejącego sponsora.
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(zakres("lead"));
    fireEvent.change(sponsorUrzadzenia(), { target: { value: SPONSOR } });
    fireEvent.change(sponsorUrzadzenia(), { target: { value: "__none__" } });
    fireEvent.click(wydaj());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${BLAD}sponsorRequired`);
  });
});

describe("ScannerDeviceDialog - walidacja i ładunek", () => {
  it("BŁĘDY NIE POKAZUJĄ SIĘ przed pierwszą próbą wydania", () => {
    renderujWydanie();
    expect(screen.queryByText(`${BLAD}invalidLabel`)).not.toBeInTheDocument();
    expect(etykieta()).not.toHaveAttribute("aria-invalid");

    fireEvent.click(wydaj());
    expect(screen.getByText(`${BLAD}invalidLabel`)).toBeInTheDocument();
    expect(etykieta()).toHaveAttribute("aria-invalid", "true");
  });

  it("etykieta krótsza niż dwa znaki nie wydaje poświadczenia", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "A" } });
    fireEvent.click(wydaj());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("etykieta jedzie OBCIĘTA, a brak powiązań jedzie jako null", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "  Telefon Ani  " } });
    fireEvent.click(wydaj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      eventId: WYDARZENIE,
      label: "Telefon Ani",
      scopes: ["checkin"],
      checkpointId: null,
      sponsorId: null,
      expiresAt: undefined,
    });
  });

  it("wskazany punkt kontrolny jedzie w żądaniu, a powrót do „bez przypięcia” go zdejmuje", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(punktKontrolny(), { target: { value: PUNKT } });
    fireEvent.click(wydaj());
    expect(onSubmit.mock.calls[0][0].checkpointId).toBe(PUNKT);

    fireEvent.change(punktKontrolny(), { target: { value: "__none__" } });
    fireEvent.click(wydaj());
    expect(onSubmit.mock.calls[1][0].checkpointId).toBeNull();
  });

  it("TERMIN W PRZESZŁOŚCI nie przechodzi - poświadczenie byłoby martwe w chwili wydania", () => {
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(terminWaznosci(), { target: { value: "2020-01-01T10:00" } });
    fireEvent.click(wydaj());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidExpiry`)).toBeInTheDocument();
  });

  it("WYCZYSZCZONY termin wraca do „bez terminu” i odblokowuje wydanie", () => {
    // Pusty termin znaczy „weź domyślny z bazy" (doba po wydarzeniu), a nie
    // „termin zero" - poprawienie pomyłki nie może zostawić okna zablokowanego.
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(terminWaznosci(), { target: { value: "2020-01-01T10:00" } });
    fireEvent.click(wydaj());
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(terminWaznosci(), { target: { value: "" } });
    fireEvent.click(wydaj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].expiresAt).toBeUndefined();
    expect(screen.queryByText(`${BLAD}invalidExpiry`)).not.toBeInTheDocument();
  });

  it("TERMIN PRZYSZŁY jedzie w UTC z zachowaniem godziny z zegara organizatora", () => {
    // Pole `datetime-local` nie niesie strefy; wysłanie napisu bez konwersji
    // dałoby poświadczenie ważne o godzinę za krótko lub za długo.
    const { onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(terminWaznosci(), { target: { value: "2099-12-31T23:45" } });
    fireEvent.click(wydaj());

    const wyslany = onSubmit.mock.calls[0][0].expiresAt ?? "";
    expect(wyslany).toMatch(/Z$/);
    const odczytany = new Date(wyslany);
    expect(odczytany.getFullYear()).toBe(2099);
    expect(odczytany.getMonth()).toBe(11);
    expect(odczytany.getDate()).toBe(31);
    expect(odczytany.getHours()).toBe(23);
    expect(odczytany.getMinutes()).toBe(45);
  });
});

describe("ScannerDeviceDialog - wydanie w locie i wyjście", () => {
  it("trwające wydanie odcina OBA przyciski i nie przepuszcza drugiego żądania", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(wydaj());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    fireEvent.click(wydaj());
    fireEvent.click(anuluj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("okno NIE zamyka się samo po wysłaniu - odmowa zostawia pracę na ekranie", () => {
    const { onOpenChange } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.change(punktKontrolny(), { target: { value: PUNKT } });
    fireEvent.click(wydaj());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(etykieta()).toHaveValue("Telefon Ani");
    expect(punktKontrolny()).toHaveValue(PUNKT);
  });

  it("anulowanie zamyka okno BEZ wydania poświadczenia", () => {
    const { onOpenChange, onSubmit } = renderujWydanie();
    fireEvent.change(etykieta(), { target: { value: "Telefon Ani" } });
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/* ------------------------------------ jednorazowy pokaz jawnego tokenu --- */

function poswiadczenie(overrides: Partial<ScannerDeviceCredential> = {}): ScannerDeviceCredential {
  return {
    deviceId: "dev-1",
    label: "Telefon Ani",
    token: "tok_abc+def/123",
    tokenPrefix: "tok_abc",
    scopes: ["checkin", "lead"],
    expiresAt: null,
    ...overrides,
  };
}

function renderujToken(credential: ScannerDeviceCredential | null = poswiadczenie()) {
  const onClose = vi.fn();
  const stan = { credential };
  const wynik = render(<ScannerCredentialDialog credential={stan.credential} onClose={onClose} />);
  const przerysuj = (next: ScannerDeviceCredential | null) => {
    stan.credential = next;
    wynik.rerender(<ScannerCredentialDialog credential={stan.credential} onClose={onClose} />);
  };
  return { ...wynik, onClose, przerysuj };
}

/** Wydaje obrazek dla n-tego żądania kodu QR i pozwala Reactowi go przyjąć. */
async function wydajKod(index: number, dataUrl: string) {
  await act(async () => {
    h.qrCalls[index].resolve(dataUrl);
  });
}

const kopiujToken = () =>
  screen.getByRole("button", { name: /adminEventOnsite\.actions\.copyToken/ });
const kopiujOdnosnik = () =>
  screen.getByRole("button", { name: /adminEventOnsite\.actions\.copyPairingLink/ });

describe("ScannerCredentialDialog - pokaz tokenu", () => {
  it("BEZ POŚWIADCZENIA okienko nie pokazuje niczego i nie prosi o kod QR", () => {
    renderujToken(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.qrCalls).toHaveLength(0);
  });

  it("pokazuje etykietę, uprawnienia i JAWNY token", () => {
    renderujToken();
    const okno = screen.getByRole("dialog");
    expect(within(okno).getByText("Telefon Ani")).toBeInTheDocument();
    expect(within(okno).getByText("adminEventOnsite.scopes.checkin")).toBeInTheDocument();
    expect(within(okno).getByText("adminEventOnsite.scopes.lead")).toBeInTheDocument();
    expect(within(okno).getByText("tok_abc+def/123")).toBeInTheDocument();
  });

  it("kod QR prowadzi wprost do trasy skanera z ZAKODOWANYM tokenem", async () => {
    // Wolontariusz nie przepisze trzydziestu dwóch znaków base64url bez
    // pomyłki, a `+` i `/` w tokenie bez zakodowania rozpadłyby się w adresie.
    const { container } = renderujToken();
    expect(h.qrCalls[0].url).toBe(`${window.location.origin}/scanner?t=tok_abc%2Bdef%2F123`);
    expect(container.querySelector("img")).toBeNull();

    await wydajKod(0, "data:image/png;base64,PIERWSZY");

    expect(screen.getByText(`${C}qrHint`)).toBeInTheDocument();
    // Obrazek jest CELOWO dekoracyjny (`alt=""`): ta sama treść stoi obok jako
    // tekst tokenu, więc czytnik ekranu nie ma jej czytać dwa razy.
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,PIERWSZY");
  });

  it("SPÓŹNIONY kod poprzedniego urządzenia NIE podmienia aktualnego", async () => {
    // Bez znacznika unieważnienia w sprzątaniu efektu wolontariusz dostałby
    // do sparowania kod z TOKENEM POPRZEDNIEGO urządzenia.
    const { container, przerysuj } = renderujToken(poswiadczenie({ token: "pierwszy" }));
    expect(h.qrCalls).toHaveLength(1);

    przerysuj(poswiadczenie({ deviceId: "dev-2", token: "drugi" }));
    expect(h.qrCalls).toHaveLength(2);

    await wydajKod(1, "data:image/png;base64,DRUGI");
    await wydajKod(0, "data:image/png;base64,PIERWSZY");

    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,DRUGI");
  });

  it("ZAMKNIĘCIE ZABIERA TOKEN Z EKRANU RAZEM Z KODEM QR", async () => {
    // Token widzi się RAZ: baza trzyma tylko skrót SHA-256. Gdyby okienko
    // pamiętało go po zamknięciu, poświadczenie wpuszczające ludzi na
    // wydarzenie zostawałoby w drzewie po tym, jak sprawa jest zamknięta.
    const { container, onClose, przerysuj } = renderujToken();
    await wydajKod(0, "data:image/png;base64,PIERWSZY");
    expect(screen.getByText("tok_abc+def/123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `${C}close` }));
    expect(onClose).toHaveBeenCalledTimes(1);

    przerysuj(null);

    expect(screen.queryByText("tok_abc+def/123")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("zamknięcie klawiszem Esc też oddaje sprawę panelowi, a OTWARCIE nic nie robi", () => {
    // Radix woła `onOpenChange` w obie strony; okienko tokenu ma reagować
    // wyłącznie na zamknięcie - odwrócenie warunku zamykałoby je w chwili
    // otwarcia.
    const { onClose } = renderujToken();
    fireEvent.click(screen.getByRole("button", { name: "radix-otwiera" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "radix-zamyka" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ScannerCredentialDialog - schowek", () => {
  it("„Skopiuj token” wkłada do schowka JAWNY token i potwierdza", async () => {
    renderujToken();
    fireEvent.click(kopiujToken());

    await waitFor(() => expect(h.writeText).toHaveBeenCalledWith("tok_abc+def/123"));
    expect(h.toastSuccess).toHaveBeenCalledWith(`${C}copied`);
  });

  it("„Kopiuj odnośnik parowania” wkłada CAŁY adres, nie sam token", async () => {
    renderujToken();
    fireEvent.click(kopiujOdnosnik());

    await waitFor(() =>
      expect(h.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/scanner?t=tok_abc%2Bdef%2F123`,
      ),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith(`${C}copied`);
  });

  it("ODMOWA SCHOWKA nie zabiera tokenu z ekranu - mówi o błędzie i zostawia treść", async () => {
    // Drugiego pokazu nie będzie, więc brak dostępu do schowka musi zostawić
    // operatorowi możliwość przepisania tokenu ręcznie.
    h.writeText.mockRejectedValue(new Error("clipboard blocked"));
    renderujToken();

    fireEvent.click(kopiujToken());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(`${BLAD}unknown`));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("tok_abc+def/123")).toBeInTheDocument();
  });

  it("odmowa schowka przy odnośniku parowania też kończy się komunikatem błędu", async () => {
    h.writeText.mockRejectedValue(new Error("clipboard blocked"));
    renderujToken();

    fireEvent.click(kopiujOdnosnik());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(`${BLAD}unknown`));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});
