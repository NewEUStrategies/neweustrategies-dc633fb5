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

/** Podkategorie danej kategorii (puste, gdy Apple ich nie definiuje). */
export function appleSubcategories(category: string): readonly string[] {
  return APPLE_PODCAST_CATEGORIES[category] ?? [];
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
  if (!(cat in APPLE_PODCAST_CATEGORIES)) {
    return { category: DEFAULT_APPLE_CATEGORY, subcategory: DEFAULT_APPLE_SUBCATEGORY };
  }
  const sub = (subcategory ?? "").trim();
  return {
    category: cat,
    subcategory: sub && appleSubcategories(cat).includes(sub) ? sub : null,
  };
}
