/**
 * Глобальный API для ИИ-агентов (клиентский сценарий, без бэкенда).
 *
 * Экспонирует window.__oneCEditor__ — набор методов для программного управления
 * распакованным расширением .cfe прямо в браузере. Агент вызывает их через
 * page.evaluate(), не кликая по интерфейсу.
 *
 * Состояние (текущий архив) регистрируется компонентом ExtensionDropzone через
 * registerArchive(). Обработчик загрузки файла — через setLoadHandler().
 */

import type { UnpackedArchive } from "./extension/extract";
import { readEntryText } from "./extension/extract";
import { buildFileTree, type FileTreeNode } from "./extension/tree";
import {
  createDownloadUrl,
  revokeDownloadUrl,
  triggerDownloadUrl,
} from "./extension/pack";

let currentArchive: UnpackedArchive | null = null;
let currentName = "";
let loadHandler: ((file: File) => Promise<void>) | null = null;

/** Регистрирует текущий распакованный архив (вызывается из ExtensionDropzone). */
export function registerArchive(archive: UnpackedArchive, name: string) {
  currentArchive = archive;
  currentName = name;
}

/** Сбрасывает текущий архив (при закрытии файла). */
export function clearArchive() {
  currentArchive = null;
  currentName = "";
}

/** Регистрирует обработчик загрузки .cfe (функция handleFiles компонента). */
export function setLoadHandler(fn: ((file: File) => Promise<void>) | null) {
  loadHandler = fn;
}

/** Устанавливает глобальный объект window.__oneCEditor__ (идемпотентно). */
export function installAgentApi(): void {
  if (typeof window === "undefined") return;
  if ((window as unknown as Record<string, unknown>).__oneCEditor__) return;

  const api = {
    /** Загрузить .cfe (File из браузера). */
    async loadFile(file: File) {
      if (!loadHandler) throw new Error("Загрузка файла сейчас недоступна.");
      await loadHandler(file);
    },

    /** Информация о текущем расширении или null. */
    getInfo():
      | { name: string; fileCount: number; editable: boolean }
      | null {
      if (!currentArchive) return null;
      return {
        name: currentName,
        fileCount: currentArchive.entries.length,
        editable: Boolean(currentArchive.writeEntry),
      };
    },

    /** Дерево файлов (папки и файлы) в машиночитаемом виде. */
    getTree(): FileTreeNode[] {
      if (!currentArchive) return [];
      return buildFileTree(currentArchive.entries);
    },

    /** Плоский список записей архива (path, isDirectory). */
    getFiles(): { path: string; isDirectory: boolean }[] {
      if (!currentArchive) return [];
      return currentArchive.entries;
    },

    /** Текст файла (null — бинарный/недоступный). */
    async readFile(path: string): Promise<string | null> {
      if (!currentArchive) return null;
      return readEntryText(currentArchive, path);
    },

    /** Можно ли редактировать конкретный файл. */
    canEdit(path: string): boolean {
      if (!currentArchive) return false;
      if (currentArchive.canEdit) return currentArchive.canEdit(path);
      return Boolean(currentArchive.writeEntry);
    },

    /** Записать изменённое содержимое файла (аналог автосохранения). */
    writeFile(path: string, text: string): void {
      if (!currentArchive || !currentArchive.writeEntry) {
        throw new Error("Текущий контейнер не поддерживает редактирование.");
      }
      currentArchive.writeEntry(path, text);
    },

    /** Упаковать обратно в .cfe. Возвращает Blob, URL и имя файла. */
    async buildFile(): Promise<{
      blob: Blob;
      url: string;
      name: string;
    }> {
      if (!currentArchive || !currentArchive.toBlob) {
        throw new Error("Упаковка расширения недоступна.");
      }
      const blob = await currentArchive.toBlob();
      return { blob, url: createDownloadUrl(blob, currentName), name: currentName };
    },

    /** Упаковать и сразу скачать .cfe через браузер. */
    async saveAndDownload(): Promise<{ name: string }> {
      const { blob, url, name } = await api.buildFile();
      triggerDownloadUrl(url, name);
      setTimeout(() => revokeDownloadUrl(url), 0);
      return { name };
    },
  };

  (window as unknown as Record<string, unknown>).__oneCEditor__ = api;
}