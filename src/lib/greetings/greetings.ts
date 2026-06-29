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
    "Nie śpisz, {name}?", "Witaj nocnym markiem, {name}!", "Cisza nocna, {name}",
    "Dobrej nocy, {name}", "Pracujesz po godzinach, {name}?", "Spokojnej nocy, {name}",
    "Witaj w nocnej zmianie, {name}",
  ],
  earlyMorning: [
    "Dzień dobry, {name}!", "Witaj wcześnie rano, {name}", "Pierwszy dzwonek, {name}",
    "Cześć, {name} - wcześnie wstajesz!", "Dobrego początku dnia, {name}",
    "Witaj o świcie, {name}", "Miłego poranka, {name}",
  ],
  morning: [
    "Dzień dobry, {name}!", "Cześć, {name} - miłego poranka!", "Witaj, {name}",
    "Dobrego dnia, {name}", "Powodzenia dziś, {name}", "Hej, {name}!",
    "Witaj ponownie, {name}", "Miło Cię widzieć, {name}",
  ],
  noon: [
    "Cześć, {name}!", "Smacznego, {name}", "Witaj w południe, {name}",
    "Dobrej przerwy, {name}", "Miłego dnia, {name}", "Hej, {name}",
    "Witaj ponownie, {name}",
  ],
  afternoon: [
    "Cześć, {name}!", "Miłego popołudnia, {name}", "Witaj, {name}",
    "Dobrego dnia, {name}", "Jak tam, {name}?", "Hej, {name}",
    "Witaj ponownie, {name}", "Drugiej połowy dnia, {name}",
  ],
  evening: [
    "Dobry wieczór, {name}!", "Witaj wieczorem, {name}", "Miłego wieczoru, {name}",
    "Cześć, {name}", "Hej, {name}", "Spokojnego wieczoru, {name}",
    "Witaj ponownie, {name}",
  ],
  lateEvening: [
    "Dobry wieczór, {name}", "Pora odpoczynku, {name}", "Spokojnej nocy, {name}",
    "Witaj, {name} - późna pora", "Miłego wieczoru, {name}",
    "Cisza wieczorna, {name}",
  ],
};

const EN: Record<TimeBucket, string[]> = {
  night: [
    "Still up, {name}?", "Welcome, night owl {name}", "Quiet night, {name}",
    "Good night, {name}", "Working late, {name}?", "Late shift, {name}?",
    "Hello night-shift {name}",
  ],
  earlyMorning: [
    "Good morning, {name}!", "Early start, {name}", "Rise and shine, {name}",
    "Hi {name} - early bird!", "Have a great day, {name}",
    "Welcome at dawn, {name}", "Top of the morning, {name}",
  ],
  morning: [
    "Good morning, {name}!", "Hi {name} - have a great morning", "Welcome, {name}",
    "Have a great day, {name}", "Good luck today, {name}", "Hey {name}!",
    "Welcome back, {name}", "Great to see you, {name}",
  ],
  noon: [
    "Hi {name}!", "Enjoy your lunch, {name}", "Welcome at noon, {name}",
    "Have a nice break, {name}", "Have a great day, {name}", "Hey {name}",
    "Welcome back, {name}",
  ],
  afternoon: [
    "Hi {name}!", "Good afternoon, {name}", "Welcome, {name}",
    "Have a great day, {name}", "How's it going, {name}?", "Hey {name}",
    "Welcome back, {name}", "Second half of the day, {name}",
  ],
  evening: [
    "Good evening, {name}!", "Welcome this evening, {name}", "Have a nice evening, {name}",
    "Hi {name}", "Hey {name}", "Have a calm evening, {name}",
    "Welcome back, {name}",
  ],
  lateEvening: [
    "Good evening, {name}", "Time to relax, {name}", "Good night, {name}",
    "Hello {name} - late hour", "Have a nice evening, {name}",
    "Quiet evening, {name}",
  ],
};

const GREETINGS: Record<Lang, Record<TimeBucket, string[]>> = { pl: PL, en: EN };

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
