// Atom: znacznik skrzynki zgłoszeń w jednym z czterech TONÓW.
//
// CO BYŁO W ORGANIZMIE. `ClubApplicationsInbox` miał DWIE kopie tego samego
// odwzorowania tonu na klasy: `statusTone()` dla statusu zgłoszenia i drabinkę
// `? :` w `CrmSyncChip` dla stanu synchronizacji. Napisy klas były identyczne
// znak w znak - czyli jedna wiedza w dwóch miejscach, gotowa do rozjechania się
// przy pierwszej korekcie palety.
//
// KOLOR NIESIE ZNACZENIE, NIE DEKORACJĘ (ta sama zasada, co w `ClubBadges`):
// czerwony wyłącznie tam, gdzie coś jest odcięte albo nieudane, bursztynowy
// tam, gdzie czeka decyzja człowieka. Redakcja skanuje skrzynkę wzrokiem PRZED
// przeczytaniem etykiet, więc znacznik w „nie tym” tonie kłamie o stanie
// zgłoszenia.
//
// Bez I/O i bez stanu: ton dostaje z zewnątrz (`applicationStatusTone`,
// `crmChipView`), napis też - atom nie tłumaczy i nie liczy.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { InboxTone } from "@/lib/clubs/adminApplicationsInbox";

const TONE_CLASS: Record<InboxTone, string> = {
  positive: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  negative: "border-destructive/40 text-destructive",
  warning: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  neutral: "border-border text-muted-foreground",
};

export function ClubInboxToneBadge({
  tone,
  title,
  children,
}: {
  tone: InboxTone;
  /** Podpowiedź pod kursorem - przy stanie CRM niesie treść błędu z bazy. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant="outline" className={TONE_CLASS[tone]} title={title}>
      {children}
    </Badge>
  );
}
