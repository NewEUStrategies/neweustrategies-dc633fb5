// Moduł "Szukam / Oferuję" - tablica ogłoszeń członków.
//
// PO CO ISTNIEJE. Networking nie załamuje się z braku ludzi, tylko z braku
// PRETEKSTU do odezwania się. Członek klubu widzi listę nazwisk i nie ma
// powodu napisać do żadnego z nich; ten sam człowiek widzi "szukam danych
// o zapasach amunicji w regionie" i wie natychmiast, czy ma co odpowiedzieć.
// Ten moduł produkuje pretekst przemysłowo - i dlatego stoi jako PIERWSZY
// w prawej szynie, przed dorobkiem i przed składem.
//
// TRZY DECYZJE, KTÓRE GO ODRÓŻNIAJĄ OD WĄTKU:
//
// 1) JEDNA LINIA. Pole zwija białe znaki i nie przyjmuje akapitu - dokładnie
//    tak, jak zrobi to baza. Ogłoszenie, które można rozwinąć, w ciągu
//    miesiąca staje się krótkim wątkiem, a wtedy moduł dubluje strumień
//    zamiast go zasilać.
//
// 2) ROZMOWA IDZIE DO DM, NIE POD OGŁOSZENIE. Nie ma odpowiedzi w miejscu
//    publikacji: dwie osoby, które się dogadały, nie mają po co robić tego
//    przy dwudziestu świadkach, a wątek pod ogłoszeniem zamieniłby tablicę
//    w kolejny strumień. Przycisk to `DirectMessageButton` - ten sam, co na
//    profilach ekspertów, z tą samą miękką bramką warstwy członkostwa.
//
// 3) DATA WAŻNOŚCI. Tablica bez wygaszania to tablica z zeszłego roku.
//    Ogłoszenie znika samo, a na trzy dni przed końcem mówi o tym wprost.
import { useState } from "react";
import { uiLang } from "@/lib/i18n/format";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Megaphone, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { MoreLink } from "@/components/clubs/molecules/ClubHubContext";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubNoticeKindPill } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import {
  useCloseClubBoardNotice,
  useCreateClubBoardNotice,
  useClubBoardNotices,
} from "@/lib/clubs/useClubNetwork";
import {
  CLUB_NOTICE_KINDS,
  CLUB_NOTICE_MAX_LENGTH,
  isNoticeBodyValid,
  isNoticeExpiringSoon,
  noticeDaysLeft,
  normalizeNoticeBody,
  toClubNoticeKind,
  type ClubNoticeKind,
} from "@/lib/clubs/networkTypes";

/**
 * Kompozytor - jedna linia, wybór kierunku, opcjonalny obszar.
 *
 * Ten sam formularz obsługuje szynę i pełną tablicę, bo to jest DOKŁADNIE ta
 * sama czynność - różni się wyłącznie oprawą: w szynie stoi w szarym boksie
 * pod przyciskiem "Dodaj", na stronie jest kartą z tytułem, bo tam jest jedną
 * z dwóch rzeczy, po które przyszedł czytelnik.
 *
 * `onDone` jest opcjonalne: na stronie kompozytor nie ma się gdzie zamknąć.
 */
export function ClubBoardComposer({
  clubId,
  onDone,
  variant = "rail",
}: {
  clubId: string;
  onDone?: () => void;
  variant?: "rail" | "page";
}) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<ClubNoticeKind>("seeking");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const create = useCreateClubBoardNotice(clubId);

  // Licznik liczy tekst PO normalizacji - ten sam, który zobaczy baza.
  // Licznik mówiący "279 / 280" nad tekstem, który zaraz zostanie odrzucony,
  // jest gorszy niż brak licznika.
  const normalized = normalizeNoticeBody(body);
  const valid = isNoticeBodyValid(body);

  const submit = (): void => {
    if (!valid || create.isPending) return;
    create.mutate(
      { kind, body: normalized, topic },
      {
        onSuccess: () => {
          setBody("");
          setTopic(null);
          onDone?.();
          toast.success(t("club.network.board.published"));
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "";
          toast.error(
            message.includes("too many open notices")
              ? t("club.network.board.tooMany")
              : t("club.network.board.failed"),
          );
        },
      },
    );
  };

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-lg border border-border/60",
        variant === "page" ? "bg-card p-3 sm:p-4" : "bg-muted/30 p-2.5",
      )}
    >
      {variant === "page" ? (
        <div>
          <h2 className="text-sm font-semibold">{t("club.network.board.composeTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("club.network.board.composeLead")}
          </p>
        </div>
      ) : null}
      {/* Kierunek najpierw: przesądza o tym, jak czyta się resztę pola. */}
      <div role="radiogroup" aria-label={t("club.network.board.kindLabel")} className="flex gap-1">
        {CLUB_NOTICE_KINDS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "inline-flex h-7 flex-1 items-center justify-center rounded-lg border px-2 text-xs font-medium transition-colors",
              kind === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {t(`club.network.board.kind.${value}`)}
          </button>
        ))}
      </div>

      <div>
        <Input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          maxLength={CLUB_NOTICE_MAX_LENGTH * 2}
          placeholder={t(`club.network.board.placeholder.${kind}`)}
          aria-label={t(`club.network.board.placeholder.${kind}`)}
          className="h-9 rounded-lg text-sm"
        />
        <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
          {normalized.length} / {CLUB_NOTICE_MAX_LENGTH}
        </p>
      </div>

      <ClubTopicSelect value={topic} onChange={setTopic} disabled={create.isPending} />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 flex-1 rounded-lg"
          disabled={!valid || create.isPending}
          onClick={submit}
        >
          {create.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          {t("club.network.board.publish")}
        </Button>
        {/* Na stronie nie ma czego anulować - kompozytor jest częścią ekranu,
            a nie warstwą nad nim. */}
        {onDone !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg"
            onClick={onDone}
            disabled={create.isPending}
          >
            {t("club.network.board.cancel")}
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("club.network.board.hint")}
      </p>
    </div>
  );
}

export function ClubBoardPanel({
  clubSlug,
  clubId,
  canPost,
  className,
}: {
  clubSlug: string;
  clubId: string;
  /** Ten sam próg, co przy odpowiedzi - ogłoszenie to głos, nie akt kuratorski. */
  canPost: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics } = useClubTopics();
  const [composing, setComposing] = useState(false);
  const [kindFilter, setKindFilter] = useState<ClubNoticeKind | null>(null);
  const query = useClubBoardNotices({ clubId, kind: kindFilter });
  const close = useCloseClubBoardNotice(clubId);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  // Panel NIE znika przy zerze, gdy czytelnik może napisać: pusta tablica
  // z zaproszeniem jest zachętą, a ukryty moduł nie jest niczym. Znika
  // dopiero dla kogoś, kto i tak nie może nic dodać.
  if (!canPost && rows.length === 0 && !query.isPending) return null;

  return (
    <ClubRailPanel
      title={t("club.network.board.title")}
      icon={Megaphone}
      className={className}
      action={
        <span className="flex items-center gap-0.5">
          {canPost ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 rounded-lg px-1.5 text-[11px]"
              onClick={() => setComposing((open) => !open)}
              aria-expanded={composing}
            >
              {composing ? (
                <X className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Plus className="h-3 w-3" aria-hidden="true" />
              )}
              {composing ? t("club.network.board.cancel") : t("club.network.board.add")}
            </Button>
          ) : null}
          <MoreLink to="/club/$clubSlug/board" clubSlug={clubSlug} label={t("club.hub.more")} />
        </span>
      }
    >
      {composing ? (
        <div className="mb-2.5">
          <ClubBoardComposer clubId={clubId} onDone={() => setComposing(false)} />
        </div>
      ) : null}

      {/* Filtr kierunku pokazuje się dopiero, gdy realnie jest co odsiać. */}
      {total > 3 ? (
        <div className="mb-2 flex gap-1">
          {([null, ...CLUB_NOTICE_KINDS] as const).map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={kindFilter === value}
              onClick={() => setKindFilter(value)}
              className={cn(
                "inline-flex h-6 items-center rounded-lg border px-2 text-[11px] font-medium transition-colors",
                kindFilter === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {value === null
                ? t("club.network.board.filterAll")
                : t(`club.network.board.kind.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {kindFilter !== null
            ? t("club.network.board.emptyFiltered")
            : t("club.network.board.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const daysLeft = noticeDaysLeft(row.expires_at);
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border/60 bg-background/60 p-2 transition-colors hover:border-primary/30"
              >
                <div className="flex items-start gap-2">
                  <ClubAuthorAvatar
                    name={row.author_name}
                    avatarUrl={row.author_avatar}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ClubNoticeKindPill kind={toClubNoticeKind(row.kind)} />
                      <span className="truncate text-[11px] font-medium text-muted-foreground">
                        {row.author_name}
                      </span>
                    </div>
                    {/* Treść jest JEDNĄ linią i tak zostaje - `line-clamp-2`
                        na wypadek wąskiej kolumny, nie na wypadek akapitu. */}
                    <p className="mt-1 line-clamp-2 text-sm leading-snug">{row.body}</p>
                    {row.author_headline !== null ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {row.author_headline}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <ClubTopicChip topic={row.topic} lang={lang} catalog={topics} size="sm" />
                      {isNoticeExpiringSoon(row.expires_at) ? (
                        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          {t("club.network.board.expiresIn", { count: daysLeft })}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {row.is_mine ? (
                      // Autor nie pisze do siebie - dostaje "załatwione".
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-lg px-1.5 text-[11px]"
                        disabled={close.isPending}
                        onClick={() =>
                          close.mutate(row.id, {
                            onSuccess: () => toast.success(t("club.network.board.closed")),
                            onError: () => toast.error(t("club.network.board.closeFailed")),
                          })
                        }
                      >
                        {t("club.network.board.resolve")}
                      </Button>
                    ) : (
                      <DirectMessageButton
                        userId={row.author_id}
                        displayName={row.author_name}
                        displayAvatar={row.author_avatar}
                        compact
                      />
                    )}
                    {/* Moderacja zdejmuje cudze ogłoszenie - inny fakt niż
                        "załatwione", więc inna etykieta i inny stan w bazie. */}
                    {!row.is_mine && row.can_close ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 rounded-lg px-1.5 text-[10px] text-muted-foreground"
                        disabled={close.isPending}
                        onClick={() =>
                          close.mutate(row.id, {
                            onSuccess: () => toast.success(t("club.network.board.removed")),
                            onError: () => toast.error(t("club.network.board.closeFailed")),
                          })
                        }
                      >
                        {t("club.network.board.remove")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ClubRailPanel>
  );
}
