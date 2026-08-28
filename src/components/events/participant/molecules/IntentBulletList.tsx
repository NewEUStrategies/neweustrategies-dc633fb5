// Lista punktów „czego szukam / co oferuję" - jedna linia tekstu z bazy
// trafia na jeden bullet. Współdzielona przez formularz edycji, podgląd
// publiczny profilu i katalog uczestników, żeby wszędzie wyglądało tak samo.
export const MAX_INTENT_BULLETS = 5;

export function parseIntentBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, MAX_INTENT_BULLETS);
}

export function IntentBulletList({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const items = parseIntentBullets(text);
  if (items.length === 0) return null;
  return (
    <ul className={`space-y-1 ${className ?? ""}`.trim()}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span
            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60"
            aria-hidden="true"
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}
