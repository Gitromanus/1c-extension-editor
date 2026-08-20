"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileArchive, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ExtensionViewer } from "@/components/extension-viewer";
import { useEffect } from "react";
import {
  extractCfe,
  CfeFormatError,
  type UnpackedArchive,
} from "@/lib/extension/extract";
import {
  registerArchive,
  clearArchive,
  setLoadHandler,
} from "@/lib/agent-api";

export interface ExtensionDropzoneProps {
  /** Уведомляет родителя о смене режима: true — открыт редактор, false — возврат. */
  onOpenChange?: (open: boolean) => void;
}

export function ExtensionDropzone({ onOpenChange }: ExtensionDropzoneProps) {
  // Предоставляем глобальному API обработчик загрузки .cfe.
  useEffect(() => {
    setLoadHandler(handleFiles);
    return () => setLoadHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<UnpackedArchive | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFiles(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);

    setBusy(true);
    const toastId = toast.loading(`Распаковка "${file.name}"…`);
    try {
      const archive = await extractCfe(file);
      toast.success("Расширение распаковано", { id: toastId });
      setOpened(archive);
      registerArchive(archive, file.name);
      onOpenChange?.(true);
    } catch (err) {
      const message =
        err instanceof CfeFormatError
          ? err.message
          : "Не удалось распаковать файл. Проверьте файл расширения .cfe.";
      toast.error(message, { id: toastId });
      setFileName(null);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpened(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
    clearArchive();
    onOpenChange?.(false);
  }

  if (opened) {
    return (
      <ExtensionViewer name={opened.name} archive={opened} onReset={reset} />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Область загрузки файла расширения"
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) handleFiles(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-muted/30 px-6 py-14 text-center outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "border-primary bg-primary/5",
        busy && "cursor-wait opacity-70"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".cfe"
        data-testid="cfe-upload-input"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files?.[0])}
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-background shadow-sm">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <FileArchive className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1">
        {fileName ? (
          <>
            <p className="font-mono text-sm font-medium break-all">
              {fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {busy ? "Распаковка…" : "Кликните, чтобы выбрать другой файл."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              Перетащите файл <span className="font-mono">.cfe</span> сюда
            </p>
            <p className="text-xs text-muted-foreground">
              или нажмите, чтобы выбрать файл расширения 1С
            </p>
          </>
        )}
      </div>
      <Button variant="secondary" size="sm" disabled={busy}>
        <FolderOpen className="h-4 w-4" />
        {busy ? "Распаковка…" : "Выбрать файл"}
      </Button>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Upload className="h-3 w-3" />
        Обработка выполняется локально в браузере
      </p>
    </div>
  );
}
