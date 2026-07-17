// Supplementary i18n bundle for the animated DownloadButton (PL/EN).
// Side-effect import wherever the button mounts:
//   import "@/lib/i18n-download-button";
import i18n from "./i18n";

export const downloadButtonPl = {
  downloadButton: {
    idle: "Pobierz",
    inProgress: "Pobieranie",
    done: "Pobrano",
    ariaLabel: "Pobierz plik",
  },
} as const;

export const downloadButtonEn = {
  downloadButton: {
    idle: "Download",
    inProgress: "Downloading",
    done: "Downloaded",
    ariaLabel: "Download file",
  },
} as const;

i18n.addResourceBundle("pl", "translation", downloadButtonPl, true, true);
i18n.addResourceBundle("en", "translation", downloadButtonEn, true, true);
