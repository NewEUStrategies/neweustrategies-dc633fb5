// Tonacja wizualna warstwy członkostwa wybierana po jej RANDZE.
//
// To nie ozdoba, a reguła redakcyjna: ranga decyduje, która warstwa wygląda
// na premium (złoto), która na podstawową (szarość), a które siedzą pomiędzy.
// Redakcja ustawia rangę w /admin/membership, a panel cennika ma pokazać ten
// sam porządek, co strona publiczna - inaczej osoba układająca ofertę widzi
// hierarchię inną niż klient.
//
// Progi 30/15/5 mieszkały wewnątrz pliku trasy `/admin/pricing`, więc jedynym
// sposobem sprawdzenia ich było wyrenderowanie całego panelu z bazą.

/** Klasy Tailwinda dla nagłówka karty warstwy w jednej tonacji. */
export interface RankTone {
  header: string;
  iconBg: string;
  iconFg: string;
  pill: string;
  dot: string;
}

const GOLD: RankTone = {
  header: "from-amber-500/10 via-amber-500/5 to-transparent",
  iconBg: "bg-amber-500/15",
  iconFg: "text-amber-600 dark:text-amber-400",
  pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  dot: "bg-amber-500",
};

const PRIMARY: RankTone = {
  header: "from-primary/10 via-primary/5 to-transparent",
  iconBg: "bg-primary/15",
  iconFg: "text-primary",
  pill: "bg-primary/10 text-primary",
  dot: "bg-primary",
};

const SKY: RankTone = {
  header: "from-sky-500/10 via-sky-500/5 to-transparent",
  iconBg: "bg-sky-500/15",
  iconFg: "text-sky-600 dark:text-sky-400",
  pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  dot: "bg-sky-500",
};

const MUTED: RankTone = {
  header: "from-muted/60 via-muted/20 to-transparent",
  iconBg: "bg-muted",
  iconFg: "text-muted-foreground",
  pill: "bg-muted text-muted-foreground",
  dot: "bg-muted-foreground/60",
};

/**
 * Tonacja karty warstwy dla podanej rangi. Progi rosnące: od 30 premium,
 * od 15 marka, od 5 pomocnicza, niżej neutralna.
 */
export function rankTone(rank: number): RankTone {
  if (rank >= 30) return GOLD;
  if (rank >= 15) return PRIMARY;
  if (rank >= 5) return SKY;
  return MUTED;
}
