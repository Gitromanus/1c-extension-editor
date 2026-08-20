import JSZip from "jszip";
import { tryParseV8Container, type ParsedV8Container } from "./v8container";
import { decodeV8Extension, rewriteFormModule } from "./v8decode";
import { packToBlob } from "./pack";
import { serializeV8Container } from "./v8write";

export interface ArchiveEntry {
  path: string;
  isDirectory: boolean;
}

export type ArchiveFormat = "zip" | "v8";

export interface UnpackedArchive {
  name: string;
  format: ArchiveFormat;
  entries: ArchiveEntry[];
  readFile(path: string): Promise<Uint8Array | null>;
  /** Доступно только для ZIP-архивов: сохранить отредактированный файл. */
  writeEntry?(path: string, content: string): void;
  /** Можно ли редактировать конкретный файл. По умолчанию — все файлы. */
  canEdit?(path: string): boolean;
  /** Доступно только для ZIP-архивов: упаковать обратно в .cfe. */
  toBlob?(): Promise<Blob>;
}

export class CfeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfeFormatError";
  }
}

const ZIP_LOCAL_FILE_HEADER = "PK\x03\x04"; // 0x04034b50
const ZIP_END_OF_CENTRAL_DIR = "PK\x05\x06"; // 0x06054b50
const ZIP64_END_OF_CENTRAL_DIR = "PK\x06\x06"; // 0x06064b50
const ZIP64_LOCATOR = "PK\x06\x07"; // 0x07064b50

function indexOfSignature(
  buffer: ArrayBuffer,
  signature: string,
  from = 0
): number {
  if (buffer.byteLength < signature.length) return -1;
  const bytes = new Uint8Array(buffer);
  const target = Array.from(signature, (c) => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function firstLocalFileHeaderOffset(buffer: ArrayBuffer): number {
  return indexOfSignature(buffer, ZIP_LOCAL_FILE_HEADER);
}

/**
 * Определяет, является ли содержимое ZIP-контейнером (формат .cfe по логике
 * v8unpack). Вместо жёсткой проверки первых байт ищем структуру архива: запись
 * локального заголовка файла или запись конца центрального каталога (EOCD),
 * включая ZIP64. Это позволяет корректно открывать валидные файлы даже при
 * наличии префикса/вложенности данных перед заголовком ZIP.
 */
function looksLikeZip(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  if (firstLocalFileHeaderOffset(buffer) !== -1) return true;
  return [ZIP_END_OF_CENTRAL_DIR, ZIP64_END_OF_CENTRAL_DIR, ZIP64_LOCATOR].some(
    (sig) => indexOfSignature(buffer, sig) !== -1
  );
}

async function tryLoadZip(
  bytes: Uint8Array,
  buffer: ArrayBuffer
): Promise<JSZip | undefined> {
  try {
    return await JSZip.loadAsync(buffer, { createFolders: true });
  } catch {
    const embeddedOffset = firstLocalFileHeaderOffset(buffer);
    if (embeddedOffset > 0) {
      try {
        return await JSZip.loadAsync(buffer.slice(embeddedOffset), {
          createFolders: true,
        });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function buildZipArchive(name: string, source: JSZip): UnpackedArchive {
  const entries: ArchiveEntry[] = Object.values(source.files)
    .map((entry) => ({
      path: entry.name,
      isDirectory: entry.dir || entry.name.endsWith("/"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    name,
    format: "zip",
    entries,
    async readFile(path: string) {
      const entry = source.files[path];
      if (!entry || entry.dir) return null;
      try {
        return await entry.async("uint8array");
      } catch {
        return null;
      }
    },
    writeEntry(path: string, content: string) {
      source.file(path, content);
    },
    canEdit() {
      return true;
    },
    toBlob() {
      return packToBlob(source);
    },
  };
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function buildV8Archive(
  name: string,
  parsed: ParsedV8Container
): UnpackedArchive {
  const decoded = decodeV8Extension(parsed.files);
  const base = {
    name,
    format: "v8" as const,
    toBlob() {
      const out = serializeV8Container({
        fileHeader: parsed.fileHeader,
        children: parsed.nodes,
      });
      const copy = new Uint8Array(out.length);
      copy.set(out);
      return Promise.resolve(
        new Blob([copy.buffer], { type: "application/octet-stream" })
      );
    },
  };

  if (!decoded) {
    return {
      ...base,
      name,
      entries: parsed.entries,
      async readFile(path: string) {
        return parsed.files.get(path) ?? null;
      },
    };
  }

  /**
   * В нативном контейнере 1С редактируемыми являются только модули
   * (`*.bsl`), в том числе модули самой конфигурации (модуль приложения и др.).
   * Остальные текстовые файлы (скобкофайлы метаданных) не редактируются, чтобы
   * не повредить структуру расширения.
   */
  const writeEntry = (path: string, content: string): void => {
    if (!path.endsWith(".bsl")) {
      throw new Error(
        "В нативном контейнере 1С можно редактировать только модули (файлы .bsl)."
      );
    }
    const target = decoded.edits.get(path);
    if (!target) {
      throw new Error(
        "Этот модуль нельзя редактировать в нативном контейнере 1С."
      );
    }
    const node = parsed.nodeByKey.get(target.rawKey);
    if (!node) {
      throw new Error("Не удалось найти элемент контейнера для правки.");
    }
    if (target.kind === "formModule") {
      const rewritten = rewriteFormModule(bytesToText(node.content), content);
      if (!rewritten) {
        throw new Error(
          "Модуль формы нельзя безопасно сохранить (сложный формат). Правка отменена."
        );
      }
      node.content = rewritten;
      return;
    }
    node.content = textToBytes(content);
  };

  return {
    ...base,
    name: decoded.name || name,
    entries: decoded.entries,
    async readFile(path: string) {
      // Читаем из «живого» содержимого контейнера, если модуль был отредактирован,
      // иначе правки терялись бы при повторном открытии файла (decoded.files — снимок).
      const edit = decoded.edits.get(path);
      if (edit) {
        const node = parsed.nodeByKey.get(edit.rawKey);
        if (node) return node.content;
      }
      return decoded.files.get(path) ?? null;
    },
    writeEntry,
    canEdit(path: string) {
      return path.endsWith(".bsl");
    },
  };
}

export async function extractCfe(file: File): Promise<UnpackedArchive> {
  if (!file.name.toLowerCase().endsWith(".cfe")) {
    throw new CfeFormatError("Выберите файл расширения .cfe.");
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new CfeFormatError("Не удалось прочитать файл. Попробуйте ещё раз.");
  }

  if (buffer.byteLength === 0) {
    throw new CfeFormatError(
      "Файл пуст. Выберите корректный файл расширения .cfe."
    );
  }

  const bytes = new Uint8Array(buffer);

  const zip = await tryLoadZip(bytes, buffer);
  if (zip) return buildZipArchive(file.name, zip);

  const v8 = tryParseV8Container(bytes);
  if (v8) return buildV8Archive(file.name, v8);

  throw new CfeFormatError(
    looksLikeZip(buffer)
      ? "Архив повреждён или содержит неподдерживаемое сжатие. Проверьте файл .cfe."
      : "Файл не является корректным расширением 1С. Формат .cfe — ZIP-контейнер либо внутренний формат 1С по логике v8unpack."
  );
}

const TEXT_EXTENSIONS = new Set([
  "xml",
  "txt",
  "json",
  "md",
  "log",
  "1c",
  "cls",
  "form",
  "bsl",
  "csv",
  "html",
  "css",
  "js",
  "ts",
  "cfg",
  "lst",
  "enums",
]);

export function isLikelyTextEntry(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base.startsWith(".")) return true;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return true;
  return TEXT_EXTENSIONS.has(base.slice(dot + 1));
}

export async function readEntryText(
  archive: UnpackedArchive,
  path: string
): Promise<string | null> {
  let bytes: Uint8Array | null;
  try {
    bytes = await archive.readFile(path);
  } catch {
    return null;
  }
  if (!bytes) return null;

  if (looksBinary(bytes)) return null;

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 8192));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) return true;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) > 0.1;
}
