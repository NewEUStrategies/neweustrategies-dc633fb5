// Słownik biblioteki materiałów w administracji (PL/EN) - lista plików, progi
// dostępu po randze członkostwa, publikacja i usuwanie.
//
// PO CO POWSTAŁ. Ekran niósł CZTERY kopie bliźniaka `L(pl, en)` - po jednej na
// komponent. 49 napisów istniało wyłącznie w kodzie, w tym treść potwierdzenia
// nieodwracalnego usunięcia pliku.
import i18n from "./i18n";

const pl = {
  adminLibrary: {
    rank: "ranga {{rank}}",
    noResourcesYet: "Brak materiałów. Dodaj pierwszy plik przyciskiem „Nowy materiał”.",
    confirmDeleteResource: "Usunąć „{{title}}”? Plik i metadane zostaną trwale usunięte.",
    couldSave: "Nie udało się zapisać.",
    resourceDeleted: "Usunięto materiał.",
    couldDelete: "Nie udało się usunąć.",
    membersLibrary: "Biblioteka materiałów",
    filesGoPrivateStorageBucket:
      "Pliki trafiają do prywatnego bucketu Storage i są chronione bramką rangi - pobierze je tylko zalogowany użytkownik o wystarczającej randze warstwy.",
    loading: "Wczytywanie...",
    couldLoadResources: "Nie udało się wczytać materiałów.",
    downloads: "Pobrania",
    published: "Opublikowany",
    hidden: "Ukryty",
    deleteResource: "Usuń materiał",
    titlePl: "Tytuł PL",
    titleEn: "Tytuł EN",
    descriptionPl: "Opis PL",
    descriptionEn: "Opis EN",
    category: "Kategoria",
    requiredTier: "Wymagana warstwa",
    selectTier: "Wybierz warstwę",
    rank0AnySignedUser: "Ranga 0 = wszyscy zalogowani, wyższa = węższy dostęp.",
    sortOrder: "Kolejność",
    uploadFailed: "Nie udało się wysłać pliku.",
    resourceAdded: "Dodano materiał.",
    newResource: "Nowy materiał",
    file: "Plik",
    chooseFileUpload: "Wybierz plik do wysłania",
    uploading: "Wysyłanie...",
    pickFileUploadsPrivateBucket: "Wybierz plik - zostanie wysłany do prywatnego bucketu.",
    cancel: "Anuluj",
    save: "Zapisz",
    changesSaved: "Zapisano zmiany.",
    editResource: "Edytuj materiał",
    chooseReplacementFile: "Wybierz nowy plik (podmiana)",
    keepCurrentFile: "Zostaw obecny plik",
    newFileReplacesCurrentOne: "Nowy plik zastąpi obecny przy zapisie; stary zniknie z bucketu.",
    canReplaceFileDownloadCounter: "Możesz podmienić plik - licznik pobrań i metadane zostają.",
  },
};

const en = {
  adminLibrary: {
    rank: "rank {{rank}}",
    noResourcesYet: 'No resources yet. Add the first file with "New resource".',
    confirmDeleteResource: 'Delete "{{title}}"? The file and metadata will be permanently removed.',
    couldSave: "Could not save.",
    resourceDeleted: "Resource deleted.",
    couldDelete: "Could not delete.",
    membersLibrary: "Members' library",
    filesGoPrivateStorageBucket:
      "Files go to a private Storage bucket and are protected by a tier gate - only a signed-in user with a sufficient tier rank can download them.",
    loading: "Loading...",
    couldLoadResources: "Could not load resources.",
    downloads: "Downloads",
    published: "Published",
    hidden: "Hidden",
    deleteResource: "Delete resource",
    titlePl: "Title PL",
    titleEn: "Title EN",
    descriptionPl: "Description PL",
    descriptionEn: "Description EN",
    category: "Category",
    requiredTier: "Required tier",
    selectTier: "Select a tier",
    rank0AnySignedUser: "Rank 0 = any signed-in user, higher = narrower access.",
    sortOrder: "Sort order",
    uploadFailed: "Upload failed.",
    resourceAdded: "Resource added.",
    newResource: "New resource",
    file: "File",
    chooseFileUpload: "Choose a file to upload",
    uploading: "Uploading...",
    pickFileUploadsPrivateBucket: "Pick a file - it uploads to the private bucket.",
    cancel: "Cancel",
    save: "Save",
    changesSaved: "Changes saved.",
    editResource: "Edit resource",
    chooseReplacementFile: "Choose a replacement file",
    keepCurrentFile: "Keep current file",
    newFileReplacesCurrentOne:
      "The new file replaces the current one on save; the old object is removed.",
    canReplaceFileDownloadCounter:
      "You can replace the file - the download counter and metadata stay.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
