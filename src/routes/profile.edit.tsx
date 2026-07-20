// /profile/edit - JEDNO miejsce edycji tożsamości (P1 z OCENA_MODULOW
// 2026-07-20 §5.5: "Konsolidacja edycji tożsamości"). Trzy dawne trasy
// (/profile/account, /profile/author, /profile/social) edytowały tożsamość
// w trzech miejscach - teraz są przekierowaniami na zakładki tej strony:
//   basic  -> dane podstawowe (dawne /profile/account),
//   expert -> profil eksperta (dawne /profile/author, tylko role autorskie),
//   social -> slug, bio PL/EN i linki (dawne /profile/social).
// Zakładka żyje w parametrze URL (?tab=), więc głębokie linki i przekierowania
// wskazują konkretny widok.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AccountIdentityPanel } from "@/components/profile/identity/AccountIdentityPanel";
import { SocialIdentityPanel } from "@/components/profile/identity/SocialIdentityPanel";
import { AuthorProfileEditor } from "@/components/profile/AuthorProfileEditor";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";

export type IdentityTab = "basic" | "expert" | "social";

interface EditSearch {
  tab?: IdentityTab;
}

export const Route = createFileRoute("/profile/edit")({
  component: ProfileEditPage,
  validateSearch: (search: Record<string, unknown>): EditSearch => {
    const raw = typeof search.tab === "string" ? search.tab : undefined;
    return {
      tab: raw === "expert" || raw === "social" ? (raw as IdentityTab) : undefined,
    };
  },
});

function isAuthorRole(roles: string[]): boolean {
  return roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
}

function ProfileEditPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureExpertsI18n();
  const { t } = useTranslation();
  const { user, roles, tenantId, loading } = useAuth();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab: IdentityTab = tab ?? "basic";
  const showExpert = isAuthorRole(roles);

  if (loading || !user) return null;

  const setTab = (next: string) => {
    void navigate({
      search: { tab: next === "basic" ? undefined : (next as IdentityTab) },
      replace: true,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-display font-semibold">
          {t("profile.edit.title", { defaultValue: "Edycja profilu" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("profile.edit.intro", {
            defaultValue: "Wszystkie dane Twojej tożsamości w jednym miejscu.",
          })}
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="basic">
            {t("profile.edit.tabs.basic", { defaultValue: "Dane podstawowe" })}
          </TabsTrigger>
          <TabsTrigger value="expert">
            {t("profile.edit.tabs.expert", { defaultValue: "Profil eksperta" })}
          </TabsTrigger>
          <TabsTrigger value="social">
            {t("profile.edit.tabs.social", { defaultValue: "Social i bio" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="basic" className="mt-4">
          <AccountIdentityPanel />
        </TabsContent>
        <TabsContent value="expert" className="mt-4">
          {showExpert ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("profile.author.title", { defaultValue: "Profil eksperta" })}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("profile.author.intro", {
                    defaultValue:
                      "Publiczny profil eksperta - widoczny na /author/<slug> oraz w widget BIO we wpisach. Niezależny od profilu prywatnego (dane kontaktowe mogą się różnić).",
                  })}
                </p>
              </CardHeader>
              <CardContent>
                <AuthorProfileEditor userId={user.id} tenantId={tenantId} mode="self" />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BrandIcon
                    name="shield-alert"
                    fallback={ShieldAlert}
                    className="h-5 w-5 text-muted-foreground"
                    alt=""
                  />
                  {t("profile.author.title", { defaultValue: "Profil eksperta" })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t("profile.author.noRole", {
                    defaultValue:
                      "Profil eksperta jest dostępny tylko dla użytkowników z rolą autora lub administratora.",
                  })}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="social" className="mt-4">
          <SocialIdentityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
