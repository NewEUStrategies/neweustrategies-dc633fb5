// Sekcja "Moje konto" - zaloguj / zarejestruj lub panel / wyloguj.
// Wyekstrahowana z Header.tsx, żeby drawer składał się z klocków.
import { Link } from "@tanstack/react-router";
import { LogIn, UserPlus, User, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  isPl: boolean;
  onNavigate: () => void;
};

// Styl spójny z desktopowym AccountMenuWidget: wiersze rounded-[6px],
// ikona 4x4 w kolorze muted, tekst 14px, hover bg-muted/60.
const accountRow =
  "group relative flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 min-h-9 text-left text-sm font-medium outline-none transition-[background-color,color] duration-200 hover:bg-muted/60 focus-visible:bg-muted/60";
const accountIcon =
  "h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--account-accent,var(--primary))]";
const primaryBtn = accountRow;
const secondaryBtn = accountRow;

export function MobileAccountSection({ isPl, onNavigate }: Props) {
  const { session, isStaff, signOut } = useAuth();
  const t = (pl: string, en: string) => (isPl ? pl : en);

  return (
    <div className="px-3 py-3 border-b border-border bg-muted/20">
      <p className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground mb-1.5 px-2.5">
        {t("Konto", "Account")}
      </p>
      {session ? (
        <div className="flex flex-col gap-0.5">
          <Link to={isStaff ? "/admin" : "/profile"} onClick={onNavigate} className={primaryBtn}>
            {isStaff ? <LayoutDashboard className={accountIcon} /> : <User className={accountIcon} />}
            {isStaff ? t("Moje konto", "My account") : t("Mój profil", "My profile")}
          </Link>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              onNavigate();
            }}
            className={secondaryBtn}
          >
            <LogOut className={accountIcon} />
            {t("Wyloguj", "Sign out")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <Link to="/login" onClick={onNavigate} className={primaryBtn}>
            <LogIn className={accountIcon} />
            {t("Zaloguj", "Sign in")}
          </Link>
          <Link
            to="/login"
            search={{ mode: "signup" }}
            onClick={onNavigate}
            className={secondaryBtn}
          >
            <UserPlus className={accountIcon} />
            {t("Zarejestruj", "Register")}
          </Link>
        </div>
      )}
    </div>
  );
}
