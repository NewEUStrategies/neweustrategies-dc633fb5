// Strona zgody OAuth 2.1 dla zewnętrznych klientów (asystenci AI łączący się
// z /mcp). Serwer autoryzacji Lovable Cloud kieruje tu użytkownika z
// `?authorization_id`; aplikacja pokazuje, kto prosi o dostęp, i przekazuje
// decyzję z powrotem serwerowi autoryzacji.
//
// `ssr: false`: sesja żyje w przeglądarce - SSR nie widziałby zalogowanego
// użytkownika i odsyłałby go do logowania. Niezalogowany trafia na `/login`
// z `next` = ten adres; portal logowania zachowuje go przy logowaniu hasłem,
// rejestracji i logowaniu Google (`/auth/callback?next=`).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  OAuthConsentError,
  OAuthConsentPanel,
  ConsentShell,
} from "@/components/oauth/OAuthConsentPanel";
import { supabase } from "@/integrations/supabase/client";
import { loginSearch } from "@/lib/access/paywallLinks";
import "@/lib/i18n-oauth-consent";
import { Loader2 } from "@/lib/lucide-shim";
import {
  consentReturnPath,
  needsConsent,
  parseConsentSearch,
  safeClientRedirect,
} from "@/lib/oauth/consent";

type ConsentLoaderData =
  | { state: "missing" }
  | { state: "expired" }
  | { state: "redirecting" }
  | {
      state: "ready";
      authorizationId: string;
      userEmail: string | null;
      client: { name: string; logoUri: string | null; redirectUri: string; scope: string };
    };

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: parseConsentSearch,
  head: () => ({
    meta: [
      { title: "Połącz aplikację / Connect an app - New European Strategies" },
      {
        name: "description",
        content:
          "Zgoda na połączenie zewnętrznej aplikacji z kontem New European Strategies / Consent to connect an external app to your account.",
      },
      { property: "og:title", content: "Connect an app - New European Strategies" },
      {
        property: "og:description",
        content: "Consent to connect an external app to your New European Strategies account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  beforeLoad: async ({ search }) => {
    if (!search.authorization_id) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: loginSearch({ mode: "signin", next: consentReturnPath(search.authorization_id) }),
      });
    }
  },
  loaderDeps: ({ search }) => ({ authorizationId: search.authorization_id }),
  loader: async ({ deps }): Promise<ConsentLoaderData> => {
    if (!deps.authorizationId) return { state: "missing" };
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(deps.authorizationId);
    if (error || !data) return { state: "expired" };
    if (!needsConsent(data)) {
      // Zgoda udzielona wcześniej - serwer od razu zwraca adres powrotu.
      const target = safeClientRedirect(data.redirect_url);
      if (!target) return { state: "expired" };
      window.location.assign(target);
      return { state: "redirecting" };
    }
    const { data: userData } = await supabase.auth.getUser();
    return {
      state: "ready",
      authorizationId: data.authorization_id,
      userEmail: userData.user?.email ?? data.user.email ?? null,
      client: {
        name: data.client.name,
        logoUri: safeClientRedirect(data.client.logo_uri),
        redirectUri: data.redirect_uri,
        scope: data.scope,
      },
    };
  },
  component: ConsentPage,
  pendingComponent: ConsentPending,
  errorComponent: ConsentRouteError,
});

function ConsentPending() {
  return (
    <ConsentShell>
      <div className="flex justify-center py-6" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    </ConsentShell>
  );
}

function ConsentRouteError() {
  const { t } = useTranslation();
  return <OAuthConsentError message={t("oauthConsent.errors.expired")} />;
}

function ConsentPage() {
  const data = Route.useLoaderData();
  const { t } = useTranslation();
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data.state === "missing") return <OAuthConsentError message={t("oauthConsent.errors.missing")} />;
  if (data.state === "expired") return <OAuthConsentError message={t("oauthConsent.errors.expired")} />;
  if (data.state === "redirecting") return <ConsentPending />;

  const { authorizationId } = data;

  async function decide(decision: "approve" | "deny") {
    setPending(decision);
    setError(null);
    const options = { skipBrowserRedirect: true };
    const { data: result, error: decisionError } =
      decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
        : await supabase.auth.oauth.denyAuthorization(authorizationId, options);
    if (decisionError || !result) {
      setPending(null);
      setError(t("oauthConsent.errors.failed"));
      return;
    }
    const target = safeClientRedirect(result.redirect_url);
    if (!target) {
      setPending(null);
      setError(t("oauthConsent.errors.noRedirect"));
      return;
    }
    window.location.assign(target);
  }

  return (
    <OAuthConsentPanel
      client={data.client}
      userEmail={data.userEmail}
      pending={pending}
      error={error}
      onDecide={(decision) => void decide(decision)}
    />
  );
}
