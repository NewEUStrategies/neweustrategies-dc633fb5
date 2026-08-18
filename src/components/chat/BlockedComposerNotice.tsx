// Atom: pasek zamiast kompozytora, gdy wołający zablokował rozmówcę.
//
// Świadomie NIE jest wyłączonym kompozytorem: wyłączone pole tekstowe mówi
// „chwilowo nie możesz", a tu chodzi o stan trwały do odwołania przez
// użytkownika. Pasek nazywa przyczynę i daje jedyną sensowną akcję -
// odblokowanie. Kierunek odwrotny (to rozmówca zablokował nas) egzekwuje
// serwer błędem „chat: blocked" i NIE jest tu widoczny: RLS `user_blocks`
// pokazuje wyłącznie własne blokady, więc UI nie ma prawa go znać.
import { useTranslation } from "react-i18next";

export interface BlockedComposerNoticeProps {
  onUnblock: () => void;
  /** Mutacja w locie - przycisk musi być nieaktywny, nie tylko przygaszony. */
  pending: boolean;
}

export function BlockedComposerNotice({ onUnblock, pending }: BlockedComposerNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-border/60 bg-background/95 px-3 py-2.5 text-center">
      <p className="text-[12px] text-muted-foreground">{t("chat.block.composerNotice")}</p>
      <button
        type="button"
        onClick={onUnblock}
        disabled={pending}
        className="mt-1.5 rounded-[6px] border border-border/60 px-3 py-1 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        {t("chat.block.unblock")}
      </button>
    </div>
  );
}
