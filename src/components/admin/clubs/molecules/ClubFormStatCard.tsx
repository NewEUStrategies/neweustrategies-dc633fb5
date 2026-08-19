// Molekuła: JEDEN kafel metryki klubu.
//
// PO CO. Zakładka „Statystyki" miała dwanaście wywołań lokalnego `StatCard`,
// a w atrybutach każdego z nich - odczyt metryki, wybór jednostki i próg
// koloru. Reguły wyjechały do `lib/clubs/adminClubStatsView.ts`; tutaj został
// wyłącznie RYSUNEK deskryptora: ikona, etykieta, wartość, podpowiedź, ton.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jeden deskryptor. Molekuła nie wie, skąd
// wziął się wiersz statystyk ani czy zapytanie jeszcze leci.
//
// DOBÓR IKONY mieszka tutaj, a nie w module reguł, bo ikona jest układem -
// dwie metryki („Odpowiedzi / 30 dni" i „Tematy") świadomie dzielą ten sam
// znak, a modułowi reguł nie wolno importować Reacta.
import {
  Ban,
  Clock,
  Layers,
  MessageCircleQuestion,
  MessagesSquare,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserCog,
  Users2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import type { ClubStatCard, ClubStatId, ClubStatTone } from "@/lib/clubs/adminClubStatsView";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

type IconType = typeof Users2;

const STAT_ICON: Record<ClubStatId, IconType> = {
  unanswered: MessageCircleQuestion,
  firstReply: Clock,
  threads30d: TrendingUp,
  replies30d: MessagesSquare,
  members: Users2,
  active30d: UserCheck,
  pending: UserCog,
  groups: Layers,
  threads: MessagesSquare,
  leads: ShieldCheck,
  moderators: ShieldAlert,
  banned: Ban,
};

const TONE_CLASS: Record<ClubStatTone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  neutral: "",
};

export function ClubFormStatCard({ card }: { card: ClubStatCard }) {
  // Etykiety i jednostki metryk są w słowniku PANELU.
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const Icon = STAT_ICON[card.id];
  // Kreska, nie puste miejsce: kafel bez danych musi wyglądać jak kafel bez
  // danych, a nie jak kafel, który się nie doczytał.
  const text =
    card.value.kind === "missing"
      ? "-"
      : card.value.kind === "plain"
        ? card.value.text
        : t(card.value.key, card.value.params);

  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t(card.labelKey)}</span>
        </div>
        <div className={`text-2xl font-semibold tabular-nums ${TONE_CLASS[card.tone]}`}>{text}</div>
        {card.hint === null ? null : (
          <p className="text-[11px] leading-tight text-muted-foreground">
            {t(card.hint.key, card.hint.params)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
