// Molekuła: lista OSTRZEŻEŃ albo BLOKAD klonu edycji.
//
// JEDNA MOLEKUŁA DLA PODGLĄDU I WYNIKU. Te same kody (`_event_clone_forecast`)
// widzi organizator przed kliknięciem (podgląd) i po nim (podsumowanie na
// pulpicie nowej edycji) - dwie wersje tej samej listy rozjechałyby się przy
// pierwszym nowym kodzie.
//
// BLOKADA TO `role="alert"`, OSTRZEŻENIE - NIE. Blokada zatrzymuje zapis, więc
// czytnik ekranu ma ją ogłosić od razu; ostrzeżenie jest informacją, którą
// organizator przeczyta w swoim tempie.
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info } from "@/lib/lucide-shim";
import type { CloneNotice } from "@/lib/events/eventCloneApi";
import { cloneBlockerKey, cloneWarningKey } from "@/lib/events/eventCloneLabels";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

export function EventCloneNotices({
  title,
  notices,
  tone,
}: {
  title: string;
  notices: readonly CloneNotice[];
  tone: "warning" | "blocker";
}) {
  ensureCloneI18n();
  const { t } = useTranslation();
  if (notices.length === 0) return null;
  const blocker = tone === "blocker";
  const Icon = blocker ? AlertTriangle : Info;
  return (
    <section
      className={
        "space-y-1.5 rounded-md border p-3 " +
        (blocker ? "border-destructive/50 bg-destructive/5" : "border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20")
      }
      role={blocker ? "alert" : undefined}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs leading-snug">
        {notices.map((notice) => (
          <li key={notice.code}>
            {t(blocker ? cloneBlockerKey(notice) : cloneWarningKey(notice), { count: notice.count })}
          </li>
        ))}
      </ul>
    </section>
  );
}
