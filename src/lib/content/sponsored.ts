// Ujawnienie komercyjnego charakteru materiału - czysta domena (bez Reacta,
// bez i18n), wspólna dla panelu, renderu publicznego, JSON-LD i serwera.
//
// PO CO OSOBNY MODUŁ. Obowiązek oznaczenia jest PRAWNY, więc nie może zależeć
// od tego, który komponent pierwszy się wyrenderuje. Trzy powierzchnie muszą
// zgadzać się co do jednej rzeczy: czy ten wpis wymaga etykiety, jakiej i czy
// deklaracja jest kompletna. Rozproszenie tej decyzji po kartach edytora i po
// trasie publicznej dałoby stan „panel mówi sponsorowany, czytelnik nie widzi
// nic" - dokładnie ten defekt, który ustawa nazywa kryptoreklamą.
//
// PODSTAWY PRAWNE (pełne uzasadnienie w migracji
// 20260817090000_post_organization_and_sponsored_disclosure.sql):
//   * Prawo prasowe art. 36 ust. 3 - oznaczenie nie budzące wątpliwości, że to
//     nie materiał redakcyjny;
//   * UPNPR art. 7 pkt 11 (zał. I pkt 11 dyr. 2005/29/WE) - płatny advertorial
//     bez jasnego oznaczenia jest praktyką nieuczciwą z samej listy;
//   * UZNK art. 16 ust. 1 pkt 4 - kryptoreklama;
//   * dyr. 2005/29/WE art. 7 ust. 2 - korzyść niepieniężna (barter) też podlega
//     ujawnieniu;
//   * uśude art. 9 ust. 1 pkt 1 (dyr. 2000/31/WE art. 6) - oznaczenie obejmuje
//     podmiot zlecający ORAZ jego adresy elektroniczne; dlatego adres
//     reklamodawcy jest w `disclosureGaps` obok nazwy, a nie „opcjonalny";
//   * Rekomendacje UOKiK (2022) - zasada dwuczęściowa: CO to jest + KTO
//     reklamuje; wprost odrzucone skróty (#ad, #sp, #collab, samo #współpraca);
//   * DSA (2022/2065) art. 26 ust. 1 lit. b-c - w czyim imieniu ORAZ kto
//     zapłacił, gdy to inny podmiot (przyjęte jako standard treści, patrz
//     migracja);
//   * rozp. (UE) 2024/900 art. 11 ust. 1 - reklama POLITYCZNA (także wpływająca
//     na proces legislacyjny lub regulacyjny, art. 3 ust. 2): informacja, że to
//     reklama polityczna, tożsamość sponsora i podmiotu ostatecznie go
//     kontrolującego oraz proces, którego dotyczy. Ten reżim wiąże wydawcę
//     BEZPOŚREDNIO - inaczej niż DSA;
//   * AVMSD art. 9 ust. 1 lit. a, art. 10 (sponsorowanie) i art. 11 (lokowanie
//     produktu) oraz ustawa o radiofonii i telewizji art. 16, 16c, 17, 17a -
//     identyfikacja przy materiale audiowizualnym. (Art. 23 AVMSD to limit
//     ilościowy 20% czasu, nie oznaczanie - nie mieszać.)

/**
 * Rodzaje relacji komercyjnej. Kolejność = rosnąca niezależność redakcyjna,
 * bo tak czyta się je w liście wyboru: od czystej reklamy do barteru.
 *
 * `self_promo` (autopromocja) stoi na końcu, bo nie ma tu zewnętrznego płatnika -
 * to promocja własnej marki (konferencja, członkostwo, raport). Bez tego wariantu
 * taki materiał trafiał albo pod `sponsored`, co KŁAMIE (sugeruje zewnętrznego
 * sponsora, którego nie ma), albo zostawał bez etykiety, co jest kryptoreklamą
 * (UZNK art. 16 ust. 1 pkt 4). Oba wyjścia były wadliwe, więc wariant jest
 * potrzebny, a nie „na zapas".
 *
 * Lustro CHECK-a `posts_sponsored_kind_check`. Dodanie wariantu TUTAJ wymaga
 * migracji podnoszącej CHECK - inaczej panel zaoferuje opcję, której baza nie
 * przyjmie (ta sama konwencja co allowlista głosów TTS).
 */
export const SPONSORED_KINDS = [
  "advertisement",
  "sponsored",
  "partner",
  "barter",
  "self_promo",
] as const;

export type SponsoredKind = (typeof SPONSORED_KINDS)[number];

export function isSponsoredKind(value: string): value is SponsoredKind {
  return (SPONSORED_KINDS as readonly string[]).includes(value);
}

/** Domyślny rodzaj przy włączeniu flagi - najczęstszy przypadek redakcyjny. */
export const DEFAULT_SPONSORED_KIND: SponsoredKind = "sponsored";

/**
 * Pola wpisu, z których wynika ujawnienie. Nazwy 1:1 z kolumnami `posts`, żeby
 * ten sam obiekt dał się podać zarówno z formularza panelu, jak i z wiersza
 * publicznego zapytania - bez warstwy mapującej, która mogłaby się rozjechać.
 */
export interface SponsoredDisclosureInput {
  is_sponsored?: boolean | null;
  sponsored_kind?: string | null;
  sponsored_advertiser_name?: string | null;
  sponsored_advertiser_url?: string | null;
  sponsored_payer_name?: string | null;
  sponsored_note_pl?: string | null;
  sponsored_note_en?: string | null;
  sponsored_affiliate?: boolean | null;
  sponsored_political?: boolean | null;
  sponsored_political_process?: string | null;
  sponsored_sponsor_controller?: string | null;
}

/** Rozstrzygnięte ujawnienie - to, co render ma pokazać. */
export interface ResolvedDisclosure {
  /** Czy w ogóle renderować pasek ujawnienia. */
  readonly required: boolean;
  /** Rodzaj relacji; null gdy ujawniamy wyłącznie afiliację. */
  readonly kind: SponsoredKind | null;
  /** Reklamodawca / sponsor - część „KTO" reguły UOKiK. */
  readonly advertiser: string | null;
  /** Adres reklamodawcy (uśude art. 9 ust. 1 pkt 1); rel="sponsored nofollow". */
  readonly advertiserUrl: string | null;
  /** Płatnik, gdy INNY niż reklamodawca (DSA art. 26 ust. 1 lit. c). */
  readonly payer: string | null;
  /** Czy dokleić linię o linkach afiliacyjnych. */
  readonly affiliate: boolean;
  /** Reklama polityczna wg rozp. (UE) 2024/900 - własny blok ujawnienia. */
  readonly political: boolean;
  /** Proces, którego dotyczy reklama polityczna (art. 11 ust. 1 lit. c). */
  readonly politicalProcess: string | null;
  /** Podmiot ostatecznie kontrolujący sponsora (art. 11 ust. 1 lit. b). */
  readonly sponsorController: string | null;
}

function trimmed(value: string | null | undefined): string | null {
  const out = (value ?? "").trim();
  return out.length > 0 ? out : null;
}

/**
 * Rozstrzyga ujawnienie z wiersza/formularza.
 *
 * Afiliacja jest ORTOGONALNA do sponsoringu: materiał redakcyjny z linkami
 * afiliacyjnymi wymaga ujawnienia (dyr. 2005/29/WE art. 7 ust. 2), choć nikt
 * za niego nie zapłacił - dlatego `required` bywa prawdziwe przy
 * `is_sponsored = false`.
 *
 * FAIL-SAFE W STRONĘ UJAWNIENIA. Gdy flaga jest włączona, ale nazwy reklamodawcy
 * brakuje (wiersz sprzed migracji, deklaracja w toku), etykieta pokazuje się MIMO
 * TO - z samym rodzajem relacji, bez zdania „kto". Odwrotny wybór („brak nazwy ⇒
 * nie renderuj") wyglądał na ostrożny, a dawał najgorszy możliwy stan: materiał
 * opłacony BEZ ŻADNEGO oznaczenia, czyli dokładnie kryptoreklamę (UZNK art. 16
 * ust. 1 pkt 4). Niepełna etykieta jest naruszeniem reguły dwuczęściowej UOKiK;
 * BRAK etykiety jest naruszeniem zakazu z listy czarnej. Wybieramy mniejsze.
 *
 * Kompletności pilnuje bramka PRZY PUBLIKACJI (`disclosureGaps` w updatePost dla
 * statusu published/scheduled) - tam, gdzie brak przestaje być stanem roboczym.
 */
export function resolveDisclosure(input: SponsoredDisclosureInput): ResolvedDisclosure {
  const affiliate = input.sponsored_affiliate === true;
  const advertiser = trimmed(input.sponsored_advertiser_name);
  const rawKind = trimmed(input.sponsored_kind);
  const kind = rawKind && isSponsoredKind(rawKind) ? rawKind : null;
  const sponsored = input.is_sponsored === true && kind !== null;
  const payer = trimmed(input.sponsored_payer_name);

  return {
    required: sponsored || affiliate,
    kind: sponsored ? kind : null,
    advertiser: sponsored ? advertiser : null,
    advertiserUrl: sponsored ? trimmed(input.sponsored_advertiser_url) : null,
    // Płatnika ujawniamy TYLKO gdy różni się od reklamodawcy - DSA art. 26
    // ust. 1 lit. c mówi „jeżeli jest inną osobą". Powtórzenie tej samej nazwy
    // dwa razy w etykiecie nic nie dodaje, a rozmywa przekaz.
    payer: sponsored && payer !== null && payer !== advertiser ? payer : null,
    affiliate,
    political: sponsored && input.sponsored_political === true,
    politicalProcess: sponsored ? trimmed(input.sponsored_political_process) : null,
    sponsorController: sponsored ? trimmed(input.sponsored_sponsor_controller) : null,
  };
}

/** Czego brakuje, by deklaracja była kompletna - zasila walidację w panelu. */
export type DisclosureGap = "kind" | "advertiser" | "advertiserUrl" | "politicalProcess";

/**
 * Prefiks błędu, którym serwer odrzuca publikację niekompletnej deklaracji.
 * Kontrakt jest KODEM, nie zdaniem: `updatePost` biegnie po stronie serwera i nie
 * zna języka panelu, więc treść komunikatu musi powstać u klienta (`t()`).
 * Format: `sponsored_disclosure_incomplete:advertiser,advertiserUrl`.
 */
export const DISCLOSURE_ERROR_PREFIX = "sponsored_disclosure_incomplete:";

/** Odczytuje braki z błędu serwera; puste, gdy to inny błąd. */
export function parseDisclosureError(error: unknown): readonly DisclosureGap[] {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const at = message.indexOf(DISCLOSURE_ERROR_PREFIX);
  if (at < 0) return [];
  return message
    .slice(at + DISCLOSURE_ERROR_PREFIX.length)
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is DisclosureGap =>
      ["kind", "advertiser", "advertiserUrl", "politicalProcess"].includes(part),
    );
}

export function disclosureGaps(input: SponsoredDisclosureInput): readonly DisclosureGap[] {
  const political = input.sponsored_political === true;
  if (input.is_sponsored !== true) {
    // Reklama polityczna bez oznaczenia materiału jako komercyjnego jest
    // wewnętrznie sprzeczna (rozp. 2024/900 dotyczy reklamy) - zgłaszamy brak
    // rodzaju relacji, bo to pierwsza rzecz, którą redakcja musi wskazać.
    return political ? ["kind"] : [];
  }
  const gaps: DisclosureGap[] = [];
  const rawKind = trimmed(input.sponsored_kind);
  if (!rawKind || !isSponsoredKind(rawKind)) gaps.push("kind");
  if (!trimmed(input.sponsored_advertiser_name)) gaps.push("advertiser");
  // Adres elektroniczny zlecającego jest elementem USTAWOWYM oznaczenia
  // (uśude art. 9 ust. 1 pkt 1), nie udogodnieniem - stąd w bramce.
  if (!trimmed(input.sponsored_advertiser_url)) gaps.push("advertiserUrl");
  if (political && !trimmed(input.sponsored_political_process)) gaps.push("politicalProcess");
  return gaps;
}

// Kluczy i18n świadomie NIE budujemy tutaj funkcją pomocniczą. Bramka
// `check:i18n-parity` umie zweryfikować gałąź dynamiczną zapisaną W MIEJSCU
// wywołania (`t(`sponsored.label.${kind}`)` - sprawdza istnienie gałęzi i parytet
// podkluczy PL/EN), ale klucz przyniesiony z innego modułu widzi jako wyrażenie
// i pomija bez sprawdzenia. Helper wyglądałby czyściej i zdejmowałby dokładnie tę
// kontrolę, która pilnuje, że etykieta w ogóle istnieje w obu językach. Brzmienia
// żyją w `src/lib/i18n-sponsored.ts`.

/**
 * Typ schema.org dla artykułu z ujawnieniem.
 *
 * `AdvertiserContentArticle` to zdefiniowany podtyp `Article` dla treści
 * dostarczonej/opłaconej przez reklamodawcę - używamy go TYLKO dla `advertisement`,
 * czyli tam, gdzie reklamodawca miał wpływ na treść. Sponsoring z zachowaną
 * niezależnością redakcyjną zostaje `NewsArticle` (bo materiał JEST redakcyjny),
 * a relację niesie węzeł `sponsor`. Podmiana typu dla wszystkich wariantów
 * byłaby nadgorliwa i zaniżałaby wartość materiałów redakcyjnych w wyszukiwarce.
 */
export function articleJsonLdType(kind: SponsoredKind | null): string | null {
  return kind === "advertisement" ? "AdvertiserContentArticle" : null;
}
