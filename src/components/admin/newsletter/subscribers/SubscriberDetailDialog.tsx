// SubscriberDetailDialog - szczegoly subskrybenta newslettera.
// Otwierany klikniciem wiersza w SubscribersPanel. Pokazuje pelne dane
// z newsletter_subscribers wraz z consents i meta (JSONB) w czytelnym
// atomowym layoucie. Read-only w Turze 3; edycja statusow w kolejnej.
import { useQuery } from "@tanstack/react-query";
import type { Json, Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { sanitizeHtml } from "@/lib/sanitize";

/**
 * Wpis zgody, jak go czyta ten dialog. Kolumna `consents` jest w bazie `jsonb`,
 * więc jej typem jest `Json` - czyli także napis, liczba i tablica napisów.
 * Wcześniejszy `as unknown as FullSubRow` obiecywał tablicę obiektów i kod
 * czytał `c.key` wprost; przy nietypowym ładunku (a to DANE OSOBOWE, wpisywane
 * przez integracje) dawało to `undefined` w kolumnie „zgoda" - czyli pytanie
 * „czy ta osoba zgodziła się na marketing" odpowiadane po cichu na nie.
 * Zawężamy jawnie: element, który nie jest obiektem, jest POMIJANY, a nie
 * renderowany jako puste pole.
 */
interface Consent {
  key?: string;
  text?: string;
  given?: boolean;
  lang?: string;
  at?: string;
}

/** Napis albo `undefined` - bez rzutowania, bo `Json` bywa liczbą i tablicą. */
function jsonStr(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readConsents(raw: Json): Consent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    // Pola czytamy po jednym i sprawdzamy typ każdego - to jedyny sposób,
    // żeby przejść z `Json` na kształt widoku BEZ rzutowania.
    return [
      {
        key: jsonStr(entry["key"]),
        text: jsonStr(entry["text"]),
        given: entry["given"] === true,
        lang: jsonStr(entry["lang"]),
        at: jsonStr(entry["at"]),
      },
    ];
  });
}

/** Pary `klucz -> wartość` z kolumny `meta` (też `jsonb`, więc też nie obiekt z definicji). */
function readMeta(raw: Json): [string, string][] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, value]) => [key, value === undefined ? "" : String(value)]);
}
/**
 * Kolumny czytane przez ten kod - WYPROWADZONE z wygenerowanych typów.
 * Ręcznie przepisany kształt wiersza rozjeżdża się z bazą bez żadnego sygnału,
 * bo `as unknown as` kasuje różnicę; `Pick` po `Tables<>` zamienia zmianę
 * kolumny w migracji na błąd kompilacji dokładnie tutaj.
 */
type FullSubRow = Pick<Tables<"newsletter_subscribers">, "id" | "email" | "display_name" | "first_name" | "last_name" | "language" | "status" | "source" | "source_form_name" | "created_at" | "confirmed_at" | "unsubscribed_at" | "updated_at" | "meta" | "consents" | "user_agent">;

export function SubscriberDetailDialog({
  subscriberId,
  onOpenChange,
}: {
  subscriberId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!subscriberId;
  const { data, isLoading } = useQuery({
    queryKey: ["newsletter-subscriber", subscriberId],
    enabled: open,
    queryFn: async (): Promise<FullSubRow | null> => {
      if (!subscriberId) return null;
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select(
          "id, email, display_name, first_name, last_name, language, status, source, source_form_name, created_at, confirmed_at, unsubscribed_at, updated_at, meta, consents, user_agent",
        )
        .eq("id", subscriberId)
        .maybeSingle();
      if (error) throw error;
      return (data as FullSubRow) ?? null;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{data?.email ?? "Subskrybent"}</DialogTitle>
          <DialogDescription>
            {data?.display_name ??
              [data?.first_name, data?.last_name].filter(Boolean).join(" ") ??
              "-"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {data && (
          <div className="space-y-5">
            <Section title="Podstawowe">
              <Row label="Status" value={<StatusBadge status={data.status} />} />
              <Row
                label="Jezyk"
                value={<span className="uppercase text-xs">{data.language}</span>}
              />
              <Row label="Zrodlo" value={data.source ?? "-"} />
              <Row label="Formularz" value={data.source_form_name ?? "-"} />
            </Section>

            <Section title="Timeline">
              <Row label="Utworzono" value={fmt(data.created_at)} />
              <Row label="Potwierdzono" value={fmt(data.confirmed_at)} />
              <Row label="Wypisano" value={fmt(data.unsubscribed_at)} />
              <Row label="Aktualizacja" value={fmt(data.updated_at)} />
            </Section>

            <Section title="Zgody">
              {readConsents(data.consents).length ? (
                <ul className="space-y-2">
                  {readConsents(data.consents).map((c, i) => (
                    <li
                      key={i}
                      className="p-3 rounded-md bg-muted/40 border border-border/60 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono uppercase tracking-wider">{c.key ?? "-"}</span>
                        <span
                          className={
                            c.given
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                          }
                        >
                          {c.given ? "✓ udzielona" : "brak"}
                        </span>
                      </div>
                      {c.text && (
                        <div
                          className="text-muted-foreground [&_a]:underline"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.text) }}
                        />
                      )}
                      {c.at && (
                        <div className="text-muted-foreground/70 text-[10px]">
                          {fmt(c.at)}
                          {c.lang ? ` • ${c.lang.toUpperCase()}` : ""}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Brak zapisanych zgod.</p>
              )}
            </Section>

            <Section title="Metadane">
              {readMeta(data.meta).length ? (
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
                  {readMeta(data.meta).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground font-mono">{k}</dt>
                      <dd className="break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">Brak metadanych.</p>
              )}
            </Section>

            {data.user_agent && (
              <Section title="Klient">
                <p className="text-[11px] font-mono text-muted-foreground break-all">
                  {data.user_agent}
                </p>
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 text-sm">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "subscribed"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "pending"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${style}`}>{status}</span>;
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}
