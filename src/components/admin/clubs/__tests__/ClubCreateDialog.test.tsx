// Organizm „Nowy klub" - SKLEJENIE formularza z mutacją i sprawdzaniem adresu.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG ZAMKNIĘTY NIE RENDERUJE TREŚCI, a otwarcie CZYŚCI formularz.
//      Zakładanie drugiego klubu po zamknięciu pierwszego nie może wystartować
//      z resztkami poprzedniego wpisu - to jest droga do klubu z nazwą, której
//      nikt nie chciał.
//   2. ADRES PODĄŻA ZA NAZWĄ, DOPÓKI KTOŚ GO NIE TKNIE, a wpisany adres jest
//      NORMALIZOWANY w locie (CHECK w bazie zna tylko `[a-z0-9-]`).
//   3. TRZY STANY DOSTĘPNOŚCI ADRESU mają trzy różne widoki: sprawdzanie w
//      toku, adres wolny, adres zajęty. ZAJĘTY BLOKUJE ZAPIS - i to jest cała
//      wartość tego zapytania.
//   4. WALIDACJA ODRZUCA PUSTE POLE WYMAGANE BEZ WYSYŁANIA ŻĄDANIA: nazwa
//      krótsza niż trzy znaki nie ma jak wyjść z tego dialogu.
//   5. KSZTAŁT PAYLOADU jest asertowany na OBIEKCIE przekazanym do mutacji, nie
//      na DOM-ie: kolumna zajawki zależy od języka interfejsu, próg planu jedzie
//      jako ranga, klub powstaje jako wersja robocza.
//   6. PODWÓJNY SUBMIT WYSYŁA RAZ - trwający zapis wyłącza przycisk i pokazuje
//      wskaźnik postępu.
//   7. ODMOWA IDZIE PRZEZ KLUCZ i18n, dialog ZOSTAJE OTWARTY z wpisaną treścią,
//      a zajęty adres dokłada trwały komunikat przy polu i blokuje ponowny
//      zapis do zmiany adresu.
//   8. SUKCES zamyka dialog i oddaje IDENTYFIKATOR nowego klubu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł formularza - stan adresu, warunek
// wysyłki, kształt payloadu i skutki odmowy mają tabele w
// `lib/clubs/__tests__/adminClubCreateForm.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i co robi z wynikiem. (2) Słownika kodów odmowy
// (`toClubSaveError` - `clubTypes.test.ts`). (3) Normalizacji adresu
// (`clubSlugFromName`). (4) Molekuł: `ClubDialogSlugRow`, `ClubDialogTextRow`,
// `ClubLayoutPicker`, `ClubEnumSelect` mają własne pliki. (5) Wyboru okładki
// i obszaru tematycznego - to komponenty innych powierzchni, tu są atrapami,
// bo przedmiotem dowodu jest, CO organizm z nich bierze. (6) Samego
// `useUpsertClub`/`useClubSlugAvailable` (unieważnianie cache, `enabled`) -
// hooki są zamockowane na poziomie MODUŁU.
//
// DETERMINIZM: `useDebouncedValue` jest atrapą, więc w testach nie ma ani
// jednego `setTimeout`; opóźnienie symulujemy zamrożeniem wartości odpytanej.
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API -
// oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ClubUpsertInput } from "@/lib/clubs/types";

/** Kształt trzeciego argumentu `mutate` - tylko to, co organizm przekazuje. */
type Wynik = { onSuccess: (clubId: string) => void; onError: (error: Error) => void };

const h = vi.hoisted(() => ({
  language: "pl",
  /** Zamrożona wartość odpytana; `null` = brak opóźnienia. */
  debounceFrozen: null as string | null,
  slugQueries: [] as string[],
  available: undefined as boolean | undefined,
  isFetching: false,
  isPending: false,
  mutations: [] as { vars: ClubUpsertInput; wynik: Wynik }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: (value: string) => (h.debounceFrozen === null ? value : h.debounceFrozen),
}));
// Radix Dialog: `Root` zawsze renderuje dzieci, ale `Content` istnieje tylko
// przy otwartym dialogu (portal nie jest montowany). Atrapa odwzorowuje to
// wprost, bo inaczej „dialog zamknięty nie renderuje treści" byłoby dowodem
// na atrapę, a nie na organizm.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return (
        <div data-testid="dialog" data-open={String(open)}>
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});
// Droplista słownikowa ma własny plik testowy; Radix pod nią nie działa bez
// pełnego pointer API. Atrapa jest natywna i ETYKIETOWANA, bo przedmiotem
// dowodu jest to, KTÓRA decyzja dochodzi do payloadu.
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: ({
    id,
    label,
    value,
    options,
    i18nPrefix,
    hintPrefix,
    onChange,
    disabled,
  }: {
    id?: string;
    label?: string;
    value: string;
    options: readonly string[];
    i18nPrefix: string;
    hintPrefix?: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {`${i18nPrefix}.${option}`}
          </option>
        ))}
      </select>
      {hintPrefix === undefined ? null : <p>{`${hintPrefix}.${value}`}</p>}
    </div>
  ),
}));
vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: ({
    label,
    value,
    onChange,
    folder,
  }: {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    folder?: string;
  }) => (
    <div data-testid="okladka" data-folder={folder}>
      <label htmlFor="pole-okladki">{label}</label>
      <input
        id="pole-okladki"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubTopicSelect", () => ({
  ClubTopicSelect: ({
    id,
    label,
    hint,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    label?: string;
    hint?: string;
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="obszar" data-hint={hint}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">bez obszaru</option>
        <option value="energy">energia</option>
      </select>
    </div>
  ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useUpsertClub: () => ({
    isPending: h.isPending,
    mutate: (vars: ClubUpsertInput, wynik: Wynik) => {
      h.mutations.push({ vars, wynik });
    },
  }),
  useClubSlugAvailable: (slug: string) => {
    h.slugQueries.push(slug);
    return { data: h.available, isFetching: h.isFetching };
  },
}));

import { ClubCreateDialog } from "@/components/admin/clubs/organisms/ClubCreateDialog";

const NOWY_KLUB = "9a1f0b7c-1111-4222-8333-444455556666";

function renderuj(props: { open?: boolean } = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const wynik = render(
    <ClubCreateDialog
      open={props.open ?? true}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  );
  const przerysuj = (open: boolean) =>
    wynik.rerender(
      <ClubCreateDialog open={open} onOpenChange={onOpenChange} onCreated={onCreated} />,
    );
  return { ...wynik, onOpenChange, onCreated, przerysuj };
}

const poleNazwyPl = () => screen.getByLabelText("adminClubs.fields.namePl");
const poleNazwyEn = () => screen.getByLabelText("adminClubs.fields.nameEn");
const poleAdresu = () => screen.getByLabelText("adminClubs.fields.slug");
const przyciskZapisu = () => screen.getByRole("button", { name: "adminClubs.create.submit" });

/** Formularz w stanie gotowym do zapisu: nazwa wpisana, adres wolny. */
function wypelnijPoprawnie(nazwa = "Klub Energetyczny") {
  fireEvent.change(poleNazwyPl(), { target: { value: nazwa } });
}

beforeEach(() => {
  h.language = "pl";
  h.debounceFrozen = null;
  h.slugQueries = [];
  h.available = true;
  h.isFetching = false;
  h.isPending = false;
  h.mutations = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("ClubCreateDialog - otwarcie i zamknięcie", () => {
  it("dialog zamknięty NIE renderuje treści formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
    expect(screen.queryByText("adminClubs.create.title")).not.toBeInTheDocument();
  });

  it("dialog otwarty pokazuje nagłówek, pola i notkę o wersji roboczej", () => {
    renderuj();
    expect(screen.getByText("adminClubs.create.title")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.create.hint")).toBeInTheDocument();
    expect(screen.getByText("adminClubs.create.draftNote")).toBeInTheDocument();
    expect(poleNazwyPl()).toHaveValue("");
    expect(screen.getByTestId("okladka")).toHaveAttribute("data-folder", "clubs");
    expect(screen.getByTestId("obszar")).toHaveAttribute("data-hint", "club.topic.hint");
  });

  it("otwarcie CZYŚCI treść wpisaną przed zamknięciem", () => {
    // Regresja, którą to łapie: drugi klub startowałby z nazwą, adresem
    // i zajawką pierwszego - i nikt tego nie zauważy, bo formularz wygląda
    // jak wypełniony celowo.
    const { przerysuj } = renderuj();
    wypelnijPoprawnie("Pierwszy klub");
    fireEvent.change(screen.getByLabelText("adminClubs.fields.taglinePl"), {
      target: { value: "Zajawka pierwszego" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.cover"), {
      target: { value: "https://example.test/a.jpg" },
    });
    expect(poleAdresu()).toHaveValue("pierwszy-klub");

    przerysuj(false);
    przerysuj(true);

    expect(poleNazwyPl()).toHaveValue("");
    expect(poleAdresu()).toHaveValue("");
    expect(screen.getByLabelText("adminClubs.fields.taglinePl")).toHaveValue("");
    expect(screen.getByLabelText("adminClubs.fields.cover")).toHaveValue("");
  });

  it("przycisk anulowania zamyka dialog bez żądania", () => {
    const { onOpenChange } = renderuj();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.mutations).toHaveLength(0);
  });

  it.fails(
    "BŁĄD: otwarcie NIE czyści wybranego obszaru tematycznego (brak setTopic w reset)",
    () => {
      // Efekt czyszczący pola po otwarciu pomija `setTopic`, więc obszar
      // wybrany przy poprzednim zakładaniu zostaje w formularzu i jedzie do
      // payloadu następnego klubu jako `policy_area`. Pozostałe dwanaście pól
      // jest czyszczone, więc w recenzji ten jeden brak wygląda jak reszta.
      const { przerysuj } = renderuj();
      fireEvent.change(screen.getByLabelText("adminClubs.fields.policyArea"), {
        target: { value: "energy" },
      });
      przerysuj(false);
      przerysuj(true);
      expect(screen.getByLabelText("adminClubs.fields.policyArea")).toHaveValue("");
    },
  );
});

describe("ClubCreateDialog - adres", () => {
  it("adres układa się z nazwy, z polskimi znakami rozłożonymi na ASCII", () => {
    renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Klub Łączności Cyfrowej" } });
    expect(poleAdresu()).toHaveValue("klub-lacznosci-cyfrowej");
  });

  it("ręcznie wpisany adres jest normalizowany i PRZESTAJE podążać za nazwą", () => {
    renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Klub Pierwszy" } });
    fireEvent.change(poleAdresu(), { target: { value: "Mój Własny ADRES!" } });
    expect(poleAdresu()).toHaveValue("moj-wlasny-adres");

    fireEvent.change(poleNazwyPl(), { target: { value: "Zupełnie Inna Nazwa" } });
    expect(poleAdresu()).toHaveValue("moj-wlasny-adres");
  });

  it("o adres krótszy niż trzy znaki pyta się serwera, ale stan zostaje „za krótki”", () => {
    h.available = undefined;
    renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Ab" } });
    expect(screen.queryByLabelText("adminClubs.create.slugFree")).not.toBeInTheDocument();
    expect(screen.getByText("adminClubs.fields.slugHint")).toBeInTheDocument();
  });

  it("sprawdzanie W LOCIE pokazuje znacznik postępu, nie odpowiedź", () => {
    h.isFetching = true;
    renderuj();
    wypelnijPoprawnie();
    expect(screen.getByLabelText("adminClubs.create.slugChecking")).toBeInTheDocument();
    expect(przyciskZapisu()).toBeDisabled();
  });

  it("opóźnienie odpytania też znaczy „sprawdzam” - odpowiedź dotyczy INNEGO adresu", () => {
    h.debounceFrozen = "stary-adres";
    h.available = false;
    renderuj();
    wypelnijPoprawnie();
    expect(screen.getByLabelText("adminClubs.create.slugChecking")).toBeInTheDocument();
  });

  it("adres WOLNY potwierdza się znacznikiem i odblokowuje zapis", () => {
    renderuj();
    wypelnijPoprawnie();
    expect(screen.getByLabelText("adminClubs.create.slugFree")).toBeInTheDocument();
    expect(przyciskZapisu()).toBeEnabled();
    expect(h.slugQueries).toContain("klub-energetyczny");
  });

  it("adres ZAJĘTY pokazuje alarm i BLOKUJE zapis", () => {
    h.available = false;
    renderuj();
    wypelnijPoprawnie();
    expect(screen.getByRole("alert")).toHaveTextContent("adminClubs.create.slugTaken");
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(0);
  });
});

describe("ClubCreateDialog - walidacja", () => {
  it("pusta nazwa nie wysyła żądania, choć adres byłby wolny", () => {
    renderuj();
    fireEvent.change(poleAdresu(), { target: { value: "wolny-adres" } });
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(0);
  });

  it("nazwa o dwóch znakach nie wysyła żądania - klub byłby nieznajdowalny", () => {
    renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Ab" } });
    fireEvent.change(poleAdresu(), { target: { value: "wolny-adres" } });
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(0);
  });

  it("nazwa o trzech znakach z wolnym adresem JUŻ wysyła", () => {
    renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Abc" } });
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(1);
  });
});

describe("ClubCreateDialog - kształt payloadu", () => {
  it("polski interfejs: zajawka do kolumny polskiej, angielska nazwa dziedziczy", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(screen.getByLabelText("adminClubs.fields.taglinePl"), {
      target: { value: "  Energia i klimat  " },
    });
    fireEvent.click(przyciskZapisu());

    expect(h.mutations).toHaveLength(1);
    expect(h.mutations[0].vars).toEqual({
      slug: "klub-energetyczny",
      name_pl: "Klub Energetyczny",
      name_en: "Klub Energetyczny",
      tagline_pl: "Energia i klimat",
      tagline_en: null,
      visibility: "members",
      join_policy: "request",
      attribution_mode: "attributed",
      layout: "list",
      min_tier_rank: 20,
      cover_image_url: null,
      policy_area: null,
      status: "draft",
    });
  });

  it("angielski interfejs zapisuje zajawkę do kolumny ANGIELSKIEJ", () => {
    h.language = "en";
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(screen.getByLabelText("adminClubs.fields.taglinePl"), {
      target: { value: "Energy and climate" },
    });
    fireEvent.click(przyciskZapisu());
    expect(h.mutations[0].vars.tagline_en).toBe("Energy and climate");
    expect(h.mutations[0].vars.tagline_pl).toBeNull();
  });

  it("wszystkie decyzje z formularza dochodzą do payloadu", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.change(poleNazwyEn(), { target: { value: "Energy Club" } });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.visibility"), {
      target: { value: "private" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.joinPolicy"), {
      target: { value: "invite" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.attributionMode"), {
      target: { value: "chatham" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.minTier"), {
      target: { value: "vip" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.policyArea"), {
      target: { value: "energy" },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.fields.cover"), {
      target: { value: " https://example.test/cover.png " },
    });
    fireEvent.click(screen.getByRole("radio", { name: /adminClubs.layout.magazine/ }));
    fireEvent.click(przyciskZapisu());

    expect(h.mutations[0].vars).toMatchObject({
      name_en: "Energy Club",
      visibility: "private",
      join_policy: "invite",
      attribution_mode: "chatham",
      min_tier_rank: 25,
      policy_area: "energy",
      cover_image_url: "https://example.test/cover.png",
      layout: "magazine",
    });
  });

  it("nazwa polska jest zastępczą treścią pola angielskiego, gdy jest wpisana", () => {
    renderuj();
    expect(poleNazwyEn()).toHaveAttribute("placeholder", "");
    wypelnijPoprawnie("Klub Energetyczny");
    expect(poleNazwyEn()).toHaveAttribute("placeholder", "Klub Energetyczny");
  });

  it("wyczyszczony obszar tematyczny jedzie jako null, nie jako pusty napis", () => {
    renderuj();
    wypelnijPoprawnie();
    const obszar = screen.getByLabelText("adminClubs.fields.policyArea");
    fireEvent.change(obszar, { target: { value: "energy" } });
    fireEvent.change(obszar, { target: { value: "" } });
    fireEvent.click(przyciskZapisu());
    expect(h.mutations[0].vars.policy_area).toBeNull();
  });
});

describe("ClubCreateDialog - zapis w locie", () => {
  it("trwający zapis wyłącza przycisk, kontrolki i pokazuje wskaźnik postępu", () => {
    const { przerysuj } = renderuj();
    wypelnijPoprawnie();
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(1);

    h.isPending = true;
    przerysuj(true);

    expect(przyciskZapisu()).toBeDisabled();
    expect(screen.getByLabelText("adminClubs.fields.visibility")).toBeDisabled();
    expect(screen.getByLabelText("adminClubs.fields.policyArea")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /adminClubs.layout.list/ })).toBeDisabled();

    // Drugie kliknięcie nie ma jak wyjść - to jest cała obrona przed dwoma
    // klubami z jednego formularza.
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(1);
  });
});

describe("ClubCreateDialog - odpowiedź serwera", () => {
  it("sukces zamyka dialog, mówi o tym i oddaje identyfikator nowego klubu", () => {
    const { onOpenChange, onCreated } = renderuj();
    wypelnijPoprawnie();
    fireEvent.click(przyciskZapisu());

    act(() => h.mutations[0].wynik.onSuccess(NOWY_KLUB));

    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.create.done");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalledWith(NOWY_KLUB);
  });

  it("odmowa mówi KONKRETNYM kluczem i NIE zamyka dialogu", () => {
    const { onOpenChange, onCreated } = renderuj();
    wypelnijPoprawnie();
    fireEvent.click(przyciskZapisu());

    act(() => h.mutations[0].wynik.onError(new Error("tenant not resolved")));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.tenant_unresolved");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    // Wpisana treść zostaje - czysty ekran byłby karą za odmowę serwera.
    expect(poleNazwyPl()).toHaveValue("Klub Energetyczny");
  });

  it("zajęty adres z ZAPISU dokłada trwały komunikat przy polu i blokuje ponowny zapis", () => {
    // To jest wyścig, nie teoria: sprawdzanie na żywo mówiło „wolny", a między
    // sprawdzeniem a kliknięciem adres zajął ktoś inny. Toast znika po chwili,
    // więc powód musi zostać przy właściwym polu.
    renderuj();
    wypelnijPoprawnie();
    fireEvent.click(przyciskZapisu());

    act(() => h.mutations[0].wynik.onError(new Error("slug already taken")));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.slug_taken");
    expect(screen.getByRole("alert")).toHaveTextContent("adminClubs.create.slugTaken");
    expect(przyciskZapisu()).toBeDisabled();
  });

  it("poprawienie adresu unieważnia ślad kolizji i znów pozwala zapisać", () => {
    renderuj();
    wypelnijPoprawnie();
    fireEvent.click(przyciskZapisu());
    act(() => h.mutations[0].wynik.onError(new Error("slug already taken")));
    expect(przyciskZapisu()).toBeDisabled();

    fireEvent.change(poleAdresu(), { target: { value: "klub-energetyczny-2" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(przyciskZapisu()).toBeEnabled();
    fireEvent.click(przyciskZapisu());
    expect(h.mutations).toHaveLength(2);
    expect(h.mutations[1].vars.slug).toBe("klub-energetyczny-2");
  });
});
