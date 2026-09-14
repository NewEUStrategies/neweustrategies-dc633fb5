// Specyfikacje kart udostępniania dla KONKRETNYCH sieci - jedna tabela faktów,
// z której korzysta podgląd w panelu (/admin/seo/social) i walidacja uploadu.
//
// PO CO OSOBNY MODUŁ, A NIE STAŁE W KOMPONENCIE. "Karta społecznościowa" nie
// jest jednym bytem: Facebook i LinkedIn czytają og:*, X czyta twitter:* i
// przycina tytuł ostrzej, Slack/Signal renderuje wąski unfurl z og:description,
// a Google pokazuje miniaturę w innym kadrze niż wszyscy pozostali. Wpisane
// w JSX te różnice są niewidoczne dla testów i rozjeżdżają się przy pierwszej
// zmianie layoutu. Tutaj są DANYMI - czystymi, porównywalnymi i testowalnymi.
//
// ŹRÓDŁO LICZB. Limity znaków to progi PRZYCIĘCIA obserwowane w unfurlach tych
// sieci, nie limity protokołu: Open Graph nie definiuje długości w ogóle, więc
// każda liczba tutaj jest progiem redakcyjnym ("po tylu znakach sieć utnie"),
// a nie walidacją, która ma coś zablokować. Dlatego przekroczenie daje
// OSTRZEŻENIE, nigdy błąd - redakcja ma widzieć skutek, a nie dostać zakaz.
import type { Lang } from "@/lib/seo/meta";

/** Sieć, dla której panel rysuje osobny podgląd karty. */
export type SocialNetworkId = "facebook" | "linkedin" | "x" | "slack" | "google";

export interface SocialNetworkSpec {
  id: SocialNetworkId;
  /** Nazwa własna - NIE tłumaczona (marka jest ta sama w PL i EN). */
  label: string;
  /** Proporcja kadru miniatury w unfurlu tej sieci. */
  aspect: string;
  /** Próg przycięcia tytułu (znaki). */
  titleLimit: number;
  /** Próg przycięcia opisu (znaki). `0` = sieć opisu nie pokazuje. */
  descriptionLimit: number;
  /** Czy sieć czyta `twitter:*` zamiast `og:*` (X ma własny zestaw). */
  usesTwitterTags: boolean;
  /** Czy unfurl pokazuje host nad kartą (Facebook/LinkedIn) czy pod (X). */
  hostPosition: "above" | "below";
}

/**
 * Zalecany rozmiar pliku karty. 1200x630 to jedyny kadr, który przechodzi
 * przez WSZYSTKIE sieci z tabeli bez dociskania: Facebook i LinkedIn skalują
 * go 1:1, X kadruje do 2:1 symetrycznie (czyli obcina po ~39 px góra/dół),
 * a Google bierze centralny kwadrat. Stąd zasada kompozycji w podpowiedzi:
 * treść krytyczna w centralnym kwadracie, nigdy przy krawędziach.
 */
export const OG_RECOMMENDED_WIDTH = 1200;
export const OG_RECOMMENDED_HEIGHT = 630;

export const SOCIAL_NETWORKS: readonly SocialNetworkSpec[] = [
  {
    id: "facebook",
    label: "Facebook",
    aspect: "1200 / 630",
    titleLimit: 88,
    descriptionLimit: 200,
    usesTwitterTags: false,
    hostPosition: "above",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    aspect: "1200 / 627",
    titleLimit: 120,
    descriptionLimit: 160,
    usesTwitterTags: false,
    hostPosition: "above",
  },
  {
    id: "x",
    label: "X (Twitter)",
    aspect: "2 / 1",
    titleLimit: 70,
    descriptionLimit: 125,
    usesTwitterTags: true,
    hostPosition: "below",
  },
  {
    id: "slack",
    label: "Slack / WhatsApp",
    aspect: "1200 / 630",
    titleLimit: 75,
    descriptionLimit: 140,
    usesTwitterTags: false,
    hostPosition: "above",
  },
  {
    id: "google",
    label: "Google",
    aspect: "1 / 1",
    titleLimit: 60,
    descriptionLimit: 160,
    usesTwitterTags: false,
    hostPosition: "above",
  },
];

/** Specyfikacja po identyfikatorze (pierwsza z tabeli jako bezpieczny fallback). */
export function socialNetworkSpec(id: SocialNetworkId): SocialNetworkSpec {
  return SOCIAL_NETWORKS.find((n) => n.id === id) ?? SOCIAL_NETWORKS[0];
}

/**
 * Przytnij tekst do progu sieci, dokładając wielokropek. Zwraca ORYGINAŁ, gdy
 * mieści się w progu - podgląd ma pokazywać brak przycięcia, a nie dopisywać
 * wielokropek "na wszelki wypadek".
 */
export function truncateForNetwork(text: string, limit: number): string {
  const value = text.trim();
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export type OgDimensionVerdict = "ok" | "tooSmall" | "wrongRatio" | "unknown";

/**
 * Ocena wymiarów wgranego pliku wobec kadru 1200x630.
 *
 * DWA ODRĘBNE PROBLEMY, nie jeden: plik ZA MAŁY sieci odrzucą albo pokażą jako
 * małą ikonę obok tekstu (Facebook wymaga minimum 200x200, poniżej 600x315
 * degraduje kartę do wariantu `summary`), a plik o ZŁYCH PROPORCJACH zostanie
 * przycięty - jest duży, więc karta będzie duża, tylko kadr wypadnie inaczej,
 * niż widziała redakcja. Zlanie tego w jeden komunikat kazałoby zgadywać,
 * którą wadę się właśnie ogląda.
 */
export function ogDimensionVerdict(
  width: number | null | undefined,
  height: number | null | undefined,
): OgDimensionVerdict {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  if (width < 600 || height < 315) return "tooSmall";
  const target = OG_RECOMMENDED_WIDTH / OG_RECOMMENDED_HEIGHT;
  const ratio = width / height;
  // Tolerancja +-12%: mieści 1200x630, 1200x628 i 1280x720, odcina 4:3 i kwadrat.
  return Math.abs(ratio - target) / target > 0.12 ? "wrongRatio" : "ok";
}

/** Domyślny podpis hosta w podglądach (bez protokołu, wielkimi literami u X). */
export function displayHost(origin: string): string {
  return origin.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/**
 * Tekst zastępczy `og:image:alt`, gdy redakcja nie wpisała własnego. Alt karty
 * czytają czytniki ekranu w podglądzie linku i scrapery indeksujące obrazy,
 * więc pusty alt jest realną luką dostępności, a nie kosmetyką.
 */
export function fallbackImageAlt(siteName: string, lang: Lang): string {
  return lang === "en" ? `${siteName} - share card` : `${siteName} - karta udostępniania`;
}
