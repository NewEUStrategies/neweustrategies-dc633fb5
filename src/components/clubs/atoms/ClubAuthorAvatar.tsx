// Awatar autora wpisu w klubie.
//
// Dyskusja bez twarzy czyta się jak log: same nazwiska w jednej linii, wszystkie
// wpisy wyglądają tak samo, a wzrok nie ma za co złapać wątku rozmowy. Awatar
// (albo inicjały, gdy zdjęcia nie ma) daje kolumnie odpowiedzi rytm i pokazuje
// od razu, ile RÓŻNYCH osób tu mówi.
//
// Anonim pod aliasem i konto usunięte NIE dostają zdjęcia - tu awatar jest
// świadomie neutralny, żeby interfejs nie sugerował tożsamości, której baza
// celowo nie zdradza.
const SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
} as const;

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export function ClubAuthorAvatar({
  name,
  avatarUrl,
  size = "sm",
  muted = false,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  /** Autor anonimowy/usunięty - stonowany, bez akcentu marki. */
  muted?: boolean;
}) {
  const cls = `${SIZES[size]} shrink-0 select-none overflow-hidden rounded-full ring-1 ring-border/60`;

  if (avatarUrl !== null && avatarUrl !== undefined && avatarUrl !== "") {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className={`${cls} object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${cls} grid place-items-center font-semibold ${
        muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
      }`}
    >
      {initials(name)}
    </span>
  );
}
