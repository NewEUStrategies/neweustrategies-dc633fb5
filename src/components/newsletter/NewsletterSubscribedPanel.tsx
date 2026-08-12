// Panel "jesteś już zapisany" - dwie kolumny.
//
// LEWA: stan subskrypcji, do której listy i od kiedy - żeby użytkownik nie
// zgadywał, czy jego adres jest już na liście i który to newsletter.
// PRAWA: wyłącznie wybór kolejnych tematów (i list wysyłkowych) - bez pól
// adresowych, bo adres jest już potwierdzony sesją.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLocale } from "@/lib/i18n/format";
import { CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";
import { TopicsDroplist, useInterestGroups } from "@/components/interests/TopicsDroplist";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { useUpdateMyNewsletterTopics } from "@/hooks/useMyNewsletterStatus";
import type { MyNewsletterStatus } from "@/lib/newsletter-status.functions";
import { cn } from "@/lib/utils";

function formatDate(value: string | null, lang: "pl" | "en"): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(uiLocale(lang), {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function NewsletterSubscribedPanel({
  status,
  lang,
  className,
}: {
  status: MyNewsletterStatus;
  lang: "pl" | "en";
  className?: string;
}) {
  const { t } = useTranslation();
  const { allItems, groups } = useInterestGroups(lang, null);
  const update = useUpdateMyNewsletterTopics();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Tematy już zapisane pokazujemy jako informację, a droplista służy tylko do
  // DOKŁADANIA kolejnych - stąd wykluczenie ich z listy do wyboru byłoby mylące
  // (użytkownik szuka tematu i go nie znajduje), więc zostają, tylko oznaczone.
  const currentTopics = useMemo(
    () => status.topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0),
    [status.topics],
  );

  const togglePick = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = (): void => {
    const labels = allItems.filter((item) => picked.has(item.id)).map((item) => item.label);
    if (labels.length === 0) return;
    update.mutate(
      { topics: labels, mailingLists: [] },
      {
        onSuccess: (res) => {
          if (res.ok) {
            toast.success(t("newsletterStatus.topicsSaved"));
            setPicked(new Set());
          } else {
            toast.error(t("newsletterStatus.topicsFailed"));
          }
        },
        onError: () => toast.error(t("newsletterStatus.topicsFailed")),
      },
    );
  };

  const pending = status.status === "pending";
  const since = formatDate(status.since, lang);

  return (
    <div
      data-testid="newsletter-subscribed-panel"
      className={cn("grid gap-6 lg:grid-cols-2 lg:gap-10", className)}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">
              {pending ? t("newsletterStatus.pendingTitle") : t("newsletterStatus.title")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pending ? t("newsletterStatus.pendingHint") : t("newsletterStatus.hint")}
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted-foreground">{t("newsletterStatus.listLabel")}</dt>
            <dd className="font-medium text-foreground">
              {status.listName ?? t("newsletterStatus.listFallback")}
            </dd>
          </div>
          {status.email !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-muted-foreground">{t("newsletterStatus.emailLabel")}</dt>
              <dd className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {status.email}
              </dd>
            </div>
          ) : null}
          {since !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-muted-foreground">{t("newsletterStatus.sinceLabel")}</dt>
              <dd className="font-medium text-foreground">{since}</dd>
            </div>
          ) : null}
          {status.mailingLists.length > 0 ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-muted-foreground">{t("newsletterStatus.listsLabel")}</dt>
              <dd className="font-medium text-foreground">{status.mailingLists.join(", ")}</dd>
            </div>
          ) : null}
        </dl>

        {currentTopics.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {currentTopics.map((topic) => (
              <li
                key={topic}
                className="rounded-[6px] border border-border/70 bg-muted/40 px-2 py-1 text-xs text-foreground"
              >
                {topic}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {t("newsletterStatus.moreTopicsTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("newsletterStatus.moreTopicsHint")}</p>
        <div className="mt-3">
          <TopicsDroplist
            lang={lang}
            allItems={allItems}
            groups={groups}
            picked={picked}
            onToggle={togglePick}
            onClear={() => setPicked(new Set())}
          />
        </div>
        <SubscribeButton
          type="button"
          onClick={submit}
          loading={update.isPending}
          loadingLabel="…"
          disabled={picked.size === 0}
          className="mt-3 w-full sm:w-auto"
        >
          {t("newsletterStatus.saveTopics")}
        </SubscribeButton>
      </div>
    </div>
  );
}
