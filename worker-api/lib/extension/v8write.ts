import { deflateRaw } from "pako";

/**
 * Сериализатор нативного бинарного контейнера 1С (.cf/.cfe) по логике v8unpack.
 *
 * Парсер (v8container.ts) восстанавливает из контейнера дерево элементов. Этот
 * модуль выполняет обратную операцию: упаковывает дерево элементов обратно в
 * бинарный контейнер, корректно пересчитывая адреса блоков. Байты заголовков
 * элементов и заголовок файла сохраняются как есть, что гарантирует потерю
 * данных только там, где пользователь сознательно внёс правку.
 */

export const V8_FF_SIGNATURE = 0x7fffffff;
export const V8_FILE_HEADER_SIZE = 16;
export const V8_BLOCK_HEADER_SIZE = 31;
export const V8_INDEX_BLOCK_SIZE = 0x200;
export const V8_ELEM_ADDR_SIZE = 12;

/** Узел дерева элементов контейнера (файл или вложенный контейнер). */
export interface V8Node {
  /** Исходное имя элемента контейнера (обычно GUID). */
  name: string;
  /** Содержимое документа атрибутов элемента (заголовок + имя в UTF-16LE). */
  headerBody: Uint8Array;
  /**
   * Распакованные данные элемента. Для файла — сам файл, для каталога —
   * сериализованный вложенный контейнер (включая его 16-байтовый заголовок).
   */
  content: Uint8Array;
  /** Вложенные элементы (для каталогов). */
  children: V8Node[];
  isDirectory: boolean;
  /** Ключ пути элемента в исходном контейнере (например `X.0/text`). */
  rawKey: string;
}

/** Заголовок бинарного контейнера. */
export interface V8ContainerHeader {
  /** Заголовок файла контейнера. */
  fileHeader: Uint8Array;
  /** Корневые элементы контейнера. */
  children: V8Node[];
}

function int2hex(value: number, width = 8): string {
  return value.toString(16).padStart(width, "0").toUpperCase();
}

function buildBlockHeader(
  docSize: number,
  blockSize: number,
  nextBlockOffset: number
): Uint8Array {
  const s =
    `\r\n${int2hex(docSize)} ${int2hex(blockSize)} ` +
    `${int2hex(nextBlockOffset)} \r\n`;
  const header = new Uint8Array(V8_BLOCK_HEADER_SIZE);
  for (let i = 0; i < s.length; i++) {
    header[i] = s.charCodeAt(i);
  }
  return header;
}

function deflate(bytes: Uint8Array): Uint8Array {
  return deflateRaw(bytes);
}

/**
 * Данные элемента для записи в блок данных.
 *
 * По логике v8unpack сжимается только корневой контейнер (`nested=False`),
 * а данные элементов вложенных контейнеров хранятся сырыми (`nested=True`).
 * Это важно для совместимости: распаковщик v8unpack декомпрессирует только
 * элементы корневого контейнера.
 */
function elementPayload(node: V8Node, deflateData: boolean): Uint8Array {
  if (node.isDirectory) {
    const childHeader = node.content.subarray(0, V8_FILE_HEADER_SIZE);
    const childContainer = serializeV8Container(
      { fileHeader: childHeader, children: node.children },
      false
    );
    return deflateData ? deflate(childContainer) : childContainer;
  }
  return deflateData ? deflate(node.content) : node.content;
}

/**
 * Упаковывает дерево элементов обратно в бинарный контейнер 1С.
 * Структура: заголовок файла, индексный блок (TOC) и последовательные блоки
 * атрибутов и данных каждого элемента. Адреса пересчитываются заново.
 */
export function serializeV8Container(
  container: V8ContainerHeader,
  deflateData = true
): Uint8Array {
  const { fileHeader, children } = container;
  if (fileHeader.length < V8_FILE_HEADER_SIZE) {
    throw new Error("Некорректный заголовок контейнера 1С");
  }

  const tocLen = children.length * V8_ELEM_ADDR_SIZE;
  const indexBlocks = Math.max(1, Math.ceil(tocLen / V8_INDEX_BLOCK_SIZE));
  const indexSize = indexBlocks * (V8_BLOCK_HEADER_SIZE + V8_INDEX_BLOCK_SIZE);
  const elementsStart = V8_FILE_HEADER_SIZE + indexSize;

  // Считаем размер каждого элемента и запоминаем смещения атрибутов/данных.
  const payloads: Uint8Array[] = [];
  let cursor = elementsStart;
  const toc: Array<[number, number]> = [];
  for (const node of children) {
    const payload = elementPayload(node, deflateData);
    payloads.push(payload);
    const attrOffset = cursor;
    const dataOffset =
      attrOffset + V8_BLOCK_HEADER_SIZE + node.headerBody.length;
    toc.push([attrOffset, dataOffset]);
    cursor = dataOffset + V8_BLOCK_HEADER_SIZE + payload.length;
  }

  const totalSize = cursor;
  const out = new Uint8Array(totalSize);
  out.set(fileHeader, 0);

  // Индексный блок (TOC): первая страница хранит реальный размер, следующие —
  // с doc_size=0, адрес следующей страницы указывает вперёд.
  const tocBytes = new Uint8Array(tocLen);
  for (let i = 0; i < children.length; i++) {
    const [attr, data] = toc[i];
    const base = i * V8_ELEM_ADDR_SIZE;
    tocBytes[base] = attr & 0xff;
    tocBytes[base + 1] = (attr >> 8) & 0xff;
    tocBytes[base + 2] = (attr >> 16) & 0xff;
    tocBytes[base + 3] = (attr >>> 24) & 0xff;
    tocBytes[base + 4] = data & 0xff;
    tocBytes[base + 5] = (data >> 8) & 0xff;
    tocBytes[base + 6] = (data >> 16) & 0xff;
    tocBytes[base + 7] = (data >>> 24) & 0xff;
    tocBytes[base + 8] = V8_FF_SIGNATURE & 0xff;
    tocBytes[base + 9] = (V8_FF_SIGNATURE >> 8) & 0xff;
    tocBytes[base + 10] = (V8_FF_SIGNATURE >> 16) & 0xff;
    tocBytes[base + 11] = (V8_FF_SIGNATURE >>> 24) & 0xff;
  }

  for (let i = 0; i < indexBlocks; i++) {
    const pageStart =
      V8_FILE_HEADER_SIZE + i * (V8_BLOCK_HEADER_SIZE + V8_INDEX_BLOCK_SIZE);
    const from = i * V8_INDEX_BLOCK_SIZE;
    const isFirst = i === 0;
    const isLast = i === indexBlocks - 1;
    const nextBlock = isLast
      ? V8_FF_SIGNATURE
      : pageStart + V8_BLOCK_HEADER_SIZE + V8_INDEX_BLOCK_SIZE;
    const pageData = tocBytes.subarray(
      from,
      Math.min(from + V8_INDEX_BLOCK_SIZE, tocBytes.length)
    );
    const header = buildBlockHeader(
      isFirst ? tocLen : 0,
      V8_INDEX_BLOCK_SIZE,
      nextBlock
    );
    out.set(header, pageStart);
    out.set(pageData, pageStart + V8_BLOCK_HEADER_SIZE);
  }

  // Элементы: блок атрибутов и блок данных.
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const [attrOffset, dataOffset] = toc[i];
    const payload = payloads[i];

    out.set(
      buildBlockHeader(
        node.headerBody.length,
        node.headerBody.length,
        V8_FF_SIGNATURE
      ),
      attrOffset
    );
    out.set(node.headerBody, attrOffset + V8_BLOCK_HEADER_SIZE);

    out.set(
      buildBlockHeader(payload.length, payload.length, V8_FF_SIGNATURE),
      dataOffset
    );
    out.set(payload, dataOffset + V8_BLOCK_HEADER_SIZE);
  }

  return out;
}
