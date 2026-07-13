// Formularz zgłoszenia kontrybutora. URL: /contribute
// RLS insert: user_id = auth.uid() AND status = 'submitted'.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-community";

export const Route = createFileRoute("/contribute")({
  component: ContributePage,
  head: () => {
    const url = getRequestUrl() || "/contribute";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Become a contributor - New European Strategies"
          : "Zostań kontrybutorem - New European Strategies",
      description:
        lang === "en"
          ? "Pitch a story on European affairs - we reply within 5 working days."
          : "Wyślij propozycję tekstu o polityce europejskiej - odpowiadamy w 5 dni roboczych.",
    });
  },
});

function ContributePage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  const [language, setLanguage] = useState<"pl" | "en">(lang);
  const [sent, setSent] = useState(false);

  const submitM = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("no user");
      const { error } = await supabase.from("contributor_submissions").insert({
        user_id: user.id,
        title: title.trim(),
        pitch: pitch.trim(),
        language,
        status: "submitted",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSent(true);
      setTitle("");
      setPitch("");
      toast.success(t("community.contribute.success"));
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("community.contribute.error")),
  });

  if (!modules.contributor_program_enabled) return <CommunityDisabled />;

  const canSubmit = !!user && title.trim().length >= 5 && pitch.trim().length >= 40;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.contribute.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.contribute.subtitle")}</p>
      </header>

      <aside className="mb-8 rounded-lg border border-border bg-muted/40 p-5 text-sm">
        <h2 className="font-semibold">{t("community.contribute.guidelines")}</h2>
        <p className="mt-2 text-muted-foreground">{t("community.contribute.guidelinesBody")}</p>
      </aside>

      {!user && (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("community.contribute.signInHint")}
        </p>
      )}

      {user && !sent && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submitM.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="contrib-title">{t("community.contribute.titleLabel")}</Label>
            <Input
              id="contrib-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("community.contribute.titlePlaceholder")}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contrib-pitch">{t("community.contribute.pitchLabel")}</Label>
            <Textarea
              id="contrib-pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              placeholder={t("community.contribute.pitchPlaceholder")}
              rows={8}
              maxLength={4000}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>{t("community.contribute.languageLabel")}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "pl" | "en")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pl">Polski</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!canSubmit || submitM.isPending}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            {submitM.isPending
              ? t("community.contribute.submitting")
              : t("community.contribute.submit")}
          </Button>
        </form>
      )}

      {sent && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-6">
          <p className="font-medium">{t("community.contribute.success")}</p>
        </div>
      )}
    </div>
  );
}
