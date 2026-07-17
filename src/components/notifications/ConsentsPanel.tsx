// Widok zarządzania zgodami RODO dla zalogowanego użytkownika. Każda zgoda:
// - definicja z katalogu (`consentCatalog.ts`) - klucz, wersja, kategoria,
// - bieżący stan z `user_consents` (via server-fn),
// - przełącznik natychmiast zapisujący decyzję (audit-log w `user_consent_events`).
//
// Kluczowa własność: klient nigdy nie pisze do tabel bezpośrednio - server-fn
// wywołuje `set_user_consent`, które atomowo aktualizuje stan i dopisuje wpis
// audit-logu wraz z IP i User-Agent czytanymi po stronie serwera.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  buildConsentViews,
  useMyConsentEvents,
  useMyConsents,
  useSetMyConsent,
  type ConsentView,
} from "@/lib/notifications/useConsents";
import type { ConsentCategory } from "@/lib/notifications/consentCatalog";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

const CATEGORY_ORDER: readonly ConsentCategory[] = [
  "legal",
  "communications",
  "product",
  "analytics",
];

function fmt(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ConsentsPanel() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const consentsQ = useMyConsents();
  const eventsQ = useMyConsentEvents(50);
  const setConsent = useSetMyConsent();

  const views = useMemo(() => buildConsentViews(consentsQ.data), [consentsQ.data]);
  const grouped = useMemo(() => {
    const map = new Map<ConsentCategory, ConsentView[]>();
    for (const v of views) {
      const cat = v.definition.category;
      const arr = map.get(cat) ?? [];
      arr.push(v);
      map.set(cat, arr);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c) ?? [],
    }));
  }, [views]);

  const onToggle = (view: ConsentView, next: boolean) => {
    if (view.definition.required) return;
    setConsent.mutate(
      {
        key: view.definition.key,
        given: next,
        version: view.definition.version,
        lang,
        source: "notifications_center",
      },
      {
        onSuccess: () =>
          toast.success(t("notifications.consents.saved", { defaultValue: "Zapisano zgodę" })),
        onError: () =>
          toast.error(
            t("notifications.consents.saveError", {
              defaultValue: "Nie udało się zapisać zgody",
            }),
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="rounded-md border border-border/60 bg-muted/30 px-3.5 py-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--brand)]/10 text-[var(--brand)]"
            aria-hidden
          >
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {t("notifications.consents.title", { defaultValue: "Zgody komunikacji" })}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("notifications.consents.subtitle", {
                defaultValue:
                  "Zdecyduj, jakie wiadomości mogą do Ciebie trafiać. Każdą zmianę zapisujemy w niezmiennym rejestrze RODO.",
              })}
            </p>
          </div>
        </div>
      </header>

      {grouped.map(({ category, items }) => (
        <section key={category} aria-labelledby={`consent-cat-${category}`}>
          <h3
            id={`consent-cat-${category}`}
            className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t(`notifications.consents.categories.${category}`, { defaultValue: category })}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {items.map((view) => {
              const { definition, state } = view;
              const inputId = `consent-${definition.key}`;
              const dateIso = view.effectiveGiven
                ? (state?.given_at ?? state?.updated_at ?? null)
                : (state?.withdrawn_at ?? state?.updated_at ?? null);
              const showOutdated = !!state && !view.isCurrent && !definition.required;
              return (
                <li
                  key={definition.key}
                  className={cn(
                    "rounded-md border border-border/60 bg-card px-3.5 py-3 shadow-sm transition-colors",
                    showOutdated && "border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={inputId} className="text-sm font-semibold">
                          {t(`notifications.consents.items.${definition.key}.title`, {
                            defaultValue: definition.key,
                          })}
                        </Label>
                        {definition.required && (
                          <span className="inline-flex h-4 items-center rounded-md bg-[var(--brand)]/10 px-1.5 text-[10px] font-medium text-[var(--brand)]">
                            {t("notifications.consents.requiredBadge", {
                              defaultValue: "Wymagana",
                            })}
                          </span>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {t("notifications.consents.version", {
                            version: definition.version,
                            defaultValue: `Wersja ${definition.version}`,
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(`notifications.consents.items.${definition.key}.description`, {
                          defaultValue: "",
                        })}
                      </p>
                      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground/80">
                        {!state
                          ? t("notifications.consents.notDecided", {
                              defaultValue: "Nie podjęto decyzji",
                            })
                          : view.effectiveGiven
                            ? t("notifications.consents.given", {
                                date: fmt(dateIso, lang),
                                defaultValue: `Udzielono ${fmt(dateIso, lang)}`,
                              })
                            : t("notifications.consents.withdrawn", {
                                date: fmt(dateIso, lang),
                                defaultValue: `Wycofano ${fmt(dateIso, lang)}`,
                              })}
                      </p>
                      {showOutdated && (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {t("notifications.consents.versionOutdated", {
                            defaultValue: "Nowa wersja tej zgody - potwierdź ponownie",
                          })}
                        </p>
                      )}
                    </div>
                    <Switch
                      id={inputId}
                      checked={view.effectiveGiven}
                      disabled={definition.required || setConsent.isPending}
                      onCheckedChange={(v) => onToggle(view, v)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-labelledby="consent-history">
        <h3
          id="consent-history"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("notifications.consents.history", { defaultValue: "Historia zmian" })}
        </h3>
        {eventsQ.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">…</p>
        ) : !eventsQ.data || eventsQ.data.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("notifications.consents.historyEmpty", { defaultValue: "Brak zapisanych zmian." })}
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1 text-[11px] tabular-nums text-muted-foreground">
            {eventsQ.data.map((ev) => (
              <li key={ev.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    ev.given ? "bg-emerald-500" : "bg-rose-500",
                  )}
                  aria-hidden
                />
                <span>
                  {fmt(ev.created_at, lang)} -{" "}
                  <span className="font-medium text-foreground">
                    {t(`notifications.consents.items.${ev.consent_key}.title`, {
                      defaultValue: ev.consent_key,
                    })}
                  </span>{" "}
                  -{" "}
                  {ev.given
                    ? t("notifications.consents.stateGiven", { defaultValue: "udzielono" })
                    : t("notifications.consents.stateWithdrawn", { defaultValue: "wycofano" })}{" "}
                  <span className="text-muted-foreground/70">(v{ev.version})</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
