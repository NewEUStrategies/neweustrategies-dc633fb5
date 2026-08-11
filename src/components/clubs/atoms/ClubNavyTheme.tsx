// Nakłada granatową paletę na CAŁY dokument (łącznie z headerem i stopką),
// dopóki zamontowana jest strona huba klubów. Klasa ląduje na <html>, bo
// header renderuje się poza drzewem route'u i nie da się go objąć wrapperem.
import { useEffect } from "react";

/** Klasa aktywująca override tokenów w `src/styles.css`. */
export const CLUB_NAVY_CLASS = "club-navy";

export function ClubNavyTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(CLUB_NAVY_CLASS);
    return () => {
      root.classList.remove(CLUB_NAVY_CLASS);
    };
  }, []);

  return null;
}
