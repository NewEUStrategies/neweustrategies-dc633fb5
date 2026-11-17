// Organizm strony zgody OAuth: kto prosi o dostęp, do czego, i decyzja.
// Stan (pobieranie szczegółów, zatwierdzenie, odmowa) należy do trasy;
// panel tylko go prezentuje, więc jest testowalny bez serwera autoryzacji.
import { useTranslation } from "react-i18next";

import { Logo } from "@/components/atoms/Logo";
import {
  LangSwitcherDropdown,
  ThemeToggleWidget,
} from "@/components/builder/organisms/widget-view/chromeWidgets";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-oauth-consent";
import { Check, Loader2, ShieldCheck, TriangleAlert } from "@/lib/lucide-shim";
import { describeScopes, redirectHost } from "@/lib/oauth/consent";

export interface ConsentClientView {
  name: string;
  logoUri: string | null;
  redirectUri: string;
  scope: string;
}

type Decision = "approve" | "deny";

interface ConsentShellProps {
  children: React.ReactNode;
}

/** Wspólna oprawa: tło, przełącznik motywu i języka jak w portalu logowania. */
export function ConsentShell({ children }: ConsentShellProps) {
  const { t } = useTranslation();
  return (
    <main className="relative min-h-screen w-full bg-muted/40 dark:bg-background flex items-center justify-center p-4 sm:p-8">
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        <ThemeToggleWidget />
        <LangSwitcherDropdown label={t("mobileDrawer.language")} />
      </div>
      <section className="w-full max-w-md rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-foreground/5 p-6 sm:p-8">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" withWordmark={false} />
        </div>
        {children}
      </section>
    </main>
  );
}

interface ConsentErrorProps {
  message: string;
}

export function OAuthConsentError({ message }: ConsentErrorProps) {
  const { t } = useTranslation();
  return (
    <ConsentShell>
      <div className="flex flex-col items-center gap-3 text-center" role="alert">
        <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t("oauthConsent.errors.title")}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <a href="/" className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t("oauthConsent.errors.backHome")}
        </a>
      </div>
    </ConsentShell>
  );
}

interface OAuthConsentPanelProps {
  client: ConsentClientView;
  userEmail: string | null;
  pending: Decision | null;
  error: string | null;
  onDecide: (decision: Decision) => void;
}

export function OAuthConsentPanel({
  client,
  userEmail,
  pending,
  error,
  onDecide,
}: OAuthConsentPanelProps) {
  const { t } = useTranslation();
  const clientName = client.name.trim() || t("oauthConsent.unknownClient");
  const scopes = describeScopes(client.scope);
  const host = redirectHost(client.redirectUri);
  const busy = pending !== null;

  return (
    <ConsentShell>
      <header className="flex flex-col items-center gap-3 text-center">
        {client.logoUri ? (
          <img
            src={client.logoUri}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-md border border-border object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" />
        )}
        <h1 className="text-xl font-semibold leading-tight">
          {t("oauthConsent.title", { client: clientName })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("oauthConsent.intro", { client: clientName })}
        </p>
      </header>

      <dl className="mt-6 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        {userEmail && (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t("oauthConsent.signedInAs")}</dt>
            <dd className="font-medium break-all">{userEmail}</dd>
          </div>
        )}
        {host && (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t("oauthConsent.returnsTo")}</dt>
            <dd className="font-medium break-all">{host}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6 space-y-4 text-sm">
        <div>
          <h2 className="mb-2 font-semibold">{t("oauthConsent.accessHeading")}</h2>
          <ul className="space-y-1.5">
            {(["read", "members"] as const).map((key) => (
              <li key={key} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t(`oauthConsent.capabilities.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        {(scopes.known.length > 0 || scopes.other.length > 0) && (
          <div>
            <h2 className="mb-2 font-semibold">{t("oauthConsent.scopesHeading")}</h2>
            <ul className="space-y-1.5">
              {scopes.known.map((scope) => (
                <li key={scope} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{t(`oauthConsent.scopes.${scope}`)}</span>
                </li>
              ))}
              {scopes.other.map((scope) => (
                <li key={scope} className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="break-all">{t("oauthConsent.scopes.other", { scope })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("oauthConsent.boundary")}</p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={busy} onClick={() => onDecide("deny")}>
          {pending === "deny" && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t("oauthConsent.deny")}
        </Button>
        <Button disabled={busy} onClick={() => onDecide("approve")} aria-busy={pending === "approve"}>
          {pending === "approve" && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t("oauthConsent.approve")}
        </Button>
      </div>
    </ConsentShell>
  );
}
