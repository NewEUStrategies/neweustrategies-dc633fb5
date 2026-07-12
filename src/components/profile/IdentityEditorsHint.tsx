// Trzy edytory tożsamości (konto / social / profil autora) mają nakładające
// się pola (bio, stanowisko, avatar, socials) - audyt IA: użytkownik nie wie,
// który jest autorytatywny. Do czasu konsolidacji modelu danych każda strona
// deklaruje swój ZAKRES i linkuje pozostałe, żeby nawigacja była świadoma.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

type EditorKey = "account" | "social" | "author";

const LINKS: Record<EditorKey, string> = {
  account: "/profile/account",
  social: "/profile/social",
  author: "/profile/author",
};

export function IdentityEditorsHint({ current }: { current: EditorKey }) {
  const { t } = useTranslation();
  const others = (Object.keys(LINKS) as EditorKey[]).filter((k) => k !== current);
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>
        {t(`profile.identityHint.${current}`)}{" "}
        {others.map((k, i) => (
          <span key={k}>
            {i > 0 && " · "}
            <Link to={LINKS[k]} className="text-brand-ink hover:underline">
              {t(`profile.nav.${k}`)}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
