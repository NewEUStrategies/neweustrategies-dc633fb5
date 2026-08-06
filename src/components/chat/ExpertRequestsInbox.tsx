// Organism: skrzynka zapytań z formularzy „Zapytanie do eksperta" wewnątrz
// czatu. Widoczna WYŁĄCZNIE dla ekspertów - czyli dla osób, które faktycznie
// otrzymują zapytania (RPC list_my_inmails('received') zwraca tylko rekordy,
// w których zalogowany użytkownik jest odbiorcą; RLS/SECURITY DEFINER pilnują
// tenanta). Zatwierdzenie zapytania tworzy serwerowo bezpośrednią rozmowę,
// więc dalsza konwersacja - i odpowiedź dla nadawcy - dzieje się już w czacie.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMyExpertRequests,
  useResolveExpertRequest,
  type ExpertRequestRow,
} from "@/lib/chat/useExpertRequests";
import { relTime, type ChatLang } from "@/lib/chat/time";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";

export interface ExpertRequestsInboxProps {
  /** Otwiera rozmowę w prawym panelu skrzynki (przełącza widok na czat). */
  onOpenConversation: (conversationId: string) => void;
  className?: string;
}

const STATUS_TONE: Record<string, string> = {
  pending: "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-brand-ink",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  answered: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  declined: "border-border bg-muted/60 text-muted-foreground",
  cancelled: "border-border bg-muted/60 text-muted-foreground",
};

function questionsOf(row: ExpertRequestRow): string[] {
  const raw: unknown = row.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
}

function linksOf(row: ExpertRequestRow): string[] {
  const raw: unknown = row.external_links;
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is string => typeof l === "string" && /^https?:\/\//i.test(l));
}

export function ExpertRequestsInbox({ onOpenConversation, className }: ExpertRequestsInboxProps) {
  ensureExpertRequestI18n();
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language === "en" ? "en" : "pl";
  const q = useMyExpertRequests("received");
  const resolve = useResolveExpertRequest();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = [...(q.data ?? [])];
    return list.sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [q.data]);

  async function act(row: ExpertRequestRow, action: "approve" | "decline") {
    setBusyId(row.id);
    try {
      const res = await resolve.mutateAsync({ requestId: row.id, action });
      if (action === "decline") {
        toast.success(t("expertRequest.status.declined"));
        return;
      }
      const conversationId = res?.conversation_id ?? row.converted_conversation_id ?? null;
      if (conversationId) {
        toast.success(t("expertRequest.inbox.openedToast"));
        onOpenConversation(conversationId);
      }
    } catch {
      toast.error(t("expertRequest.error.generic"));
    } finally {
      setBusyId(null);
    }
  }

  if (q.isPending) {
    return (
      <div className={cn("flex flex-col gap-2 p-3", className)} aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-[6px] bg-muted/50" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-8", className)}>
        <MessagesSquare className="h-7 w-7 text-muted-foreground/60" aria-hidden />
        <p className="text-center text-xs text-muted-foreground">
          {t("expertRequest.inbox.empty")}
        </p>
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-2 overflow-y-auto p-3", className)}>
      {rows.map((row) => {
        const open = expanded === row.id;
        const questions = questionsOf(row);
        const links = linksOf(row);
        const busy = busyId === row.id;
        return (
          <li key={row.id} className="rounded-[6px] border border-border/70 bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{row.subject}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {relTime(row.created_at, lang)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-[6px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  STATUS_TONE[row.status] ?? STATUS_TONE.declined,
                )}
              >
                {t(`expertRequest.status.${row.status}`)}
              </span>
            </div>

            <p className={cn("mt-1.5 text-xs text-muted-foreground", !open && "line-clamp-2")}>
              {row.reason}
            </p>

            {open && (
              <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                {questions.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("expertRequest.inbox.questions")}
                    </p>
                    <ol className="mt-1 list-decimal pl-4 text-xs text-foreground">
                      {questions.map((question) => (
                        <li key={question} className="py-0.5">
                          {question}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {row.expected_answers && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("expertRequest.fields.expectedAnswers")}
                    </p>
                    <p className="mt-1 text-xs text-foreground">{row.expected_answers}</p>
                  </div>
                )}
                {links.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {links.map((link) => (
                      <li key={link}>
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          <span className="break-all">{link}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : row.id)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                  aria-hidden
                />
                {open ? t("expertRequest.inbox.less") : t("expertRequest.inbox.more")}
              </button>

              <div className="flex flex-wrap justify-end gap-1.5">
                {row.status === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-[6px]"
                      disabled={busy}
                      onClick={() => void act(row, "decline")}
                    >
                      {t("expertRequest.actions.decline")}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 rounded-[6px]"
                      disabled={busy}
                      onClick={() => void act(row, "approve")}
                    >
                      {t("expertRequest.inbox.reply")}
                    </Button>
                  </>
                ) : (
                  row.converted_conversation_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-[6px]"
                      onClick={() => onOpenConversation(row.converted_conversation_id as string)}
                    >
                      {t("expertRequest.actions.openConversation")}
                    </Button>
                  )
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
