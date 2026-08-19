import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PanelSaveBarProps {
  /** Czy zapis ma sens - szkic różni się od stanu ZAPISANEGO. */
  canSave: boolean;
  /**
   * Czy przywrócenie domyślnych ma sens.
   *
   * OSOBNA FLAGA, NIE `canSave`. „Zapisz" pyta o różnicę wobec bazy, a
   * „przywróć domyślne" o różnicę wobec WARTOŚCI DOMYŚLNYCH - to dwa różne
   * pytania i panele modułu odpowiadały na nie na trzy różne sposoby. Molekuła
   * nie rozstrzyga, którą różnicę liczyć: dostaje gotową odpowiedź od organizmu.
   */
  canReset: boolean;
  /** Czy zapis jest w toku. */
  pending: boolean;
  saveLabel: string;
  /** Napis na przycisku w trakcie zapisu - inaczej użytkownik nie wie, że coś się dzieje. */
  savingLabel: string;
  resetLabel: string;
  onSave: () => void;
  onReset: () => void;
}

/**
 * Molekuła: pasek zapisu panelu ustawień (przywróć domyślne + zapisz).
 *
 * CO SCALIŁA I CO NAPRAWIŁA. Cztery panele modułu miały cztery różne umowy na
 * ten sam pasek:
 * - ToC: reset i zapis wyłączone przy czystym szkicu (poprawnie),
 * - sekcja „dowiesz się": reset AKTYWNY przy czystym szkicu, więc kliknięcie
 *   nadpisywało zapisany stan wartościami domyślnymi bez żadnej zmiany po
 *   stronie użytkownika,
 * - rekomendacje: goły przycisk zapisu bez sprawdzenia zmian - zapis leciał do
 *   bazy także wtedy, gdy nic nie ruszono,
 * - układy wpisu: surowy `<button>` (nie komponent `Button`) BEZ stanu
 *   wyłączonego - podwójne kliknięcie wysyłało dwa zapisy.
 * Molekuła narzuca jedną umowę: zapis wyłączony bez zmian albo w trakcie
 * zapisu, reset wyłączony bez zmian, a napis zapisu ogłasza stan „zapisuję".
 */
export function PanelSaveBar({
  canSave,
  canReset,
  pending,
  saveLabel,
  savingLabel,
  resetLabel,
  onSave,
  onReset,
}: PanelSaveBarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onReset} disabled={!canReset || pending}>
        <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        {resetLabel}
      </Button>
      <Button size="sm" onClick={onSave} disabled={!canSave || pending}>
        <Save className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        {pending ? savingLabel : saveLabel}
      </Button>
    </div>
  );
}
