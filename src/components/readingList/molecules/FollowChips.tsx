// Chipy obserwacji: klikalne (archiwum / profil autora) + „przestań obserwować"
// jednym kliknięciem.
//
// MOLEKUŁA: sama MUTACJA nie mieszka tutaj - komponent dostaje `onUnfollow`
// i `pending` od organizmu. Dzięki temu wygląd i etykiety da się sprawdzić bez
// klienta zapytań, a organizm odpowiada za to, co jest odpowiedzialnością
// danych: unieważnienie cache'u i stan „w locie".
//
// Pusta lista chipów NIE renderuje sekcji (zamiast pustego nagłówka
// „Obserwujesz" nad niczym).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { FollowChip } from "@/components/readingList/atoms/followChips";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function FollowChips({
  chips,
  pending,
  onUnfollow,
}: {
  chips: readonly FollowChip[];
  pending: boolean;
  onUnfollow: (chip: FollowChip) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
        {t("readingList.yourFollows")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const label = chip.label ?? t(chip.fallbackKey ?? "readingList.anonymousAuthor");
          return (
            <span
              key={`${chip.type}:${chip.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1.5 text-sm"
            >
              {chip.avatarUrl && (
                <img src={chip.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
              )}
              {chip.href ? (
                <Link to={chip.href.to} params={chip.href.params} className="hover:underline">
                  {label}
                </Link>
              ) : (
                <span>{label}</span>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => onUnfollow(chip)}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-destructive disabled:opacity-50"
                aria-label={t("readingList.unfollow", { name: label })}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
    </section>
  );
}
