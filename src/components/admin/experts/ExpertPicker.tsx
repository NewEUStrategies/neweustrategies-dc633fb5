// Wybór osoby z bazy wewnętrznej ekspertów - jedna kontrolka dla obu edytorów.
//
// Zastępuje zwykły `<select>`, który przy kilkudziesięciu osobach (baza NES to
// dziś ponad 40 profili) był nie do przeszukania i nie mówił NIC o tym, kogo
// właściwie zawiera. Tutaj redakcja widzi zdjęcie, stanowisko, odznakę
// „ekspert" i status publikacji profilu, a stopka podaje wielkość bazy - czyli
// to, czego szukano: identyfikację wewnętrznego zasobu, nie samą listę id.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, User as UserIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  filterInternalExperts,
  internalExpertBaseQueryOptions,
  type InternalExpertEntry,
} from "@/lib/experts/internalBase";

interface Props {
  lang: "pl" | "en";
  /** Zaznaczone `user_id` ("" = brak wyboru). */
  value: string;
  onSelect: (entry: InternalExpertEntry) => void;
  /** Wywoływane przy wyborze pozycji „brak". Bez tego pozycja się nie pojawia. */
  onClear?: () => void;
  /** Etykieta pozycji „brak" (np. „Autor bieżącego wpisu"). */
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}

const T = {
  pl: {
    placeholder: "Wybierz osobę z bazy",
    search: "Szukaj: nazwisko, stanowisko, organizacja…",
    listbox: "Osoby w bazie wewnętrznej",
    empty: "Brak dopasowań w bazie wewnętrznej.",
    expert: "ekspert",
    draft: "profil niepubliczny",
    restricted: "Widok ograniczony do profili publicznych - pełną bazę widzi administrator.",
    base: (total: number, experts: number) =>
      `Baza wewnętrzna: ${total} ${plPeople(total)} · ${experts} z odznaką „ekspert"`,
    loading: "Wczytywanie bazy…",
  },
  en: {
    placeholder: "Pick a person from the base",
    search: "Search: name, job title, organisation…",
    listbox: "People in the internal base",
    empty: "No matches in the internal base.",
    expert: "expert",
    draft: "profile not published",
    restricted: "Limited to published profiles - an administrator sees the full base.",
    base: (total: number, experts: number) =>
      `Internal base: ${total} ${total === 1 ? "person" : "people"} · ${experts} with the “expert” badge`,
    loading: "Loading the base…",
  },
} as const;

/** Odmiana „osoba/osoby/osób" - stopka podaje realną wielkość bazy. */
function plPeople(n: number): string {
  if (n === 1) return "osoba";
  const last = n % 10;
  const teen = n % 100;
  if (last >= 2 && last <= 4 && !(teen >= 12 && teen <= 14)) return "osoby";
  return "osób";
}

function Avatar({ entry }: { entry: InternalExpertEntry }) {
  if (entry.avatarUrl) {
    return (
      <img
        src={entry.avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-7 w-7 shrink-0 rounded-[6px] object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground"
      aria-hidden
    >
      <UserIcon className="h-3.5 w-3.5" />
    </span>
  );
}

export function ExpertPicker({
  lang,
  value,
  onSelect,
  onClear,
  noneLabel,
  disabled,
  className,
}: Props) {
  const t = T[lang];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery(internalExpertBaseQueryOptions());

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const shown = useMemo(() => filterInternalExperts(entries, q), [entries, q]);
  const selected = entries.find((e) => e.id === value) ?? null;

  const subtitle = (e: InternalExpertEntry) =>
    [e.jobTitle, e.company].filter((v) => !!v && v.trim().length > 0).join(" · ");

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-[6px] border border-border bg-background px-2 text-left text-xs",
            "hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {selected ? (
            <>
              <Avatar entry={selected} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{selected.name}</span>
                {subtitle(selected) && (
                  <span className="text-muted-foreground"> - {subtitle(selected)}</span>
                )}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {noneLabel ?? t.placeholder}
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(28rem,90vw)] p-0">
        <div className="flex items-center gap-2 border-b border-border px-2 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            className="h-6 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* `role="listbox"` bez nazwy dostępnej to naruszenie WCAG 4.1.2
            (axe: `aria-input-field-name`): czytnik ogłaszał "listbox" i nic
            więcej, więc nie dawał się odróżnić od żadnej innej listy panelu. */}
        <div role="listbox" aria-label={t.listbox} className="max-h-72 overflow-y-auto py-1">
          {onClear && (
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              <span className="w-7 shrink-0" />
              <span className="flex-1 truncate">{noneLabel ?? t.placeholder}</span>
              {!value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          )}

          {isLoading && <div className="px-3 py-3 text-xs text-muted-foreground">{t.loading}</div>}

          {!isLoading && shown.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{t.empty}</div>
          )}

          {shown.map((e) => (
            <button
              key={e.id}
              type="button"
              role="option"
              aria-selected={e.id === value}
              onClick={() => {
                onSelect(e);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted",
                e.id === value && "bg-muted/60",
              )}
            >
              <Avatar entry={e} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{e.name}</span>
                {subtitle(e) && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {subtitle(e)}
                  </span>
                )}
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {e.isExpert && (
                    <span className="rounded-[6px] bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {t.expert}
                    </span>
                  )}
                  {!e.isPublic && (
                    <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t.draft}
                    </span>
                  )}
                </span>
              </span>
              {e.id === value && <Check className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>

        <div className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          {data ? t.base(data.total, data.expertCount) : t.loading}
          {data?.restricted && <div className="mt-0.5">{t.restricted}</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
