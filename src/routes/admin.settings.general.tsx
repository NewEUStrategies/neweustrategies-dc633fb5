import { createFileRoute } from "@tanstack/react-router";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Select, SaveBar } from "@/components/admin/settings/fields";

type General = {
  site_name: string;
  tagline: string;
  site_url: string;
  admin_email: string;
  site_icon_url: string;
  site_logo_url: string;
  default_language: "pl" | "en";
  timezone: string;
  date_format: string;
  time_format: string;
  week_starts_on: number;
};

const DEFAULTS: General = {
  site_name: "",
  tagline: "",
  site_url: "",
  admin_email: "",
  site_icon_url: "",
  site_logo_url: "",
  default_language: "pl",
  timezone: "Europe/Warsaw",
  date_format: "d.m.Y",
  time_format: "H:i",
  week_starts_on: 1,
};

export const Route = createFileRoute("/admin/settings/general")({
  component: GeneralSettings,
});

function GeneralSettings() {
  const { query, save } = useSettings<General>("general", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const set = <K extends keyof General>(k: K, v: General[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Ustawienia ogólne</h2>

      <Field label="Nazwa witryny">
        <Text value={draft.site_name} onChange={(e) => set("site_name", e.target.value)} />
      </Field>
      <Field label="Slogan" hint="W kilku słowach wyjaśnij, o czym jest ta witryna.">
        <Text value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} />
      </Field>
      <Field label="Ikona witryny (favicon)" hint="URL obrazu, kwadrat min. 512×512 px.">
        <Text value={draft.site_icon_url} onChange={(e) => set("site_icon_url", e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Logo witryny">
        <Text value={draft.site_logo_url} onChange={(e) => set("site_logo_url", e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Adres witryny (URL)">
        <Text value={draft.site_url} onChange={(e) => set("site_url", e.target.value)} placeholder="https://example.com" />
      </Field>
      <Field label="Adres e-mail administratora">
        <Text type="email" value={draft.admin_email} onChange={(e) => set("admin_email", e.target.value)} />
      </Field>
      <Field label="Język witryny">
        <Select
          value={draft.default_language}
          onChange={(e) => set("default_language", e.target.value as "pl" | "en")}
        >
          <option value="pl">Polski</option>
          <option value="en">English</option>
        </Select>
      </Field>
      <Field label="Strefa czasowa">
        <Text value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Europe/Warsaw" />
      </Field>
      <Field label="Format daty" hint="Składnia jak w PHP date(): d.m.Y, Y-m-d, m/d/Y …">
        <Text value={draft.date_format} onChange={(e) => set("date_format", e.target.value)} className="w-40" />
      </Field>
      <Field label="Format godziny">
        <Text value={draft.time_format} onChange={(e) => set("time_format", e.target.value)} className="w-40" />
      </Field>
      <Field label="Pierwszy dzień tygodnia">
        <Select
          value={String(draft.week_starts_on)}
          onChange={(e) => set("week_starts_on", Number(e.target.value))}
        >
          <option value="1">poniedziałek</option>
          <option value="0">niedziela</option>
        </Select>
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
