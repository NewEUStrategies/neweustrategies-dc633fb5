// CO DOWODZI TEN PLIK
//
// Reguła gotowości kanału dla katalogu Apple Podcasts. Przedmiotem dowodu jest
// LISTA BRAKÓW: które pole, z jaką wagą i pod jakim kluczem i18n.
//
// KONSEKWENCJA DEFEKTU. Kanał bez wymaganego tagu nie wchodzi do katalogu albo
// wchodzi w złym miejscu, a awaria jest CICHA: `buildPodcastRssXml` jest
// fail-safe (podstawia kategorię domyślną, bierze okładkę pierwszego odcinka,
// emituje `explicit=no` za nieustawioną flagę), więc feed wygląda poprawnie i
// nikt nie widzi problemu, dopóki ktoś nie zauważy, że audycji nie ma w Apple.
// Ta reguła jest jedynym miejscem, które wygaduje to na głos - więc fałszywie
// zielona reguła jest gorsza niż brak karty.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Starszej checklisty panelu
// (`src/lib/seo/__tests__/podcastFeedReadiness.test.ts` - kody blocking i
// warnings), scalania warstw z wierszy bazy
// (`podcastChannelMeta.test.ts`), taksonomii kategorii
// (`applePodcastCategories.test.ts`) ani emisji XML (`podcastRss.test.ts`).
// Tu sprawdzamy wyłącznie regułę i jej adaptery.
//
// RODO: wszystkie adresy na `example.com` / `example.org`, nazwa audycji,
// wydawcy i redakcji zmyślona.
import { describe, expect, it } from "vitest";

import {
  APPLE_IMAGE_MAX_PX,
  APPLE_IMAGE_MIN_PX,
  applePodcastBlockingGaps,
  applePodcastGaps,
  applePodcastGapsFromReadiness,
  applePodcastWarningGaps,
  isApplePodcastOwnerEmail,
  isApplePodcastSubmittable,
  mergeApplePodcastMeta,
  resolveApplePodcastGaps,
  type ApplePodcastChannelMeta,
  type ApplePodcastGap,
  type ApplePodcastShowOverride,
} from "@/lib/podcast/applePodcast";

/** Kanał, który Apple przyjmie bez zastrzeżeń - punkt odniesienia tabel. */
const KOMPLETNY: ApplePodcastChannelMeta = {
  title: "Bruksela na Wschodzie",
  description: "Cotygodniowy przeglad polityki europejskiej.",
  language: "pl",
  category: "News",
  explicit: false,
  author: "Instytut Spraw Zmyslonych",
  ownerName: "Redakcja Brukseli na Wschodzie",
  ownerEmail: "redakcja@example.com",
  imageUrl: "https://cdn.example.org/okladka-3000.jpg",
  imageWidth: 3000,
  imageHeight: 3000,
};

/**
 * Podpis braku w postaci czytelnej w tabeli: `waga:pole:kod`. Kod to ostatni
 * segment klucza i18n - pełny klucz (z segmentem `blocking`/`warnings`)
 * asertuje osobny test niżej, żeby tabele nie tonęły w prefiksie.
 */
function podpis(gaps: readonly ApplePodcastGap[]): string[] {
  return gaps.map((gap) => {
    const kod = gap.messageKey.split(".").at(-1);
    return `${gap.severity}:${gap.field}:${kod}`;
  });
}

const kanal = (patch: Partial<ApplePodcastChannelMeta>): ApplePodcastChannelMeta => ({
  ...KOMPLETNY,
  ...patch,
});

describe("applePodcastGaps - kanał kompletny", () => {
  it("nie zgłasza żadnego braku i pozwala zgłosić kanał", () => {
    const gaps = applePodcastGaps(KOMPLETNY);
    expect(podpis(gaps)).toEqual([]);
    expect(isApplePodcastSubmittable(gaps)).toBe(true);
  });

  it("jest deterministyczna: dwa wywołania dają identyczny wynik", () => {
    // Reguła nie może zależeć od czasu ani od kolejności kluczy obiektu -
    // inaczej karta migałaby brakami między renderami.
    expect(applePodcastGaps(KOMPLETNY)).toEqual(applePodcastGaps(KOMPLETNY));
  });

  it("nie mutuje wejścia", () => {
    const wejscie = kanal({});
    const kopia = { ...wejscie };
    applePodcastGaps(wejscie);
    expect(wejscie).toEqual(kopia);
  });
});

describe("applePodcastGaps - każdy brak osobno", () => {
  const PRZYPADKI: ReadonlyArray<[string, Partial<ApplePodcastChannelMeta>, string[]]> = [
    // --- tytuł, opis, język: puste znaczy puste, także w samych białych znakach
    ["brak tytułu (null)", { title: null }, ["blocking:title:title"]],
    ["brak tytułu (pusty napis)", { title: "" }, ["blocking:title:title"]],
    ["brak tytułu (same białe znaki)", { title: "   " }, ["blocking:title:title"]],
    ["brak opisu", { description: null }, ["blocking:description:description"]],
    ["brak opisu (tabulator)", { description: "\t" }, ["blocking:description:description"]],
    ["brak języka", { language: null }, ["blocking:language:language"]],
    ["brak języka (pusty napis)", { language: "" }, ["blocking:language:language"]],

    // --- kategoria: brak i nazwa poza taksonomią to DWA różne komunikaty
    ["brak kategorii", { category: null }, ["blocking:category:category"]],
    [
      "kategoria poza taksonomią Apple",
      { category: "Polityka europejska" },
      ["blocking:category:categoryUnknown"],
    ],
    [
      // `normalizeAppleCategory` używa `in`, więc „constructor" przechodzi tam
      // jako znana kategoria (defekt przypięty w applePodcastCategories.test).
      // Reguła gotowości pyta TABLICĘ nazw, więc jest na to odporna.
      "kategoria z prototypu Object nie jest kategorią Apple",
      { category: "constructor" },
      ["blocking:category:categoryUnknown"],
    ],
    ["kategoria bez podkategorii jest poprawna", { category: "History" }, []],

    // --- explicit: brak decyzji to brak blokujący, bo builder decyduje za nas
    ["brak deklaracji explicit (null)", { explicit: null }, ["blocking:explicit:explicit"]],
    [
      "brak deklaracji explicit (undefined)",
      { explicit: undefined },
      ["blocking:explicit:explicit"],
    ],
    ["explicit ustawiony na true", { explicit: true }, []],

    // --- okładka
    ["brak okładki", { imageUrl: null }, ["blocking:imageUrl:image"]],
    ["brak okładki (białe znaki)", { imageUrl: "  " }, ["blocking:imageUrl:image"]],
    [
      "okładka po http zamiast https",
      { imageUrl: "http://cdn.example.org/okladka-3000.jpg" },
      ["blocking:imageUrl:imageProtocol"],
    ],
    [
      "okładka po HTTPS wielkimi literami jest poprawna",
      { imageUrl: "HTTPS://cdn.example.org/okladka-3000.jpg" },
      [],
    ],
    [
      "okładka po protokole względnym (bez schematu) jest brakiem protokołu",
      { imageUrl: "//cdn.example.org/okladka-3000.jpg" },
      ["blocking:imageUrl:imageProtocol"],
    ],
    [
      "okładka prostokątna",
      { imageWidth: 3000, imageHeight: 1500 },
      ["blocking:imageUrl:imageSquare"],
    ],
    [
      "okładka kwadratowa, ale mniejsza niż minimum Apple",
      { imageWidth: APPLE_IMAGE_MIN_PX - 1, imageHeight: APPLE_IMAGE_MIN_PX - 1 },
      ["blocking:imageUrl:imageSize"],
    ],
    [
      "okładka kwadratowa, ale większa niż maksimum Apple",
      { imageWidth: APPLE_IMAGE_MAX_PX + 1, imageHeight: APPLE_IMAGE_MAX_PX + 1 },
      ["blocking:imageUrl:imageSize"],
    ],
    [
      "okładka dokładnie na dolnej granicy",
      { imageWidth: APPLE_IMAGE_MIN_PX, imageHeight: APPLE_IMAGE_MIN_PX },
      [],
    ],
    [
      "okładka dokładnie na górnej granicy",
      { imageWidth: APPLE_IMAGE_MAX_PX, imageHeight: APPLE_IMAGE_MAX_PX },
      [],
    ],
    [
      // Rozmiaru nie da się wyczytać z URL-a; znamy go tylko dla plików z
      // biblioteki mediów. Połowa wymiarów to wciąż „nie wiemy".
      "nieznany rozmiar okładki nie jest brakiem",
      { imageWidth: null, imageHeight: null },
      [],
    ],
    ["znana tylko szerokość okładki nie jest brakiem", { imageHeight: null }, []],
    ["znana tylko wysokość okładki nie jest brakiem", { imageWidth: null }, []],

    // --- e-mail właściciela
    ["brak e-maila właściciela", { ownerEmail: null }, ["blocking:ownerEmail:ownerEmail"]],
    [
      "brak e-maila właściciela (białe znaki)",
      { ownerEmail: " \n " },
      ["blocking:ownerEmail:ownerEmail"],
    ],
    [
      "e-mail właściciela bez domeny",
      { ownerEmail: "redakcja" },
      ["blocking:ownerEmail:ownerEmailShape"],
    ],
    [
      "e-mail właściciela w kopercie z nazwą",
      { ownerEmail: "Redakcja <redakcja@example.com>" },
      ["blocking:ownerEmail:ownerEmailShape"],
    ],
    [
      "dwa adresy w polu na jeden adres",
      { ownerEmail: "redakcja@example.com, biuro@example.org" },
      ["blocking:ownerEmail:ownerEmailShape"],
    ],
    [
      "e-mail właściciela z otoczką białych znaków jest poprawny",
      { ownerEmail: "  redakcja@example.com  " },
      [],
    ],

    // --- zalecenia
    ["brak nazwy wydawcy", { author: null }, ["warning:author:author"]],
    [
      // `podcastRss` emituje `<itunes:name>` z `author`, gdy `ownerName` jest
      // puste - więc to NIE jest brak w feedzie i nie może być alarmem.
      "brak nazwy właściciela przy wypełnionym wydawcy nie jest brakiem",
      { ownerName: null },
      [],
    ],
    [
      "brak wydawcy i właściciela naraz to dwa zalecenia",
      { author: null, ownerName: null },
      ["warning:author:author", "warning:ownerName:ownerName"],
    ],
  ];

  it.each(PRZYPADKI)("%s", (_opis, patch, oczekiwane) => {
    expect(podpis(applePodcastGaps(kanal(patch)))).toEqual(oczekiwane);
  });
});

describe("applePodcastGaps - kombinacje braków", () => {
  it("pusty kanał zgłasza wszystkie braki w kolejności deklaracji sprawdzeń", () => {
    // Kolejność jest częścią kontraktu: karta renderuje listę bez sortowania,
    // więc przetasowanie sprawdzeń przetasowałoby komunikaty na ekranie.
    expect(podpis(applePodcastGaps({}))).toEqual([
      "blocking:title:title",
      "blocking:description:description",
      "blocking:language:language",
      "blocking:category:category",
      "blocking:explicit:explicit",
      "blocking:imageUrl:image",
      "blocking:ownerEmail:ownerEmail",
      "warning:author:author",
      "warning:ownerName:ownerName",
    ]);
  });

  it("okładka po http i prostokątna naraz daje DWA braki dla jednego pola", () => {
    // Dlatego klucz `<li>` w karcie nie może być samym polem.
    const gaps = applePodcastGaps(
      kanal({ imageUrl: "http://cdn.example.org/banner.jpg", imageWidth: 1600, imageHeight: 900 }),
    );
    expect(podpis(gaps)).toEqual([
      "blocking:imageUrl:imageProtocol",
      "blocking:imageUrl:imageSquare",
    ]);
  });

  it("okładka po http i za mała naraz nie zgłasza jednocześnie kwadratu i rozmiaru", () => {
    const gaps = applePodcastGaps(
      kanal({ imageUrl: "http://cdn.example.org/male.jpg", imageWidth: 600, imageHeight: 600 }),
    );
    expect(podpis(gaps)).toEqual([
      "blocking:imageUrl:imageProtocol",
      "blocking:imageUrl:imageSize",
    ]);
  });

  it("zły e-mail przy braku kategorii nie zasłania kategorii", () => {
    const gaps = applePodcastGaps(kanal({ category: "  ", ownerEmail: "redakcja@example" }));
    expect(podpis(gaps)).toEqual([
      "blocking:category:category",
      "blocking:ownerEmail:ownerEmailShape",
    ]);
  });

  it("same zalecenia NIE blokują zgłoszenia, a jedno blokujące blokuje", () => {
    const tylkoZalecenia = applePodcastGaps(kanal({ author: null, ownerName: null }));
    expect(isApplePodcastSubmittable(tylkoZalecenia)).toBe(true);

    const zBlokujacym = applePodcastGaps(kanal({ ownerEmail: null, author: null }));
    expect(isApplePodcastSubmittable(zBlokujacym)).toBe(false);
  });
});

describe("applePodcastGaps - klucze i18n", () => {
  it("braki blokujące i zalecenia siedzą w rozdzielnych gałęziach słownika", () => {
    // Karta nie tłumaczy kodów sama - dostaje gotowy klucz. Wspólny prefiks
    // dla obu wag oznaczałby, że „author" jako brak blokujący i jako zalecenie
    // pokazałyby to samo zdanie.
    const gaps = applePodcastGaps({});
    for (const gap of gaps) {
      const oczekiwanyPrefiks =
        gap.severity === "blocking"
          ? "adminPodcasts.settings.apple.blocking."
          : "adminPodcasts.settings.apple.warnings.";
      expect({
        pole: gap.field,
        prefiks: gap.messageKey.slice(0, oczekiwanyPrefiks.length),
      }).toEqual({ pole: gap.field, prefiks: oczekiwanyPrefiks });
    }
  });

  it("żaden klucz nie jest zbudowany z pustego kodu", () => {
    const gaps = applePodcastGaps(kanal({ category: "Polityka europejska" }));
    for (const gap of gaps) {
      expect(gap.messageKey.endsWith(".")).toBe(false);
    }
  });
});

describe("isApplePodcastOwnerEmail - kontrola narzędzia", () => {
  // Predykat jest własny (nie ma tu biblioteki do walidacji adresu), więc musi
  // udowodnić, że ODRZUCA to, co ma odrzucać - inaczej „walidacja kształtu"
  // przepuszczałaby wszystko i karta świeciłaby zielono dla adresu, na który
  // Apple nigdy nie wyśle kodu weryfikacyjnego.
  const ZLE: ReadonlyArray<[string, string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same białe znaki", "   "],
    ["bez małpy", "redakcja.example.com"],
    ["bez części lokalnej", "@example.com"],
    ["bez domeny", "redakcja@"],
    ["domena bez kropki", "redakcja@example"],
    ["domena z pustą etykietą", "redakcja@example..com"],
    ["domena zaczynająca się kropką", "redakcja@.example.com"],
    ["kropka na końcu domeny", "redakcja@example.com."],
    ["dwie małpy", "redakcja@@example.com"],
    ["spacja w części lokalnej", "red akcja@example.com"],
    ["spacja w domenie", "redakcja@exa mple.com"],
    ["przecinek rozdzielający adresy", "redakcja@example.com,biuro@example.org"],
    ["średnik rozdzielający adresy", "redakcja@example.com;biuro@example.org"],
    ["koperta z nazwą", "Redakcja <redakcja@example.com>"],
    ["nowa linia w środku", "redakcja@example.com\nbiuro@example.org"],
    ["adres dłuższy niż koperta SMTP", `${"a".repeat(250)}@example.com`],
  ];

  it.each(ZLE)("odrzuca adres: %s", (_opis, wartosc) => {
    expect(isApplePodcastOwnerEmail(wartosc)).toBe(false);
  });

  const DOBRE: ReadonlyArray<[string, string]> = [
    ["zwykły adres redakcji", "redakcja@example.com"],
    ["adres z kropką i tagiem", "podcast.redakcja+apple@example.org"],
    ["adres wielkimi literami", "REDAKCJA@EXAMPLE.COM"],
    ["adres z dywizem", "podcast-redakcja@example.org"],
    ["poddomena", "redakcja@mail.example.org"],
    ["otoczka białych znaków (przycinana)", "  redakcja@example.com  "],
  ];

  it.each(DOBRE)("przyjmuje adres: %s", (_opis, wartosc) => {
    expect(isApplePodcastOwnerEmail(wartosc)).toBe(true);
  });
});

describe("mergeApplePodcastMeta - nadpisania programu", () => {
  const PROGRAM: ApplePodcastShowOverride = {
    title: "Wschod bez filtra",
    ownerEmail: "program@example.org",
  };

  it("niepuste nadpisanie programu wygrywa, puste dziedziczy z kanału", () => {
    const meta = mergeApplePodcastMeta(kanal({}), { ...PROGRAM, description: "   ", author: null });
    expect(meta.title).toBe("Wschod bez filtra");
    expect(meta.ownerEmail).toBe("program@example.org");
    // Puste nadpisanie NIE wymazuje wartości kanału - to reguła
    // `resolvePodcastChannelMeta` i musi być tu identyczna.
    expect(meta.description).toBe(KOMPLETNY.description);
    expect(meta.author).toBe(KOMPLETNY.author);
  });

  it("brak nadpisań (undefined) zwraca przyciętą warstwę kanału", () => {
    const meta = mergeApplePodcastMeta({ title: "  Bruksela na Wschodzie  ", language: "" });
    expect(meta.title).toBe("Bruksela na Wschodzie");
    expect(meta.language).toBeNull();
    expect(meta.explicit).toBeNull();
    expect(meta.imageWidth).toBeNull();
  });

  it("`explicit: false` programu przesłania `true` kanału", () => {
    // `??`, nie `||` - inaczej program deklarujący treści bezpieczne
    // dziedziczyłby ostrzeżenie kanału i tracił odbiorców.
    const meta = mergeApplePodcastMeta(kanal({ explicit: true }), { explicit: false });
    expect(meta.explicit).toBe(false);
  });

  it("wymiary okładki idą Z TEJ SAMEJ warstwy co adres okładki", () => {
    // Program z własną okładką nie może odziedziczyć rozmiaru pliku kanału -
    // reguła oceniałaby wtedy nie ten obraz, który pójdzie do Apple.
    const meta = mergeApplePodcastMeta(kanal({}), {
      imageUrl: "https://cdn.example.org/program.jpg",
    });
    expect(meta.imageUrl).toBe("https://cdn.example.org/program.jpg");
    expect({ w: meta.imageWidth, h: meta.imageHeight }).toEqual({ w: null, h: null });
  });
});

describe("applePodcastGaps - nadpisania programu", () => {
  it("nadpisanie programu ZASŁANIA brak kanału", () => {
    const bezEmaila = kanal({ ownerEmail: null });
    expect(podpis(applePodcastGaps(bezEmaila))).toEqual(["blocking:ownerEmail:ownerEmail"]);
    expect(podpis(applePodcastGaps(bezEmaila, { ownerEmail: "program@example.org" }))).toEqual([]);
  });

  it("nadpisanie programu WPROWADZA brak w kanale bez braków", () => {
    // To jest cichy scenariusz, na który nie ma innego czujnika: kanał
    // sieciowy jest kompletny, a program przesłania jego dane wartością, którą
    // Apple odrzuci - i to program, nie kanał, jest zgłaszany do katalogu.
    expect(podpis(applePodcastGaps(KOMPLETNY, { ownerEmail: "program@example" }))).toEqual([
      "blocking:ownerEmail:ownerEmailShape",
    ]);
    expect(podpis(applePodcastGaps(KOMPLETNY, { category: "Polityka europejska" }))).toEqual([
      "blocking:category:categoryUnknown",
    ]);
    expect(
      podpis(applePodcastGaps(KOMPLETNY, { imageUrl: "http://cdn.example.org/program.jpg" })),
    ).toEqual(["blocking:imageUrl:imageProtocol"]);
  });

  it("nadpisanie okładki programu jest oceniane WŁASNYM rozmiarem", () => {
    expect(
      podpis(
        applePodcastGaps(KOMPLETNY, {
          imageUrl: "https://cdn.example.org/program-800.jpg",
          imageWidth: 800,
          imageHeight: 800,
        }),
      ),
    ).toEqual(["blocking:imageUrl:imageSize"]);
  });

  it("nadpisanie programu bez wymiarów nie dziedziczy wymiarów kanału", () => {
    // Kanał ma znany kwadrat 3000 px; program podaje inny plik bez rozmiaru.
    // Reguła musi wtedy MILCZEĆ o rozmiarze, a nie zakładać, że jest dobry.
    expect(
      podpis(applePodcastGaps(KOMPLETNY, { imageUrl: "https://cdn.example.org/program.jpg" })),
    ).toEqual([]);
  });

  it("nadpisanie programu na `null` nie wymazuje danych kanału", () => {
    expect(podpis(applePodcastGaps(KOMPLETNY, { ownerEmail: null, title: null }))).toEqual([]);
  });
});

describe("filtry i predykat na liście braków", () => {
  const GAPS = applePodcastGaps({});

  it("rozdziela braki blokujące od zaleceń", () => {
    expect(applePodcastBlockingGaps(GAPS).map((g) => g.field)).toEqual([
      "title",
      "description",
      "language",
      "category",
      "explicit",
      "imageUrl",
      "ownerEmail",
    ]);
    expect(applePodcastWarningGaps(GAPS).map((g) => g.field)).toEqual(["author", "ownerName"]);
  });

  it("pusta lista braków znaczy gotowy kanał", () => {
    expect(isApplePodcastSubmittable([])).toBe(true);
    expect(applePodcastBlockingGaps([])).toEqual([]);
    expect(applePodcastWarningGaps([])).toEqual([]);
  });
});

describe("applePodcastGapsFromReadiness - adapter starszej checklisty", () => {
  it("przenosi kody na pola i zachowuje kolejność: najpierw blokujące", () => {
    const gaps = applePodcastGapsFromReadiness({
      ready: false,
      blocking: ["image", "ownerEmail", "episodes"],
      warnings: ["author", "enclosureLength"],
    });
    expect(podpis(gaps)).toEqual([
      // Kod „image" ma w tej warstwie inną nazwę niż pole formularza, więc
      // adapter musi go przemapować - inaczej karta nie wskaże kontrolki.
      "blocking:imageUrl:image",
      "blocking:ownerEmail:ownerEmail",
      "blocking:episodes:episodes",
      "warning:author:author",
      "warning:enclosureLength:enclosureLength",
    ]);
  });

  it("gotowa checklista daje pustą listę braków", () => {
    const gaps = applePodcastGapsFromReadiness({ ready: true, blocking: [], warnings: [] });
    expect(gaps).toEqual([]);
    expect(isApplePodcastSubmittable(gaps)).toBe(true);
  });

  it("nieznany kod nie ginie - trafia na listę jako pole `unknown`", () => {
    // Dopisanie kodu do checklisty bez dopisania go tu nie może CICHO usuwać
    // braku z ekranu; brak z surowym kluczem jest widoczny, brak bez wiersza
    // nie jest.
    const gaps = applePodcastGapsFromReadiness({
      ready: false,
      blocking: ["transcript"],
      warnings: ["chapters"],
    });
    expect(podpis(gaps)).toEqual(["blocking:unknown:transcript", "warning:unknown:chapters"]);
    expect(isApplePodcastSubmittable(gaps)).toBe(false);
  });
});

describe("resolveApplePodcastGaps - która droga wejścia wygrywa", () => {
  const GOTOWE: readonly ApplePodcastGap[] = [
    {
      field: "title",
      severity: "blocking",
      messageKey: "adminPodcasts.settings.apple.blocking.title",
    },
  ];

  it("gotowa lista braków ma pierwszeństwo nad metadanymi", () => {
    expect(resolveApplePodcastGaps({ gaps: GOTOWE, channel: {} })).toEqual(GOTOWE);
  });

  it("metadane mają pierwszeństwo nad starszą checklistą", () => {
    const gaps = resolveApplePodcastGaps({
      channel: KOMPLETNY,
      readiness: { ready: false, blocking: ["image"], warnings: [] },
    });
    expect(podpis(gaps)).toEqual([]);
  });

  it("metadane liczą się razem z nadpisaniami programu", () => {
    const gaps = resolveApplePodcastGaps({
      channel: KOMPLETNY,
      show: { imageUrl: "http://cdn.example.org/program.jpg" },
    });
    expect(podpis(gaps)).toEqual(["blocking:imageUrl:imageProtocol"]);
  });

  it("sama checklista przechodzi przez adapter", () => {
    const gaps = resolveApplePodcastGaps({
      readiness: { ready: false, blocking: ["episodes"], warnings: ["duration"] },
    });
    expect(podpis(gaps)).toEqual(["blocking:episodes:episodes", "warning:duration:duration"]);
  });

  it("pusta lista braków podana WPROST nie spada na inne drogi", () => {
    // `[]` to informacja („nie ma braków"), a nie brak informacji - inaczej
    // karta cofnęłaby się do nieaktualnej checklisty.
    expect(
      resolveApplePodcastGaps({
        gaps: [],
        channel: {},
        readiness: { ready: false, blocking: ["image"], warnings: [] },
      }),
    ).toEqual([]);
  });

  it("brak wszystkich trzech dróg daje pustą listę", () => {
    expect(resolveApplePodcastGaps({})).toEqual([]);
    expect(resolveApplePodcastGaps({ gaps: null, channel: null, readiness: null })).toEqual([]);
  });
});
