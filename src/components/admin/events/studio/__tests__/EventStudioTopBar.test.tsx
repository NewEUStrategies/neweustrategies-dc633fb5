// GORNY PASEK STUDIA WYDARZENIA - jedyne miejsce, z ktorego redaktor zmienia
// STAN wydarzenia dla uczestnikow.
//
// PO CO TEN PLIK ISTNIEJE. Pasek startowal z 0% i wyglada na warstwe czysto
// wizualna, a trzyma trzy rzeczy, ktorych zepsucie NIE WYWRACA zadnego ekranu:
//   1. PUBLIKACJA JEST NIEODWRACALNA Z PUNKTU WIDZENIA UCZESTNIKA. Zgubiony
//      `disabled` na tym jednym przycisku otwiera wydarzenie na swiat w chwili,
//      w ktorej wiersza jeszcze nie ma w bazie (kreator) albo trwa poprzedni
//      zapis. Ekran po takim kliknieciu wyglada identycznie - roznica jest
//      wylacznie w tym, kto widzi wydarzenie.
//   2. CHIP STANU JEST PRZELACZNIKIEM, NIE PLAKIETKA. Odwolanie wydarzenia
//      i cofniecie go do szkicu to jedyna droga do tych dwoch stanow; chip,
//      ktory przestaje otwierac menu, zabiera je bez sladu w interfejsie.
//      W trybie kreatora jest odwrotnie: kontrolka, ktora WYGLADA na klikalna,
//      a nie moze nic zmienic, klamie samym swoim wygladem.
//   3. ETYKIETA PODGLADU JEST KONTEKSTOWA. Na kreatorze formularza przycisk
//      otwiera formularz zgloszenia, a nie strone wydarzenia - napis „Podglad
//      wydarzenia" obiecywalby tam cos, czego redaktor nie zobaczy, i kazalby
//      mu wracac po to, zeby sprawdzic, czy formularz w ogole sie zapisal.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Ramy studia - `EventStudioShell.test.tsx`
// dowodzi, KIEDY rama podaje `isBusy` i co robi z `onStatusChange`; tutaj pasek
// dostaje te wartosci wprost. (2) Zawartosci przelacznika motywu - ma wlasny
// plik; tu stoi atrapa zrodla stanu motywu, bo przedmiotem dowodu jest to, ze
// przelacznik w pasku SIEGA po to samo zrodlo, co strona publiczna.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { EventStudioTopBar } from "@/components/admin/events/studio/EventStudioTopBar";
import type { EventStatus } from "@/lib/events/eventDetailApi";
import type { EventStudioSection } from "@/lib/events/eventStudioNav";

const h = vi.hoisted(() => ({
  /** Przelaczenia motywu zamowione przez pasek - patrz test o jednym zrodle. */
  przelaczMotyw: vi.fn<() => void>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Motyw jest stanem CALEJ aplikacji (klasa na `<html>`), wiec w tescie
// komponentu stoi za nim atrapa - inaczej test mierzylby `localStorage`.
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", toggle: h.przelaczMotyw, setTheme: () => undefined }),
}));

const PUBLIKUJ = "adminEvents.studio.topBar.publish";
const PODGLAD = "adminEvents.studio.topBar.preview";
const PODGLAD_FORMULARZA = "adminEvents.studio.topBar.previewForm";
const SZKIC = "adminEvents.list.status.draft";
const OPUBLIKOWANE = "adminEvents.list.status.published";
const ODWOLANE = "adminEvents.list.status.cancelled";

interface Nadpisania {
  status?: EventStatus;
  isBusy?: boolean;
  previewOpen?: boolean;
  createMode?: boolean;
  section?: EventStudioSection | null;
}

function pasek(nadpisania: Nadpisania = {}) {
  const onStatusChange = vi.fn<(status: EventStatus) => void>();
  const onTogglePreview = vi.fn<() => void>();
  const { container } = render(
    <EventStudioTopBar
      status={nadpisania.status ?? "draft"}
      isBusy={nadpisania.isBusy ?? false}
      previewOpen={nadpisania.previewOpen ?? false}
      onTogglePreview={onTogglePreview}
      onStatusChange={onStatusChange}
      createMode={nadpisania.createMode ?? false}
      section={nadpisania.section ?? null}
    />,
  );
  return { onStatusChange, onTogglePreview, container };
}

/** Otwiera menu stanu i oddaje jego zawartosc (Radix rysuje ja w portalu). */
function otworzMenuStanu(etykietaChipa: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: etykietaChipa }));
  return screen.getByRole("dialog");
}

afterEach(() => {
  cleanup();
  h.przelaczMotyw.mockClear();
});

describe("EventStudioTopBar - publikacja", () => {
  it("publikuje szkic jednym kliknieciem i nie zgaduje stanu docelowego", () => {
    const { onStatusChange } = pasek({ status: "draft" });

    fireEvent.click(screen.getByRole("button", { name: PUBLIKUJ }));

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("published");
  });

  it("w trybie kreatora publikacja ZOSTAJE na pasku, ale jest nieczynna", () => {
    // Wydarzenia jeszcze nie ma w bazie, wiec nie ma czego opublikowac.
    // Znikajaca akcja kazalaby szukac jej od nowa po zapisie szkicu - dlatego
    // pasek nie zmienia SKLADU, tylko dostepnosc.
    const { onStatusChange } = pasek({ createMode: true });

    const przycisk = screen.getByRole("button", { name: PUBLIKUJ });
    expect(przycisk).toBeDisabled();

    fireEvent.click(przycisk);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("nie publikuje po raz drugi wydarzenia juz opublikowanego", () => {
    // Powtorny zapis tego samego stanu jest zapytaniem bez tresci, a redaktor
    // czyta z niego, ze „cos sie stalo" - i szuka, co.
    const { onStatusChange } = pasek({ status: "published" });

    const przycisk = screen.getByRole("button", { name: PUBLIKUJ });
    expect(przycisk).toBeDisabled();

    fireEvent.click(przycisk);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu publikacja jest nieczynna i pokazuje, ze pracuje", () => {
    // Dwa klikniecia w trakcie jednego zapisu to dwa zapisy tego samego
    // wiersza; kolejnosc odpowiedzi rozstrzyga wtedy stan wydarzenia.
    const { onStatusChange, container } = pasek({ status: "draft", isBusy: true });

    const przycisk = screen.getByRole("button", { name: PUBLIKUJ });
    expect(przycisk).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    fireEvent.click(przycisk);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("odwolane wydarzenie daje sie opublikowac ponownie", () => {
    // Odwolanie nie jest koncem wiersza - organizator, ktory odwolal termin
    // przez pomylke, musi miec droge powrotna bez zakladania wydarzenia od nowa.
    const { onStatusChange } = pasek({ status: "cancelled" });

    fireEvent.click(screen.getByRole("button", { name: PUBLIKUJ }));

    expect(onStatusChange).toHaveBeenCalledWith("published");
  });
});

describe("EventStudioTopBar - chip stanu", () => {
  it("chip otwiera menu i ustawia wybrany stan, a potem menu sie zamyka", () => {
    // Odwolanie wydarzenia jest osiagalne WYLACZNIE stad. Menu, ktore po
    // wyborze zostaje otwarte, zaprasza do drugiego klikniecia w trzeci stan.
    const { onStatusChange } = pasek({ status: "draft" });

    const menu = otworzMenuStanu(SZKIC);
    fireEvent.click(within(menu).getByRole("button", { name: ODWOLANE }));

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("cancelled");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("menu wymienia komplet stanow, a biezacego nie da sie wybrac", () => {
    const { onStatusChange } = pasek({ status: "published" });

    const menu = otworzMenuStanu(OPUBLIKOWANE);
    const biezacy = within(menu).getByRole("button", { name: OPUBLIKOWANE });
    expect(biezacy).toBeDisabled();
    expect(within(menu).getByRole("button", { name: SZKIC })).toBeEnabled();
    expect(within(menu).getByRole("button", { name: ODWOLANE })).toBeEnabled();

    fireEvent.click(biezacy);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("cofa opublikowane wydarzenie do szkicu", () => {
    // Droga powrotna do szkicu istnieje tylko tutaj - bez niej jedynym
    // sposobem na zdjecie wydarzenia ze swiata jest odwolanie go uczestnikom.
    const { onStatusChange } = pasek({ status: "published" });

    const menu = otworzMenuStanu(OPUBLIKOWANE);
    fireEvent.click(within(menu).getByRole("button", { name: SZKIC }));

    expect(onStatusChange).toHaveBeenCalledWith("draft");
  });

  it("w trybie kreatora stan jest plakietka, a nie kontrolka", () => {
    // Szkic nie ma jeszcze wiersza w bazie - droplista nie mialaby czego
    // przestawic, a wygladalaby na czynna.
    pasek({ createMode: true, status: "published" });

    expect(screen.queryByRole("button", { name: SZKIC })).toBeNull();
    // Pasek kreatora mowi „szkic" niezaleznie od tego, co dostal w `status`:
    // stanu, ktorego nie ma w bazie, nie wolno pokazywac jako obowiazujacego.
    expect(screen.getByText(SZKIC)).toBeInTheDocument();
    expect(screen.queryByText(OPUBLIKOWANE)).toBeNull();
  });

  it.fails("defekt: chip stanu przyjmuje zmiane w TRAKCIE trwajacego zapisu statusu", () => {
    // CO JEST ZLE: przycisk publikacji jest bramkowany `isBusy`, a chip stanu
    // NIE - w trakcie zapisu da sie stad wyslac drugie zadanie zmiany stanu
    // tego samego wiersza (`EventStudioShell.changeStatus` wola mutacje przy
    // kazdym wywolaniu, bez sprawdzenia, czy poprzednia wrocila).
    // DLACZEGO TO BOLI: dwa rownolegle zapisy `admin_event_set_status`
    // rozstrzyga kolejnosc odpowiedzi, a nie kolejnosc klikniec - redaktor
    // widzi toast „opublikowano" przy wierszu, ktory zostal odwolany.
    // Naprawa nalezy do paska (`disabled={isBusy}` na chipie), nie do testu.
    const { onStatusChange } = pasek({ status: "draft", isBusy: true });

    const menu = otworzMenuStanu(SZKIC);
    fireEvent.click(within(menu).getByRole("button", { name: ODWOLANE }));

    expect(onStatusChange).not.toHaveBeenCalled();
  });
});

describe("EventStudioTopBar - podglad i wyjscie", () => {
  it("etykieta podgladu mowi, CO sie otworzy - formularz albo wydarzenie", () => {
    pasek({ section: "registrationForm" });
    expect(screen.getByRole("button", { name: PODGLAD_FORMULARZA })).toBeInTheDocument();
    cleanup();

    pasek({ section: "general" });
    expect(screen.getByRole("button", { name: PODGLAD })).toBeInTheDocument();
    cleanup();

    // Adres bez sekcji (kreator, gole przekierowanie) zostaje przy domyslnej.
    pasek({ section: null });
    expect(screen.getByRole("button", { name: PODGLAD })).toBeInTheDocument();
  });

  it("przycisk podgladu niesie stan nakladki i przelacza ja", () => {
    // Nakladka zabiera caly ekran; przycisk, ktory nie mowi, ze jest wcisniety,
    // kaze zgadywac, czy kolejne klikniecie otworzy podglad, czy go zamknie.
    const { onTogglePreview } = pasek({ previewOpen: true });

    const przycisk = screen.getByRole("button", { name: PODGLAD });
    expect(przycisk).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(przycisk);
    expect(onTogglePreview).toHaveBeenCalledTimes(1);
    // Pasek NIE zamyka nakladki sam: dopoki rama nie odda nowego `previewOpen`,
    // przycisk ma dalej mowic „wcisniety". Przycisk przestawiajacy sie lokalnie
    // rozjechalby sie z nakladka, ktora nadal stoi na ekranie.
    expect(screen.getByRole("button", { name: PODGLAD })).toHaveAttribute("aria-pressed", "true");
    cleanup();

    // Stan zamkniety musi byc ROZNY od otwartego - przycisk zawsze „wcisniety"
    // nie niesie zadnej informacji o tym, co zrobi klikniecie.
    pasek({ previewOpen: false });
    expect(screen.getByRole("button", { name: PODGLAD })).toHaveAttribute("aria-pressed", "false");
  });

  it("w trybie kreatora podgladu nie ma czego otworzyc", () => {
    const { onTogglePreview } = pasek({ createMode: true });

    const przycisk = screen.getByRole("button", { name: PODGLAD });
    expect(przycisk).toBeDisabled();

    fireEvent.click(przycisk);
    expect(onTogglePreview).not.toHaveBeenCalled();
  });

  it("odnosnik po lewej prowadzi do listy wydarzen", () => {
    // To jedyne wyjscie ze studia, gdy sidebar jest przewiniety.
    pasek();

    expect(screen.getByRole("link", { name: "adminEvents.studio.topBar.studio" })).toHaveAttribute(
      "href",
      "/admin/events/list",
    );
  });

  it("przelacznik motywu w pasku siega po to samo zrodlo, co strona", () => {
    // Redaktor sklada tu strone wydarzenia i musi zobaczyc ja w obu trybach.
    // Przycisk, ktory trzymalby WLASNY stan motywu, przestawialby co najwyzej
    // sam siebie: podglad (czytajacy klase z `<html>`) zostalby w poprzednim
    // trybie, a pasek pokazywalby juz nastepny - i redaktor ocenialby kolory
    // wydarzenia po napisie, ktory nie zgadza sie z tym, co widzi.
    pasek();

    // Atrapa wspolnego dostawcy stoi na `light`, wiec pasek MA proponowac
    // przejscie w ciemny. Napis liczony z wlasnego stanu byl otwarty na to,
    // zeby pokazac odwrotna propozycje niz reszta serwisu.
    const przelacznik = screen.getByRole("button", { name: "common.preview.darkMode" });
    expect(przelacznik).toHaveAttribute("title", "common.preview.darkMode");

    fireEvent.click(przelacznik);
    fireEvent.click(przelacznik);

    // Kazde klikniecie dojezdza do wspolnego dostawcy - takze drugie.
    expect(h.przelaczMotyw).toHaveBeenCalledTimes(2);
    // I nic nie przestawilo sie lokalnie: zrodlo nadal mowi „light", wiec
    // przycisk nadal proponuje tryb ciemny (ten sam wezel, ta sama etykieta).
    expect(screen.getByRole("button", { name: "common.preview.darkMode" })).toBe(przelacznik);
  });
});

describe("EventStudioTopBar - dostepnosc", () => {
  it("pasek studia nie ma naruszen axe", async () => {
    const { container } = pasek({ status: "published", previewOpen: true });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("pasek kreatora nie ma naruszen axe", async () => {
    const { container } = pasek({ createMode: true });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
