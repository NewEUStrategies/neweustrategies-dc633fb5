// World-class greeting engine.
// - Dozens of variants per time-of-day, PL + EN.
// - Vocative-aware (Polish), gender-aware fallbacks from `name_dictionary`.
// - Pure functions; no I/O. Lookup is performed by the React hook.

export type Lang = "pl" | "en";
export type Gender = "male" | "female" | "neutral";
export type TimeBucket = "night" | "earlyMorning" | "morning" | "noon" | "afternoon" | "evening" | "lateEvening";

export interface NameEntry {
  name: string;
  name_normalized: string;
  gender: Gender;
  vocative_pl: string | null;
  vocative_en: string | null;
}

export function timeBucket(date: Date = new Date()): TimeBucket {
  const h = date.getHours();
  if (h < 5) return "night";
  if (h < 8) return "earlyMorning";
  if (h < 11) return "morning";
  if (h < 14) return "noon";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "lateEvening";
}

export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .trim();
}

// ----------- GREETINGS DICTIONARY -----------
// `{name}` placeholder = vocative form (or plain name if not found).
const PL: Record<TimeBucket, string[]> = {
  night: [
    "Dobry wieczór, {name}", "Miło Cię widzieć, {name}", "Witaj, {name}",
    "Cieszymy się, że jesteś, {name}", "Dobrego wieczoru, {name}",
    "Powodzenia, {name}", "Witaj ponownie, {name}",
  ],
  earlyMorning: [
    "Dzień dobry, {name}!", "Miłego poranka, {name}", "Dobrego dnia, {name}",
    "Witaj, {name}", "Powodzenia dziś, {name}", "Miło Cię widzieć, {name}",
    "Udanego dnia, {name}",
  ],
  morning: [
    "Dzień dobry, {name}!", "Miłego poranka, {name}", "Witaj, {name}",
    "Dobrego dnia, {name}", "Powodzenia dziś, {name}", "Miło Cię widzieć, {name}",
    "Witaj ponownie, {name}", "Udanego dnia, {name}",
  ],
  noon: [
    "Dzień dobry, {name}!", "Miłego dnia, {name}", "Witaj, {name}",
    "Dobrej przerwy, {name}", "Powodzenia, {name}", "Miło Cię widzieć, {name}",
    "Witaj ponownie, {name}",
  ],
  afternoon: [
    "Dzień dobry, {name}!", "Miłego popołudnia, {name}", "Witaj, {name}",
    "Dobrego dnia, {name}", "Powodzenia, {name}", "Miło Cię widzieć, {name}",
    "Witaj ponownie, {name}", "Udanej drugiej połowy dnia, {name}",
  ],
  evening: [
    "Dobry wieczór, {name}!", "Miłego wieczoru, {name}", "Witaj, {name}",
    "Miło Cię widzieć, {name}", "Dobrego wieczoru, {name}",
    "Witaj ponownie, {name}", "Udanego wieczoru, {name}",
  ],
  lateEvening: [
    "Dobry wieczór, {name}", "Miłego wieczoru, {name}", "Witaj, {name}",
    "Miło Cię widzieć, {name}", "Dobrego wieczoru, {name}",
    "Witaj ponownie, {name}",
  ],
};

const EN: Record<TimeBucket, string[]> = {
  night: [
    "Good evening, {name}", "Great to see you, {name}", "Welcome, {name}",
    "Glad you're here, {name}", "Have a good evening, {name}",
    "All the best, {name}", "Welcome back, {name}",
  ],
  earlyMorning: [
    "Good morning, {name}!", "Have a great morning, {name}", "Have a good day, {name}",
    "Welcome, {name}", "Good luck today, {name}", "Great to see you, {name}",
    "Wishing you a great day, {name}",
  ],
  morning: [
    "Good morning, {name}!", "Have a great morning, {name}", "Welcome, {name}",
    "Have a good day, {name}", "Good luck today, {name}", "Great to see you, {name}",
    "Welcome back, {name}", "Wishing you a great day, {name}",
  ],
  noon: [
    "Good day, {name}!", "Have a nice day, {name}", "Welcome, {name}",
    "Enjoy your break, {name}", "All the best, {name}", "Great to see you, {name}",
    "Welcome back, {name}",
  ],
  afternoon: [
    "Good afternoon, {name}!", "Have a great afternoon, {name}", "Welcome, {name}",
    "Have a good day, {name}", "All the best, {name}", "Great to see you, {name}",
    "Welcome back, {name}", "Wishing you a great afternoon, {name}",
  ],
  evening: [
    "Good evening, {name}!", "Have a great evening, {name}", "Welcome, {name}",
    "Great to see you, {name}", "Have a good evening, {name}",
    "Welcome back, {name}", "Wishing you a great evening, {name}",
  ],
  lateEvening: [
    "Good evening, {name}", "Have a nice evening, {name}", "Welcome, {name}",
    "Great to see you, {name}", "Have a good evening, {name}",
    "Welcome back, {name}",
  ],
};


export type GreetingsDictionary = Record<Lang, Record<TimeBucket, string[]>>;

export const DEFAULT_GREETINGS: GreetingsDictionary = { pl: PL, en: EN };

const GREETINGS: GreetingsDictionary = DEFAULT_GREETINGS;


// ----------- VOCATIVE FALLBACKS (PL) -----------
// Used when the name is not in the dictionary. Heuristics by last letter / gender.
function fallbackVocativePL(name: string, gender: Gender | null): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  const last = lower.slice(-1);
  const cap = trimmed[0].toUpperCase() + trimmed.slice(1);

  if (gender === "female") {
    if (last === "a") return cap.slice(0, -1) + "o";
    return cap; // niespotykane formy - lepiej nie zniekształcać
  }
  if (gender === "male") {
    if (last === "a") return cap.slice(0, -1) + "o"; // np. "Kuba" -> "Kubo"
    if (last === "k") return cap + "u";
    if (last === "ł") return cap.slice(0, -1) + "le";
    if (last === "r") return cap.slice(0, -1) + "rze";
    if (last === "t") return cap.slice(0, -1) + "cie";
    if (last === "d") return cap.slice(0, -1) + "dzie";
    return cap + "ie";
  }
  return cap;
}

export interface GreetingArgs {
  lang: Lang;
  /** Display name or first name as typed by the user. */
  firstName?: string | null;
  /** Optional pre-resolved dictionary entry (preferred when available). */
  entry?: NameEntry | null;
  /** Stable seed (e.g. user id) so the variant is steady within a session. */
  seed?: string | number;
  /** Now (overridable for testing). */
  now?: Date;
  /** Optional custom greeting pool overrides (from CMS site_settings). */
  overrides?: Partial<GreetingsDictionary> | null;
}

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickGreeting({ lang, firstName, entry, seed, now }: GreetingArgs): string {
  const bucket = timeBucket(now);
  const pool = GREETINGS[lang][bucket];
  // Stable variant within a 30-min window per user (or random if no seed).
  const halfHour = Math.floor((now ?? new Date()).getTime() / (30 * 60 * 1000));
  const idx = seed !== undefined
    ? (hashSeed(`${seed}:${halfHour}`) % pool.length)
    : Math.floor(Math.random() * pool.length);
  const template = pool[idx];

  const raw = (firstName ?? "").trim();
  if (!raw) {
    // Strip ", {name}" gracefully.
    return template.replace(/\s*-?\s*\{name\}!?/g, "").replace(/,\s*$/, "").replace(/\s+!/, "!").trim();
  }

  let vocative = raw;
  if (lang === "pl") {
    vocative = entry?.vocative_pl?.trim() || fallbackVocativePL(raw, entry?.gender ?? null);
  } else if (entry?.vocative_en) {
    vocative = entry.vocative_en;
  }
  return template.replace(/\{name\}/g, vocative);
}
