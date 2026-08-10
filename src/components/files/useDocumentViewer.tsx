// Sterowanie popupem podglądu z poziomu dowolnej listy plików.
//
// Powód istnienia: kafelek pliku nie powinien znać dialogu, a lista nie
// powinna trzymać czterech osobnych `useState`. Hook oddaje jedną funkcję
// `openFile` i gotowy element do wstawienia na końcu listy.
import { useCallback, useState } from "react";
import { DocumentViewerDialog, type DocumentViewerFile } from "./DocumentViewerDialog";

export function useDocumentViewer(): {
  openFile: (file: DocumentViewerFile) => void;
  viewer: React.ReactNode;
} {
  const [file, setFile] = useState<DocumentViewerFile | null>(null);

  const openFile = useCallback((next: DocumentViewerFile) => setFile(next), []);
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setFile(null);
  }, []);

  return {
    openFile,
    viewer: <DocumentViewerDialog file={file} open={file !== null} onOpenChange={onOpenChange} />,
  };
}
