// Formularz ogólny organizacji: dane profilowe, warstwa, limit, kontakt.
// Wspólny dla /new i /$id (tab Ogólne).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

type Lang = "pl" | "en";

export interface OrgGeneralValue {
  name: string;
  slug: string;
  tier_key: string;
  seats_limit: number;
  contact_email: string;
  note: string;
  description: string;
  website_url: string;
  sector: string;
  city: string;
  country: string;
}

export function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function emptyOrgGeneral(): OrgGeneralValue {
  return {
    name: "",
    slug: "",
    tier_key: "corporate",
    seats_limit: 5,
    contact_email: "",
    note: "",
    description: "",
    website_url: "",
    sector: "",
    city: "",
    country: "",
  };
}

export function OrgGeneralForm({
  value,
  onChange,
  tierOptions,
  lang,
  autoSlug = true,
}: {
  value: OrgGeneralValue;
  onChange: (next: OrgGeneralValue) => void;
  tierOptions: MembershipTierRow[];
  lang: Lang;
  autoSlug?: boolean;
}) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [slugTouched, setSlugTouched] = useState(!autoSlug);

  const patch = (p: Partial<OrgGeneralValue>) => onChange({ ...value, ...p });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Podstawy", "Basics")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{L("Nazwa", "Name")}</Label>
            <Input
              value={value.name}
              onChange={(e) => {
                const name = e.target.value;
                patch({
                  name,
                  slug: !slugTouched ? makeSlug(name) : value.slug,
                });
              }}
              className="h-9 text-sm"
              placeholder={L("np. Acme Sp. z o.o.", "e.g. Acme Ltd.")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Slug (URL)", "Slug (URL)")}</Label>
            <Input
              value={value.slug}
              onChange={(e) => {
                setSlugTouched(true);
                patch({ slug: makeSlug(e.target.value) });
              }}
              className="h-9 font-mono text-sm"
              placeholder="acme"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Warstwa", "Tier")}</Label>
            <Select value={value.tier_key} onValueChange={(v) => patch({ tier_key: v })}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tierOptions.map((tier) => (
                  <SelectItem key={tier.key} value={tier.key}>
                    {tier.key} ({tierName(tier, lang)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Limit miejsc", "Seat limit")}</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={value.seats_limit}
              onChange={(e) => patch({ seats_limit: Number(e.target.value) || 1 })}
              className="h-9 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Profil", "Profile")}
        </h3>
        <div className="space-y-1">
          <Label className="text-xs">{L("Opis", "Description")}</Label>
          <Textarea
            value={value.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
            className="text-sm"
            placeholder={L("Krótki opis organizacji", "Short organization description")}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{L("Strona www", "Website")}</Label>
            <Input
              value={value.website_url}
              onChange={(e) => patch({ website_url: e.target.value })}
              className="h-9 text-sm"
              placeholder="https://"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Sektor", "Sector")}</Label>
            <Input
              value={value.sector}
              onChange={(e) => patch({ sector: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Miasto", "City")}</Label>
            <Input
              value={value.city}
              onChange={(e) => patch({ city: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{L("Kraj", "Country")}</Label>
            <Input
              value={value.country}
              onChange={(e) => patch({ country: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Kontakt i notatka", "Contact & note")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{L("E-mail kontaktowy", "Contact email")}</Label>
            <Input
              type="email"
              value={value.contact_email}
              onChange={(e) => patch({ contact_email: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{L("Notatka wewnętrzna", "Internal note")}</Label>
          <Textarea
            value={value.note}
            onChange={(e) => patch({ note: e.target.value })}
            rows={2}
            className="text-sm"
          />
        </div>
      </section>
    </div>
  );
}
