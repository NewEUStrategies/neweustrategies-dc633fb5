// Taksonomia kategorii Apple Podcasts - zamknięta lista, jedno źródło prawdy
// dla buildera RSS (`podcastRss.ts`) i selecta w /admin/podcasts.
//
// Apple przyjmuje w `<itunes:category>` WYŁĄCZNIE wartości z tej listy; własna
// nazwa kategorii to odrzucenie kanału w Podcasts Connect. Podkategoria jest
// zagnieżdżona:
//   <itunes:category text="News">
//     <itunes:category text="Politics"/>
//   </itunes:category>
//
// Nieznana wartość degraduje do domyślnej (`DEFAULT_APPLE_CATEGORY`) zamiast
// wywracać feed - kanał bez `<itunes:category>` jest nieprzyjmowany, więc
// zawsze lepiej wyemitować poprawną kategorię domyślną niż żadną.
//
// Mapa jest zwykłym literałem obiektowym, więc KAŻDY odczyt idzie przez
// `isAppleCategory` (`Object.hasOwn`), a nie przez `in` / `MAP[klucz]`: te
// drugie chodzą po łańcuchu prototypu i przepuściłyby "toString",
// "constructor" czy "__proto__" jako kategorie Apple (a "constructor" z
// podkategorią wywracał /podcast/rss.xml błędem 500).

/** Kategorie Apple wraz z podkategoriami (stan taksonomii Apple 2026). */
const APPLE_PODCAST_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  Arts: ["Books", "Design", "Fashion & Beauty", "Food", "Performing Arts", "Visual Arts"],
  Business: ["Careers", "Entrepreneurship", "Investing", "Management", "Marketing", "Non-Profit"],
  Comedy: ["Comedy Interviews", "Improv", "Stand-Up"],
  Education: ["Courses", "How To", "Language Learning", "Self-Improvement"],
  Fiction: ["Comedy Fiction", "Drama", "Science Fiction"],
  Government: [],
  History: [],
  "Health & Fitness": [
    "Alternative Health",
    "Fitness",
    "Medicine",
    "Mental Health",
    "Nutrition",
    "Sexuality",
  ],
  "Kids & Family": ["Education for Kids", "Parenting", "Pets & Animals", "Stories for Kids"],
  Leisure: [
    "Animation & Manga",
    "Automotive",
    "Aviation",
    "Crafts",
    "Games",
    "Hobbies",
    "Home & Garden",
    "Video Games",
  ],
  Music: ["Music Commentary", "Music History", "Music Interviews"],
  News: [
    "Business News",
    "Daily News",
    "Entertainment News",
    "News Commentary",
    "Politics",
    "Sports News",
    "Tech News",
  ],
  "Religion & Spirituality": [
    "Buddhism",
    "Christianity",
    "Hinduism",
    "Islam",
    "Judaism",
    "Religion",
    "Spirituality",
  ],
  Science: [
    "Astronomy",
    "Chemistry",
    "Earth Sciences",
    "Life Sciences",
    "Mathematics",
    "Natural Sciences",
    "Nature",
    "Physics",
    "Social Sciences",
  ],
  "Society & Culture": [
    "Documentary",
    "Personal Journals",
    "Philosophy",
    "Places & Travel",
    "Relationships",
  ],
  Sports: [
    "Baseball",
    "Basketball",
    "Cricket",
    "Fantasy Sports",
    "Football",
    "Golf",
    "Hockey",
    "Rugby",
    "Running",
    "Soccer",
    "Swimming",
    "Tennis",
    "Volleyball",
    "Wilderness",
    "Wrestling",
  ],
  Technology: [],
  "True Crime": [],
  "TV & Film": ["After Shows", "Film History", "Film Interviews", "Film Reviews", "TV Reviews"],
};

export const APPLE_CATEGORY_NAMES: readonly string[] = Object.keys(APPLE_PODCAST_CATEGORIES);

/** Domyślna kategoria dla think-tanku analitycznego (polityka europejska). */
export const DEFAULT_APPLE_CATEGORY = "News";
export const DEFAULT_APPLE_SUBCATEGORY = "Politics";

export interface AppleCategory {
  readonly category: string;
  readonly subcategory: string | null;
}

/**
 * Czy wartość jest WŁASNYM kluczem taksonomii Apple (bez łańcucha prototypu).
 * Porównanie jest dokładne - Apple nie przyjmuje "news" za "News".
 */
export function isAppleCategory(category: unknown): category is string {
  return typeof category === "string" && Object.hasOwn(APPLE_PODCAST_CATEGORIES, category);
}

/** Podkategorie danej kategorii (puste, gdy Apple ich nie definiuje). */
export function appleSubcategories(category: string): readonly string[] {
  return isAppleCategory(category) ? APPLE_PODCAST_CATEGORIES[category] : [];
}

/**
 * Normalizuje parę (kategoria, podkategoria) do wartości akceptowanych przez
 * Apple. Nieznana kategoria -> domyślna; podkategoria nienależąca do kategorii
 * -> pomijana (kanał z samą kategorią jest poprawny, z obcą podkategorią nie).
 */
export function normalizeAppleCategory(
  category: string | null | undefined,
  subcategory: string | null | undefined,
): AppleCategory {
  const cat = (category ?? "").trim();
  if (!isAppleCategory(cat)) {
    return { category: DEFAULT_APPLE_CATEGORY, subcategory: DEFAULT_APPLE_SUBCATEGORY };
  }
  const sub = (subcategory ?? "").trim();
  return {
    category: cat,
    subcategory: sub && appleSubcategories(cat).includes(sub) ? sub : null,
  };
}
