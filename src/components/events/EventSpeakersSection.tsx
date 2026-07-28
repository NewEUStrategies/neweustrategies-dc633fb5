// Sekcja "Prelegenci" na stronie wydarzenia (/events/$slug). Prelegenci
// pochodza z relacji event_speakers (kolejnosc sort_order) wzbogaconej o
// profil prelegenta i eksperta (RPC get_public_speakers). Klik otwiera
// SpeakerProfileDialog. Sekcja znika, gdy wydarzenie nie ma prelegentow.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@/lib/lucide-shim";
import { speakersQueryOptions } from "@/lib/builder/speakersQuery";
import { SpeakerChip } from "./SpeakerChip";
import { SpeakerProfileDialog, type SpeakerDialogFallback } from "./SpeakerProfileDialog";

export function EventSpeakersSection({ eventId, lang }: { eventId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const speakersQ = useQuery({
    ...speakersQueryOptions({ source: "event", eventId, limit: 50 }, lang),
    enabled: !!eventId,
  });
  const [dialogSpeaker, setDialogSpeaker] = useState<{
    userId: string;
    fallback: SpeakerDialogFallback;
  } | null>(null);

  const speakers = speakersQ.data ?? [];
  if (speakers.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{t("community.events.speakersTitle")}</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {speakers.map((speaker) => {
          const role =
            (lang === "pl" ? speaker.headline_pl : speaker.headline_en) ||
            speaker.headline_pl ||
            speaker.headline_en ||
            speaker.job_title ||
            "";
          return (
            <li key={speaker.user_id}>
              <SpeakerChip
                name={speaker.display_name ?? ""}
                role={role}
                photoUrl={speaker.avatar_url}
                size="lg"
                onClick={() =>
                  setDialogSpeaker({
                    userId: speaker.user_id,
                    fallback: {
                      name: speaker.display_name ?? "",
                      role,
                      photo: speaker.avatar_url ?? undefined,
                    },
                  })
                }
                trailing={
                  speaker.is_expert ? (
                    <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-brand-ink" />
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>

      {dialogSpeaker && (
        <SpeakerProfileDialog
          userId={dialogSpeaker.userId}
          lang={lang}
          open
          onOpenChange={(open) => {
            if (!open) setDialogSpeaker(null);
          }}
          fallback={dialogSpeaker.fallback}
        />
      )}
    </section>
  );
}
