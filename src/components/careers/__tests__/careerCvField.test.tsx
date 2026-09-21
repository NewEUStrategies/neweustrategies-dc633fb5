// Pole załącznika CV w zgłoszeniu rekrutacyjnym - GRANICA, przez którą do
// prywatnego bucketu wchodzi PLIK Z DANYMI OSOBOWYMI osoby z zewnątrz.
//
// PO CO TEN PLIK ISTNIEJE. `CareerCvField.tsx` wchodził w tę kampanię
// z pokryciem 9/22 linii, 2/6 funkcji i 11/20 gałęzi, bo jedyny test, który go
// w ogóle dotykał (`careersApplyForm.test.tsx`), używa WYŁĄCZNIE gałęzi „wklej
// link" - `fireEvent.change` na `careers.form.cvUrl`. Cała ścieżka pliku
// (`pickFile`, stan „wysyłamy", mapowanie odmowy na komunikat, usunięcie
// wybranego pliku, przycisk otwierający okno wyboru) nie miała ANI JEDNEGO
// wywołania. Konkretne defekty, które bez tego pliku przechodzą bez śladu:
//
//   * plik odrzucony przez walidator (zły typ / ponad 5 MB) trafia jednak do
//     `onChange`, czyli do payloadu zgłoszenia - a wtedy w CRM ląduje ścieżka
//     do pliku, którego magazyn nie przyjął, albo przyjął wbrew polityce;
//   * `onErrorMessage` dostaje klucz, którego NIE MA w słowniku - kandydat
//     widzi wtedy `careers.form.errors.cvType` zamiast zdania po polsku
//     (i18next przy braku klucza zwraca sam klucz, cicho);
//   * `accept` pola pliku rozjeżdża się z listą MIME walidatora - okno wyboru
//     proponuje formaty, które walidator zaraz odrzuci (albo odwrotnie:
//     zachęca do wgrania formatu poza polityką bucketu);
//   * przycisk nie jest blokowany na czas transferu, więc jedno drgnięcie
//     palca wgrywa CV dwa razy (dwa pliki z danymi osobowymi, jeden podpięty);
//   * „Usuń plik" czyści nazwę, ale zostawia `path`, czyli zgłoszenie idzie
//     z załącznikiem, którego kandydat już nie widzi w interfejsie.
//
// CO JEST PRZEDMIOTEM DOWODU (co POLE robi z wynikiem warstwy reguł):
//   1. stan pusty: etykieta sekcji, podpowiedź, przycisk wgrania, alternatywa
//      „albo" i pole linku - wszystko z AKTYWNEGO słownika, oraz `accept`
//      równy `CV_ACCEPT_ATTR` ze schematu (jedno źródło listy formatów);
//   2. przycisk otwiera ukryte pole pliku (`inputRef.current.click()`);
//   3. wybór poprawnego pliku: rodzic dostaje DOKŁADNIE tę ścieżkę, którą
//      przyjął magazyn, plus oryginalną nazwę i WYZEROWANY link - także wtedy,
//      gdy kandydat wcześniej ten link wpisał (plik ALBO link, nigdy oba);
//      kandydat widzi nazwę pliku, „Zmień plik" i przycisk usunięcia, a pole
//      linku znika; kontrolka pliku dostaje ZAPIS pustej wartości; „Zmień
//      plik" (klikany PRZYCISK, nie ukryta kontrolka) otwiera okno wyboru
//      i PODMIENIA załącznik - rodzic dostaje drugą ścieżkę, a nie pierwszą;
//   4. czas transferu: przycisk zablokowany, napis „Wysyłamy plik...",
//      kręcący się wskaźnik postępu, a klik w zablokowany przycisk NIE otwiera
//      okna wyboru drugi raz; poprzedni komunikat gaśnie JESZCZE PRZED końcem
//      transferu, a rodzic nie widzi żadnej wartości, dopóki transfer trwa;
//   5. odmowa walidatora - ponad `CV_MAX_BYTES` i niedozwolony typ: klucz
//      komunikatu ISTNIEJĄCY w słowniku, ZERO wywołań `onChange`, ZERO
//      wysyłek do magazynu i (przy złym typie/rozmiarze) zero rund po tenanta;
//   6. awaria magazynu: `cvUploadFailed` do rodzica, wartość pola nietknięta,
//      przycisk odblokowany (kandydat może spróbować ponownie);
//   7. odmowa NIE kasuje wcześniej przyjętego pliku (zły plik nie kradnie
//      dobrego załącznika);
//   8. puste zdarzenie zmiany (anulowane okno wyboru, brak listy plików) nie
//      rusza ani rodzica, ani magazynu;
//   9. „Usuń plik" zwraca rodzicowi PEŁNY pusty rekord (`path`, `fileName`
//      i `url` naraz) i przywraca pole linku;
//  10. wpisanie linku czyści ZASTANĄ ścieżkę i nazwę pliku (stan wejściowy ze
//      ścieżką bez nazwy modeluje odtworzony szkic formularza), a wpisany
//      adres ZOSTAJE widoczny w polu (kontrolka kontrolowana);
//  11. dostępność: pole pliku ma nazwę ze słownika (jest jego etykietą),
//      komunikat błędu jest `role="alert"`, a kontener `[data-field="cv"]`
//      wskazuje go przez `aria-describedby`, jest oznaczony `data-invalid`
//      i JEST PROGRAMOWO FOKUSOWALNY - `tabindex="-1"` (to on jest celem
//      `focusFirstError` w rodzicu:
//      `document.querySelector('[data-field="cv"]')?.focus()`);
//  12. brak naruszeń axe w stanie pustym i w stanie „plik + błąd";
//  13. w KONTEKŚCIE FORMULARZA (bo tam pole żyje): klik „Wgraj CV" i „Usuń
//      plik" NIE wysyła formularza - inaczej wybór CV kończyłby krok kreatora
//      zamiast dołączyć plik.
//
// CO JEST ATRAPOWANE I DLACZEGO. JEDNA atrapa: `@/integrations/supabase/client`,
// czyli sieć. Notuje bucket, ścieżkę i opcje wysyłki oraz udaje
// `public_tenant_id()`; ma też BRAMKĘ, dzięki której transfer da się zatrzymać
// w połowie i zobaczyć stan „wysyłamy".
//
// `react-i18next` NIE JEST atrapowany - i to jest decyzja, nie przeoczenie.
// Ostrzeżenie z `@/test/i18nReal` mówi, że fabryka `vi.mock("react-i18next")`
// sięga po `@/lib/i18n`, czyli po moduł, który importuje właśnie atrapowany
// pakiet; zmierzone tu na własnej skórze: plik z taką atrapą wisiał bez
// jednego wiersza wyjścia do zabicia procesu. Zamiast tego (jak
// `community/__tests__/PollCard.test.tsx`) idzie PRAWDZIWY `react-i18next`
// nad prawdziwą instancją i18next - import `@/test/i18nReal` domyka rdzenie
// PL/EN, a `realT("pl")` daje ten sam `t`, który dostaje komponent. Asercja
// na napisie mierzy więc SŁOWNIK: zniknięcie klucza oblewa test (`zeSlownika()`
// sprawdza to jawnie, bo i18next przy braku klucza zwraca sam klucz).
// Parzystość PL/EN pilnuje osobna bramka słowników.
//
// CO ZOSTAJE PRAWDZIWE. `uploadCv` i `validateCvFile` (`lib/careers/cvUpload`),
// `CV_ACCEPT_ATTR` i `CV_MAX_BYTES` (`lib/careers/applicationSchema`), słownik
// `lib/i18n-careers`, atomy `Button` i `FloatingInput`, stan Reacta. Atrapowanie
// `uploadCv` zamieniłoby ten plik w test atrapy: „pole pokazuje komunikat, gdy
// atrapa powie, że plik jest za duży" nie dowodzi NICZEGO o tym, że plik 5 MB
// + 1 bajt jest za duży. Tutaj przez pole przechodzi PRAWDZIWY `File`
// i PRAWDZIWY walidator, więc dowód wiąże granicę interfejsu z granicą reguł.
//
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
//   * kształt ścieżki w buckecie - tenant jako PIERWSZY segment, fail-closed
//     bez tenanta, oryginalna nazwa pliku poza ścieżką: `lib/careers/__tests__/
//     cvUpload.test.ts` (to tam mieszka dowód izolacji najemcy, tutaj nie ma
//     ani jednej asercji na skład ścieżki - pole ma ją przekazać BEZ ZMIAN);
//   * reguły rozpoznawania formatu (rozszerzenie, gdy przeglądarka nie podała
//     MIME; typ zastępczy przekazywany magazynowi; włączność limitu 5 MB):
//     ten sam `cvUpload.test.ts`. Tutaj przez pole przechodzą wyłącznie
//     przypadki, w których widać SKUTEK w interfejsie i u rodzica;
//   * polityki RLS/INSERT bucketu `career-cv` i podpisany odczyt dla personelu:
//     pgTAP;
//   * sprzątanie plików osieroconych (kandydat wgrał CV, kliknął „Usuń plik"
//     albo porzucił formularz - plik zostaje w magazynie): job retencji,
//     `lib/careers/cvRetention.ts` + `cvRetention.test.ts`, powód `orphan`.
//     Pole ŚWIADOMIE nie kasuje pliku z bucketu przy usunięciu z formularza;
//   * walidacja „CV wymagane: plik ALBO link" i komunikat `cvRequired`:
//     `lib/careers/__tests__/applicationSchema.test.ts`;
//   * payload całego zgłoszenia i kroki kreatora: `careersApplyForm.test.tsx`;
//   * to, że w PRAWDZIWEJ przeglądarce ten sam plik da się wybrać dwa razy
//     (bo `event.target.value = ""` resetuje kontrolkę): e2e. `fireEvent`
//     wysyła `change` bezwarunkowo, więc w tej warstwie da się udowodnić
//     wyłącznie, że handler ZAPISAŁ do kontrolki pustą wartość - i to jest
//     asertowane (przez przechwycony setter, bo ODCZYT `value` pod happy-dom
//     jest pusty niezależnie od handlera; patrz `nasluchujCzyszczenia`);
//   * przeniesienie fokusu na sekcję po nieudanej walidacji: `focusFirstError`
//     mieszka w rodzicu (`careersApplyForm.test.tsx`). Tutaj dowodzimy tylko
//     tego, co pole wnosi: `tabindex="-1"`, bez którego skok rodzica byłby
//     w prawdziwej przeglądarce bezskuteczny (happy-dom fokusuje dowolny
//     element, więc sam `activeElement` niczego tu nie dowodzi).
//
// ZNALEZISKO (dostępność, zachowanie istniejące - zaasertowane, nie zmieniane).
// `aria-describedby` z komunikatem błędu wisi na KONTENERZE sekcji
// (`div[data-field="cv"]`, `tabIndex={-1}`, bez roli i bez nazwy), a NIE na
// polu pliku ani na polu linku; te dwie kontrolki nie mają też `aria-invalid`.
// Jest to spójne z rodzicem, który po nieudanej walidacji przenosi fokus
// właśnie na ten kontener (`focusFirstError`) - dlatego test dowodzi, że
// kontener jest programowo fokusowalny (`tabindex="-1"`) i że opis wskazuje
// istniejący `role="alert"`.
// Kandydat czytający formularz czytnikiem ekranu i wchodzący w pole pliku
// TABEM (bez skoku fokusu z walidacji) nie usłyszy jednak przy nim błędu -
// to brak w produkcie, nie w teście, i nie wolno go „naprawić" asercją.
//
// REWIZJA ADWERSARYJNA (audyt mutacyjny: 33 mutanty wstrzyknięte do
// `CareerCvField.tsx`, z tego jeden semantycznie równoważny - zostaje 32 realne
// zmiany zachowania). Pierwsza wersja tego pliku miała 100% linii, funkcji
// i gałęzi, a mimo to PRZEPUSZCZAŁA JEDENAŚCIE z nich - dowód, że pokrycie nie
// jest dowodem. Każdą zabija teraz konkretna asercja, nie render:
//   * `onErrorMessage(undefined)` przeniesione ZA transfer (komunikat po
//     poprzednim pliku wisi przez cały upload) - łapie test kolejności
//     z bramką;
//   * `url: ""` zamienione na `url: value.url` (plik NIE zeruje wpisanego
//     linku - payload z dwoma źródłami CV) - łapie ten sam test, bo start
//     ma wpisany adres;
//   * handler linku scalający zamiast zerować (`{...value, url}`) - łapie
//     stan wejściowy ze ZASTANĄ ścieżką;
//   * usunięte `event.target.value = ""` - stara asercja czytała `value`
//     (pod happy-dom zawsze `""`, więc nie mogła oblać); teraz mierzy zapis;
//   * `onChange(EMPTY_CV)` bez kopii - łapie `not.toBe(EMPTY_CV)`;
//   * zdjęte `tabIndex={-1}` - stara asercja na `document.activeElement`
//     przechodziła (happy-dom fokusuje wszystko); teraz mierzy atrybut;
//   * „Zmień plik" odcięty od okna wyboru (`if (!value.fileName)`) - stary
//     test podmieniał plik prosto przez ukrytą kontrolkę, więc nazwa testu
//     obiecywała przycisk, którego nikt nie klikał;
//   * spinacz zamieniony ze spinnerem - łapie asercja na wskaźniku postępu;
//   * `type="button"` zamienione na `submit` (osobno na „Wgraj/Zmień plik"
//     i na „Usuń plik") - łapie test w `<form>`: happy-dom wykonuje niejawną
//     wysyłkę, więc dowodem jest SKUTEK (`onSubmit` zawołany dwa razy),
//     a atrybut jest tylko potwierdzeniem;
//   * `value={value.url}` zamienione na `value=""` (pole linku kasuje tekst
//     pod palcami kandydata) - łapie asercja na wartości kontrolki.
// Jeden mutant PRZEŻYWA świadomie: zdjęcie `sr-only` z kontrolki pliku. Jest
// czysto wizualny (nazwa aria i czystość axe stoją niezależnie od klasy),
// a asercja na klasie mierzyłaby styl, nie zachowanie; ten sam powód dotyczy
// `inputMode="url"` (podpowiedź klawiatury mobilnej).
//
// Pozostałe 20 mutantów padało już przed rewizją: brak wartownika pustego
// pliku, brak `return` po odmowie, klucz błędu bez przedrostka, `accept` spoza
// schematu, nazwa kontrolki z literału, zamiana napisów „Wgraj"/„Zmień",
// zdjęta rola `alert`, stałe `data-invalid`, przycisk bez `click()`, brak
// `await` na wysyłce, plakietka pokazująca link zamiast nazwy, usunięcie
// zostawiające ścieżkę, pole linku widoczne razem z plikiem.
//
// RODO: żadnych prawdziwych osób ani plików. Nazwiska i nazwy plików zmyślone
// (`cv-anna-kowalska.pdf`, `zyciorys.exe`), tenant `tenant-testowy`, adresy
// wyłącznie w domenie `example.com`. Plik testowy nie zawiera treści CV -
// `new File(["x"], ...)` z podmienionym `size`, więc żaden bajt danych
// osobowych nie powstaje.
import { type FormEvent, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

// Atrapa sieci: notuje wysyłki i udaje `public_tenant_id()`. `gate` pozwala
// zatrzymać transfer w połowie - bez tego stan „wysyłamy" jest niemierzalny,
// bo cały `await` domyka się w jednej mikrozadaniowej pętli.
const h = vi.hoisted(() => {
  interface UploadCall {
    bucket: string;
    path: string;
    contentType?: string;
    upsert?: boolean;
  }
  const state = {
    tenant: "tenant-testowy",
    /** Nazwy zawołanych RPC - dowód „walidator odciął plik PRZED siecią". */
    rpcCalls: [] as string[],
    uploads: [] as UploadCall[],
    uploadError: null as { message: string } | null,
    gate: null as Promise<void> | null,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      h.state.rpcCalls.push(name);
      if (h.state.gate) await h.state.gate;
      return { data: h.state.tenant, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          _file: unknown,
          options: { contentType?: string; upsert?: boolean },
        ) => {
          h.state.uploads.push({ bucket, path, ...options });
          return { data: { path }, error: h.state.uploadError };
        },
      }),
    },
  },
}));

// Słownik kariery rejestruje się efektem ubocznym importu; sam komponent go nie
// importuje (robi to trasa), więc plik testu musi go dociągnąć - inaczej `t`
// zwracałby klucze i asercje mierzyłyby brak słownika, nie napisy.
import "@/lib/i18n-careers";
import { realT } from "@/test/i18nReal";
import { CV_ACCEPTED_MIME, CV_ACCEPT_ATTR, CV_MAX_BYTES } from "@/lib/careers/applicationSchema";
import { CV_BUCKET } from "@/lib/careers/cvUpload";
import { CareerCvField, EMPTY_CV, type CvValue } from "../molecules/CareerCvField";

const T = realT("pl");

/** Napis ze słownika + dowód, że klucz ISTNIEJE (i18next bez klucza zwraca klucz). */
function zeSlownika(key: string): string {
  const text = T(key);
  expect(text, `brak klucza w słowniku: ${key}`).not.toBe(key);
  return text;
}

/**
 * Plik o zadanym rozmiarze BEZ alokowania bajtów: limit to 5 MB, a pięć
 * megabajtów napisu w teście kosztowałoby więcej niż cała reszta suity.
 */
function plik(name: string, type: string, size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * Rodzic pola - kontrolowany, taki jak `CareersApplyForm`: trzyma `CvValue`
 * w stanie i TŁUMACZY zgłoszony klucz błędu (`msg()` w rodzicu robi dokładnie
 * to samo). Bez tego nie da się zobaczyć skutku wyboru pliku, bo pole jest
 * bezstanowe poza flagą transferu.
 */
function Rodzic({
  start = EMPTY_CV,
  onChangeSpy,
  onErrorSpy,
}: {
  start?: CvValue;
  onChangeSpy: (next: CvValue) => void;
  onErrorSpy: (key: string | undefined) => void;
}) {
  const [value, setValue] = useState<CvValue>(start);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
  return (
    <CareerCvField
      value={value}
      error={errorKey ? T(errorKey) : undefined}
      onChange={(next) => {
        onChangeSpy(next);
        setValue(next);
      }}
      onErrorMessage={(key) => {
        onErrorSpy(key);
        setErrorKey(key);
      }}
    />
  );
}

function pole(start?: CvValue) {
  const onChangeSpy = vi.fn();
  const onErrorSpy = vi.fn();
  const utils = render(<Rodzic start={start} onChangeSpy={onChangeSpy} onErrorSpy={onErrorSpy} />);
  return { ...utils, onChangeSpy, onErrorSpy };
}

/** Ukryte pole pliku - jedyna droga wejścia z okna wyboru. */
function wejsciePliku(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("test: pole CV nie ma kontrolki pliku");
  return input;
}

/**
 * Zapisy do `value` kontrolki pliku. Pod happy-dom podstawienie `files` NIE
 * rusza `value`, więc odczyt `input.value === ""` jest prawdą także wtedy, gdy
 * handler niczego nie czyści (zmierzone mutacją: usunięcie
 * `event.target.value = ""` przechodziło przez taką asercję bez śladu).
 * Dowodem jest więc PRZECHWYCONY ZAPIS, nie odczyt.
 */
function nasluchujCzyszczenia(input: HTMLInputElement): string[] {
  const zapisy: string[] = [];
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => "",
    set: (next: string) => {
      zapisy.push(next);
    },
  });
  return zapisy;
}

function sekcja(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[data-field="cv"]');
  if (node === null) throw new Error("test: brak kontenera [data-field=cv]");
  return node;
}

/** Wybór pliku z okna dialogowego + domknięcie mikrozadań transferu. */
async function wybierz(container: HTMLElement, file: File | File[] | null) {
  await act(async () => {
    fireEvent.change(wejsciePliku(container), { target: { files: file } });
  });
}

/** Bramka transferu: zwraca zwolnienie, po którym `await` w polu dobiega. */
function zatrzymajTransfer() {
  let release!: () => void;
  h.state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    h.state.gate = null;
    await act(async () => {
      release();
    });
  };
}

beforeEach(() => {
  h.state.tenant = "tenant-testowy";
  h.state.rpcCalls = [];
  h.state.uploads = [];
  h.state.uploadError = null;
  h.state.gate = null;
});

describe("CareerCvField: stan pusty i wejście do okna wyboru", () => {
  it("pokazuje etykietę sekcji, podpowiedź, przycisk wgrania, alternatywę i pole linku ze słownika", () => {
    const { container } = pole();

    expect(screen.getByText(zeSlownika("careers.form.cv"))).toBeInTheDocument();
    expect(screen.getByText(zeSlownika("careers.form.cvHint"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zeSlownika("careers.form.cvUpload") }),
    ).toBeInTheDocument();
    // „albo" stoi zamiast plakietki pliku, dopóki nic nie wybrano.
    expect(screen.getByText(zeSlownika("careers.form.cvOr"))).toBeInTheDocument();
    expect(screen.getByLabelText(zeSlownika("careers.form.cvUrl"))).toBeInTheDocument();
    // Bez błędu sekcja nie jest oznaczona jako niepoprawna i nic nie opisuje.
    expect(sekcja(container).getAttribute("data-invalid")).toBeNull();
    expect(sekcja(container).getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("filtr okna wyboru jest listą formatów ze schematu, jeden do jednego z listą MIME", () => {
    const { container } = pole();
    // Pole nie ma własnej listy formatów - bierze tę ze schematu, którym
    // walidator zaraz odrzuci plik spoza polityki bucketu.
    expect(wejsciePliku(container)).toHaveAttribute("accept", CV_ACCEPT_ATTR);
    // Jedyne miejsce w repo, gdzie TREŚĆ filtra `accept` jest asertowana:
    // rozszerzenie na jeden dozwolony typ MIME, nic ponad to. Dołożenie MIME
    // bez dołożenia rozszerzenia (albo odwrotnie) oblewa ten test. Że KAŻDY
    // przyjmowany MIME ma własne rozszerzenie w ścieżce, dowodzi warstwa reguł
    // (`lib/careers/__tests__/careersRulesEdges.test.ts`).
    expect(CV_ACCEPT_ATTR.split(",")).toEqual([".pdf", ".doc", ".docx"]);
    expect(CV_ACCEPTED_MIME).toHaveLength(CV_ACCEPT_ATTR.split(",").length);
  });

  it("przycisk wgrania otwiera ukrytą kontrolkę pliku", () => {
    const { container } = pole();
    const otwarcie = vi.spyOn(wejsciePliku(container), "click");

    fireEvent.click(screen.getByRole("button", { name: T("careers.form.cvUpload") }));

    expect(otwarcie).toHaveBeenCalledTimes(1);
  });
});

describe("CareerCvField: plik przyjęty", () => {
  it("przekazuje rodzicowi ścieżkę przyjętą przez magazyn, nazwę pliku i pusty link", async () => {
    const { container, onChangeSpy, onErrorSpy } = pole();

    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);

    // Jedna wysyłka, do prywatnego bucketu CV, bez nadpisywania.
    expect(h.state.uploads).toHaveLength(1);
    expect(h.state.uploads[0].bucket).toBe(CV_BUCKET);
    expect(h.state.uploads[0].upsert).toBe(false);
    expect(h.state.uploads[0].contentType).toBe("application/pdf");
    // Pole NIE przerabia ścieżki - rodzic dostaje dokładnie to, co magazyn.
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith({
      path: h.state.uploads[0].path,
      fileName: "cv-anna-kowalska.pdf",
      url: "",
    });
    // Pole zgłasza rodzicowi „brak błędu" (jedno miejsce na komunikat).
    // KOLEJNOŚĆ - że gaśnie jeszcze w trakcie transferu - dowodzi osobny test
    // z bramką („gasi poprzedni komunikat JESZCZE PRZED transferem"); sam fakt
    // wywołania jej nie mierzy.
    expect(onErrorSpy).toHaveBeenCalledWith(undefined);
  });

  it("po przyjęciu pliku kandydat widzi jego nazwę, „Zmień plik” i usunięcie, a pole linku znika", async () => {
    const { container } = pole();
    const czyszczenia = nasluchujCzyszczenia(wejsciePliku(container));

    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);

    expect(screen.getByText("cv-anna-kowalska.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zeSlownika("careers.form.cvChange") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zeSlownika("careers.form.cvRemove") }),
    ).toBeInTheDocument();
    // Plik ALBO link: pole linku i napis „albo" ustępują plakietce pliku.
    expect(screen.queryByLabelText(T("careers.form.cvUrl"))).toBeNull();
    expect(screen.queryByText(T("careers.form.cvOr"))).toBeNull();
    // Handler ZAPISAŁ pustą wartość do kontrolki (w przeglądarce to warunek
    // ponownego wyboru TEGO SAMEGO pliku - dowód pełny leży w e2e). Mierzymy
    // zapis, bo odczyt `value` pod happy-dom jest pusty niezależnie od handlera.
    expect(czyszczenia).toEqual([""]);
  });

  it("„Zmień plik” otwiera okno wyboru i podmienia załącznik: rodzic dostaje drugą ścieżkę, nie pierwszą", async () => {
    const { container, onChangeSpy } = pole();
    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);
    const pierwsza = h.state.uploads[0].path;
    const otwarcie = vi.spyOn(wejsciePliku(container), "click");

    // Droga kandydata idzie przez PRZYCISK, nie przez ukrytą kontrolkę: gdyby
    // stan „mam już plik" odcinał otwarcie okna, załącznika nie dałoby się
    // podmienić bez uprzedniego usunięcia (zmierzone mutacją).
    fireEvent.click(screen.getByRole("button", { name: zeSlownika("careers.form.cvChange") }));
    expect(otwarcie).toHaveBeenCalledTimes(1);
    await wybierz(container, [plik("cv-anna-kowalska-v2.docx", "application/msword", 4096)]);

    expect(h.state.uploads).toHaveLength(2);
    expect(h.state.uploads[1].path).not.toBe(pierwsza);
    expect(onChangeSpy).toHaveBeenLastCalledWith({
      path: h.state.uploads[1].path,
      fileName: "cv-anna-kowalska-v2.docx",
      url: "",
    });
    // Kandydat widzi nową nazwę, stara znika z interfejsu.
    expect(screen.getByText("cv-anna-kowalska-v2.docx")).toBeInTheDocument();
    expect(screen.queryByText("cv-anna-kowalska.pdf")).toBeNull();
  });
});

describe("CareerCvField: stan transferu", () => {
  it("na czas wysyłki blokuje przycisk, pokazuje status ze słownika i nie otwiera okna po raz drugi", async () => {
    const { container } = pole();
    const zwolnij = zatrzymajTransfer();
    const otwarcie = vi.spyOn(wejsciePliku(container), "click");

    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);

    const przycisk = screen.getByRole("button", {
      name: zeSlownika("careers.form.cvUploading"),
    });
    expect(przycisk).toBeDisabled();
    // Ikony są `aria-hidden`, więc jedynym mierzalnym w tej warstwie śladem
    // „kręcącego się" wskaźnika postępu jest klasa animacji - bez niej kandydat
    // widzi spinacz i napis „Wysyłamy plik...", czyli statyczny formularz.
    expect(przycisk.querySelector(".animate-spin")).not.toBeNull();
    // Zablokowany przycisk nie wpuszcza drugiego pliku z danymi osobowymi.
    fireEvent.click(przycisk);
    expect(otwarcie).not.toHaveBeenCalled();

    await zwolnij();

    expect(screen.getByText("cv-anna-kowalska.pdf")).toBeInTheDocument();
    const poTransferze = screen.getByRole("button", { name: T("careers.form.cvChange") });
    expect(poTransferze).toBeEnabled();
    expect(poTransferze.querySelector(".animate-spin")).toBeNull();
  });

  it("wgranie pliku gasi poprzedni komunikat JESZCZE PRZED transferem i kasuje wpisany wcześniej link", async () => {
    const { container, onChangeSpy, onErrorSpy } = pole();
    // Kandydat najpierw wkleił link, potem podał plik spoza polityki - na
    // ekranie stoi komunikat, a w stanie rodzica wisi adres.
    fireEvent.change(screen.getByLabelText(T("careers.form.cvUrl")), {
      target: { value: "https://portfolio.example.com/cv-anna-kowalska" },
    });
    await wybierz(container, [plik("zyciorys.exe", "application/x-msdownload", 4096)]);
    expect(screen.getByRole("alert")).toHaveTextContent(T("careers.form.errors.cvType"));
    onChangeSpy.mockClear();
    onErrorSpy.mockClear();

    const zwolnij = zatrzymajTransfer();
    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);

    // KOLEJNOŚĆ, nie sam fakt: komunikat gaśnie, gdy transfer JESZCZE TRWA
    // (bramka wciąż trzyma `public_tenant_id()`), a rodzic nie dostał jeszcze
    // żadnej wartości - kandydat nie patrzy na błąd po poprzednim pliku.
    expect(onErrorSpy).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: T("careers.form.cvUploading") })).toBeDisabled();
    expect(onChangeSpy).not.toHaveBeenCalled();

    await zwolnij();

    // Plik ALBO link: przyjęty plik ZERUJE wcześniej wpisany adres, inaczej
    // zgłoszenie idzie z dwoma źródłami CV naraz.
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith({
      path: h.state.uploads[0].path,
      fileName: "cv-anna-kowalska.pdf",
      url: "",
    });
    expect(screen.queryByLabelText(T("careers.form.cvUrl"))).toBeNull();
  });
});

describe("CareerCvField: plik odrzucony", () => {
  it("plik ponad limit 5 MB nie leci do magazynu, a rodzic dostaje klucz cvTooLarge", async () => {
    const { container, onChangeSpy, onErrorSpy } = pole();

    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", CV_MAX_BYTES + 1)]);

    expect(onErrorSpy).toHaveBeenLastCalledWith("careers.form.errors.cvTooLarge");
    expect(screen.getByRole("alert")).toHaveTextContent(
      zeSlownika("careers.form.errors.cvTooLarge"),
    );
    // ZERO śladu w magazynie i ZERO wartości w formularzu.
    expect(h.state.uploads).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(T("careers.form.cvUrl"))).toBeInTheDocument();
  });

  it("plik niedozwolonego typu jest odrzucony przed jakąkolwiek rundą sieciową", async () => {
    const { container, onChangeSpy, onErrorSpy } = pole();

    await wybierz(container, [plik("zyciorys.exe", "application/x-msdownload", 4096)]);

    expect(onErrorSpy).toHaveBeenLastCalledWith("careers.form.errors.cvType");
    expect(screen.getByRole("alert")).toHaveTextContent(zeSlownika("careers.form.errors.cvType"));
    expect(h.state.uploads).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("awaria magazynu daje cvUploadFailed, nie rusza wartości pola i odblokowuje przycisk", async () => {
    h.state.uploadError = { message: "storage 500" };
    const { container, onChangeSpy, onErrorSpy } = pole();

    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);

    expect(h.state.uploads).toHaveLength(1);
    expect(onErrorSpy).toHaveBeenLastCalledWith("careers.form.errors.cvUploadFailed");
    expect(screen.getByRole("alert")).toHaveTextContent(
      zeSlownika("careers.form.errors.cvUploadFailed"),
    );
    expect(onChangeSpy).not.toHaveBeenCalled();
    // Kandydat może spróbować ponownie: stan „wysyłamy" jest zdjęty.
    expect(screen.getByRole("button", { name: T("careers.form.cvUpload") })).toBeEnabled();
  });

  it("odrzucony nowy plik nie kasuje załącznika przyjętego wcześniej", async () => {
    const { container, onChangeSpy } = pole({
      path: "tenant-testowy/uploads/2026-09-01/wczesniej.pdf",
      fileName: "cv-anna-kowalska.pdf",
      url: "",
    });

    await wybierz(container, [plik("zyciorys.exe", "application/x-msdownload", 4096)]);

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getByText("cv-anna-kowalska.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(T("careers.form.errors.cvType"));
  });

  it("anulowane okno wyboru (brak pliku) nie rusza ani rodzica, ani magazynu", async () => {
    const { container, onChangeSpy, onErrorSpy } = pole();

    await wybierz(container, []);
    await wybierz(container, null);

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(onErrorSpy).not.toHaveBeenCalled();
    expect(h.state.rpcCalls).toEqual([]);
    expect(h.state.uploads).toEqual([]);
  });
});

describe("CareerCvField: usunięcie pliku i ręczny link", () => {
  it("„Usuń plik” zwraca rodzicowi pusty rekord w całości i przywraca pole linku", async () => {
    const { container, onChangeSpy } = pole();
    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);
    onChangeSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: T("careers.form.cvRemove") }));

    // Naraz: ścieżka, nazwa i link - inaczej zgłoszenie idzie z załącznikiem,
    // którego kandydat już nie widzi.
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith({ path: "", fileName: "", url: "" });
    // Kopia, nie alias: rodzic trzyma ten rekord w stanie i modyfikuje go przez
    // `setValue`, więc oddanie mu współdzielonej stałej modułu (`EMPTY_CV`)
    // wystawiłoby wartość domyślną na zepsucie przez pierwsze pole formularza.
    expect(
      onChangeSpy.mock.calls[0][0],
      "pusty rekord musi być kopią, nie aliasem EMPTY_CV",
    ).not.toBe(EMPTY_CV);
    expect(screen.queryByText("cv-anna-kowalska.pdf")).toBeNull();
    expect(screen.getByLabelText(T("careers.form.cvUrl"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T("careers.form.cvUpload") })).toBeInTheDocument();
    // Usunięcie z formularza NIE kasuje pliku z bucketu - to robi job retencji
    // (`cvRetention`, powód `orphan`).
    expect(h.state.uploads).toHaveLength(1);
  });

  it("wpisany link zastępuje plik: rodzic dostaje sam adres, bez zastanej ścieżki i nazwy", () => {
    // Stan wejściowy modeluje odtworzony szkic: w rodzicu wisi jeszcze ścieżka
    // w buckecie, ale nazwy pliku nie ma (więc pole linku jest widoczne).
    // Handler linku musi ZERWAĆ tę ścieżkę, inaczej payload niesie plik i link.
    const { onChangeSpy } = pole({
      path: "tenant-testowy/uploads/2026-09-01/szkic.pdf",
      fileName: "",
      url: "",
    });

    fireEvent.change(screen.getByLabelText(T("careers.form.cvUrl")), {
      target: { value: "https://portfolio.example.com/cv-anna-kowalska" },
    });

    expect(onChangeSpy).toHaveBeenCalledWith({
      path: "",
      fileName: "",
      url: "https://portfolio.example.com/cv-anna-kowalska",
    });
    // Pole jest KONTROLOWANE wartością z rodzica: wpisany adres musi w nim
    // zostać, inaczej kandydat pisze w polu, które kasuje mu tekst pod palcami.
    expect(screen.getByLabelText(T("careers.form.cvUrl"))).toHaveValue(
      "https://portfolio.example.com/cv-anna-kowalska",
    );
  });
});

describe("CareerCvField: pole wewnątrz formularza kreatora", () => {
  it("klik „Wgraj CV” i „Usuń plik” nie wysyła formularza, w którym pole żyje", async () => {
    // Kontekst produkcyjny: pole stoi w `<form>` kreatora aplikacji. Przyciski
    // MUSZĄ być `type="button"` - domyślny `submit` zamieniłby wybór CV
    // w wysłanie zgłoszenia (albo w przejście kroku) bez reszty danych.
    const wyslanie = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { container } = render(
      <form onSubmit={wyslanie}>
        <Rodzic onChangeSpy={vi.fn()} onErrorSpy={vi.fn()} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: T("careers.form.cvUpload") }));
    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);
    const zmien = screen.getByRole("button", { name: T("careers.form.cvChange") });
    const usun = screen.getByRole("button", { name: T("careers.form.cvRemove") });
    fireEvent.click(zmien);
    fireEvent.click(usun);

    expect(wyslanie).not.toHaveBeenCalled();
    expect(zmien).toHaveAttribute("type", "button");
    expect(usun).toHaveAttribute("type", "button");
  });
});

describe("CareerCvField: dostępność", () => {
  it("kontrolka pliku ma nazwę ze słownika, a komunikat błędu jest powiązany aria z sekcją", async () => {
    const { container } = pole();
    // Ukryte pole pliku jest dostępne WYŁĄCZNIE przez swoją nazwę aria.
    expect(screen.getByLabelText(zeSlownika("careers.form.cvUpload"))).toBe(
      wejsciePliku(container),
    );

    await wybierz(container, [plik("zyciorys.exe", "application/x-msdownload", 4096)]);

    const alert = screen.getByRole("alert");
    expect(sekcja(container)).toHaveAttribute("data-invalid", "true");
    expect(sekcja(container).getAttribute("aria-describedby")).toBe(alert.getAttribute("id"));
    expect(alert.getAttribute("id")).toBeTruthy();
    // Rodzic po nieudanej walidacji woła `focus()` na tym kontenerze. Sam
    // skutek `focus()` NIE jest tu dowodem: happy-dom ustawia `activeElement`
    // na dowolnym elemencie, także takim bez `tabindex` (zmierzone mutacją -
    // zdjęcie `tabIndex={-1}` przechodziło przez asercję na `activeElement`).
    // Dowodem programowej fokusowalności jest w tej warstwie atrybut; że sam
    // skok fokusu robi rodzic, dowodzi `careersApplyForm.test.tsx`.
    expect(sekcja(container)).toHaveAttribute("tabindex", "-1");
    sekcja(container).focus();
    expect(document.activeElement).toBe(sekcja(container));
    // ZNALEZISKO (zachowanie istniejące): opis wisi na kontenerze, a nie na
    // kontrolkach - pole pliku i pole linku nie mają ani `aria-describedby`,
    // ani `aria-invalid`.
    expect(wejsciePliku(container).getAttribute("aria-describedby")).toBeNull();
    expect(wejsciePliku(container).getAttribute("aria-invalid")).toBeNull();
  });

  it("nie ma naruszeń axe w stanie pustym", async () => {
    const { container } = pole();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie ma naruszeń axe w stanie „wybrany plik + komunikat błędu”", async () => {
    const { container } = pole();
    await wybierz(container, [plik("cv-anna-kowalska.pdf", "application/pdf", 2048)]);
    await wybierz(container, [plik("zyciorys.exe", "application/x-msdownload", 4096)]);

    expect(screen.getByText("cv-anna-kowalska.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
