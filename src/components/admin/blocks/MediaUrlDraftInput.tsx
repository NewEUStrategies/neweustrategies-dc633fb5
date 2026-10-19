import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface Props {
  placeholder: string;
  onCommit: (url: string) => void;
  className?: string;
}

/**
 * Pole adresu w PUSTYM bloku mediów (obraz, wideo, audio). Zapis idzie dopiero
 * po Enter albo po opuszczeniu pola: zapis na każdym znaku dawał niepusty URL
 * już po pierwszej literze („h"), blok przełączał się na podgląd/odtwarzacz,
 * a pole znikało razem z fokusem - adres dało się tylko wkleić w całości.
 * Przy okazji jeden adres to jeden wpis historii cofania, a nie jeden na znak.
 */
export function MediaUrlDraftInput({ placeholder, onCommit, className }: Props) {
  const [draft, setDraft] = useState("");
  // Enter przełącza blok na podgląd i odmontowuje pole; przeglądarka może
  // jeszcze wysłać `blur` - ten sam adres nie idzie wtedy drugi raz.
  const committed = useRef("");
  const commit = () => {
    const url = draft.trim();
    if (!url || url === committed.current) return;
    committed.current = url;
    onCommit(url);
  };
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit();
      }}
      className={className}
    />
  );
}
