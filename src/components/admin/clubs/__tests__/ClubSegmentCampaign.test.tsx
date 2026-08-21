// Kampania segmentowa - SKLEJENIE reguły, podglądu i nieodwracalnej wysyłki.
//
// CO TEN PLIK DOWODZI.
//   1. PUSTY SEGMENT NIE POZWALA WYSŁAĆ: niedokończona reguła NIE pyta bazy
//      o podgląd (`enabled: false`), mówi o sobie zdaniem ze słownika, a przycisk
//      jest nieaktywny. Reguła bez wartości rozwiązuje się w bazie na zbiór
//      pusty, więc „wysłano 0 zaproszeń” byłoby raportem sukcesu z niczego.
//   2. PODGLĄD ZERA ODBIORCÓW BLOKUJE WYSYŁKĘ - tak samo jak podgląd W LOCIE
//      i AWARIA podglądu. Cztery liczby są warunkiem wstępnym, nie ozdobą.
//   3. POTWIERDZENIEM NIEODWRACALNEJ OPERACJI JEST LICZBA: dopóki zasięg nie
//      jest policzony, etykieta przycisku NIE obiecuje liczby; po policzeniu
//      mówi dokładnie, ile zaproszeń pójdzie. Wysyłka jest możliwa WYŁĄCZNIE
//      z tego stanu, więc administrator nie ma jak wysłać kampanii, której
//      zasięgu nie zobaczył.
//   4. CO IDZIE DO MUTACJI: reguła w postaci właściwej dla rodzaju, rola
//      z droplisty, wiadomość przycięta (pusta jako `null`) i `saveRule`, bo
//      kampanię ma się dać powtórzyć. Asercja jest na OBIEKCIE przekazanym
//      do `mutate`.
//   5. KOTWICA ZNIKA PRZY ZMIANIE RODZAJU. `policy_follow` i `event_rsvp` dzielą
//      jedno pole, ale to DWA różne typy encji - identyfikator aktu prawnego
//      wysłany jako wydarzenie daje zbiór pusty.
//   6. LISTA „INNEGO KLUBU” NIE ZAWIERA KLUBU KAMPANII, a nazwy klubów jadą
//      w języku interfejsu.
//   7. TRWAJĄCA WYSYŁKA ZAMYKA CAŁY FORMULARZ (rodzaj, wartość reguły, rola,
//      wiadomość, przycisk) - kampania nie ma pójść dwa razy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Budowy segmentu, bramki wysyłki i pięciu
// stanów podglądu - tabele przypadków są w `lib/clubs/__tests__/adminSegment.test.ts`;
// tutaj dowodzimy, że organizm ich UŻYWA i co robi z wynikiem. (2) Molekuły
// czterech liczb (`ClubCatalogSegmentPreview`) i droplisty słownikowej
// (`ClubEnumSelect`) - mają własne pliki, tu są atrapami. (3) Wyszukiwarki
// kotwicy (`ClubAnchorPicker`) - to inna powierzchnia, tu jest atrapą-markerem,
// bo przedmiotem dowodu jest, CO organizm z niej bierze. (4) Samych hooków
// (`useClubSegmentPreview`, `useInviteClubSegment`) - są zamockowane na poziomie
// MODUŁU.
//
// Radix Select nie działa pod happy-dom bez pełnego pointer API - jest
// podmieniony na natywny odpowiednik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubAnchorValue } from "@/components/clubs/molecules/ClubAnchorPicker";
import type { AdminClubRow, ClubAnchorType, ClubSegmentPreview } from "@/lib/clubs/types";
import type { ClubSegmentSendVars } from "@/lib/clubs/adminSegment";

interface Wynik {
  onSuccess: (invited: number) => void;
  onError: (error: Error) => void;
}

interface PodgladArgs {
  clubId: string | undefined;
  rule: Record<string, unknown>;
  enabled: boolean;
}

const h = vi.hoisted(() => ({
  language: "pl",
  clubs: undefined as { rows: AdminClubRow[]; total: number } | undefined,
  clubsPending: false,
  previewArgs: [] as PodgladArgs[],
  preview: undefined as ClubSegmentPreview | undefined,
  previewPending: false,
  previewError: false,
  sendVars: [] as ClubSegmentSendVars[],
  sendPending: false,
  sendFails: false,
  invited: 30,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
// Droplista słownikowa ma własny plik testowy; atrapa jest natywna
// i ETYKIETOWANA, bo przedmiotem dowodu jest to, KTÓRA decyzja dochodzi do reguły.
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: ({
    id,
    label,
    value,
    options,
    i18nPrefix,
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
    </div>
  ),
}));
// Wyszukiwarka kotwicy należy do innej powierzchni - tutaj jest markerem, który
// pokazuje, JAKI typ encji i jaką etykietę dostała, i pozwala wybrać kotwicę.
vi.mock("@/components/clubs/molecules/ClubAnchorPicker", () => ({
  ClubAnchorPicker: ({
    value,
    onChange,
    disabled,
    anchorType,
    fieldLabel,
  }: {
    value: ClubAnchorValue | null;
    onChange: (value: ClubAnchorValue | null) => void;
    disabled?: boolean;
    anchorType?: ClubAnchorType | null;
    fieldLabel?: string;
  }) => (
    <div
      data-testid="kotwica"
      data-typ={anchorType ?? ""}
      data-wartosc={value === null ? "" : value.anchorId}
    >
      <span>{fieldLabel}</span>
      <button
        type="button"
        data-testid="kotwica-wybierz"
        disabled={disabled}
        onClick={() =>
          onChange({
            anchorType: anchorType ?? "eu_policy_item",
            anchorId: `${anchorType ?? "brak"}-1`,
            label: "Wybrana kotwica",
          })
        }
      />
    </div>
  ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useAdminClubs: () => ({ data: h.clubs, isPending: h.clubsPending }),
  useClubSegmentPreview: (args: PodgladArgs) => {
    h.previewArgs.push(args);
    return {
      data: h.preview,
      isPending: h.previewPending,
      isError: h.previewError,
    };
  },
  useInviteClubSegment: () => ({
    mutate: (vars: ClubSegmentSendVars, wynik: Wynik) => {
      h.sendVars.push(vars);
      if (h.sendFails) wynik.onError(new Error("nie poszło"));
      else wynik.onSuccess(h.invited);
    },
    isPending: h.sendPending,
  }),
}));

import { ClubSegmentCampaign } from "@/components/admin/clubs/organisms/ClubSegmentCampaign";
import { CLUB_IDS, adminClubRow } from "@/test/clubs/fixtures";

function kampania() {
  return render(<ClubSegmentCampaign clubId={CLUB_IDS.club} />);
}

function podglądZasięgu(overrides: Partial<ClubSegmentPreview> = {}): ClubSegmentPreview {
  return { matched: 40, already_member: 6, blocked: 4, will_send: 30, ...overrides };
}

function rodzaj(): HTMLElement {
  return screen.getByLabelText("adminClubs.segment.kindLabel");
}

function rola(): HTMLElement {
  return screen.getByLabelText("adminClubs.columns.role");
}

function wiadomość(): HTMLElement {
  return screen.getByLabelText("adminClubs.invitations.messageLabel");
}

/**
 * Droplista pod atrapą Radixa. `id` mieszka na wyzwalaczu (`SelectTrigger`),
 * którego atrapa nie renderuje jako pola, więc powiązanie etykiety z polem
 * sprawdzamy osobno - samą etykietą - a pole bierzemy po znaczniku testowym.
 */
function listaKlubów(): HTMLElement {
  return screen.getByTestId("select");
}

function przyciskWysyłki(): HTMLElement {
  const przyciski = screen
    .getAllByRole("button")
    .filter((element) => element.textContent?.includes("adminClubs.segment.send") === true);
  if (przyciski.length !== 1) throw new Error("przycisk wysyłki nie jest jeden");
  return przyciski[0];
}

/** Ostatnie argumenty, z jakimi organizm poprosił bazę o podgląd. */
function ostatniPodgląd(): PodgladArgs {
  const last = h.previewArgs.at(-1);
  if (last === undefined) throw new Error("organizm nie zapytał o podgląd");
  return last;
}

function ustawRodzaj(kind: string): void {
  fireEvent.change(rodzaj(), { target: { value: kind } });
}

beforeEach(() => {
  h.language = "pl";
  h.clubs = {
    rows: [
      adminClubRow({ id: CLUB_IDS.club, name_pl: "Klub kampanii", name_en: "Campaign club" }),
      adminClubRow({ id: "inny-1", name_pl: "Klub energetyczny", name_en: "Energy club" }),
    ],
    total: 2,
  };
  h.clubsPending = false;
  h.previewArgs = [];
  h.preview = podglądZasięgu();
  h.previewPending = false;
  h.previewError = false;
  h.sendVars = [];
  h.sendPending = false;
  h.sendFails = false;
  h.invited = 30;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("segment domyślny: odznaka profilu", () => {
  it("startuje od PIERWSZEJ odznaki i od razu pyta bazę o zasięg", () => {
    kampania();

    expect(ostatniPodgląd()).toEqual({
      clubId: CLUB_IDS.club,
      rule: { kind: "badge", badge: "verified" },
      enabled: true,
    });
  });

  it("pokazuje CZTERY liczby podglądu, a przycisk obiecuje dokładną liczbę", () => {
    const { container } = kampania();

    expect(container.querySelectorAll("[data-preview-cell]")).toHaveLength(4);
    expect(screen.getByText("adminClubs.segment.matched")).toBeTruthy();
    expect(screen.getByText("adminClubs.segment.willSend")).toBeTruthy();
    expect(przyciskWysyłki().textContent).toContain("adminClubs.segment.sendCount(count=30)");
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(false);
  });

  it("zmiana odznaki przebudowuje regułę", () => {
    kampania();

    fireEvent.change(screen.getByTestId("select"), { target: { value: "expert" } });

    expect(ostatniPodgląd().rule).toEqual({ kind: "badge", badge: "expert" });
  });

  it("etykiety odznak jadą w języku interfejsu", () => {
    h.language = "en";
    kampania();

    expect(within(screen.getByTestId("select")).getByText("Verified")).toBeTruthy();
  });
});

describe("pusty segment nie pozwala wysłać", () => {
  it("niedokończona reguła NIE pyta bazy, mówi o sobie i blokuje przycisk", () => {
    kampania();

    ustawRodzaj("specialization");

    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "specialization", value: "" },
      enabled: false,
    });
    expect(screen.getByText("adminClubs.segment.incomplete")).toBeTruthy();
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
  });

  it("kliknięcie zablokowanego przycisku NIE woła mutacji", () => {
    kampania();
    ustawRodzaj("specialization");

    fireEvent.click(przyciskWysyłki());

    expect(h.sendVars).toEqual([]);
  });

  it("wpisana specjalizacja domyka regułę i jedzie PRZYCIĘTA", () => {
    kampania();
    ustawRodzaj("specialization");

    fireEvent.change(screen.getByLabelText("adminClubs.segment.specLabel"), {
      target: { value: "  energetyka  " },
    });

    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "specialization", value: "energetyka" },
      enabled: true,
    });
    expect(screen.getByText("adminClubs.segment.specHint")).toBeTruthy();
  });
});

describe("podgląd jest warunkiem wstępnym wysyłki", () => {
  it("ZERO odbiorców blokuje wysyłkę, a przycisk przestaje obiecywać liczbę", () => {
    h.preview = podglądZasięgu({ matched: 12, already_member: 12, blocked: 0, will_send: 0 });
    kampania();

    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
    expect(przyciskWysyłki().textContent).toContain("adminClubs.segment.send");
    expect(przyciskWysyłki().textContent).not.toContain("count=");

    fireEvent.click(przyciskWysyłki());
    expect(h.sendVars).toEqual([]);
  });

  it("podgląd W LOCIE pokazuje szkielet i blokuje wysyłkę", () => {
    h.preview = undefined;
    h.previewPending = true;
    const { container } = kampania();

    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(container.querySelectorAll("[data-preview-cell]")).toHaveLength(0);
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
  });

  it("AWARIA podglądu mówi to wprost i blokuje wysyłkę", () => {
    h.preview = undefined;
    h.previewError = true;
    h.previewPending = true;
    kampania();

    expect(screen.getByText("adminClubs.segment.previewFailed")).toBeTruthy();
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
  });

  it("cisza po zapytaniu (brak danych, nic się nie liczy) nie rysuje ani liczb, ani szkieletu", () => {
    h.preview = undefined;
    h.previewPending = false;
    const { container } = kampania();

    expect(container.querySelectorAll("[data-preview-cell]")).toHaveLength(0);
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
    expect(screen.queryByText("adminClubs.segment.incomplete")).toBeNull();
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
  });
});

describe("wysyłka jest operacją NIEODWRACALNĄ", () => {
  it("jedzie z regułą, rolą, wiadomością i zapisem kampanii", () => {
    kampania();

    fireEvent.change(rola(), { target: { value: "moderator" } });
    fireEvent.change(wiadomość(), { target: { value: "  Zapraszamy do klubu  " } });
    fireEvent.click(przyciskWysyłki());

    expect(h.sendVars).toEqual([
      {
        rule: { kind: "badge", badge: "verified" },
        role: "moderator",
        message: "Zapraszamy do klubu",
        saveRule: true,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.segment.sent(count=30)");
  });

  it("puste okienko wiadomości jedzie jako `null`, a po sukcesie pole jest czyste", () => {
    kampania();

    fireEvent.change(wiadomość(), { target: { value: "   " } });
    fireEvent.click(przyciskWysyłki());

    expect(h.sendVars[0].message).toBeNull();
    expect((wiadomość() as HTMLTextAreaElement).value).toBe("");
  });

  it("AWARIA wysyłki mówi jednym zdaniem i NIE czyści wiadomości", () => {
    h.sendFails = true;
    kampania();

    fireEvent.change(wiadomość(), { target: { value: "Treść zaproszenia" } });
    fireEvent.click(przyciskWysyłki());

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.segment.failed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect((wiadomość() as HTMLTextAreaElement).value).toBe("Treść zaproszenia");
  });

  it("TRWAJĄCA wysyłka zamyka cały formularz", () => {
    h.sendPending = true;
    kampania();

    expect(rodzaj().hasAttribute("disabled")).toBe(true);
    expect(rola().hasAttribute("disabled")).toBe(true);
    expect(wiadomość().hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("select").hasAttribute("disabled")).toBe(true);
    expect(przyciskWysyłki().hasAttribute("disabled")).toBe(true);
  });
});

describe("segment: członkowie innego klubu", () => {
  it("lista NIE zawiera klubu kampanii, a nazwy są w języku interfejsu", () => {
    kampania();
    ustawRodzaj("other_club");

    const lista = listaKlubów();
    expect(screen.getByText("adminClubs.segment.clubLabel")).toBeTruthy();
    expect(within(lista).queryByText("Klub kampanii")).toBeNull();
    expect(within(lista).getByText("Klub energetyczny")).toBeTruthy();
  });

  it("nazwy klubów schodzą na kolumnę angielską przy angielskim interfejsie", () => {
    h.language = "en";
    kampania();
    ustawRodzaj("other_club");

    expect(within(listaKlubów()).getByText("Energy club")).toBeTruthy();
  });

  it("wybrany klub domyka regułę", () => {
    kampania();
    ustawRodzaj("other_club");

    fireEvent.change(listaKlubów(), { target: { value: "inny-1" } });

    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "other_club", club_id: "inny-1" },
      enabled: true,
    });
  });

  it("lista klubów W LOCIE jest zablokowana i pusta, ale nie rzuca", () => {
    h.clubs = undefined;
    h.clubsPending = true;
    kampania();
    ustawRodzaj("other_club");

    const lista = listaKlubów();
    expect(lista.hasAttribute("disabled")).toBe(true);
    expect(within(lista).queryByText("Klub energetyczny")).toBeNull();
  });
});

describe("segment: kotwica dwóch rodzajów", () => {
  it("akt prawny dostaje TYP encji i własną etykietę", () => {
    kampania();
    ustawRodzaj("policy_follow");

    const kotwica = screen.getByTestId("kotwica");
    expect(kotwica.getAttribute("data-typ")).toBe("eu_policy_item");
    expect(screen.getByText("adminClubs.segment.policyLabel")).toBeTruthy();
    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "policy_follow", item_id: "" },
      enabled: false,
    });
  });

  it("wybrana kotwica domyka regułę aktu prawnego", () => {
    kampania();
    ustawRodzaj("policy_follow");

    fireEvent.click(screen.getByTestId("kotwica-wybierz"));

    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "policy_follow", item_id: "eu_policy_item-1" },
      enabled: true,
    });
  });

  it("ZMIANA RODZAJU CZYŚCI KOTWICĘ - to dwa różne typy encji", () => {
    kampania();
    ustawRodzaj("policy_follow");
    fireEvent.click(screen.getByTestId("kotwica-wybierz"));

    ustawRodzaj("event_rsvp");

    const kotwica = screen.getByTestId("kotwica");
    expect(kotwica.getAttribute("data-typ")).toBe("event");
    expect(kotwica.getAttribute("data-wartosc")).toBe("");
    expect(screen.getByText("adminClubs.segment.eventLabel")).toBeTruthy();
    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "event_rsvp", event_id: "" },
      enabled: false,
    });
  });

  it("wydarzenie jedzie pod WŁASNYM kluczem reguły", () => {
    kampania();
    ustawRodzaj("event_rsvp");

    fireEvent.click(screen.getByTestId("kotwica-wybierz"));

    expect(ostatniPodgląd()).toMatchObject({
      rule: { kind: "event_rsvp", event_id: "event-1" },
      enabled: true,
    });
  });

  it("trwająca wysyłka blokuje także wybór kotwicy", () => {
    h.sendPending = true;
    kampania();
    ustawRodzaj("policy_follow");

    expect(screen.getByTestId("kotwica-wybierz").hasAttribute("disabled")).toBe(true);
  });
});
