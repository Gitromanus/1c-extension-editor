import { inflateRaw } from "pako";
import type { ArchiveEntry } from "./extract";
import type { V8Node } from "./v8write";

/**
 * Парсер внутреннего бинарного контейнера 1С (.cf/.cfe) по логике v8unpack.
 *
 * Файл расширения 1С — это НЕ ZIP. Это бинарный контейнер, который состоит из
 * файлового заголовка, блока адресов элементов и самих элементов (заголовок +
 * данные). Данные каждого элемента сжаты потоком raw-deflate. Если распакованные
 * данные сами являются бинарным контейнером (вложенность), элемент становится
 * каталогом, иначе — файлом.
 */

const V8_FF_SIGNATURE = 0x7fffffff;
const FILE_HEADER_SIZE = 16;
const BLOCK_HEADER_SIZE = 31;
const ELEM_HEADER_BEGIN_SIZE = 20;
const ELEM_ADDR_SIZE = 12;

export interface ParsedV8Container {
  entries: ArchiveEntry[];
  files: Map<string, Uint8Array>;
  /** Заголовок файла контейнера (16 байт), сохраняется как есть. */
  fileHeader: Uint8Array;
  /** Корневые элементы контейнера. */
  nodes: V8Node[];
  /** Индекс элементов по исходному ключу пути. */
  nodeByKey: Map<string, V8Node>;
}

function asciiText(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function hexToUint32(hex: string): number {
  return parseInt(hex.trim(), 16) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Проверяет, что по смещению `offset` расположен корректный заголовок блока
 * (строки вида "0d0a <data_size> <page_size> <next_page> 0d0a").
 */
function isBlockHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + BLOCK_HEADER_SIZE > bytes.length) return false;
  return (
    bytes[offset] === 0x0d &&
    bytes[offset + 1] === 0x0a &&
    bytes[offset + 10] === 0x20 &&
    bytes[offset + 19] === 0x20 &&
    bytes[offset + 28] === 0x20 &&
    bytes[offset + 29] === 0x0d &&
    bytes[offset + 30] === 0x0a
  );
}

/**
 * Читает логический блок данных, следующих за заголовком блока по смещению
 * `offset`, объединяя цепочку страниц, если адрес следующей страницы задан.
 */
function readBlockData(bytes: Uint8Array, offset: number): Uint8Array {
  const dataSize = hexToUint32(asciiText(bytes, offset + 2, offset + 10));
  const out = new Uint8Array(dataSize);
  let written = 0;
  let cur = offset;
  while (written < dataSize) {
    const pageSize = hexToUint32(asciiText(bytes, cur + 11, cur + 19));
    const next = hexToUint32(asciiText(bytes, cur + 20, cur + 28));
    const take = Math.min(pageSize, dataSize - written);
    out.set(
      bytes.subarray(cur + BLOCK_HEADER_SIZE, cur + BLOCK_HEADER_SIZE + take),
      written
    );
    written += take;
    if (next !== V8_FF_SIGNATURE) {
      cur = next;
    } else {
      break;
    }
  }
  return out;
}

/** Декодирует имя элемента (UTF-16LE после служебного заголовка элемента). */
function decodeElementName(headerBody: Uint8Array): string {
  let name = "";
  for (let i = ELEM_HEADER_BEGIN_SIZE; i + 1 < headerBody.length; i += 2) {
    const code = headerBody[i] | (headerBody[i + 1] << 8);
    if (code === 0) break;
    name += String.fromCharCode(code);
  }
  return name;
}

/** Пытается распаковать данные raw-deflate; при неудаче возвращает как есть. */
function inflateOrRaw(bytes: Uint8Array): Uint8Array {
  try {
    return inflateRaw(bytes);
  } catch {
    return bytes;
  }
}

function parseContainer(
  bytes: Uint8Array,
  offset: number,
  prefix: string,
  entries: ArchiveEntry[],
  files: Map<string, Uint8Array>,
  nodes: V8Node[],
  nodeByKey: Map<string, V8Node>
): void {
  const addrBlock = readBlockData(bytes, offset + FILE_HEADER_SIZE);
  const count = Math.floor(addrBlock.length / ELEM_ADDR_SIZE);

  for (let i = 0; i < count; i++) {
    const base = i * ELEM_ADDR_SIZE;
    const headerAddr = readUint32(addrBlock, base);
    const dataAddr = readUint32(addrBlock, base + 4);
    const signature = readUint32(addrBlock, base + 8);
    if (signature !== V8_FF_SIGNATURE) break;

    const headerBody = readBlockData(bytes, headerAddr);
    const name = decodeElementName(headerBody) || `element-${i}`;
    const dataBlock = readBlockData(bytes, dataAddr);
    const data = inflateOrRaw(dataBlock);
    const path = prefix ? `${prefix}/${name}` : name;

    if (isBlockHeader(data, FILE_HEADER_SIZE)) {
      const children: V8Node[] = [];
      const node: V8Node = {
        name,
        headerBody,
        content: data,
        children,
        isDirectory: true,
        rawKey: path,
      };
      nodes.push(node);
      nodeByKey.set(path, node);
      entries.push({ path, isDirectory: true });
      parseContainer(data, 0, path, entries, files, children, nodeByKey);
    } else {
      const node: V8Node = {
        name,
        headerBody,
        content: data,
        children: [],
        isDirectory: false,
        rawKey: path,
      };
      nodes.push(node);
      nodeByKey.set(path, node);
      entries.push({ path, isDirectory: false });
      files.set(path, data);
    }
  }
}

/**
 * Пытается разобрать буфер как бинарный контейнер 1С (v8unpack). Возвращает
 * null, если структура не похожа на контейнер 1С.
 */
export function tryParseV8Container(
  bytes: Uint8Array
): ParsedV8Container | null {
  if (bytes.length < FILE_HEADER_SIZE + BLOCK_HEADER_SIZE) return null;
  if (!isBlockHeader(bytes, FILE_HEADER_SIZE)) return null;

  const entries: ArchiveEntry[] = [];
  const files = new Map<string, Uint8Array>();
  const nodes: V8Node[] = [];
  const nodeByKey = new Map<string, V8Node>();
  parseContainer(bytes, 0, "", entries, files, nodes, nodeByKey);

  if (entries.length === 0) return null;
  return {
    entries,
    files,
    fileHeader: bytes.slice(0, FILE_HEADER_SIZE),
    nodes,
    nodeByKey,
  };
}

export function looksLikeV8Container(bytes: Uint8Array): boolean {
  return (
    bytes.length >= FILE_HEADER_SIZE + BLOCK_HEADER_SIZE &&
    isBlockHeader(bytes, FILE_HEADER_SIZE)
  );
}
