// Lekki, bezzależnościowy wskaźnik siły hasła (bez zxcvbn - nie jest w repo).
// Wynik 0-4 liczony z długości (>=8, >=12) oraz obecności małych/wielkich liter,
// cyfry i znaku specjalnego. Dostępny: role="status" + aria-live ogłasza etykietę.
import { cn } from "@/lib/utils";

interface PasswordStrengthMeterProps {
  password: string;
  lang?: "pl" | "en";
}

const LABELS: Record<"pl" | "en", readonly [string, string, string, string]> = {
  pl: ["Słaby", "Średni", "Dobry", "Silny"],
  en: ["Weak", "Fair", "Good", "Strong"],
};

// Kolory segmentu i etykiety per poziom: czerwony -> bursztyn -> limonka -> zielony.
const SEGMENT_COLORS = ["bg-red-500", "bg-amber-500", "bg-lime-500", "bg-green-500"] as const;
const LABEL_COLORS = [
  "text-red-600 dark:text-red-400",
  "text-amber-600 dark:text-amber-400",
  "text-lime-600 dark:text-lime-400",
  "text-green-600 dark:text-green-400",
] as const;

/**
 * Zwraca wynik 1-4 dla niepustego hasła (0 tylko dla pustego).
 */
function scorePassword(password: string): number {
  if (!password) return 0;
  let raw = 0;
  if (password.length >= 8) raw += 1;
  if (password.length >= 12) raw += 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  raw += variety;
  // raw mieści się w 0..6 -> mapujemy na 1..4.
  if (raw <= 1) return 1;
  if (raw <= 3) return 2;
  if (raw <= 5) return 3;
  return 4;
}

export function PasswordStrengthMeter({ password, lang = "en" }: PasswordStrengthMeterProps) {
  if (!password) return null;

  const score = scorePassword(password);
  const label = LABELS[lang][score - 1];

  return (
    <div className="mt-1.5" role="status" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < score ? SEGMENT_COLORS[score - 1] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className={cn("mt-1 text-[11px] font-medium", LABEL_COLORS[score - 1])}>{label}</p>
    </div>
  );
}
