// Molekuła: wybór PODMIOTU nadania po imieniu i nazwisku (albo nazwie firmy).
//
// ZASTĘPUJE POLE „UUID". Administrator wpisuje imię, nazwisko, e-mail albo
// nazwę firmy, a pod polem rozwija się lista dopasowań z avatarem. Wybór
// oddaje rodzicowi identyfikator - kontrakt zapisu (`subjectId`) się nie
// zmienia. Wklejony pełny UUID nadal działa (szukamy po `id`).
//
// IZOLACJA NAJEMCY jest w bazie: RLS na `profiles`, `event_people`
// i `crm_companies` zawęża wynik do obszaru roboczego wołającego staffu,
// więc klient nie dokłada własnego filtra `tenant_id`.
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, Check, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { isUuid, shouldQueryMembers } from "@/lib/admin/memberSearch";
import { cn } from "@/lib/utils";

export type GrantSubjectKind = "user" | "person" | "company";

export interface GrantSubjectOption {
  id: string;
  name: string;
  secondary: string | null;
  avatarUrl: string | null;
}

/** Usuwa znaki specjalne `ilike`/`or`, żeby fraza nie zmieniała filtra. */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

async function searchSubjects(kind: GrantSubjectKind, term: string): Promise<GrantSubjectOption[]> {
  const uuid = isUuid(term);
  const safe = sanitizeSearchTerm(term);
  if (kind === "user") {
    const base = supabase.from("profiles").select("id, display_name, avatar_url, slug");
    const { data, error } = await (
      uuid ? base.eq("id", term) : base.ilike("display_name", `%${safe}%`).order("display_name")
    ).limit(10);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      name: (row.display_name ?? "").trim() || row.slug || row.id,
      secondary: row.slug,
      avatarUrl: row.avatar_url,
    }));
  }
  if (kind === "person") {
    const base = supabase
      .from("event_people")
      .select("id, first_name, last_name, email, photo_url");
    const words = safe.split(/\s+/).filter(Boolean);
    const filter = words
      .flatMap((word) => [
        `first_name.ilike.%${word}%`,
        `last_name.ilike.%${word}%`,
        `email.ilike.%${word}%`,
      ])
      .join(",");
    const { data, error } = await (uuid ? base.eq("id", term) : base.or(filter))
      .order("last_name")
      .limit(10);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      return {
        id: row.id,
        name: name || row.email || row.id,
        secondary: name ? row.email : null,
        avatarUrl: row.photo_url,
      };
    });
  }
  const base = supabase.from("crm_companies").select("id, name, email, logo_url");
  const { data, error } = await (
    uuid ? base.eq("id", term) : base.ilike("name", `%${safe}%`).order("name")
  ).limit(10);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name ?? row.id,
    secondary: row.email,
    avatarUrl: row.logo_url,
  }));
}

export function GrantSubjectCombobox({
  id,
  kind,
  value,
  onChange,
}: {
  id?: string;
  kind: GrantSubjectKind;
  value: string;
  onChange: (subjectId: string) => void;
}) {
  const { t } = useTranslation();
  const P = "adminEventRegistration.audienceGrants.subjectSearch";
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<GrantSubjectOption | null>(null);

  // Zmiana rodzaju podmiotu albo reset rodzica zdejmuje wybór.
  useEffect(() => {
    setSelected(null);
    setInput("");
    setTerm("");
  }, [kind]);
  useEffect(() => {
    if (value === "") setSelected(null);
  }, [value]);

  useEffect(() => {
    const handle = setTimeout(() => setTerm(input.trim()), 220);
    return () => clearTimeout(handle);
  }, [input]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const ready = shouldQueryMembers(term);
  const q = useQuery({
    queryKey: ["admin-grant-subject-search", kind, term] as const,
    enabled: open && ready,
    staleTime: 30_000,
    queryFn: () => searchSubjects(kind, term),
  });
  const results = q.data ?? [];

  const pick = (option: GrantSubjectOption) => {
    setSelected(option);
    onChange(option.id);
    setOpen(false);
    setInput("");
    setTerm("");
  };

  const clear = () => {
    setSelected(null);
    onChange("");
  };

  if (selected !== null) {
    return (
      <div className="platform-field flex h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm">
        <SubjectAvatar kind={kind} option={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{selected.name}</span>
        </span>
        <button
          type="button"
          onClick={clear}
          aria-label={t(`${P}.clear`)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  const showList = open && input.trim() !== "";

  return (
    <div ref={rootRef} className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={input}
        placeholder={t(`${P}.placeholder.${kind}`)}
        className="pl-9"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setInput(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            pick(results[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {!ready ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{t(`${P}.hint`)}</p>
          ) : q.isLoading ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{t(`${P}.loading`)}</p>
          ) : q.isError ? (
            <p className="px-2 py-2 text-xs text-destructive">{t(`${P}.error`)}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{t(`${P}.empty`)}</p>
          ) : (
            results.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <SubjectAvatar kind={kind} option={option} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.name}</span>
                  {option.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.secondary}
                    </span>
                  ) : null}
                </span>
                {value === option.id ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function SubjectAvatar({ kind, option }: { kind: GrantSubjectKind; option: GrantSubjectOption }) {
  if (kind === "company" && !option.avatarUrl) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  return <ChatAvatar name={option.name} avatarUrl={option.avatarUrl} size="xs" />;
}
