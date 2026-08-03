// Rdzeń inwariantu "wierność ustawień widgetu": panel ⇄ renderer.
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Metryka "100/100 typów bloków, pełne pokrycie rejestru" była ODPORNA na całą
// klasę defektów: widget istniał, renderował się, miał panel - a pojedyncze
// ustawienia były martwe albo kłamliwe. Panel oferował `autoplay` karuzeli,
// warianty akordeonu, kolumny tablet/telefon, `showTitle`/`authorDisplay`
// slidera; renderer nie czytał żadnego z nich. Odwrotnie: renderer czytał
// `brand`, `showYear`, `text_pl` widgetu `copyright`, a panel mówił "Brak
// edytowalnych pól". Najgorszy wariant to rozjazd nazwy klucza: kontrolka TOC
// pisała `items`, widget czytał `items_${lang}` - oba końce "działały",
// ustawienie nie robiło nic. Testy punktowe (PR #141) naprawiły ~40 przypadków,
// ale nie postawiły bramki - klasa mogła wrócić przy następnym widgecie.
//
// ROZWIĄZANIE: OBSERWACJA WYKONANIA, NIE STATYCZNY MANIFEST
// Zamiast utrzymywać ręczną listę "kto co czyta" (która sama by się rozjechała),
// oba końce są MIERZONE. Treść widgetu wjeżdża w Proxy notujące każdy odczyt
// klucza, a bramka renderuje ten sam widget dwa razy:
//   1. przez panel właściwości -> zbiór kluczy OFEROWANYCH redakcji,
//   2. przez renderer publiczny -> zbiór kluczy CZYTANYCH przy renderze.
// Różnica symetryczna tych zbiorów to lista defektów:
//   - klucz tylko w panelu  -> ustawienie MARTWE (obietnica bez pokrycia),
//   - klucz tylko w rendererze -> ustawienie UKRYTE (nieedytowalne).
// Rozjazd `items` vs `items_pl` łapie się sam, bo porównujemy DOKŁADNE klucze
// magazynowe, nie bazowe: `items` ≠ `items_pl`.
//
// Moduł jest czysty (bez Reacta, DOM-u i I/O) - żeby generator próbek i logika
// różnicy dały się testować bez montowania czegokolwiek.
import type { Json, WidgetContent } from "../types";
import type { SchemaField } from "../schemas";

/** Języki treści buildera. Każde pole i18n żyje jako para `${key}_pl|_en`. */
export const CONTENT_LANGS = ["pl", "en"] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

const LANG_SUFFIX_RE = /_(pl|en)$/;

/** Klucz bazowy pola i18n: `title_pl` -> `title`. Pozostałe zwraca bez zmian. */
export function baseContentKey(key: string): string {
  return key.replace(LANG_SUFFIX_RE, "");
}

/** Czy klucz jest zlokalizowanym wariantem (`*_pl` / `*_en`). */
export function isLangScopedKey(key: string): boolean {
  return LANG_SUFFIX_RE.test(key);
}

/**
 * Domyka zbiór kluczy o rodzeństwo językowe: odczyt `title_pl` implikuje
 * `title_en` i odwrotnie.
 *
 * Dzięki temu bramka mierzy każdą stronę TYLKO w jednym języku (panel jest
 * kosztowny w renderze), nie tracąc czułości na najgroźniejszy wariant defektu:
 * rozjazd nazwy klucza. `items` nadal NIE jest równe `items_pl` - domykanie
 * dodaje rodzeństwo, nie ucina sufiksu.
 *
 * Świadomy koszt: renderer, który zaszył `title_pl` zamiast `title_${lang}`,
 * przejdzie TĘ bramkę. Pilnuje go osobny, tańszy test
 * (`widgetViewI18nFallback.test.tsx`) - jeden inwariant, jedna
 * odpowiedzialność.
 */
export function withLangSiblings(keys: Iterable<string>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of keys) {
    out.add(key);
    const base = baseContentKey(key);
    if (base === key) continue;
    for (const lang of CONTENT_LANGS) out.add(`${base}_${lang}`);
  }
  return out;
}

/**
 * Nazwy, które Proxy widzi jako odczyt, choć NIGDY nie są ustawieniem widgetu.
 *
 * React (`$$typeof`), silnik obietnic (`then`), serializacja (`toJSON`) i
 * prototyp obiektu odpytują worek treści przy zwykłym przekazywaniu go dalej.
 * Bez tego filtra każdy widget miałby fałszywe "ukryte ustawienie".
 */
export const RESERVED_CONTENT_READS: ReadonlySet<string> = new Set([
  "$$typeof",
  "then",
  "toJSON",
  "constructor",
  "prototype",
  "__proto__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "toLocaleString",
  "nodeType",
  "length",
  "key",
  "ref",
  "props",
]);

/** Dziennik odczytów jednego worka treści. */
export interface ContentReadLog {
  /** Dokładne klucze magazynowe, o które odpytano worek. */
  readonly reads: ReadonlySet<string>;
  /**
   * `true`, gdy ktoś wyliczył WSZYSTKIE klucze (spread `{...content}`,
   * `Object.keys`, `JSON.stringify`). Taki odczyt nie dowodzi, że pojedyncze
   * ustawienie jest naprawdę używane, więc bramka musi go zgłosić jawnie,
   * a nie policzyć jako pokrycie.
   */
  readonly enumerated: boolean;
}

interface MutableLog {
  reads: Set<string>;
  enumerated: boolean;
}

/**
 * Owija worek treści w Proxy notujące odczyty.
 *
 * Trapy `get` / `has` / `getOwnPropertyDescriptor` liczą się jako odczyt
 * pojedynczego klucza; `ownKeys` (spread, `Object.keys`) ustawia flagę
 * `enumerated`, bo wylicza wszystko naraz i nie dowodzi użycia niczego.
 */
export function trackContentReads<T extends object>(bag: T): { tracked: T; log: ContentReadLog } {
  const log: MutableLog = { reads: new Set<string>(), enumerated: false };
  const note = (prop: string | symbol): void => {
    if (typeof prop !== "string") return;
    if (RESERVED_CONTENT_READS.has(prop)) return;
    log.reads.add(prop);
  };
  const tracked = new Proxy(bag, {
    get(target, prop, receiver) {
      note(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      note(prop);
      return Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      note(prop);
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    ownKeys(target) {
      log.enumerated = true;
      return Reflect.ownKeys(target);
    },
  });
  return { tracked, log: log as ContentReadLog };
}

/** Jedna próbka treści: etykieta (do komunikatu błędu) + worek. */
export interface ContentProbe {
  readonly label: string;
  readonly content: WidgetContent;
}

/**
 * Pozycje listy w próbkach. Są URL-ami obrazów, bo renderery mediów filtrują
 * pozycje przez `safeImageUrl` - zwykły napis wypadłby i widget pokazałby stan
 * pusty zamiast swojej realnej gałęzi.
 */
const PROBE_LIST_ITEMS: ReadonlyArray<string> = [
  "https://example.org/probe-1.jpg",
  "https://example.org/probe-2.jpg",
  "https://example.org/probe-3.jpg",
];

/** Który koniec zakresu wstawić w pola liczbowe danej próbki. */
type NumberEdge = "default" | "min" | "max";

/**
 * Wartość próbna dla pola schematu - wystarczająco "prawdziwa", by renderer
 * wszedł w gałąź zależną od obecności wartości (pusty string albo `0` bywa
 * traktowany jako brak i cicho gasi całą sekcję).
 */
function probeEntries(
  field: SchemaField,
  bools: boolean,
  numberEdge: NumberEdge = "default",
): Record<string, Json> {
  const { key, type } = field;
  const num = (): number => {
    const min = field.min ?? Number.NEGATIVE_INFINITY;
    const max = field.max ?? Number.POSITIVE_INFINITY;
    // Pola widoczne warunkowo bywają zależne od LICZBY ("wyrównanie rozdzielacza
    // ma sens tylko przy szerokości < 100%"). Próbkowanie wyłącznie wartością
    // domyślną nigdy nie spełniłoby takiego warunku, więc bramka mierzy też
    // oba końce zakresu.
    if (numberEdge === "min" && field.min !== undefined) return field.min;
    if (numberEdge === "max" && field.max !== undefined) return field.max;
    const fallback = typeof field.default === "number" ? field.default : (field.min ?? 1);
    return Math.min(max, Math.max(min, fallback || (field.min ?? 1) || 1));
  };
  switch (type) {
    case "i18nText":
      return { [`${key}_pl`]: "Próbka PL", [`${key}_en`]: "Probe EN" };
    case "i18nHtml":
      return { [`${key}_pl`]: "<p>Próbka PL</p>", [`${key}_en`]: "<p>Probe EN</p>" };
    // Listy dostają URL-e, nie zwykłe napisy: renderery mediów (galeria, chmura
    // logotypów) przepuszczają każdą pozycję przez `safeImageUrl`, więc lista
    // typu ["Probe A"] wypada do zera i widget renderuje stan pusty - a wtedy
    // jego ustawienia prezentacji nigdy nie są czytane. URL jest jednocześnie
    // poprawnym napisem, więc listy tekstowe nic nie tracą.
    case "i18nStringArray":
      return {
        [`${key}_pl`]: [...PROBE_LIST_ITEMS],
        [`${key}_en`]: [...PROBE_LIST_ITEMS],
      };
    case "stringArray":
      return { [key]: [...PROBE_LIST_ITEMS] };
    case "bool":
      return { [key]: bools };
    case "number":
      return { [key]: num() };
    case "select": {
      const first = field.options?.[0]?.value;
      const value = typeof field.default === "string" ? field.default : first;
      return value === undefined ? {} : { [key]: value };
    }
    case "color":
      return { [key]: "#3b82f6" };
    case "url":
      return { [key]: "https://example.org/probe" };
    case "image":
      return { [key]: "https://example.org/probe.jpg" };
    case "icon":
      return { [key]: "Star" };
    case "chartData":
      return { [key]: "Etykieta,Wartość\nA,1\nB,2" };
    case "textarea":
    case "text":
    default:
      return { [key]: typeof field.default === "string" ? field.default : "Probe" };
  }
}

/**
 * Zakres próbkowania. Panel rozgałęzia się WYŁĄCZNIE przez `visibleWhen`, więc
 * enumerowanie opcji, których żaden predykat nie wymienia, jest dla niego czystą
 * stratą (render panelu jest ~20× droższy od renderu widgetu). Renderer
 * rozgałęzia się sam - po wariancie, układzie, źródle danych - więc dostaje
 * szerszy zestaw.
 */
export type ProbeScope = "panel" | "renderer";

/**
 * Pola `select`, których wartość steruje widocznością innych pól ALBO gałęzią
 * wariantu w rendererze. Dla nich generujemy próbkę na każdą opcję - inaczej
 * ustawienia widoczne tylko przy `variant === "gradient"` nigdy nie zostałyby
 * odczytane przez żadną stronę i wyglądałyby na martwe.
 *
 * Zależność `visibleWhen` odczytujemy z ŹRÓDŁA predykatu (`String(fn)`), bo to
 * jedyny sposób, by zapytać "od którego klucza zależy ta widoczność" bez
 * zgadywania. Predykat, którego nie da się przypisać do klucza, i tak trafia
 * pod bramkę osiągalności (`unreachableSchemaFields`).
 */
function branchSelectKeys(
  schema: ReadonlyArray<SchemaField>,
  scope: ProbeScope,
): ReadonlySet<string> {
  const predicates = schema
    .filter((f) => typeof f.visibleWhen === "function")
    .map((f) => String(f.visibleWhen));
  const keys = new Set<string>();
  for (const field of schema) {
    if (field.type !== "select" || !field.options?.length) continue;
    const mentioned = predicates.some((src) => src.includes(field.key));
    if (mentioned || (scope === "renderer" && BRANCH_KEY_HINTS.has(field.key))) keys.add(field.key);
  }
  return keys;
}

/**
 * Klucze, które w tym buildera są z definicji przełącznikami gałęzi renderera,
 * nawet gdy żadne `visibleWhen` ich nie wymienia (renderer rozgałęzia się sam).
 */
const BRANCH_KEY_HINTS: ReadonlySet<string> = new Set([
  "variant",
  "mode",
  "layout",
  "style",
  "display",
  "source",
  "kind",
  "shape",
  "preset",
  "sizePreset",
  "position",
  "align",
  "type",
  "orientation",
]);

/**
 * Próbki treści dla jednego typu widgetu.
 *
 * Kolejność: defaulty (stan po wstawieniu z palety), pełne wypełnienie z
 * przełącznikami ON, to samo z OFF, a następnie po jednej próbce na każdą opcję
 * pól rozgałęziających. To rośnie LINIOWO z liczbą opcji, nie kombinatorycznie -
 * bramka ma być bramką, nie nocnym batchem.
 */
export function contentProbes(
  defaults: WidgetContent,
  schema: ReadonlyArray<SchemaField>,
  scope: ProbeScope = "renderer",
  states: ReadonlyArray<WidgetProbeState> = [],
): ReadonlyArray<ContentProbe> {
  const fill = (bools: boolean, numberEdge: NumberEdge = "default"): WidgetContent => {
    const out: WidgetContent = { ...defaults };
    for (const field of schema) Object.assign(out, probeEntries(field, bools, numberEdge));
    return out;
  };
  const filledOn = fill(true);
  const hasBoundedNumber = schema.some(
    (f) => f.type === "number" && (f.min !== undefined || f.max !== undefined),
  );
  const probes: ContentProbe[] = [
    { label: "defaults", content: { ...defaults } },
    { label: "filled/switches-on", content: filledOn },
    { label: "filled/switches-off", content: fill(false) },
  ];
  if (hasBoundedNumber) {
    probes.push({ label: "filled/numbers-min", content: fill(true, "min") });
    probes.push({ label: "filled/numbers-max", content: fill(true, "max") });
  }
  for (const key of branchSelectKeys(schema, scope)) {
    const field = schema.find((f) => f.key === key);
    for (const option of field?.options ?? []) {
      probes.push({
        label: `filled/${key}=${option.value}`,
        content: { ...filledOn, [key]: option.value },
      });
    }
  }
  for (const state of states) {
    probes.push({
      label: `state/${state.label}`,
      content: { ...filledOn, ...state.patch },
    });
  }
  return probes;
}

/**
 * Stan, w którym trzeba postawić widget, żeby jego gałąź w ogóle się otworzyła.
 *
 * Edytory niestandardowe (slider, prelegenci, spotkania, mega-menu, lista z
 * oceną) rysują część kontrolek WYŁĄCZNIE dla wybranego źródła albo trybu, a
 * renderer symetrycznie czyta wtedy inne klucze. Generator próbek nie zna tych
 * warunków (nie ma schematu z `visibleWhen`), więc dostaje je z zewnątrz.
 *
 * To fixtura, NIE zwolnienie: deklaruje STAN ("slider ze źródłem 'manual'"),
 * nigdy listę kluczy. Ustawienie, którego renderer nie czyta w żadnym
 * zadeklarowanym stanie, wciąż wywala bramkę.
 */
export interface WidgetProbeState {
  readonly label: string;
  readonly patch: WidgetContent;
}

/**
 * Pola, których panel NIE MOŻE pokazać przy żadnej próbce - `visibleWhen` nigdy
 * nie jest prawdziwe. To defekt sam w sobie: kontrolka istnieje w schemacie,
 * ma etykietę i tłumaczenie, a redakcja nie ma jak do niej dojść.
 */
export function unreachableSchemaFields(
  schema: ReadonlyArray<SchemaField>,
  probes: ReadonlyArray<ContentProbe>,
): ReadonlyArray<string> {
  return schema
    .filter((field) => {
      const gate = field.visibleWhen;
      if (!gate) return false;
      return !probes.some((probe) => {
        try {
          return gate(probe.content) === true;
        } catch {
          return false;
        }
      });
    })
    .map((field) => field.key);
}

/**
 * Klucze magazynowe, jakie schemat obiecuje redakcji dla danego pola.
 * Pole i18n obiecuje PARĘ (`_pl` + `_en`) - dokładnie tak jak je zapisuje panel.
 */
export function schemaStorageKeys(schema: ReadonlyArray<SchemaField>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const field of schema) {
    if (
      field.type === "i18nText" ||
      field.type === "i18nHtml" ||
      field.type === "i18nStringArray"
    ) {
      for (const lang of CONTENT_LANGS) keys.add(`${field.key}_${lang}`);
    } else {
      keys.add(field.key);
    }
  }
  return keys;
}

/** Różnica wierności między tym, co panel oferuje, a tym, co renderer czyta. */
export interface FidelityDiff {
  /** Oferowane, nigdy nieczytane - ustawienie MARTWE. */
  readonly dead: ReadonlyArray<string>;
  /** Czytane, nigdy nieoferowane - ustawienie UKRYTE. */
  readonly hidden: ReadonlyArray<string>;
}

/**
 * Różnica symetryczna dwóch zbiorów kluczy, w stabilnej (alfabetycznej)
 * kolejności - komunikat błędu bramki musi być deterministyczny.
 */
export function diffFidelity(
  offered: ReadonlySet<string>,
  read: ReadonlySet<string>,
): FidelityDiff {
  const sorted = (values: Iterable<string>): string[] =>
    [...values].sort((a, b) => (a < b ? -1 : 1));
  return {
    dead: sorted([...offered].filter((key) => !read.has(key))),
    hidden: sorted([...read].filter((key) => !offered.has(key))),
  };
}

/** Wpis listy odstępstw: klucz -> powód, dla którego rozjazd jest zamierzony. */
export type FidelityWaivers = Readonly<Record<string, string>>;

/**
 * Odstępstwa dla jednego typu widgetu. Rozdzielone na `dead` / `hidden`, żeby
 * zwolnienie w jednym kierunku nie maskowało regresji w drugim.
 */
export interface WidgetFidelityWaiver {
  readonly dead?: FidelityWaivers;
  readonly hidden?: FidelityWaivers;
  /** Powód, dla którego treść widgetu jest wyliczana hurtem (spread). */
  readonly enumerated?: string;
}

/**
 * Wynik konfrontacji różnicy z listą odstępstw.
 *
 * `stale` jest równie ważne jak `unexpected`: odstępstwo, którego nikt już nie
 * potrzebuje, to kłamstwo w dokumentacji bramki i cicha dziura w pokryciu.
 */
export interface WaiverVerdict {
  readonly unexpected: ReadonlyArray<string>;
  readonly stale: ReadonlyArray<string>;
}

export function applyWaivers(
  actual: ReadonlyArray<string>,
  waivers: FidelityWaivers | undefined,
): WaiverVerdict {
  const waived = new Set(Object.keys(waivers ?? {}));
  return {
    unexpected: actual.filter((key) => !waived.has(key)),
    stale: [...waived].filter((key) => !actual.includes(key)).sort((a, b) => (a < b ? -1 : 1)),
  };
}
