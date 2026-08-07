// Obserwowanie wątku.
//
// Trzy stany, nie dwa. Brak wpisu w `club_thread_subscriptions` NIE jest tym
// samym, co `muted`: znaczy "domyślny poziom powiadomień klubu", który sam
// w sobie może być włączony. Przycisk z dwoma stanami kłamałby o tym przy
// pierwszym wejściu - pokazywałby "nie obserwujesz" komuś, kto dostaje
// powiadomienia z ustawień klubu.
//
// Stąd `null` rysuje się jako stan neutralny z podpowiedzią, a nie jako
// wyłączony dzwonek.
import { useTranslation } from "react-i18next";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClubSubscriptionState } from "@/lib/clubs/types";

export function ClubFollowButton({
  state,
  pending,
  disabled,
  onChange,
}: {
  state: ClubSubscriptionState | null;
  pending: boolean;
  disabled: boolean;
  onChange: (next: ClubSubscriptionState) => void;
}) {
  const { t } = useTranslation();

  // Kliknięcie prowadzi zawsze do stanu JAWNEGO: z domyślnego i z wyciszonego
  // do "obserwuję", z "obserwuję" do "wyciszony". Nie ma drogi z powrotem do
  // stanu domyślnego i nie udajemy, że jest.
  const next: ClubSubscriptionState = state === "subscribed" ? "muted" : "subscribed";
  const Icon = state === "subscribed" ? BellRing : state === "muted" ? BellOff : Bell;

  return (
    <Button
      size="sm"
      variant={state === "subscribed" ? "secondary" : "outline"}
      disabled={pending || disabled}
      aria-pressed={state === "subscribed"}
      onClick={() => onChange(next)}
      title={state === null ? t("club.subscription.defaultHint") : undefined}
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="mr-1.5 h-3.5 w-3.5" />
      )}
      {state === "subscribed"
        ? t("club.subscription.subscribed")
        : state === "muted"
          ? t("club.subscription.muted")
          : t("club.subscription.follow")}
    </Button>
  );
}
