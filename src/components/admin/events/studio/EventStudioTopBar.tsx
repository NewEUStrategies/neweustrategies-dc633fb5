// Gorny pasek STUDIA WYDARZENIA.
//
// PASEK NALEZY DO AKCJI, NIE DO TOZSAMOSCI. Zostaja w nim dwie rzeczy: w jakim
// stanie jest wydarzenie (szkic / opublikowane / odwolane) i co moge z nim
// zrobic teraz (podglad, publikacja). Publikacja jest jedyna akcja nieodwracalna
// z punktu widzenia uczestnika, wiec stoi osobno, po prawej.
//
// NAZWY WYDARZENIA TU NIE MA - i to jest decyzja, nie przeoczenie. Nazwa
// i termin przeniosly sie do naglowka sidebara, bo tam stoja we wzorcu
// (`‹ Back to the community` · nazwa · data · `Open event`), a pasek gorny
// wzorca ma wylacznie logo, plakietke planu, `Preview event`, `Publish event`
// i konto. Zostawienie nazwy tutaj znaczyloby ten sam napis dwa razy na jednym
// ekranie, kilkadziesiat pikseli od siebie - a wtedy przestaje sie go czytac
// w obu miejscach. Odnosnik po lewej zostaje, bo prowadzi do STUDIA jako
// modulu (i jest jedynym wyjsciem, gdy sidebar jest przewiniety).
//
// STATUS JEST PRZELACZNIKIEM, NIE PLAKIETKA. Odwolanie wydarzenia i cofniecie
// go do szkicu to czynnosci rzadkie, ale musza byc osiagalne bez szukania -
// dlatego chip stanu otwiera menu, zamiast tylko informowac.
//
// PUBLIKACJA NIE PYTA O ZGODE DRUGI RAZ, gdy nie ma o co pytac: warunki
// (oba tytuly, termin) sprawdza baza i odmawia nazwanym bledem. Ekran nie
// powtarza tej reguly, tylko pokazuje jej wynik.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronDown, Loader2, Play } from "@/lib/lucide-shim";
import { ThemeToggle } from "@/components/atoms/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EventStatus } from "@/lib/events/eventDetailApi";
import type { EventStudioSection } from "@/lib/events/eventStudioNav";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

const STATUS_LABEL_KEYS: Record<EventStatus, string> = {
  draft: "adminEvents.list.status.draft",
  published: "adminEvents.list.status.published",
  cancelled: "adminEvents.list.status.cancelled",
};

/** Etykieta podgladu wszedzie tam, gdzie przycisk otwiera STRONE wydarzenia. */
const PREVIEW_LABEL_KEY = "adminEvents.studio.topBar.preview";

/**
 * Sekcje, na ktorych podglad otwiera COS INNEGO niz strone wydarzenia.
 *
 * MAPA, A NIE WARUNEK W JSX. Wzorzec zmienia ten napis kontekstowo (zrzut 02:
 * „Preview form” na kreatorze formularza, „Preview event” na pozostalych
 * ekranach), a takich wyjatkow bedzie wiecej niz jeden. Rozsiane `if`
 * odpowiadaja na to samo pytanie w kilku miejscach naraz i przy trzecim
 * wyjatku przestaja sie zgadzac. `Partial<Record<EventStudioSection, ...>>`
 * dodatkowo NIE PRZEPUSZCZA klucza sekcji, ktora nie istnieje: literowka
 * w nazwie ekranu wychodzi w kompilacji, a nie jako niezmieniony napis,
 * ktorego nikt nie zglosi.
 */
const PREVIEW_LABEL_KEY_BY_SECTION: Partial<Record<EventStudioSection, string>> = {
  registrationForm: "adminEvents.studio.topBar.previewForm",
};

export function EventStudioTopBar({
  status,
  isBusy,
  previewOpen,
  onTogglePreview,
  onStatusChange,
  createMode = false,
  section = null,
}: {
  status: EventStatus;
  isBusy: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onStatusChange: (status: EventStatus) => void;
  /**
   * Tryb kreatora: wydarzenia JESZCZE NIE MA.
   *
   * Sklad paska zostaje NIETKNIETY - zmienia sie tylko dostepnosc. Tak robi
   * wzorzec: na ekranie modulu, ktorego jeszcze nie zalozono, akcja publikacji
   * stoi na swoim miejscu wyszarzona, a nie znika (zrzut 37). Pasek, ktory
   * zmienia SKLAD miedzy ekranami, kaze szukac akcji od nowa na kazdym z nich.
   */
  createMode?: boolean;
  /**
   * Sekcja, na ktorej stoimy - potrzebna WYLACZNIE do etykiety podgladu.
   *
   * Pasek nie wylicza jej sam, bo rama i tak juz ja zna (rozstrzyga nia
   * podswietlenie sidebara i bramke wylaczonego modulu); drugie liczenie
   * z `pathname` dawaloby dwie odpowiedzi na jedno pytanie. `null` znaczy
   * „adres bez sekcji” (kreator, gole przekierowanie) - wtedy zostaje
   * etykieta domyslna.
   */
  section?: EventStudioSection | null;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const [statusOpen, setStatusOpen] = useState(false);

  const previewLabelKey =
    (section === null ? undefined : PREVIEW_LABEL_KEY_BY_SECTION[section]) ?? PREVIEW_LABEL_KEY;

  const pick = (next: EventStatus) => {
    setStatusOpen(false);
    onStatusChange(next);
  };

  return (
    <header className="sticky top-0 z-30 flex h-[3.25rem] items-center gap-3 border-b border-border bg-card px-3">
      <Link
        to="/admin/events/list"
        className="flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="hidden sm:inline">{t("adminEvents.studio.topBar.studio")}</span>
      </Link>

      {createMode ? (
        /* Szkic nie ma jeszcze wiersza w bazie, wiec nie ma czego przestawiac.
           Plakietka zamiast droplisty: kontrolka, ktora nie moze nic zmienic,
           klamie samym tym, ze wyglada na klikalna. */
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
          {t(STATUS_LABEL_KEYS.draft)}
        </span>
      ) : (
        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  status === "published" && "bg-emerald-500",
                  status === "draft" && "bg-amber-500",
                  status === "cancelled" && "bg-destructive",
                )}
                aria-hidden="true"
              />
              {t(STATUS_LABEL_KEYS[status])}
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            {(["draft", "published", "cancelled"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => pick(value)}
                disabled={value === status}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted",
                  value === status && "font-medium text-muted-foreground",
                )}
              >
                {t(STATUS_LABEL_KEYS[value])}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {/* Rozpiera pasek: akcje maja stac po PRAWEJ, tak jak we wzorcu. */}
      <span className="flex-1" aria-hidden="true" />

      {/* PRZELACZNIK MOTYWU STOI W PASKU STUDIA, bo redaktor sklada tu strone
          wydarzenia i musi zobaczyc ja w obu trybach bez wychodzenia z panelu.
          Ten sam komponent, co w naglowku serwisu - jedno zrodlo prawdy dla
          stanu `dark`, wiec podglad i strona publiczna nie moga sie rozjechac. */}
      <ThemeToggle className="h-8 w-8 rounded-[6px]" />

      <Button

        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        aria-pressed={previewOpen}
        disabled={createMode}
        onClick={onTogglePreview}
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        {t(previewLabelKey)}
      </Button>

      {/* PUBLIKACJA JEST OBRYSOWANA, NIE WYPELNIONA - i to jest cala regula
          hierarchii tego paska. Wzorzec trzyma w pasku gornym wylacznie
          akcje obrysowane, a wypelniony akcent rezerwuje dla akcji glownej
          w TRESCI: „Create sessions” na liscie sesji, „Create marketplace”
          na pustym module (zrzuty 08, 02, 37). Jeden wypelniony przycisk na
          ekran znaczy „to jest ta jedna rzecz, ktora tu robisz”; dwa
          konkuruja i zaden nie wygrywa - a przegralby wlasnie ten w tresci,
          po ktory redaktor przyszedl, bo pasek gorny stoi wyzej i patrzy sie
          na niego pierwszy. Obwodka i napis w kolorze akcentu, bo wzorzec
          tak odroznia publikacje od pozostalych akcji paska; wyszarzenie
          w trybie kreatora robi juz `disabled` - akcja ZOSTAJE na swoim
          miejscu, zamiast znikac (zrzut 37). */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-brand text-xs text-brand hover:bg-brand/10 hover:text-brand"
        disabled={createMode || isBusy || status === "published"}
        onClick={() => onStatusChange("published")}
      >
        {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        {t("adminEvents.studio.topBar.publish")}
      </Button>
    </header>
  );
}
