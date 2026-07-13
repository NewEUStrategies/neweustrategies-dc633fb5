// Dedykowana strona tworzenia organizacji - zastępuje popup.
// Layout kompaktowy, spójny z resztą admina (max-w-4xl, karty, small type).
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Landmark, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMembershipTiers, type MembershipTierRow } from "@/lib/billing/tiers";
import { createOrganization } from "@/lib/admin/membership-admin";
import {
  OrgGeneralForm,
  emptyOrgGeneral,
  type OrgGeneralValue,
} from "@/components/admin/organizations/OrgGeneralForm";

export const Route = createFileRoute("/admin/organizations/new")({
  component: NewOrganizationPage,
});

type Lang = "pl" | "en";

function NewOrganizationPage() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const navigate = useNavigate();

  const tiersQ = useMembershipTiers();
  const tierOptions = useMemo<MembershipTierRow[]>(() => {
    const tiers = tiersQ.data ?? [];
    const high = tiers.filter((t) => t.rank >= 30);
    return high.length > 0 ? high : tiers;
  }, [tiersQ.data]);

  const [value, setValue] = useState<OrgGeneralValue>(emptyOrgGeneral());

  const create = useMutation({
    mutationFn: () =>
      createOrganization({
        name: value.name.trim(),
        tier_key: value.tier_key,
        seats_limit: value.seats_limit,
        contact_email: value.contact_email.trim() || null,
        note: value.note.trim() || null,
        slug: value.slug.trim() || null,
        description: value.description.trim() || null,
        website_url: value.website_url.trim() || null,
        sector: value.sector.trim() || null,
        city: value.city.trim() || null,
        country: value.country.trim() || null,
      }),
    onSuccess: (org) => {
      toast.success(L("Utworzono organizację", "Organization created"));
      void navigate({ to: "/admin/organizations/$id", params: { id: org.id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit =
    value.name.trim().length > 0 &&
    value.tier_key.length > 0 &&
    value.seats_limit >= 1 &&
    value.seats_limit <= 500 &&
    !create.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <header className="space-y-2">
        <Link
          to="/admin/organizations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {L("Wróć do listy", "Back to list")}
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Landmark className="h-5 w-5" />
              {L("Nowa organizacja", "New organization")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {L(
                "Utwórz organizację. Po zapisie skonfigurujesz branding i miejsca.",
                "Create the organization. After saving you'll configure branding and seats.",
              )}
            </p>
          </div>
          <Button size="sm" disabled={!canSubmit} onClick={() => create.mutate()}>
            <Save className="mr-1.5 h-4 w-4" />
            {L("Utwórz i przejdź dalej", "Create and continue")}
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{L("Dane organizacji", "Organization details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgGeneralForm
            value={value}
            onChange={setValue}
            tierOptions={tierOptions}
            lang={lang}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/admin/organizations">{L("Anuluj", "Cancel")}</Link>
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => create.mutate()}>
          <Save className="mr-1.5 h-4 w-4" />
          {L("Utwórz organizację", "Create organization")}
        </Button>
      </div>
    </div>
  );
}
