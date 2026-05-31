import { createFileRoute } from "@tanstack/react-router";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";

type HeaderSettings = {
  tagline_pl: string;
  tagline_en: string;
  show_newsletter: boolean;
  show_socials: boolean;
  social_facebook: string;
  social_twitter: string;
  social_youtube: string;
  social_instagram: string;
  social_linkedin: string;
  contact_email: string;
};

const DEFAULTS: HeaderSettings = {
  tagline_pl: "",
  tagline_en: "",
  show_newsletter: true,
  show_socials: true,
  social_facebook: "",
  social_twitter: "",
  social_youtube: "",
  social_instagram: "",
  social_linkedin: "",
  contact_email: "",
};

export const Route = createFileRoute("/admin/appearance/header")({
  component: HeaderEditor,
});

function HeaderEditor() {
  const { query, save } = useSettings<HeaderSettings>("header", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const set = <K extends keyof HeaderSettings>(k: K, v: HeaderSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Nagłówek</h2>
      <Field label="Slogan (PL)"><Text value={draft.tagline_pl} onChange={(e) => set("tagline_pl", e.target.value)} /></Field>
      <Field label="Slogan (EN)"><Text value={draft.tagline_en} onChange={(e) => set("tagline_en", e.target.value)} /></Field>
      <Field label="Newsletter"><Checkbox label="Pokaż przycisk newsletter" checked={draft.show_newsletter} onChange={(v) => set("show_newsletter", v)} /></Field>
      <Field label="Ikony social"><Checkbox label="Pokaż ikony mediów społecznościowych" checked={draft.show_socials} onChange={(v) => set("show_socials", v)} /></Field>
      <Field label="E-mail kontaktowy"><Text value={draft.contact_email} onChange={(e) => set("contact_email", e.target.value)} placeholder="office@example.com" /></Field>
      <Field label="Facebook URL"><Text value={draft.social_facebook} onChange={(e) => set("social_facebook", e.target.value)} placeholder="https://facebook.com/..." /></Field>
      <Field label="X / Twitter URL"><Text value={draft.social_twitter} onChange={(e) => set("social_twitter", e.target.value)} /></Field>
      <Field label="YouTube URL"><Text value={draft.social_youtube} onChange={(e) => set("social_youtube", e.target.value)} /></Field>
      <Field label="Instagram URL"><Text value={draft.social_instagram} onChange={(e) => set("social_instagram", e.target.value)} /></Field>
      <Field label="LinkedIn URL"><Text value={draft.social_linkedin} onChange={(e) => set("social_linkedin", e.target.value)} /></Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
