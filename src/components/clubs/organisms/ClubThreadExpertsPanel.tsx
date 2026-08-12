// Organizm: "Eksperci tego wątku".
//
// JEDYNY MODUŁ KONTEKSTOWY W KLUBIE - jego zawartość zmienia się razem
// z otwartym wątkiem, bo bierze obszar tematyczny TEGO wątku (a gdy wątek go
// nie ma - obszar klubu) i szuka członków, którzy zadeklarowali w nim
// kompetencję.
//
// PO CO. W think tanku najcenniejszą asymetrią informacyjną nie jest to, co
// ktoś napisał, tylko to, KTO realnie pracował nad daną sprawą. Ta wiedza
// istnieje w każdym klubie i w żadnym nie jest zapisana - siedzi w głowach
// trzech osób, które znają wszystkich. Ten panel ją wypisuje.
//
// KOLEJNOŚĆ JEST TEZĄ: najpierw ci, których w wątku JESZCZE NIE MA. Członek,
// który już się wypowiedział, jest widoczny w dyskusji dwadzieścia centymetrów
// niżej i nie potrzebuje drugiego miejsca na ekranie. Cała wartość panelu to
// ludzie, których czytelnik NIE widzi.
//
// "POPROŚ O ZDANIE" JEST JEDNORAZOWE. Baza deduplikuje prośbę po trójce
// (wątek, adresat, pytający): druga prośba do tej samej osoby w tym samym
// wątku to nie przypomnienie, tylko spam. Przycisk zmienia się wtedy w stan,
// a nie w błąd - bo z punktu widzenia pytającego nic złego się nie stało.
//
// MILCZY tam, gdzie ma milczeć: klub ukrywający skład i wątek bez obszaru
// dostają z bazy zero wierszy, a panel bez wierszy nie renderuje się wcale.
// Nagłówek "Eksperci" nad pustką sugerowałby, że w klubie nie ma nikogo, kto
// się na tym zna - a to zwykle nieprawda, tylko nikt tego nie zadeklarował.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Check, GraduationCap, Loader2, MessageSquareQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubExpertiseChip } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { useClubThreadExperts, usePingClubThreadExpert } from "@/lib/clubs/useClubNetwork";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { uiLang } from "@/lib/i18n/format";

export function ClubThreadExpertsPanel({
  threadId,
  canAsk,
  className,
}: {
  threadId: string;
  /** Prosić o zdanie może ten, kto sam może się w tym wątku odezwać. */
  canAsk: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { topics } = useClubTopics();
  const lang = uiLang(i18n.language);
  const query = useClubThreadExperts({ threadId });
  const ping = usePingClubThreadExpert(threadId);

  const rows = query.data ?? [];
  // Cisza przy braku danych, przy błędzie i przy pustce - patrz nagłówek.
  // Panel kontekstowy nie ma prawa krzyczeć o własnej awarii nad dyskusją,
  // po którą czytelnik tu przyszedł.
  if (query.isPending || query.isError || rows.length === 0) return null;

  const area = rows[0].topic;

  return (
    <section className={cn(HUB_SURFACE, "p-3 sm:p-4", className)}>
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("club.network.experts.title")}
        </h2>
        {area !== null ? (
          <span className="text-[11px] text-muted-foreground">
            {t("club.network.experts.inArea", { area: topicLabel(area, lang, topics) })}
          </span>
        ) : null}
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.user_id}
            className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/60 p-2.5"
          >
            <ClubAuthorAvatar name={row.display_name} avatarUrl={row.avatar_url} size="md" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {row.profile_slug !== null ? (
                  <Link
                    to="/author/$slug"
                    params={{ slug: row.profile_slug }}
                    className="min-w-0 truncate text-sm font-medium hover:text-primary"
                  >
                    {row.display_name}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-sm font-medium">{row.display_name}</span>
                )}
                {/* Obecność w wątku jest informacją, nie wyróżnieniem: mówi
                    "tej osoby nie trzeba prosić, ona już tu jest". */}
                {row.in_thread ? (
                  <span className="shrink-0 rounded-lg bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                    {t("club.network.experts.inThread")}
                  </span>
                ) : null}
              </div>

              {row.headline !== null ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.headline}</p>
              ) : null}

              {row.topics.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.topics.slice(0, 3).map((topic) => (
                    <ClubExpertiseChip key={topic} label={topicLabel(topic, lang, topics)} />
                  ))}
                </div>
              ) : null}

              {canAsk && !row.in_thread ? (
                <div className="mt-2 flex items-center gap-1.5">
                  {row.pinged_by_me ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                      {t("club.network.experts.asked")}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg px-2 text-[11px]"
                      disabled={ping.isPending}
                      onClick={() =>
                        ping.mutate(row.user_id, {
                          onSuccess: (sent) => {
                            if (sent) toast.success(t("club.network.experts.askSent"));
                          },
                          onError: () => toast.error(t("club.network.experts.askFailed")),
                        })
                      }
                    >
                      {ping.isPending ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <MessageSquareQuote className="mr-1 h-3 w-3" aria-hidden="true" />
                      )}
                      {t("club.network.experts.ask")}
                    </Button>
                  )}
                  <DirectMessageButton
                    userId={row.user_id}
                    displayName={row.display_name}
                    displayAvatar={row.avatar_url}
                    compact
                  />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
        {t("club.network.experts.hint")}
      </p>
    </section>
  );
}
