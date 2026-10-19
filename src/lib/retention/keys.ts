// FABRYKA KLUCZY REACT QUERY RETENCJI (przepływ anulowania).
//
// DWIE RODZINY KLUCZY ŚWIADOMIE. Odczyt publiczny (`retention-settings`,
// `retention-reasons`) karmi dialog anulowania u czytelnika; odczyt panelu
// (`["admin", …]`) - zakładkę Retencja w /admin/pricing. Mają różne kształty
// danych i różne uprawnienia, więc zapis w panelu unieważnia obie.
//
// KSZTAŁTY = DZISIEJSZE LITERAŁY; LIŚĆ BEZ IMPORTÓW RUNTIME (mapa szyny).
export const retentionKeys = {
  settingsPublic: () => ["retention-settings"] as const,
  reasonsPublic: () => ["retention-reasons"] as const,
  admin: {
    settings: () => ["admin", "retention-settings"] as const,
    reasons: () => ["admin", "retention-reasons"] as const,
    /** Odpowiedzi z przepływu anulowania (powody odejść). */
    feedback: () => ["admin", "retention-feedback"] as const,
  },
} as const;
