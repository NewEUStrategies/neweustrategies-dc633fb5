// Panel: pełnoekranowa strona tworzenia nowej organizacji członkowskiej.
// Kompaktowy, premium layout w duchu strony publicznej - bez modala.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Building2, Save, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMembershipTiers, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import { createOrganization } from "@/lib/admin/membership-admin";

export const Route = createFileRoute("/admin/organizations/new")({
  component: AdminOrganizationNewPage,
});

type Lang = "pl" | "en";
const tr = (lang: Lang) => (pl: string, en: string) => (lang === "pl" ? pl : en);

function AdminOrganizationNewPage() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = tr(lang);
  const navigate = useNavigate();

  const tiersQ = useMembershipTiers();
  const tiers: MembershipTierRow[] = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const tierOptions = useMemo<MembershipTierRow[]>(() => {
    const high = tiers.filter((t) => t.rank >= 30);
    return high.length > 0 ? high : tiers;
  }, [tiers]);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tierKey, setTierKey] = useState("corporate");
  const [seatsLimit, setSeatsLimit] = useState(5);
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [note, setNote] = useState("");

  const canSubmit =
    name.trim().length > 0 && tierKey.length > 0 && seatsLimit >= 1 && seatsLimit <= 500;

  const create = useMutation({
    mutationFn: () =>
      createOrganization({
        name: name.trim(),
        tier_key: tierKey,
        seats_limit: seatsLimit,
        contact_email: contactEmail.trim() || null,
        note: note.trim() || null,
        slug: slug.trim() || null,
        description: description.trim() || null,
        website_url: websiteUrl.trim() || null,
        sector: sector.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
      }),
    onSuccess: (org) => {
      toast.success(L("Utworzono organizację", "Organization created"));
      void navigate({ to: "/admin/organizations/$id", params: { id: org.id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8">
            <Link to="/admin/organizations">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {L("Wróć", "Back")}
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
              {L("Nowa organizacja", "New organization")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {L(
                "Utwórz członkostwo korporacyjne / partnerstwo. Markę i logo skonfigurujesz po utworzeniu.",
                "Create a corporate / partner membership. Branding and logos are configured after creation.",
              )}
            </p>
          </div>
        </div>
        <Button size="sm" className="h-8" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {create.isPending ? L("Zapisywanie...", "Saving...") : L("Utwórz", "Create")}
        </Button>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card title={L("Podstawowe dane", "Basic details")}>
            <div className="grid gap-3">
              <Field label={L("Nazwa organizacji", "Organization name")}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={L("np. Acme Sp. z o.o.", "e.g. Acme Ltd.")}
                  className="h-8 text-sm"
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={L("Slug (URL)", "Slug (URL)")} hint={L("mała litera, myślniki", "lowercase, hyphens")}>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    placeholder="acme"
                    className="h-8 text-sm"
                  />
                </Field>
                <Field label={L("Sektor / branża", "Sector / industry")}>
                  <Input
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    placeholder={L("np. Finanse, Energetyka", "e.g. Finance, Energy")}
                    className="h-8 text-sm"
                  />
                </Field>
              </div>
              <Field label={L("Krótki opis", "Short description")}>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={L("Kilka zdań o organizacji...", "A few sentences about the organization...")}
                  className="min-h-20 text-sm"
                />
              </Field>
            </div>
          </Card>

          <Card title={L("Kontakt i adres", "Contact & location")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={L("E-mail kontaktowy", "Contact email")}>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="office@acme.com"
                  className="h-8 text-sm"
                />
              </Field>
              <Field label={L("Strona www", "Website")}>
                <Input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://acme.com"
                  className="h-8 text-sm"
                />
              </Field>
              <Field label={L("Miasto", "City")}>
                <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-8 text-sm" />
              </Field>
              <Field label={L("Kraj", "Country")}>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} className="h-8 text-sm" />
              </Field>
            </div>
          </Card>

          <Card title={L("Notatka wewnętrzna", "Internal note")}>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={L("Widoczna tylko dla administracji.", "Visible only to admins.")}
              className="min-h-16 text-sm"
            />
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title={L("Członkostwo", "Membership")}>
            <div className="space-y-3">
              <Field label={L("Warstwa", "Tier")}>
                <Select value={tierKey} onValueChange={setTierKey}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={L("Wybierz warstwę", "Select tier")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tierOptions.map((tier) => (
                      <SelectItem key={tier.key} value={tier.key}>
                        {tier.key} ({tierName(tier, lang)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={L("Limit miejsc", "Seat limit")}>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={seatsLimit}
                  onChange={(e) => setSeatsLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                  className="h-8 text-sm"
                />
              </Field>
              <div className="rounded-md border border-dashed border-border/70 bg-muted/30 p-3 text-[11px] text-muted-foreground">
                <Building2 className="mb-1 h-3.5 w-3.5" aria-hidden="true" />
                {L(
                  "Po utworzeniu przejdziesz do pełnej strony organizacji, gdzie skonfigurujesz kolory marki, logo (pionowe/poziome, jasne/ciemne) oraz zaprosisz konta na miejsca.",
                  "After creating, you'll be taken to the full organization page to configure brand colors, logos (vertical/horizontal, light/dark) and invite seat accounts.",
                )}
              </div>
            </div>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}
