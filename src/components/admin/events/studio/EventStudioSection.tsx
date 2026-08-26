// Uklad EKRANU USTAWIEN w studiu: opis po lewej, kontrolki po prawej.
//
// PO CO OSOBNA MOLEKULA. Kazdy ekran studia to ta sama figura powtorzona
// kilkanascie razy: nazwa sekcji plus zdanie wyjasniajace w waskiej kolumnie
// po lewej, pola po prawej, kreska miedzy sekcjami. Przeklejona kilkanascie
// razy figura rozjezdza sie na trzecim ekranie - inna szerokosc kolumny, inny
// odstep, raz kreska jest, raz jej nie ma. Jedno wejscie = jeden uklad.
//
// OPIS JEST CZESCIA KONTROLKI, a nie ozdoba. Zdanie „Twoi odbiorcy zostana
// przekierowani na ten adres” tlumaczy, PO CO jest pole - a pole bez
// wyjasnienia zostaje puste albo wypelnione czyms, co nie ma sensu.
//
// NAGLOWEK EKRANU MA DWA WARIANTY, bo wzorzec ma dwa rodzaje ekranow i myla
// sie tylko wtedy, gdy uda sie je do siebie: `EventStudioPage` to lista albo
// ustawienia (H1 = nazwa sekcji, pod nim zdanie o tym, po co ten ekran jest),
// `EventStudioRecordPage` to POJEDYNCZY REKORD (H1 = nazwa rekordu, a pod nim
// zakladki tego rekordu). Zdania opisowego w wariancie rekordu nie ma celowo:
// redaktor, ktory wszedl w konkretna sesje, nie czyta juz definicji sesji -
// szuka pol i zakladek, a akapit odsuwa je o dwa wiersze w dol.
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Sparkles } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/**
 * Otoczka tresci ekranu studia.
 *
 * BEZ OGRANICZENIA SZEROKOSCI - i to jest decyzja, nie zapomniana klasa.
 * Tresc wzorca jest przyklejona do lewej i idzie do prawej krawedzi okna:
 * lista osob ma jedenascie kolumn przewijanych w poziomie, a wysrodkowana
 * kolumna o stalej szerokosci obcielaby je w polowie i jeszcze zostawilaby
 * puste marginesy po obu stronach. Padding zostaje, zeby tabela nie dotykala
 * krawedzi i zeby przyklejony pasek zapisu (`-mx-4 sm:-mx-8`) mial co wyjsc.
 */
const PAGE_SHELL_CLASS = "w-full px-4 py-6 sm:px-8";

/**
 * Pigulka pomocy na koncu akapitu opisu.
 *
 * WISI W AKAPICIE, NIE W PASKU NARZEDZI. We wzorcu ten odsylacz konczy zdanie
 * wyjasniajace ekran - czyta sie go jako „a jesli to za malo, przeczytaj” i
 * dlatego nie konkuruje z akcja glowna. Przeniesiony do paska narzedzi stalby
 * obok przycisku tworzenia rekordu i zbieralby klikniecia zamiast niego.
 *
 * IKONA JEST ZAROWKA WZORCA W NASZYM ZESTAWIE. Nasza nakladka na ikony nie
 * eksportuje `Lightbulb`, a slownik ikon jest poza tym zadaniem - `Sparkles`
 * niesie to samo znaczenie (podpowiedz), wiec pigulka nie czeka na dopisanie
 * jednego glifu.
 */
function EventStudioHelpPill({ href }: { href: string }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ml-1 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 align-middle text-xs font-medium text-brand-ink transition-colors hover:bg-brand/20"
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {t("adminEvents.studio.help.learnHow")}
      <ChevronRight className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

/**
 * Naglowek WARIANTU A: lista albo ekran ustawien.
 *
 * OPIS I PIGULKA SA OPCJONALNE OSOBNO. Wzorzec ma ekrany z samym H1 (lista
 * kanalow feedu) i ekrany z pelnym akapitem plus odsylaczem (lista osob).
 * Gdyby akapit renderowal sie zawsze, ekran z samym H1 dostalby pusty wiersz
 * i tabela zjechalaby nizej niz na siostrzanym ekranie - a wtedy przejscie
 * miedzy dwiema listami wyglada jak przeskok ukladu, nie jak zmiana danych.
 *
 * SLOT `actions` ZOSTAL USUNIETY. Byl martwy - zaden z dwudziestu dziewieciu
 * ekranow studia go nie podawal, bo we wzorcu akcje ekranu naleza do PASKA
 * NARZEDZI TRESCI (szukanie po lewej, zebatka / eksport / przycisk glowny po
 * prawej), a nie do naglowka. Puste gniazdo w naglowku zaprasza, zeby wstawic
 * w nie drugi przycisk glowny - i wtedy na ekranie sa dwa, kilkadziesiat
 * pikseli od siebie.
 */
export function EventStudioPage({
  title,
  description,
  helpHref,
  children,
}: {
  title: string;
  /** Zdanie „po co jest ten ekran” - opcjonalne, patrz zrzut listy kanalow. */
  description?: string;
  /** Adres artykulu pomocy. Bez adresu pigulki nie ma wcale. */
  helpHref?: string;
  children: ReactNode;
}) {
  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="mb-6 space-y-2">
        <h1 className="font-display text-2xl">{title}</h1>
        {description === undefined && helpHref === undefined ? null : (
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
            {helpHref === undefined ? null : <EventStudioHelpPill href={helpHref} />}
          </p>
        )}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** Jedna zakladka rekordu. Licznik jest opcjonalny - „Attendees” go nie ma. */
export type EventStudioRecordTab = {
  key: string;
  label: string;
  count?: number;
};

/**
 * Kontrakt rzedu zakladek - DANE, nie JSX.
 *
 * Gdyby ekran przekazywal gotowy rzad zakladek jako `ReactNode`, kazdy z nich
 * narysowalby wlasny: inny odstep, inne podkreslenie, licznik raz w nawiasie,
 * raz w kolku. Po trzech ekranach sa trzy rozne rzedy i zaden nie jest wzorcem.
 *
 * TROJKA JEST JEDNYM PROPEM, bo osobne `tabs` / `activeTab` / `onTabSelect`
 * daloby sie podac po jednym - a rzad zakladek bez aktywnego klucza albo bez
 * callbacka to kontrolka, ktora tylko wyglada na klikalna.
 */
export type EventStudioRecordTabs = {
  items: readonly EventStudioRecordTab[];
  active: string;
  onSelect: (key: string) => void;
};

/**
 * Naglowek WARIANTU B: szczegol pojedynczego rekordu (zrzut sesji).
 *
 * PIGULKA-LICZNIK OBOK H1 MOWI O ZAWARTOSCI REKORDU, nie o calej sekcji -
 * dlatego stoi przy nazwie, a nie w pasku narzedzi listy, z ktorej redaktor
 * tu wszedl.
 *
 * RZAD ZAKLADEK JEST OPCJONALNY, bo rekord bez zakladek istnieje (dokument
 * ma same pola). Wtedy nie ma tez kreski pod naglowkiem - kreska bez zakladek
 * obiecuje rzad, ktorego nie ma.
 */
export function EventStudioRecordPage({
  title,
  badge,
  tabs,
  children,
}: {
  title: string;
  /** Szara pigulka przy nazwie rekordu - np. liczba zgloszen. */
  badge?: string;
  tabs?: EventStudioRecordTabs;
  children: ReactNode;
}) {
  // Rzad zakladek bierze nazwe od naglowka rekordu, zeby czytnik ekranu mowil,
  // CZYJE to zakladki. Wlasny napis wymagalby klucza, ktory nic nie dodaje.
  const headingId = useId();
  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id={headingId} className="font-display text-2xl">
          {title}
        </h1>
        {badge === undefined ? null : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </div>

      {tabs === undefined ? null : (
        <div className="mt-4 border-b border-border">
          <div role="tablist" aria-labelledby={headingId} className="-mb-px flex flex-wrap gap-6">
            {tabs.items.map((tab) => {
              const active = tab.key === tabs.active;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => tabs.onSelect(tab.key)}
                  className={cn(
                    "border-b-2 py-3 text-sm transition-colors",
                    active
                      ? "border-brand font-semibold text-brand-ink"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {tab.count === undefined ? null : (
                    <span className="ml-1 tabular-nums">({tab.count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 divide-y divide-border">{children}</div>
    </div>
  );
}

export function EventStudioRow({
  label,
  description,
  hint,
  children,
  className,
}: {
  label: string;
  description?: string;
  /** Dopisek pod opisem - odsylacz „Dowiedz sie jak” albo ostrzezenie. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("grid gap-4 py-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]", className)}
    >
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        {description === undefined ? null : (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
        {hint}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Karta wyboru z kolkiem radiowym - „Format”, „Uklad strony glownej”,
 * „Tryb prezentacji”. Wzorzec referencyjny uzywa jej wszedzie tam, gdzie wybor
 * ma DWA albo TRZY warianty i kazdy wymaga zdania wyjasniajacego; droplista
 * chowa te zdania i zmusza do zgadywania.
 */
export function EventStudioChoiceCard({
  id,
  name,
  checked,
  label,
  description,
  icon,
  onSelect,
  children,
}: {
  id: string;
  name: string;
  checked: boolean;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Dodatkowa tresc karty - miniatura ukladu albo przycisk. */
  children?: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
        checked ? "border-brand bg-brand/5" : "border-border hover:border-brand/40",
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-[var(--brand,#FA9346)]"
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {icon}
        </span>
        {description === undefined ? null : (
          <span className="block text-[13px] text-muted-foreground">{description}</span>
        )}
        {children}
      </span>
    </label>
  );
}

/**
 * Przyklejony pasek zapisu ekranu studia.
 *
 * ZAPIS JEST JAWNY, NIE AUTOMATYCZNY. Ekran zmienia adres publiczny wydarzenia,
 * termin i strefe - czyli rzeczy, ktore po zapisie ida do przypomnien i do
 * kalendarzy uczestnikow. Autozapis przy takich polach znaczy, ze literowka
 * w slugu jest juz wdrozona, zanim redaktor skonczyl ja pisac.
 *
 * PASEK JEST WIDOCZNY DOPIERO PRZY ZMIANIE. Pasek stojacy zawsze uczy, zeby go
 * nie zauwazac, a wtedy nie zauwaza sie go takze wtedy, gdy cos jest do zapisania.
 */
export function EventStudioSaveBar({
  dirty,
  saving,
  saveLabel,
  discardLabel,
  savingLabel,
  onSave,
  onDiscard,
  disabled,
  leading,
}: {
  dirty: boolean;
  saving: boolean;
  saveLabel: string;
  discardLabel: string;
  savingLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  disabled?: boolean;
  /** Dodatkowa akcja po lewej - np. „Przywroc branding spolecznosci”. */
  leading?: ReactNode;
}) {
  if (!dirty && !saving) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      {leading}
      <span className="mr-auto text-xs text-muted-foreground">{saving ? savingLabel : null}</span>
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {discardLabel}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled === true}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {saveLabel}
      </button>
    </div>
  );
}
