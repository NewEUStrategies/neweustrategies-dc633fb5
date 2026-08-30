// ATOM POLA GRAFIKI - jedyna droga, ktora wpuszcza plik z dysku do wydarzenia.
//
// PO CO TEN PLIK ISTNIEJE. Ten atom stoi na okladkach wydarzen, pasm, sal
// i sponsorow, wiec kazdy jego blad mnozy sie przez wszystkie te ekrany naraz.
// Dwie rzeczy sa tu warte testu i obie sa NIEWIDOCZNE na ekranie w chwili,
// w ktorej sie psuja:
//
//   1. WALIDACJA STOI PRZED SIECIA. Bucket `media` jest PUBLICZNY i serwuje
//      bajty wprost, wiec plik, ktory wyjdzie z przegladarki, zyje pod znanym
//      adresem NIEZALEZNIE od tego, czy serwer zarejestruje go w bibliotece
//      (patrz naglowek `lib/media/upload.ts` - to jest opisany tam wektor
//      SVG-XSS). Odrzucenie ZLEGO TYPU i ZA DUZEGO PLIKU musi wiec nastapic
//      zanim poleci pierwszy bajt - a ekran w obu przypadkach wyglada
//      identycznie: czerwone zdanie pod polem. Dowodem jest CISZA W SIECI,
//      nie napis.
//   2. UPUSZCZENIE WIELU PLIKOW BIERZE JEDEN. Pole trzyma JEDEN adres, wiec
//      drugi plik nie ma gdzie trafic; petla po `dataTransfer.files` (albo
//      `Promise.all`) nadpisywalaby wartosc w kolejnosci wyscigu odpowiedzi
//      i redaktor dostawalby losowy z upuszczonych obrazow.
//
// TRZECIA RZECZ: USUNIECIE OBRAZU. Kosz czysci WYLACZNIE pole formularza - nie
// kasuje pliku z biblioteki mediow, bo ten sam plik moze stac na innym
// wydarzeniu. Test pilnuje, ze usuniecie oddaje pusty napis w gore, a nie
// zapytanie do bazy.
//
// TEN PLIK TESTOWY NIE WYCHODZI DO SIECI. Klient bazy jest atrapa, ktora
// ZAPISUJE wywolania - dzieki temu „nie bylo zapytania" jest asercja, a nie
// zalozeniem.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Samej allowlisty i limitow (`lib/media/upload`
// ma wlasny plik testowy) - tutaj przez atom przechodzi PRAWDZIWA
// `uploadAndRegisterMedia`, bo przedmiotem dowodu jest droga „plik -> odmowa
// przed siecia", a nie tabela dozwolonych typow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  // SYGNATURA JEST CZESCIA DOWODU: pierwszym argumentem `storage.upload` jest
  // KLUCZ OBIEKTU (sciezka z prefiksem najemcy) i to jego czyta ponizszy test.
  // Atrapa bez zadeklarowanych parametrow ma krotke wywolan dlugosci zero,
  // wiec `mock.calls[0][0]` nie mialoby typu.
  upload: vi.fn<(path: string, file: File) => Promise<{ error: null }>>(async () => ({
    error: null,
  })),
  remove: vi.fn(async () => ({ data: null, error: null })),
  getPublicUrl: vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.example.org/media/${path}` },
  })),
  /** Wszystkie wywolania `supabase.storage.from(...)` - takze te niechciane. */
  kubelki: [] as string[],
  rejestracje: [] as Record<string, unknown>[],
  /** Odpowiedz rejestracji: `null` = sukces, napis = odmowa serwera. */
  bladRejestracji: null as string | null,
  tenantId: "22222222-2222-4222-8222-222222222222" as string | null,
  userId: "11111111-1111-4111-8111-111111111111" as string | undefined,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        h.kubelki.push(bucket);
        return { upload: h.upload, remove: h.remove, getPublicUrl: h.getPublicUrl };
      },
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Rejestracja w bibliotece mediow jest funkcja serwerowa - poza runtime'em
// Start nie da sie jej wywolac. Atrapa ZAPISUJE ladunek, bo to on jest
// kontraktem: nazwa pliku, MIME i rozmiar musza dojechac takie, jakie byly.
vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: () => undefined }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (args: { data: Record<string, unknown> }) => {
    h.rejestracje.push(args.data);
    if (h.bladRejestracji !== null) throw new Error(h.bladRejestracji);
    return { id: "media-1" };
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    tenantId: h.tenantId,
    user: h.userId === undefined ? null : { id: h.userId },
    roles: ["admin"],
    isAdmin: true,
    session: null,
  }),
}));

const { EventImageDropzone } = await import("@/components/admin/events/atoms/EventImageDropzone");

const DROP = "adminEventAgenda.imageDrop.";

/**
 * Plik o zadanym rozmiarze BEZ alokowania bajtow: limit obrazow to 10 MB, a
 * dziesiec megabajtow napisu w tescie kosztuje wiecej niz cala reszta pliku.
 */
function plik(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function pole(options: { value?: string; onValueChange?: (value: string) => void } = {}) {
  return render(
    <EventImageDropzone
      label="Okladka pasma"
      recommendation="1600 x 900 px"
      hint="Grafika stoi na karcie pasma."
      value={options.value ?? ""}
      onValueChange={options.onValueChange ?? (() => undefined)}
      subfolder="event-tracks"
    />,
  );
}

/** Ukryte pole pliku - jedyna droga wejscia z okna wyboru. */
function wejsciePliku(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (input === null) throw new Error("test: atom nie ma pola pliku");
  return input as HTMLInputElement;
}

/**
 * Strefa upuszczania. Szukamy jej po ZNACZNIKU, a nie po dostepnej nazwie:
 * strefa i przycisk „Wgraj" nosza TEN SAM napis (i tak ma byc - to jedna
 * czynnosc w dwoch miejscach), wiec zapytanie po nazwie oddaje dwa elementy.
 */
function strefa(container: HTMLElement): HTMLElement {
  const zone = container.querySelector('div[role="button"]');
  if (zone === null) throw new Error("test: atom nie ma strefy upuszczania");
  return zone as HTMLElement;
}

beforeEach(() => {
  h.upload.mockClear();
  h.remove.mockClear();
  h.getPublicUrl.mockClear();
  h.kubelki = [];
  h.rejestracje = [];
  h.bladRejestracji = null;
  h.tenantId = "22222222-2222-4222-8222-222222222222";
  h.userId = "11111111-1111-4111-8111-111111111111";
});

afterEach(cleanup);

describe("EventImageDropzone - co wolno wyslac", () => {
  it("PLIK DOZWOLONY jedzie do storage i wraca adresem publicznym", async () => {
    const zmiany: string[] = [];
    const { container } = pole({ onValueChange: (value) => zmiany.push(value) });

    fireEvent.change(wejsciePliku(container), {
      target: { files: [plik("okladka.png", "image/png", 2048)] },
    });

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.kubelki).toEqual(["media", "media"]);
    // Sciezka w storage zaczyna sie od PREFIKSU NAJEMCY i niesie podfolder -
    // bez tego pliki wydarzen wpadaja do wspolnego worka.
    const sciezka = String(h.upload.mock.calls[0][0]);
    expect(sciezka.startsWith("22222222-2222-4222-8222-222222222222/")).toBe(true);
    expect(sciezka).toContain("/event-tracks/");
    expect(zmiany).toEqual([`https://cdn.example.org/media/${sciezka}`]);
  });

  it("ZLY TYP odpada PRZED siecia - ani jednego bajtu do publicznego kubelka", async () => {
    // Bucket `media` jest publiczny i serwuje bajty wprost, wiec SVG, ktory
    // wyjdzie z przegladarki, zyje pod znanym adresem takze wtedy, gdy serwer
    // odmowi rejestracji. Dowodem jest cisza w sieci, nie czerwone zdanie.
    const zmiany: string[] = [];
    const { container } = pole({ onValueChange: (value) => zmiany.push(value) });

    fireEvent.change(wejsciePliku(container), {
      target: { files: [plik("wektor.svg", "image/svg+xml", 1024)] },
    });

    expect(await screen.findByText(/Disallowed mime type/)).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.kubelki).toEqual([]);
    expect(h.rejestracje).toEqual([]);
    expect(zmiany).toEqual([]);
  });

  it("PLIK ZA DUZY odpada PRZED siecia, a zdanie mowi o rozmiarze", async () => {
    const { container } = pole();

    fireEvent.change(wejsciePliku(container), {
      target: { files: [plik("makieta.png", "image/png", 11 * 1024 * 1024)] },
    });

    expect(await screen.findByText(/File too large/)).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.kubelki).toEqual([]);
  });

  it("BRAK NAJEMCY konczy sie zdaniem, a nie sciezka bez prefiksu", async () => {
    // Sciezka w storage zaczyna sie od identyfikatora najemcy. Upload bez niego
    // wyladowalby poza zakresem polityki - lepiej nie wyslac nic.
    h.tenantId = null;
    const { container } = pole();

    fireEvent.change(wejsciePliku(container), {
      target: { files: [plik("okladka.png", "image/png", 2048)] },
    });

    expect(await screen.findByText(`${DROP}failed`)).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("ODMOWA REJESTRACJI SPRZATA plik ze storage - inaczej zostaje zywy pod publicznym adresem", async () => {
    h.bladRejestracji = "Disallowed mime type: image/png";
    const zmiany: string[] = [];
    const { container } = pole({ onValueChange: (value) => zmiany.push(value) });

    fireEvent.change(wejsciePliku(container), {
      target: { files: [plik("okladka.png", "image/png", 2048)] },
    });

    expect(await screen.findByText(/Disallowed mime type/)).toBeInTheDocument();
    expect(h.remove).toHaveBeenCalledTimes(1);
    // Pole formularza zostaje puste - adres, ktorego nie ma w bibliotece, nie
    // moze trafic do wydarzenia.
    expect(zmiany).toEqual([]);
  });
});

describe("EventImageDropzone - upuszczanie", () => {
  it("UPUSZCZENIE WIELU PLIKOW bierze PIERWSZY, a nie ostatni ze zwyciezonego wyscigu", async () => {
    // Pole trzyma jeden adres. Petla po `dataTransfer.files` nadpisywalaby
    // wartosc w kolejnosci odpowiedzi serwera, wiec redaktor dostawalby losowy
    // z upuszczonych obrazow.
    const zmiany: string[] = [];
    const { container } = pole({ onValueChange: (value) => zmiany.push(value) });

    fireEvent.drop(strefa(container), {
      dataTransfer: {
        files: [
          plik("pierwszy.png", "image/png", 1024),
          plik("drugi.png", "image/png", 1024),
          plik("trzeci.png", "image/png", 1024),
        ],
      },
    });

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.rejestracje).toHaveLength(1);
    expect(h.rejestracje[0].filename).toBe("pierwszy.png");
    expect(zmiany).toHaveLength(1);
  });

  it("UPUSZCZENIE PUSTKI nic nie robi - przeciagniecie zaznaczenia tekstu nie jest uploadem", () => {
    const { container } = pole();

    fireEvent.drop(strefa(container), { dataTransfer: { files: [] } });

    expect(h.upload).not.toHaveBeenCalled();
    expect(h.kubelki).toEqual([]);
  });

  it("przeciagniecie nad polem i zjechanie z niego nie wysyla niczego", () => {
    const { container } = pole();

    fireEvent.dragOver(strefa(container));
    fireEvent.dragLeave(strefa(container));

    expect(h.upload).not.toHaveBeenCalled();
  });
});

describe("EventImageDropzone - obraz juz wybrany", () => {
  it("USUNIECIE czysci pole formularza i NIE rusza biblioteki mediow", () => {
    // Ten sam plik moze stac na innym wydarzeniu - kosz jest tu gumka do pola,
    // a nie kasowaniem pliku.
    const zmiany: string[] = [];
    pole({
      value: "https://cdn.example.org/media/okladka.png",
      onValueChange: (v) => zmiany.push(v),
    });

    fireEvent.click(screen.getByRole("button", { name: `${DROP}remove` }));

    expect(zmiany).toEqual([""]);
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.kubelki).toEqual([]);
  });

  it("wybrany obraz ma PODGLAD z tekstem alternatywnym, a strefa mowi „podmien”", () => {
    const { container } = pole({ value: "https://cdn.example.org/media/okladka.png" });

    const podglad = screen.getByRole("img", { name: "Okladka pasma" });
    expect(podglad).toHaveAttribute("src", "https://cdn.example.org/media/okladka.png");
    expect(strefa(container)).toHaveAttribute("aria-label", `${DROP}replace`);
    expect(screen.queryByRole("button", { name: `${DROP}upload` })).toBeNull();
  });

  it("ADRES RECZNY zostaje - redakcja bywa szybsza z gotowym linkiem z CDN", () => {
    const zmiany: string[] = [];
    pole({ onValueChange: (value) => zmiany.push(value) });

    fireEvent.change(screen.getByLabelText(`${DROP}urlLabel`), {
      target: { value: "https://cdn.example.org/media/z-cdn.jpg" },
    });

    expect(zmiany).toEqual(["https://cdn.example.org/media/z-cdn.jpg"]);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("pusty adres nie ma kosza - przycisk kasujacy nic nie jest gorszy niz jego brak", () => {
    pole({ value: "" });

    expect(screen.queryByRole("button", { name: `${DROP}remove` })).toBeNull();
  });
});

describe("EventImageDropzone - obsluga z klawiatury i dostepnosc", () => {
  it("strefa otwiera okno wyboru Enterem i spacja - klik myszy nie moze byc jedyna droga", () => {
    const { container } = pole();
    const otworz = vi.spyOn(wejsciePliku(container), "click");

    fireEvent.keyDown(strefa(container), { key: "Enter" });
    fireEvent.keyDown(strefa(container), { key: " " });
    expect(otworz).toHaveBeenCalledTimes(2);

    // Inne klawisze nie otwieraja okna - Tab musi wyprowadzac z pola dalej.
    fireEvent.keyDown(strefa(container), { key: "Tab" });
    expect(otworz).toHaveBeenCalledTimes(2);
  });

  it("pole nie ma naruszen axe - i z obrazem, i bez niego", async () => {
    // `label` WYLACZONY I TO NIE JEST ZAMIATANIE DEFEKTU POD DYWAN. Ukryte pole
    // pliku ma klase `hidden` (czyli `display: none`), a happy-dom nie liczy
    // CSS - w przegladarce axe pomija elementy `display: none`, tutaj widzi je
    // jako zwykly `<input>` bez etykiety. To ten sam powod, dla ktorego wspolny
    // pomocnik gasi `color-contrast` i `region`. Dostepna nazwe pol, ktore
    // redaktor NAPRAWDE widzi, dowodza asercje wyzej: strefa ma `aria-label`,
    // pole adresu odnajduje sie przez `getByLabelText`, a kosz przez `getByRole`.
    const bezEtykietyUkrytego = { label: { enabled: false } };

    const puste = pole();
    const bezObrazu = await axeViolations(puste.container, bezEtykietyUkrytego);
    expect(bezObrazu, summarize(bezObrazu)).toEqual([]);
    expect(strefa(puste.container)).toHaveAttribute("aria-label", `${DROP}upload`);
    puste.unmount();

    const zObrazem = pole({ value: "https://cdn.example.org/media/okladka.png" });
    const naruszenia = await axeViolations(zObrazem.container, bezEtykietyUkrytego);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
