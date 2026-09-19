// Atom: pusty folder biblioteki mediów.
//
// Do 2026-09 był to wyłącznie napis „Przeciągnij pliki tutaj lub kliknij
// «Wgraj»" - czyli instrukcja, która odsyłała do PASKA NARZĘDZI, zamiast
// przyjąć plik w miejscu, na które użytkownik właśnie patrzy. Teraz pusty
// folder jest pełnoprawnym obszarem wgrywania w standardzie platformy
// (`@/components/ui/upload-area`): przyjmuje kliknięcie i upuszczenie, a pliki
// lądują w bieżącym folderze.
import { useTranslation } from "react-i18next";
import { FileAudio, FileImage, FileVideo } from "lucide-react";

import { UploadArea } from "@/components/ui/upload-area";
import "@/lib/i18n-admin-media";
import "@/lib/i18n-upload-area";

export function MediaEmptyState({
  onFiles,
  accept,
  busy = false,
}: {
  /** Pliki z pickera albo z upuszczenia - wgrywane do bieżącego folderu. */
  onFiles: (files: File[]) => void;
  accept?: string;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    // `data-nomarquee`: kanwa mediów ciągnie po pustym tle gumkę zaznaczenia,
    // a przeciąganie po obszarze wgrywania jest gestem upuszczania pliku, nie
    // zaznaczania - hook gumki pomija poddrzewa z tym atrybutem.
    <div className="flex items-center justify-center py-10" data-nomarquee>
      <UploadArea
        title={t("uploadArea.media.title")}
        description={t("uploadArea.media.description")}
        ctaLabel={t("admin.media.uploadFiles")}
        busyLabel={t("admin.media.uploading")}
        busy={busy}
        icons={[FileImage, FileVideo, FileAudio]}
        accept={accept}
        multiple
        onFiles={onFiles}
      />
    </div>
  );
}
