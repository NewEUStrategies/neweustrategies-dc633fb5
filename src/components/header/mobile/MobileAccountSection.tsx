// Sekcja "Moje konto" - zaloguj / zarejestruj lub panel / wyloguj.
// Wyekstrahowana z Header.tsx, żeby drawer składał się z klocków.
import { Link } from "@tanstack/react-router";
import { LogIn, UserPlus, User, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  isPl: boolean;
  onNavigate: () => void;
};

const primaryBtn =
  "flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition";
const secondaryBtn =
  "flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-md border border-border text-foreground text-sm font-semibold hover:bg-muted transition";

export function MobileAccountSection({ isPl, onNavigate }: Props) {
  const { session, isStaff, signOut } = useAuth();
  const t = (pl: string, en: string) => (isPl ? pl : en);

  return (
    <div className="px-4 py-4 border-b border-border bg-muted/30">
      <p className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground mb-2">
        {t("Moje konto", "My account")}
      </p>
      {session ? (
        <div className="flex flex-col gap-2">
          <Link to={isStaff ? "/admin" : "/profile"} onClick={onNavigate} className={primaryBtn}>
            {isStaff ? <LayoutDashboard className="w-4 h-4" /> : <User className="w-4 h-4" />}
            {isStaff ? t("Panel", "Dashboard") : t("Mój profil", "My profile")}
          </Link>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              onNavigate();
            }}
            className={secondaryBtn}
          >
            <LogOut className="w-4 h-4" />
            {t("Wyloguj", "Sign out")}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Link to="/login" onClick={onNavigate} className={primaryBtn}>
            <LogIn className="w-4 h-4" />
            {t("Zaloguj", "Sign in")}
          </Link>
          <Link
            to="/login"
            search={{ mode: "signup" }}
            onClick={onNavigate}
            className={secondaryBtn}
          >
            <UserPlus className="w-4 h-4" />
            {t("Zarejestruj", "Register")}
          </Link>
        </div>
      )}
    </div>
  );
}
