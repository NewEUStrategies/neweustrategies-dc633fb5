// /club/join/$token - wykorzystanie linku zapraszającego.
//
// Cała logika (ważność, limit, blokady, wpis członkostwa) jest w JEDNEJ
// transakcji po stronie bazy. Ta trasa tylko woła RPC i tłumaczy wynik -
// gdyby sprawdzała cokolwiek sama, powstałaby druga definicja tych reguł.
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRedeemClubInviteLink } from "@/lib/clubs/useClubs";
import { toClubInviteError } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/join/$token")({
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
  component: ClubJoinByLink,
});

function ClubJoinByLink() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const redeemM = useRedeemClubInviteLink();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  // Link wolno zrealizować dokładnie raz na wejście: bez tej blokady
  // ponowny render w trybie ścisłym Reacta wysłałby drugie żądanie.
  const attempted = useRef(false);

  useEffect(() => {
    if (loading || !session || attempted.current) return;
    attempted.current = true;
    redeemM.mutate(token, {
      onSuccess: ({ clubSlug, status }) => {
        if (status === "pending") {
          setPendingApproval(true);
          return;
        }
        void navigate({ to: "/club/$clubSlug", params: { clubSlug } });
      },
      onError: (error) => {
        const code = toClubInviteError(error);
        setErrorKey(code ? `adminClubs.invitations.error.${code}` : "adminClubs.saveFailed");
      },
    });
  }, [loading, session, token, redeemM, navigate]);

  if (loading || (session && !errorKey && !pendingApproval)) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("club.joiningByLink")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <h1 className="text-lg font-semibold">{t("club.membersOnlyTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("club.linkNeedsSignIn")}</p>
            <Button asChild>
              <a href="/login">{t("club.signIn")}</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg px-4 py-16">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          {pendingApproval ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-muted-foreground">{t("club.joinRequested")}</p>
            </>
          ) : (
            <>
              <XCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {errorKey ? t(errorKey) : t("adminClubs.saveFailed")}
              </p>
            </>
          )}
          {/* `Link`, nie surowe `<a href>`: tylko router przepuszcza adres
              przez `rewrite.output`, który dokleja prefiks języka. Surowy
              odnośnik wyrzucał czytelnika z /en/ na polską wersję i przeładowywał
              całą aplikację. */}
          <Button asChild variant="outline" size="sm">
            <Link to="/club">{t("club.title")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
