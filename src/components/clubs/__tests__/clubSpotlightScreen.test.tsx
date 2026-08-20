// Pełny ekran "Poznaj członka" (`ClubSpotlightScreen`) razem z formularzem
// przypięcia redakcyjnego.
//
// CO TEN PLIK DOWODZI.
// (1) TRZY WARSTWY MAJĄ TRZECH ADRESATÓW: karta osoby tygodnia (każdy członek),
//     formularz przypięcia (prowadzenie klubu) i archiwum (kto był wcześniej).
//     Formularz jest jedyną drogą zapisu do `club_member_spotlight` poza
//     panelem administracyjnym, którego prowadzący klub NIE widzi - dlatego
//     bramka `canModerate` jest tu regułą produktu, a nie kosmetyką.
// (2) SKĄD WZIĘŁA SIĘ TA OSOBA NA EKRANIE. Rotacja i decyzja redakcji to dwa
//     RÓŻNE fakty i mają dwa różne podpisy; bez tego czytelnik nie wie, czy
//     ktoś ją wybrał.
// (3) PRZYPIĘCIE SKŁADA PAYLOAD, a nie przekazuje pola formularza jeden do
//     jednego: pusty blurb jedzie jako `null` (nie jako pusty ciąg, który
//     przykryłby biogram z profilu), pusta data jedzie jako `null` (RPC
//     wybierze bieżący tydzień), a po sukcesie oba pola tekstowe są czyszczone,
//     bo następne przypięcie dotyczy INNEJ osoby.
// (4) ARCHIWUM ZAWIERA WYŁĄCZNIE PRZYPIĘCIA I NIE DUBLUJE BIEŻĄCEGO TYGODNIA -
//     wiersz `is_current` stoi wyżej w wielkiej karcie.
// (5) ZDJĘCIE PRZYPIĘCIA MA STAĆ TYLKO TAM, GDZIE RPC ODDAŁO `can_manage`;
//     awaria mutacji nie może zniknąć w ciszy.
// (6) STANY DANYCH: odczyt w locie, awaria (komunikat plus ponowienie),
//     klub bez ani jednej osoby do przedstawienia, dane częściowe (bez profilu
//     publicznego, bez stanowiska, bez obszarów, bez blurba).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `spotlightBlurb` i `firstSentences` (kolejność źródeł opisu, cięcie na
//     zdaniach, skróty) - czyste reguły z własnym testem. Tutaj dowodzimy
//     tylko, że ekran ich UŻYWA (blurb redakcyjny wygrywa z biogramem).
// (b) `mondayOf` - reguła tygodnia ma własny test; tu sprawdzamy, że formularz
//     startuje z DATĄ (a nie z pustym polem) i że to, co widać, jedzie do RPC.
// (c) `ClubAuthorAvatar`, `ClubExpertiseChip`, `MessageOrConnectButton` -
//     atomy z własnymi testami; przycisk kontaktu jest tu atrapą.
// (d) Radixowego `Select` - pod happy-dom nie otwiera listy bez pełnego API
//     wskaźnika, więc stoi za niego natywny `<select>` ze wspólnej atrapy
//     `radixSelectStub` (zachowuje `id`, więc etykieta dalej wiąże pole).
//
// DETERMINIZM: zegar zamrożony na `NET_BASE_ISO` (wtorek 18.08.2026), więc
// domyślny tydzień formularza to poniedziałek 17.08.2026 w każdej strefie od
// UTC-11 do UTC+14.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ClubSpotlightHistoryRow, ClubSpotlightRow } from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock(
  "@/lib/clubs/networkApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).networkApiMock,
);
vi.mock("@/lib/clubs/api", async () => (await import("@/test/clubs/apiMock")).clubApiMock);
vi.mock("@/lib/clubs/topicsApi", () => ({
  fetchActiveClubTopics: vi.fn(async () => [
    { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
    { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
  ]),
  fetchAdminClubTopics: vi.fn(),
  upsertClubTopic: vi.fn(),
  setClubTopicActive: vi.fn(),
  deleteClubTopic: vi.fn(),
}));
vi.mock("@/components/network/MessageOrConnectButton", async () =>
  (await import("@/test/clubs/networkScreenStubs")).messageOrConnectStub(),
);

import { ClubSpotlightScreen } from "@/components/clubs/organisms/ClubSpotlightScreen";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import { clubMemberRow } from "@/test/clubs/fixtures";
import {
  NET_BASE_ISO,
  NET_IDS,
  spotlightHistoryRow,
  spotlightRow,
} from "@/test/clubs/networkScreenFixtures";

function nigdy(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function given(
  current: ClubSpotlightRow | null,
  history: readonly ClubSpotlightHistoryRow[] = [],
): void {
  networkApiMock.fetchClubSpotlight.mockResolvedValue(current);
  networkApiMock.fetchClubSpotlightHistory.mockResolvedValue([...history]);
}

function renderSpotlight(canModerate = false) {
  return renderWithQueryClient(
    <ClubSpotlightScreen clubId={NET_IDS.club} canModerate={canModerate} />,
  );
}

beforeEach(() => {
  cleanup();
  resetNetworkApiMock();
  resetClubApiMock();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  clubApiMock.fetchClubMembers.mockResolvedValue({
    rows: [
      clubMemberRow({ user_id: NET_IDS.member, display_name: "Anna Nowak" }),
      clubMemberRow({ user_id: NET_IDS.otherMember, display_name: "Jan Kowalski" }),
    ],
    total: 2,
  });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NET_BASE_ISO) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ClubSpotlightScreen - stany odczytu", () => {
  it("odczyt w locie pokazuje szkielet karty, a nie pusty klub", () => {
    networkApiMock.fetchClubSpotlight.mockImplementation(nigdy);
    networkApiMock.fetchClubSpotlightHistory.mockResolvedValue([]);
    renderSpotlight();

    expect(screen.getByRole("generic", { busy: true })).toBeInTheDocument();
    expect(screen.queryByText("club.network.spotlight.emptyClub")).not.toBeInTheDocument();
  });

  it("awaria odczytu zabiera CAŁY ekran na komunikat i ponowienie", async () => {
    networkApiMock.fetchClubSpotlight.mockRejectedValue(new Error("42501"));
    networkApiMock.fetchClubSpotlightHistory.mockResolvedValue([]);
    renderSpotlight(true);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    expect(screen.queryByText("club.network.spotlight.emptyClub")).not.toBeInTheDocument();
    // Awaria bieżącego tygodnia nie może zostawić na ekranie formularza
    // przypięcia ani archiwum - to byłby ekran udający, że wszystko działa.
    expect(screen.queryByText("club.network.spotlight.pinTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("club.network.spotlight.archive")).not.toBeInTheDocument();

    const przed = networkApiMock.fetchClubSpotlight.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /club\.error\.retry/ }));
    await waitFor(() =>
      expect(networkApiMock.fetchClubSpotlight.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("klub bez ani jednej osoby do przedstawienia mówi to wprost, a archiwum zostaje", async () => {
    given(null, []);
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.emptyClub")).toBeInTheDocument(),
    );
    expect(screen.getByText("club.network.spotlight.archive")).toBeInTheDocument();
    expect(screen.getByText("club.network.spotlight.archiveEmpty")).toBeInTheDocument();
  });
});

describe("ClubSpotlightScreen - osoba tygodnia", () => {
  it("przypięcie redakcyjne jest podpisane jako decyzja, nie jako rotacja", async () => {
    given(spotlightRow({ curated: true }));
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.sourceCurated")).toBeInTheDocument(),
    );
    expect(screen.getByText("club.network.spotlight.thisWeek")).toBeInTheDocument();
    expect(screen.queryByText("club.network.spotlight.sourceRotation")).not.toBeInTheDocument();
  });

  it("osoba z rotacji jest podpisana jako rotacja", async () => {
    given(spotlightRow({ curated: false }));
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.sourceRotation")).toBeInTheDocument(),
    );
  });

  it("karta niesie nazwisko z linkiem do profilu, stanowisko, blurb i obszary", async () => {
    given(spotlightRow());
    renderSpotlight();

    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: /Anna Nowak|openProfile/ }).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(
      screen.getByRole("link", { name: "club.network.spotlight.openProfile" }),
    ).toHaveAttribute("href", "/author/anna-nowak");
    expect(screen.getByText("Analityk - NES")).toBeInTheDocument();
    // Blurb redakcyjny WYGRYWA z biogramem z profilu - to jest teza modułu.
    expect(
      screen.getByText("Trzy zdania redakcji o Annie. Zna rynek gazu. Pisze o bilansowaniu."),
    ).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByTestId("kontakt")).toHaveAttribute("data-user-id", NET_IDS.member);
  });

  it("osoba bez profilu publicznego dostaje nagłówek, nie link, i nie dostaje przycisku profilu", async () => {
    given(spotlightRow({ profile_slug: null, headline: null, topics: [], blurb_pl: null }));
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Anna Nowak" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Anna Nowak" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "club.network.spotlight.openProfile" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Analityk - NES")).not.toBeInTheDocument();
    expect(screen.queryByText("Energetyka")).not.toBeInTheDocument();
    // Bez blurba redakcyjnego opis spada na biogram z profilu - moduł nie
    // pokazuje pustego akapitu.
    expect(
      screen.getByText(/Pracuje nad rynkiem energii\. Doradzała m\.in\. MKiŚ\./),
    ).toBeInTheDocument();
  });
});

describe("ClubSpotlightScreen - archiwum", () => {
  it("nie dubluje bieżącego tygodnia i pokazuje tydzień, stanowisko oraz blurb", async () => {
    given(spotlightRow(), [
      spotlightHistoryRow({ id: "spot-biezacy", is_current: true, display_name: "Anna Nowak" }),
      spotlightHistoryRow({ id: "spot-stary", display_name: "Jan Kowalski" }),
    ]);
    renderSpotlight();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getByRole("link", { name: "Jan Kowalski" })).toHaveAttribute(
      "href",
      "/author/jan-kowalski",
    );
    expect(within(row).getByText(/club\.network\.spotlight\.weekOf/)).toBeInTheDocument();
    expect(within(row).getByText("Dyrektor - MSZ")).toBeInTheDocument();
    expect(within(row).getByText("Prowadził negocjacje pakietu.")).toBeInTheDocument();
    expect(screen.queryByText("club.network.spotlight.archiveEmpty")).not.toBeInTheDocument();
  });

  it("wiersz bez profilu, stanowiska i blurba nie zostawia pustych akapitów", async () => {
    given(spotlightRow(), [
      spotlightHistoryRow({
        profile_slug: null,
        headline: null,
        blurb_pl: "   ",
        blurb_en: null,
      }),
    ]);
    renderSpotlight();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getByText("Jan Kowalski")).toBeInTheDocument();
    expect(within(row).queryByText("Dyrektor - MSZ")).not.toBeInTheDocument();
    expect(within(row).queryByText("Prowadził negocjacje pakietu.")).not.toBeInTheDocument();
  });

  it("archiwum z samym bieżącym tygodniem jest PUSTE i mówi o tym", async () => {
    given(spotlightRow(), [spotlightHistoryRow({ is_current: true })]);
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.archiveEmpty")).toBeInTheDocument(),
    );
    expect(screen.getByText("club.network.spotlight.archiveHint")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("bez `can_manage` nie ma przycisku zdjęcia przypięcia", async () => {
    given(spotlightRow(), [spotlightHistoryRow({ can_manage: false })]);
    renderSpotlight(true);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(
      screen.queryByRole("button", { name: "club.network.spotlight.unpin" }),
    ).not.toBeInTheDocument();
  });

  it("zdjęcie przypięcia woła warstwę danych z ID TEGO wiersza i potwierdza", async () => {
    given(spotlightRow(), [spotlightHistoryRow({ can_manage: true })]);
    networkApiMock.deleteClubSpotlight.mockResolvedValue(true);
    renderSpotlight(true);

    const unpin = await waitFor(() =>
      screen.getByRole("button", { name: "club.network.spotlight.unpin" }),
    );
    fireEvent.click(unpin);

    await waitFor(() =>
      expect(networkApiMock.deleteClubSpotlight.mock.calls[0]?.[0]).toBe(NET_IDS.spotlight),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("club.network.spotlight.unpinned"),
    );
  });

  it("awaria zdjęcia przypięcia nie znika w ciszy", async () => {
    given(spotlightRow(), [spotlightHistoryRow({ can_manage: true })]);
    networkApiMock.deleteClubSpotlight.mockRejectedValue(new Error("42501"));
    renderSpotlight(true);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "club.network.spotlight.unpin" })),
    );

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.spotlight.pinFailed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  // DEFEKT PRODUKTU, nie luka testu. Ekran obsługuje `isError` bieżącego
  // tygodnia, ale archiwum czyta `historyQ.data ?? []` i nie patrzy na awarię -
  // padnięte `club_member_spotlight_history` renderuje się DOKŁADNIE tak, jak
  // brak przypięć ("archiwum jest puste"). To jest ta sama klasa błędu, dla
  // której powstał `ClubErrorNotice` (patrz nagłówek tego komponentu): błąd
  // odczytu podany jako brak treści prowadzi redakcję do wniosku, że dane
  // zginęły. Test opisuje stan POŻĄDANY i dlatego jest oznaczony `it.fails`.
  it.fails("awaria archiwum powinna być odróżniona od pustego archiwum", async () => {
    networkApiMock.fetchClubSpotlight.mockResolvedValue(spotlightRow());
    networkApiMock.fetchClubSpotlightHistory.mockRejectedValue(new Error("42501"));
    renderSpotlight();

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.archiveEmpty")).toBeInTheDocument(),
    );
    expect(screen.getByText("club.error.title")).toBeInTheDocument();
  });
});

describe("ClubSpotlightScreen - formularz przypięcia", () => {
  it("bez prawa moderacji formularza nie ma", async () => {
    given(spotlightRow());
    renderSpotlight(false);

    await waitFor(() =>
      expect(screen.getByText("club.network.spotlight.thisWeek")).toBeInTheDocument(),
    );
    expect(screen.queryByText("club.network.spotlight.pinTitle")).not.toBeInTheDocument();
    expect(clubApiMock.fetchClubMembers).not.toHaveBeenCalled();
  });

  it("startuje z poniedziałkiem bieżącego tygodnia i pełną listą składu", async () => {
    given(spotlightRow());
    renderSpotlight(true);

    await waitFor(() => expect(clubApiMock.fetchClubMembers).toHaveBeenCalled());
    expect(screen.getByLabelText("club.network.spotlight.week")).toHaveValue("2026-08-17");
    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    const options = within(screen.getByLabelText("club.network.spotlight.member")).getAllByRole(
      "option",
    );
    expect(options.map((option) => option.textContent)).toEqual(["Anna Nowak", "Jan Kowalski"]);
  });

  it("droplista składu jest zablokowana, dopóki skład się nie wczytał", async () => {
    given(spotlightRow());
    clubApiMock.fetchClubMembers.mockImplementation(nigdy);
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "club.network.spotlight.pin" })).toBeDisabled();
  });

  it("bez wybranej osoby nie ma czego przypiąć - przycisk jest zablokowany", async () => {
    given(spotlightRow());
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "club.network.spotlight.pin" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("club.network.spotlight.member"), {
      target: { value: NET_IDS.member },
    });

    expect(screen.getByRole("button", { name: "club.network.spotlight.pin" })).toBeEnabled();
  });

  it("składa payload z osoby, tygodnia i obu blurbów, a po sukcesie czyści opisy", async () => {
    given(spotlightRow());
    networkApiMock.pinClubSpotlight.mockResolvedValue("spot-nowy");
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("club.network.spotlight.member"), {
      target: { value: NET_IDS.otherMember },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.week"), {
      target: { value: "2026-08-24" },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.blurbPl"), {
      target: { value: "  Trzy zdania o Janie.  " },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.blurbEn"), {
      target: { value: "Three sentences about Jan." },
    });

    fireEvent.click(screen.getByRole("button", { name: "club.network.spotlight.pin" }));

    await waitFor(() =>
      expect(networkApiMock.pinClubSpotlight).toHaveBeenCalledWith(NET_IDS.club, {
        userId: NET_IDS.otherMember,
        weekStart: "2026-08-24",
        blurbPl: "Trzy zdania o Janie.",
        blurbEn: "Three sentences about Jan.",
      }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("club.network.spotlight.pinned"),
    );
    // Następne przypięcie dotyczy INNEJ osoby - opisy nie mogą zostać.
    expect(screen.getByLabelText("club.network.spotlight.blurbPl")).toHaveValue("");
    expect(screen.getByLabelText("club.network.spotlight.blurbEn")).toHaveValue("");
  });

  it("puste opisy i pusta data jadą jako `null`, a nie jako pusty ciąg", async () => {
    given(spotlightRow());
    networkApiMock.pinClubSpotlight.mockResolvedValue("spot-nowy");
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("club.network.spotlight.member"), {
      target: { value: NET_IDS.member },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.week"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.blurbPl"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: "club.network.spotlight.pin" }));

    await waitFor(() =>
      expect(networkApiMock.pinClubSpotlight).toHaveBeenCalledWith(NET_IDS.club, {
        userId: NET_IDS.member,
        weekStart: null,
        blurbPl: null,
        blurbEn: null,
      }),
    );
  });

  it("w trakcie zapisu przycisk jest zablokowany i pokazuje, że coś się dzieje", async () => {
    given(spotlightRow());
    networkApiMock.pinClubSpotlight.mockImplementation(nigdy);
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("club.network.spotlight.member"), {
      target: { value: NET_IDS.member },
    });
    fireEvent.click(screen.getByRole("button", { name: "club.network.spotlight.pin" }));

    await waitFor(() => {
      const pin = screen.getByRole("button", { name: "club.network.spotlight.pin" });
      expect(pin).toBeDisabled();
      expect(pin.querySelector(".animate-spin")).not.toBeNull();
    });
  });

  it("awaria przypięcia nie znika w ciszy i nie czyści opisów", async () => {
    given(spotlightRow());
    networkApiMock.pinClubSpotlight.mockRejectedValue(new Error("23505"));
    renderSpotlight(true);

    await waitFor(() =>
      expect(screen.getByLabelText("club.network.spotlight.member")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("club.network.spotlight.member"), {
      target: { value: NET_IDS.member },
    });
    fireEvent.change(screen.getByLabelText("club.network.spotlight.blurbPl"), {
      target: { value: "Opis do poprawy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "club.network.spotlight.pin" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.spotlight.pinFailed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText("club.network.spotlight.blurbPl")).toHaveValue("Opis do poprawy.");
  });
});
