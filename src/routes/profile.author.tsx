// /profile/author - własny profil eksperta. Cały formularz mieszka
// w reużywalnym komponencie AuthorProfileEditor, żeby /admin/users/$id
// miał 1:1 ten sam zestaw pól i logikę zapisu (RLS rozstrzyga uprawnienia:
// właściciel edytuje swoje, admin/super_admin - dowolnego usera w tenancie).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { IdentityEditorsHint } from "@/components/profile/IdentityEditorsHint";
import { AuthorProfileEditor } from "@/components/profile/AuthorProfileEditor";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";
export const Route = createFileRoute("/profile/author")({
  component: AuthorProfilePage,
});

function isAuthorRole(roles: string[]): boolean {
  return roles.some((r) => r === "author" || r === "admin" || r === "super_admin");
}

function AuthorProfilePage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureExpertsI18n();
  const { t } = useTranslation();
  const { user, roles, tenantId, loading } = useAuth();

  if (loading) return null;
  if (!user) return null;

  if (!isAuthorRole(roles)) {
    return (
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
    );
  }

  return (
    <>
      <IdentityEditorsHint current="author" />
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.author.title", { defaultValue: "Profil eksperta" })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("profile.author.intro", {
              defaultValue:
                "Publiczny profil eksperta - widoczny na /author/<slug> oraz w widget BIO we wpisach. Niezależny od profilu prywatnego (dane kontaktowe mogą się różnić).",
            })}
          </p>
        </CardHeader>
        <CardContent>
          <AuthorProfileEditor userId={user.id} tenantId={tenantId} mode="self" />
          <div className="mt-4">
            <Link
              to="/profile/account"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("profile.author.editPrivate", {
                defaultValue: "Edytuj profil prywatny →",
              })}
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
