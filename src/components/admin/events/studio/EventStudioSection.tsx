// Uklad EKRANU USTAWIEN w studiu: opis po lewej, kontrolki po prawej.
//
// PO CO OSOBNA MOLEKULA. Kazdy ekran studia to ta sama figura powtorzona
// kilkanascie razy: nazwa sekcji plus zdanie wyjasniajace w waskiej kolumnie
// po lewej, pola po prawej, kreska miedzy sekcjami. Przeklejona kilkanascie
// razy figura rozjezdza sie na trzecim ekranie - inna szerokosc kolumny, inny
// odstep, raz kreska jest, raz jej nie ma. Jedno wejscie = jeden uklad.
//
// OPIS JEST CZESCIA KONTROLKI, a nie ozdoba. Zdanie „Twoi odbiorcy zostana
// przekierowani na ten adres" tlumaczy, PO CO jest pole - a pole bez
// wyjasnienia zostaje puste albo wypelnione czyms, co nie ma sensu.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EventStudioPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">{title}</h1>
        {actions === undefined ? null : <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      <div className="divide-y divide-border">{children}</div>
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
  /** Dopisek pod opisem - odsylacz „Dowiedz sie jak" albo ostrzezenie. */
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
 * Karta wyboru z kolkiem radiowym - „Format", „Uklad strony glownej",
 * „Tryb prezentacji". Wzorzec referencyjny uzywa jej wszedzie tam, gdzie wybor
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
  /** Dodatkowa akcja po lewej - np. „Przywroc branding spolecznosci". */
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
