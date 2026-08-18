// Treść okien potwierdzeń listy wpisów - sześć wariantów tej samej decyzji:
// „czy na pewno”. Wyniesione z `src/routes/admin.posts.tsx`, gdzie każdy z nich
// był literałem wklejonym w handler razem z wywołaniem server fn, unieważnieniem
// cache i obsługą błędu.
//
// Rozdział jest tu istotny, bo okna różnią się DWIEMA rzeczami naraz:
// odwracalnością operacji (kosz można cofnąć, trwałe usunięcie nie) i tym, czy
// przycisk potwierdzenia jest czerwony. Rozjazd między jednym a drugim daje
// najgorszy możliwy wariant: neutralnie wyglądające okno przy operacji
// nieodwracalnej.

/** Treść okna potwierdzenia (bez `onConfirm`, który dokłada wywołujący). */
export interface PostsListConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  /** Czerwony przycisk potwierdzenia - operacje usuwające dane z widoku. */
  destructive?: boolean;
}

/** Przeniesienie JEDNEGO wpisu do kosza - odwracalne, ale zabiera go z listy. */
export function confirmTrashOne(title: string): PostsListConfirmCopy {
  return {
    title: "Przenieść do kosza?",
    description: `Wpis "${title}" zostanie przeniesiony do kosza. Możesz go później przywrócić.`,
    confirmLabel: "Przenieś do kosza",
    destructive: true,
  };
}

/** Przeniesienie zaznaczonych wpisów do kosza. */
export function confirmTrashMany(count: number): PostsListConfirmCopy {
  return {
    title: `Przenieść do kosza ${count} wpisów?`,
    description: "Zaznaczone wpisy zostaną przeniesione do kosza.",
    confirmLabel: "Przenieś do kosza",
    destructive: true,
  };
}

/** Przywrócenie JEDNEGO wpisu z kosza - operacja odbudowująca, nie niszcząca. */
export function confirmRestoreOne(title: string): PostsListConfirmCopy {
  return {
    title: "Przywrócić wpis?",
    description: `"${title}" zostanie przywrócony z kosza.`,
    confirmLabel: "Przywróć",
  };
}

/** Przywrócenie zaznaczonych wpisów z kosza. */
export function confirmRestoreMany(count: number): PostsListConfirmCopy {
  return {
    title: `Przywrócić ${count} wpisów?`,
    description: "Zaznaczone wpisy zostaną przywrócone z kosza.",
    confirmLabel: "Przywróć",
  };
}

/** Trwałe usunięcie JEDNEGO wpisu - jedyna operacja listy bez drogi powrotnej. */
export function confirmPurgeOne(title: string): PostsListConfirmCopy {
  return {
    title: "Usunąć trwale?",
    description: `"${title}" zostanie nieodwracalnie usunięty. Tej operacji nie można cofnąć.`,
    confirmLabel: "Usuń trwale",
    destructive: true,
  };
}

/** Trwałe usunięcie zaznaczonych wpisów. */
export function confirmPurgeMany(count: number): PostsListConfirmCopy {
  return {
    title: `Usunąć trwale ${count} wpisów?`,
    description: "Zaznaczone wpisy zostaną nieodwracalnie usunięte. Tej operacji nie można cofnąć.",
    confirmLabel: "Usuń trwale",
    destructive: true,
  };
}
