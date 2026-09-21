// Kontrakt katalogu Apple Podcasts - JEDNA czysta reguła gotowości kanału.
//
// PO CO TEN MODUŁ ISTNIEJE. Brak wymaganego tagu w kanale to awaria CICHA:
// `buildPodcastRssXml` jest fail-safe (podstawia domyślną kategorię, bierze
// okładkę pierwszego odcinka, emituje `<itunes:explicit>no</itunes:explicit>`
// dla nieustawionej flagi), więc feed WYCHODZI poprawny składniowo i nikt nie
// widzi problemu, dopóki ktoś nie zauważy, że audycja nie pojawiła się
// w katalogu albo wisi w złej kategorii. Karta gotowości w panelu jest
// dokładnie tym mechanizmem, który ma to wyłapać PRZED zgłoszeniem - a żeby
// karta mogła być cienkim renderem, cała reguła musi żyć tutaj.
//
// Wejście = metadane kanału (+ opcjonalne nadpisania programu). Wyjście =
// LISTA BRAKÓW: pole, waga (`blocking` / `warning`) i klucz i18n komunikatu.
// Karta RENDERUJE wynik, nie decyduje o nim.
//
// Skąd wzięte są wymagania (nie z pamięci - z kodu, który emituje feed):
//   * `@/lib/seo/podcastRss.ts` - co kanał FAKTYCZNIE wypuszcza i czym
//     builder papierkuje braki (kategoria domyślna, okładka z odcinka,
//     `ownerName` spadający na `author`, `managingEditor` tylko z e-mailem),
//   * `@/lib/seo/podcastChannelMeta.ts` - jak warstwy PROGRAM -> KANAŁ ->
//     MARKA są scalane (nadpisanie niepuste wygrywa; `explicit` przez `??`,
//     więc `false` programu przesłania `true` kanału; podkategoria i wymiary
//     okładki idą ZAWSZE z tej samej warstwy co wartość, którą opisują).
//
// Deterministyczna, bez importów Reacta, bez dostępu do bazy: kolejność braków
// jest kolejnością deklaracji sprawdzeń, więc test może ją asertować.
import { APPLE_CATEGORY_NAMES } from "@/lib/seo/applePodcastCategories";
import type { PodcastFeedReadiness } from "@/lib/seo/podcastFeedReadiness";

/** `blocking` = Apple odrzuci kanał albo wpis trafi nie tam, gdzie miał. */
export type ApplePodcastGapSeverity = "blocking" | "warning";

/**
 * Pole, którego brak dotyczy. Nazwy pokrywają się z `ApplePodcastMetaValue`
 * (formularz w panelu), żeby karta mogła podświetlić właściwą kontrolkę.
 * `episodes`/`copyright`/`enclosureLength`/`duration` przychodzą wyłącznie ze
 * starszej checklisty `podcastFeedReadiness`; `unknown` to zapas na kod, który
 * dopisano do checklisty, a tu jeszcze nie ma odpowiednika.
 */
export type ApplePodcastGapField =
  | "title"
  | "description"
  | "language"
  | "category"
  | "explicit"
  | "imageUrl"
  | "ownerEmail"
  | "ownerName"
  | "author"
  | "episodes"
  | "copyright"
  | "enclosureLength"
  | "duration"
  | "unknown";

export interface ApplePodcastGap {
  readonly field: ApplePodcastGapField;
  readonly severity: ApplePodcastGapSeverity;
  /** Klucz i18n zdania widocznego na liście braków (PL i EN). */
  readonly messageKey: string;
}

/** Metadane jednej warstwy: kanału sieciowego albo programu. */
export interface ApplePodcastChannelMeta {
  title?: string | null;
  description?: string | null;
  language?: string | null;
  category?: string | null;
  explicit?: boolean | null;
  author?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  imageUrl?: string | null;
  /** Znany rozmiar okładki w px. `null` = nieznany (URL zewnętrzny). */
  imageWidth?: number | null;
  imageHeight?: number | null;
}

/** Nadpisania per program - pole puste znaczy „dziedzicz z kanału". */
export type ApplePodcastShowOverride = ApplePodcastChannelMeta;

/** Metadane po scaleniu warstw - to na nich pracują sprawdzenia. */
export interface ResolvedApplePodcastMeta {
  title: string | null;
  description: string | null;
  language: string | null;
  category: string | null;
  explicit: boolean | null;
  author: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

const KEY_ROOT = "adminPodcasts.settings.apple";
const blockingKey = (code: string): string => `${KEY_ROOT}.blocking.${code}`;
const warningKey = (code: string): string => `${KEY_ROOT}.warnings.${code}`;

/** Apple wymaga kwadratu od 1400x1400 do 3000x3000 px. */
export const APPLE_IMAGE_MIN_PX = 1400;
export const APPLE_IMAGE_MAX_PX = 3000;

const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Kształt adresu e-mail właściciela. NIE jest to walidacja RFC 5322 - Apple
 * wysyła na ten adres kod weryfikacyjny, więc jedyne, co ma sens sprawdzić bez
 * wysyłki, to czy adres da się w ogóle zaadresować: jedna małpa, niepusta część
 * lokalna, domena z co najmniej jedną kropką i niepustymi etykietami.
 *
 * Świadomie odrzuca adresy z białym znakiem, przecinkiem i nawiasem trójkątnym
 * (czyli wklejone „Redakcja <adres>" i listy adresów) - w `<itunes:email>`
 * może stać dokładnie jeden adres.
 */
const EMAIL_SHAPE = /^[^\s@,;<>"]+@[^\s@,;<>".]+(?:\.[^\s@,;<>".]+)+$/;

export function isApplePodcastOwnerEmail(value: string | null | undefined): boolean {
  const s = trimmed(value);
  // 254 znaki to maksymalna długość ścieżki koperty SMTP - dłuższy adres nie
  // dojdzie, więc kod weryfikacyjny nigdy nie dotrze.
  return s !== null && s.length <= 254 && EMAIL_SHAPE.test(s);
}

/**
 * Scalenie warstw PROGRAM -> KANAŁ. Ta sama reguła co
 * `resolvePodcastChannelMeta`: nadpisanie niepuste wygrywa, `explicit` idzie
 * przez `??` (więc `false` programu przesłania `true` kanału), a wymiary
 * okładki są SPRZĘŻONE z warstwą, która podała URL - inaczej program z własną
 * okładką odziedziczyłby rozmiar pliku kanału i reguła oceniałaby nie ten obraz.
 */
export function mergeApplePodcastMeta(
  channel: ApplePodcastChannelMeta,
  show?: ApplePodcastShowOverride | null,
): ResolvedApplePodcastMeta {
  const showImage = trimmed(show?.imageUrl);
  const image = showImage
    ? { url: showImage, width: show?.imageWidth ?? null, height: show?.imageHeight ?? null }
    : {
        url: trimmed(channel.imageUrl),
        width: channel.imageWidth ?? null,
        height: channel.imageHeight ?? null,
      };

  return {
    title: trimmed(show?.title) ?? trimmed(channel.title),
    description: trimmed(show?.description) ?? trimmed(channel.description),
    language: trimmed(show?.language) ?? trimmed(channel.language),
    category: trimmed(show?.category) ?? trimmed(channel.category),
    explicit: show?.explicit ?? channel.explicit ?? null,
    author: trimmed(show?.author) ?? trimmed(channel.author),
    ownerName: trimmed(show?.ownerName) ?? trimmed(channel.ownerName),
    ownerEmail: trimmed(show?.ownerEmail) ?? trimmed(channel.ownerEmail),
    imageUrl: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

/**
 * LISTA BRAKÓW kanału. Kolejność jest kolejnością deklaracji sprawdzeń:
 * tytuł, opis, język, kategoria, explicit, okładka, e-mail właściciela,
 * a na końcu zalecenia (autor, nazwa właściciela).
 */
export function applePodcastGaps(
  channel: ApplePodcastChannelMeta,
  show?: ApplePodcastShowOverride | null,
): readonly ApplePodcastGap[] {
  const meta = mergeApplePodcastMeta(channel, show);
  const gaps: ApplePodcastGap[] = [];
  const block = (field: ApplePodcastGapField, code: string): void => {
    gaps.push({ field, severity: "blocking", messageKey: blockingKey(code) });
  };
  const warn = (field: ApplePodcastGapField, code: string): void => {
    gaps.push({ field, severity: "warning", messageKey: warningKey(code) });
  };

  if (meta.title === null) block("title", "title");
  if (meta.description === null) block("description", "description");
  if (meta.language === null) block("language", "language");

  // Kategoria: builder podstawia „News" za brak i za nazwę poza taksonomią,
  // więc jedno i drugie jest niewidoczne w feedzie - i jedno i drugie znaczy,
  // że kanał wyląduje w katalogu tam, gdzie nikt tego nie wybrał.
  if (meta.category === null) {
    block("category", "category");
  } else if (!APPLE_CATEGORY_NAMES.includes(meta.category)) {
    block("category", "categoryUnknown");
  }

  // `<itunes:explicit>` jest wymagane; builder emituje „no" dla nieustawionej
  // flagi, czyli deklaruje za redakcję. Zła deklaracja to zdjęcie audycji
  // z katalogu, więc brak decyzji jest brakiem blokującym, a nie zaleceniem.
  if (meta.explicit === null) block("explicit", "explicit");

  if (meta.imageUrl === null) {
    block("imageUrl", "image");
  } else {
    // Apple pobiera okładkę własnym klientem i nie idzie po http.
    if (!/^https:\/\//i.test(meta.imageUrl)) block("imageUrl", "imageProtocol");
    // Rozmiaru nie da się wyczytać z URL-a. Gdy znamy go z biblioteki mediów,
    // sprawdzamy kwadrat i zakres; gdy nie - zostaje obecność i protokół.
    const { imageWidth: w, imageHeight: h } = meta;
    if (w !== null && h !== null) {
      if (w !== h) {
        block("imageUrl", "imageSquare");
      } else if (w < APPLE_IMAGE_MIN_PX || w > APPLE_IMAGE_MAX_PX) {
        block("imageUrl", "imageSize");
      }
    }
  }

  if (meta.ownerEmail === null) {
    block("ownerEmail", "ownerEmail");
  } else if (!isApplePodcastOwnerEmail(meta.ownerEmail)) {
    block("ownerEmail", "ownerEmailShape");
  }

  if (meta.author === null) warn("author", "author");
  // `podcastRss` emituje `<itunes:name>` z `ownerName` LUB, gdy puste, z
  // `author` - więc pusta nazwa właściciela przy wypełnionym autorze nie jest
  // brakiem w feedzie i zgłaszanie jej byłoby fałszywym alarmem.
  if (meta.ownerName === null && meta.author === null) warn("ownerName", "ownerName");

  return gaps;
}

export function applePodcastBlockingGaps(
  gaps: readonly ApplePodcastGap[],
): readonly ApplePodcastGap[] {
  return gaps.filter((gap) => gap.severity === "blocking");
}

export function applePodcastWarningGaps(
  gaps: readonly ApplePodcastGap[],
): readonly ApplePodcastGap[] {
  return gaps.filter((gap) => gap.severity === "warning");
}

/**
 * Czy kanał można zgłosić. Zalecenia (`warning`) NIE blokują - wpis będzie
 * ubogi, ale Apple go przyjmie.
 */
export function isApplePodcastSubmittable(gaps: readonly ApplePodcastGap[]): boolean {
  return gaps.every((gap) => gap.severity !== "blocking");
}

const LEGACY_BLOCKING_FIELD: Readonly<Record<string, ApplePodcastGapField>> = {
  title: "title",
  description: "description",
  language: "language",
  image: "imageUrl",
  ownerEmail: "ownerEmail",
  episodes: "episodes",
};

const LEGACY_WARNING_FIELD: Readonly<Record<string, ApplePodcastGapField>> = {
  author: "author",
  ownerName: "ownerName",
  copyright: "copyright",
  enclosureLength: "enclosureLength",
  duration: "duration",
};

/**
 * Adapter starszej checklisty `podcastFeedReadiness` (kody, nie braki) na tę
 * samą listę braków. Dzięki temu panel sieciowy nie musi się przepisywać, a
 * karta ma JEDEN kształt wejścia.
 *
 * Kod nieznany temu adapterowi dalej trafia na listę (z polem `unknown` i
 * własnym kluczem i18n) - lepiej pokazać surowy klucz niż zgubić brak.
 */
export function applePodcastGapsFromReadiness(
  readiness: PodcastFeedReadiness,
): readonly ApplePodcastGap[] {
  return [
    ...readiness.blocking.map((code) => ({
      field: LEGACY_BLOCKING_FIELD[code] ?? "unknown",
      severity: "blocking" as const,
      messageKey: blockingKey(code),
    })),
    ...readiness.warnings.map((code) => ({
      field: LEGACY_WARNING_FIELD[code] ?? "unknown",
      severity: "warning" as const,
      messageKey: warningKey(code),
    })),
  ];
}

/**
 * Trzy drogi wejścia karty gotowości, rozstrzygane TU, a nie w komponencie:
 * gotowa lista braków, metadane (wtedy woła się reguła) albo wynik starszej
 * checklisty. Brak wszystkich trzech to pusta lista, czyli „nic nie wiemy o
 * brakach" - karta pokaże stan gotowy, dokładnie jak dla kanału bez braków.
 */
export interface ApplePodcastGapSource {
  gaps?: readonly ApplePodcastGap[] | null;
  channel?: ApplePodcastChannelMeta | null;
  show?: ApplePodcastShowOverride | null;
  readiness?: PodcastFeedReadiness | null;
}

export function resolveApplePodcastGaps(source: ApplePodcastGapSource): readonly ApplePodcastGap[] {
  if (source.gaps != null) return source.gaps;
  if (source.channel != null) return applePodcastGaps(source.channel, source.show);
  if (source.readiness != null) return applePodcastGapsFromReadiness(source.readiness);
  return [];
}
