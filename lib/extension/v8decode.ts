import type { ArchiveEntry } from "./extract";

/**
 * Декодер нативного бинарного контейнера 1С (.cfe) до читаемого дерева.
 *
 * Контейнер хранит элементы под именами-GUID, но имена папок и модулей,
 * которые видит пользователь в 1С, находятся внутри содержимого каждого
 * элемента (скобкофайл `{...}`). Этот модуль разбирает скобкофайлы и строит
 * дерево с читаемыми названиями (имя конфигурации, типы метаданных, имена
 * объектов, формы, модули) по логике v8unpack, сохраняя привязку к исходным
 * данным элементов, чтобы содержимое по-прежнему можно было открыть.
 */

export interface DecodedV8Tree {
  /** Читаемое имя конфигурации/расширения. */
  name: string;
  entries: ArchiveEntry[];
  files: Map<string, Uint8Array>;
  /**
   * Карта «читаемый путь → цель правки» для записи изменений обратно в
   * бинарный контейнер.
   */
  edits: Map<string, V8EditTarget>;
}

export type V8EditKind = "element" | "formModule";

export interface V8EditTarget {
  /** Исходный ключ элемента в бинарном контейнере. */
  rawKey: string;
  /**
   * element — элемент целиком (модуль/скобкофайл/файл), formModule — модуль,
   * встроенный в скобкофайл формы (по индексу `[0][2]`).
   */
  kind: V8EditKind;
}

interface V8TypeDef {
  /** Имя папки типа метаданных (как в 1С). */
  folder: string;
  /** Путь к заголовку объекта для извлечения имени. */
  header?: number[];
  /** Тип «Форма» (особое извлечение имени). */
  form?: boolean;
}

const V8_TYPES: Record<string, V8TypeDef> = {
  "0fe48980-252d-11d6-a3c7-0050bae0a776": {
    folder: "CommonModules",
    header: [0, 1, 1],
  },
  "7dcd43d9-aca5-4926-b549-1842e6a4e8cf": {
    folder: "CommonPictures",
    header: [0, 1, 1],
  },
  "09736b02-9cac-4e3f-b4f7-d3e9576ab948": {
    folder: "Roles",
    header: [0, 1, 1],
  },
  "bf845118-327b-4682-b5c6-285d2a0eb296": {
    folder: "DataProcessors",
    header: [0, 1, 3, 1],
  },
  "cf4abea6-37b2-11d4-940f-008048da11f9": {
    folder: "Catalogs",
    header: [0, 1, 9, 1],
  },
  "f6a80749-5ad7-400b-8519-39dc5dff2542": {
    folder: "Enums",
    header: [0, 1, 5, 1],
  },
  "c045099e-13b9-4fb6-9d50-fca00202971e": {
    folder: "DefinedTypes",
    header: [0, 1, 3],
  },
  "9cd510ce-abfc-11d4-9434-004095e12fc7": {
    folder: "Languages",
    header: [0, 1, 1],
  },
  "58848766-36ea-4076-8800-e91eb49590d7": {
    folder: "StyleItems",
    header: [0, 1, 3],
  },
  "d5b0e5ed-256d-401c-9c36-f630cafd8a62": { folder: "Forms", form: true },
};

/** Альтернативные пути к заголовку для типов, не описанных явно. */
const FALLBACK_HEADERS: number[][] = [
  [0, 1, 1],
  [0, 1, 3, 1],
  [0, 1, 5, 1],
  [0, 1, 9, 1],
];

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Модули самой конфигурации/расширения (модуль приложения и др.).
 *
 * В бинарном контейнере 1С модули конфигурации хранятся как вложенные элементы
 * объекта конфигурации `<uuid-объекта-конфигурации>.<индекс>`, где индекс задан
 * схемой объекта (по логике v8unpack: app=6, con=5, seance=7).
 */
const CONFIG_MODULES: Array<{ index: number; name: string }> = [
  { index: 5, name: "Модуль внешнего соединения" },
  { index: 6, name: "Модуль приложения" },
  { index: 7, name: "Модуль сеанса" },
];

function strDecode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^"|"$/g, "");
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/\r/g, "");
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Парсер скобкофайла (аналог JsonContainerDecoder в v8unpack).
// ---------------------------------------------------------------------------

const MODE_PARAM = 1;
const MODE_BEGIN_STR = 2;
const MODE_MULTI = 6;
const MODE_END_STR = 3;
const MODE_B64 = 4;
const MODE_TEXT = 5;

export function parseBraceText(text: string): unknown {
  let mode = MODE_PARAM;
  let data: unknown[] = [];
  let currentObject: unknown[] | null = null;
  let currentValue: string | null = null;
  let previousChar: string | null = null;
  const path: unknown[][] = [];

  function endValue(): void {
    mode = MODE_PARAM;
    if (previousChar !== "}" && currentObject) {
      currentObject.push(currentValue as string);
      currentValue = "";
    }
    previousChar = ",";
  }

  function endCurrentObject(): void {
    endValue();
    if (path.length) path.pop();
    currentObject = path.length ? path[path.length - 1] : null;
    currentValue = null;
    previousChar = "}";
  }

  function addToCurrentValue(value: string): void {
    currentValue = (currentValue || "") + value;
    previousChar = value;
  }

  function decodeObject(line: string): void {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (mode === MODE_PARAM) {
        if (ch === ",") endValue();
        else if (ch === "}") endCurrentObject();
        else if (ch === '"') {
          if (line.endsWith(',"\n') && i === line.length - 2) {
            mode = MODE_MULTI;
            addToCurrentValue(line.slice(i));
            break;
          }
          mode = MODE_BEGIN_STR;
          addToCurrentValue(ch);
        } else if (ch === "\n") break;
        else addToCurrentValue(ch);
      } else if (mode === MODE_BEGIN_STR) {
        if (ch === '"') {
          mode = MODE_END_STR;
          addToCurrentValue(ch);
        } else addToCurrentValue(ch);
      } else if (mode === MODE_END_STR) {
        if (ch === '"') {
          mode = MODE_BEGIN_STR;
          addToCurrentValue(ch);
        } else if (ch === ",") endValue();
        else if (ch === "}") endCurrentObject();
        else addToCurrentValue(ch);
      }
    }
  }

  function decodeB64Line(line: string, startPos: number): boolean {
    const endPos = line.indexOf("}");
    if (endPos >= 0) {
      currentValue += line.slice(startPos, endPos);
      if (startPos === 1) currentValue = "#" + currentValue;
      endCurrentObject();
      decodeObject(line.slice(endPos + 1));
      return true;
    }
    currentValue += line.slice(startPos, -1);
    return false;
  }

  function decodeLine(line: string): void {
    if (mode === MODE_B64) {
      if (line !== "\n") decodeB64Line(line, 0);
      return;
    }
    if (mode === MODE_MULTI) {
      const quotes = (line.match(/"/g) || []).length;
      if (quotes % 2 !== 0) {
        mode = MODE_BEGIN_STR;
        decodeObject(line);
      } else {
        currentValue += line;
        return;
      }
      return;
    }
    // Строковый литерал, начатый на предыдущей строке, продолжается на этой.
    // Без этого длинные многострочные значения (например, код модуля формы)
    // обрезаются после первой строки.
    if (mode === MODE_BEGIN_STR || mode === MODE_END_STR) {
      decodeObject(line);
      return;
    }
    if (mode === MODE_PARAM) {
      if (line[0] === "{") {
        if (currentObject === null) {
          currentObject = [];
          data.push(currentObject);
          path.push(currentObject);
        } else {
          currentObject.push([]);
          currentObject = currentObject[currentObject.length - 1] as unknown[];
          path.push(currentObject);
        }
        currentValue = "";
        if (line.startsWith("{#base64")) {
          mode = MODE_B64;
          decodeB64Line(line, 1);
        } else decodeObject(line.slice(1));
      } else if (line[0] === "}") {
        endCurrentObject();
        decodeObject(line.slice(1));
      } else if (
        line[0] === "\n" &&
        currentValue &&
        currentValue.length === 64
      ) {
        mode = MODE_B64;
        return;
      } else if (!data.length && currentValue === null) {
        if (line === "\n") return;
        data = line as unknown as unknown[];
        mode = MODE_TEXT;
        return;
      } else if (
        data.length === 1 &&
        (data[0] as unknown[]).length === 0 &&
        currentValue === ""
      ) {
        data = ("{\n" + line) as unknown as unknown[];
        mode = MODE_TEXT;
        return;
      } else if (currentValue && currentValue.length === 64) {
        mode = MODE_B64;
        decodeB64Line(line, 0);
      }
      return;
    }
  }

  const parts = text.split("\n");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i] + (i < parts.length - 1 ? "\n" : "");
    decodeLine(line);
  }
  return data;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Сериализатор скобкофайла (обратная операция к parseBraceText).
// ---------------------------------------------------------------------------

function encodeBraceObject(data: unknown, first: boolean): string {
  let raw = first ? "{" : "\n{";
  const arr = data as unknown[];
  for (let i = 0; i < arr.length; i++) {
    const elem = arr[i];
    if (Array.isArray(elem)) {
      raw += encodeBraceObject(elem, false);
      if (i === arr.length - 1) raw += "\n";
    } else if (typeof elem === "string") {
      raw += elem;
    } else if (elem == null) {
      continue;
    } else {
      raw += String(elem);
    }
    if (i !== arr.length - 1) raw += ",";
  }
  raw += "}";
  return raw;
}

/** Сериализует распарсенный скобкофайл обратно в текст (аналог v8unpack). */
export function encodeBraceText(data: unknown): string {
  const parts: string[] = [];
  for (const elem of data as unknown[]) {
    if (parts.length) parts.push(",\n");
    parts.push(encodeBraceObject(elem, true));
  }
  return parts.join("");
}

/**
 * Кодирует код модуля в строковое значение скобкофайла: оборачивает в кавычки
 * и удваивает внутренние кавычки (формат хранения строк в скобкофайле).
 */
export function encodeModuleString(code: string): string {
  return `"${code.replace(/"/g, '""')}"`;
}

/**
 * Пытается записать изменённый код модуля формы обратно в скобкофайл формы.
 *
 * Скобкофайлы форм могут содержать данные, которые сериализатор
 * (encodeBraceText) не может воспроизвести байт-в-байт (например, base64-блоки
 * `{#base64...}` — «сложный формат»). Поэтому здесь выполняется точечная
 * текстовая замена: строка кода модуля (элемент `[0][2]`) находится в исходном
 * тексте как непрерывная уникальная подстрока и заменяется только она, а все
 * остальные байты файла сохраняются без изменений. Это гарантирует отсутствие
 * потери данных.
 *
 * Перед записью выполняется проверка: строка кода должна встречаться в тексте
 * ровно один раз, а после замены пере-разбор скобкофайла должен возвращать
 * ожидаемое значение. При нарушении любого условия функция возвращает null
 * (модуль помечается нередактируемым, правка отменяется).
 */
export function rewriteFormModule(
  formText: string,
  newCode: string
): Uint8Array | null {
  let parsed: unknown;
  try {
    parsed = parseBraceText(formText);
  } catch {
    return null;
  }
  if (!isArray(parsed) || !isArray(parsed[0])) return null;
  const form0 = parsed[0] as unknown[];
  if (
    form0.length <= 2 ||
    typeof form0[0] !== "string" ||
    !["2", "3", "4"].includes(form0[0]) ||
    typeof form0[2] !== "string"
  ) {
    return null;
  }

  const oldCode = form0[2];

  // Находим непрерывный уникальный фрагмент исходного текста, соответствующий
  // строке кода модуля (включая обрамляющие кавычки).
  let start = -1;
  let occurrences = 0;
  let from = 0;
  while (from <= formText.length - oldCode.length) {
    const i = formText.indexOf(oldCode, from);
    if (i === -1) break;
    occurrences++;
    start = i;
    from = i + oldCode.length;
  }
  if (occurrences !== 1 || start < 0) return null;

  // Приводим переносы строк нового кода к стилю файла (CRLF, если файл CRLF).
  let newModule = newCode.replace(/\r\n/g, "\n");
  if (formText.includes("\r\n")) {
    newModule = newModule.replace(/\n/g, "\r\n");
  }

  const encoded =
    formText.slice(0, start) +
    encodeModuleString(newModule) +
    formText.slice(start + oldCode.length);

  // Проверка обратимости: строка кода модуля должна пере-распарситься в
  // ожидаемое значение, остальные данные при точечной замене не затрагиваются.
  let reparse: unknown;
  try {
    reparse = parseBraceText(encoded);
  } catch {
    return null;
  }
  if (!isArray(reparse) || !isArray(reparse[0])) return null;
  if ((reparse[0] as unknown[])[2] !== encodeModuleString(newModule)) {
    return null;
  }
  return textToBytes(encoded);
}

/** Возвращает имя объекта по типу метаданных. */
function getObjectName(
  type: V8TypeDef | undefined,
  brace: unknown
): string | null {
  if (!brace || !isArray(brace) || !isArray(brace[0])) return null;

  let headers: number[][];
  if (type?.form) {
    const obj = brace as unknown[];
    const root = obj[0] as unknown[];
    if (!isArray(root[1])) return null;
    const ver = root[1][0];
    const formRoot = ver === "0" ? root[1] : (root[1][1] as unknown[]);
    if (!isArray(formRoot) || !isArray(formRoot[1]) || !isArray(formRoot[1][1]))
      return null;
    const h = formRoot[1][1] as unknown[];
    const name = strDecode(h[2]);
    return name && !GUID_RE.test(name) ? name : null;
  }

  if (type?.header) headers = [type.header];
  else headers = FALLBACK_HEADERS;

  for (const header of headers) {
    let node: unknown = brace;
    let ok = true;
    for (const p of header) {
      if (!isArray(node)) {
        ok = false;
        break;
      }
      node = node[p];
    }
    if (!ok) continue;
    if (!isArray(node)) continue;
    const name = strDecode(node[2]);
    if (name && !GUID_RE.test(name)) return name;
  }
  return null;
}

/**
 * Собирает из скобкофайла все вхождения типов метаданных вида
 * `[тип_uuid, количество, объект1, объект2, ...]` с количеством > 0.
 */
function collectIncludes(
  brace: unknown,
  out: Array<[V8TypeDef, string[]]>
): void {
  if (!isArray(brace)) return;
  for (let i = 0; i < brace.length; i++) {
    const el = brace[i];
    if (isArray(el) && el.length >= 2 && typeof el[0] === "string") {
      const def = V8_TYPES[strDecode(el[0]).toLowerCase()];
      if (def) {
        const count = parseInt(el[1] as string, 10);
        if (count > 0 && el.length >= 2 + count) {
          const objs: string[] = [];
          for (let j = 0; j < count; j++) {
            const o = strDecode(el[2 + j]);
            if (GUID_RE.test(o)) objs.push(o);
          }
          if (objs.length) out.push([def, objs]);
        }
      }
    }
    if (isArray(el)) collectIncludes(el, out);
  }
}

// ---------------------------------------------------------------------------
// Построение читаемого дерева.
// ---------------------------------------------------------------------------

interface BuildNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: BuildNode[];
}

/** Имя конфигурации/расширения из структуры корневого объекта. */
function getConfigName(configObj: unknown[]): string {
  const group = configObj[3];
  if (!isArray(group)) return "";
  const data = group[1];
  if (!isArray(data)) return "";
  const h = data[1];
  if (!isArray(h)) return "";
  const h2 = h[1];
  if (!isArray(h2)) return "";
  const h3 = h2[1];
  if (!isArray(h3)) return "";
  const name = strDecode(h3[2]);
  return name && !GUID_RE.test(name) ? name : "";
}

/**
 * Возвращает UUID объекта конфигурации — основу имён элементов контейнера, в
 * которых хранятся модули конфигурации (модуль приложения, сеанса и т.д.).
 * Путь соответствует логике v8unpack: `header[0][3][1][1][1][1][1][2]`.
 */
function getConfigObjectUuid(configObj: unknown[]): string | null {
  const block = configObj[3];
  if (!isArray(block) || !isArray(block[1])) return null;
  const b1 = block[1];
  if (!isArray(b1[1])) return null;
  const bb = b1[1];
  if (!isArray(bb[1])) return null;
  const inner = bb[1];
  if (!isArray(inner[1])) return null;
  const inner2 = inner[1];
  if (!isArray(inner2[1])) return null;
  const selfRef = inner2[1];
  if (!isArray(selfRef) || typeof selfRef[2] !== "string") return null;
  const uuid = strDecode(selfRef[2]);
  return GUID_RE.test(uuid) ? uuid : null;
}

function makeDir(name: string, parentPath: string): BuildNode {
  return {
    name,
    path: parentPath ? `${parentPath}/${name}` : name,
    isDirectory: true,
    children: [],
  };
}

function makeFile(name: string, parentPath: string): BuildNode {
  return {
    name,
    path: parentPath ? `${parentPath}/${name}` : name,
    isDirectory: false,
    children: [],
  };
}

function flatten(
  nodes: BuildNode[],
  files: Map<string, Uint8Array>
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const walk = (list: BuildNode[]) => {
    for (const n of list) {
      if (n.isDirectory) {
        entries.push({ path: n.path, isDirectory: true });
        walk(n.children);
      } else {
        entries.push({ path: n.path, isDirectory: false });
        if (!files.has(n.path)) files.set(n.path, textToBytes(n.name));
      }
    }
  };
  walk(nodes);
  return entries;
}

/**
 * Декодирует элементы бинарного контейнера 1С в читаемое дерево.
 *
 * @param elements Карта «имя элемента → распакованные данные» (как в
 *   v8container.ts). Для вложенных контейнеров используются пути вида
 *   `<uuid>.0/text`.
 */
export function decodeV8Extension(
  elements: Map<string, Uint8Array>
): DecodedV8Tree | null {
  const textOf = (key: string): string | null => {
    const data = elements.get(key);
    return data ? bytesToText(data) : null;
  };

  const configinfo = textOf("configinfo");
  if (!configinfo) return null;

  let configinfoParsed: unknown;
  try {
    configinfoParsed = parseBraceText(configinfo);
  } catch {
    return null;
  }
  if (!isArray(configinfoParsed)) return null;

  const fileUuidRaw = (configinfoParsed[1] as unknown[])?.[1];
  const fileUuid =
    typeof fileUuidRaw === "string" ? strDecode(fileUuidRaw) : "";
  if (!GUID_RE.test(fileUuid)) return null;

  const rootText = textOf(fileUuid);
  if (!rootText) return null;

  let root: unknown;
  try {
    root = parseBraceText(rootText);
  } catch {
    return null;
  }
  if (!isArray(root) || !isArray(root[0])) return null;

  const configObj = root[0] as unknown[];
  const configName = getConfigName(configObj) || "Расширение";

  const parsedCache = new Map<string, unknown>();
  const parseObj = (uuid: string): unknown => {
    if (parsedCache.has(uuid)) return parsedCache.get(uuid);
    const text = textOf(uuid);
    if (!text) {
      parsedCache.set(uuid, null);
      return null;
    }
    try {
      const parsed = parseBraceText(text);
      parsedCache.set(uuid, parsed);
      return parsed;
    } catch {
      parsedCache.set(uuid, null);
      return null;
    }
  };

  /**
   * Возвращает целевой элемент модуля для записи правок. Для обычных объектов
   * модуль — это отдельный элемент контейнера (`<uuid>.0/text` или `<uuid>.0`),
   * для форм — скобкофайл формы, в который встроен код модуля (`[0][2]`).
   */
  const moduleTarget = (
    uuid: string,
    def?: V8TypeDef
  ): { target: V8EditTarget; bytes: Uint8Array } | null => {
    if (def?.form) {
      const data = elements.get(`${uuid}.0`);
      if (!data) return null;
      let form: unknown;
      try {
        form = parseBraceText(bytesToText(data));
      } catch {
        return null;
      }
      if (!isArray(form) || !isArray(form[0])) return null;
      const form0 = form[0] as unknown[];
      if (form0.length <= 2) return null;
      if (typeof form0[0] !== "string" || !["2", "3", "4"].includes(form0[0]))
        return null;
      const code = form0[2];
      if (typeof code !== "string") return null;
      return {
        target: { rawKey: `${uuid}.0`, kind: "formModule" },
        bytes: textToBytes(code.replace(/^"|"$/g, "").replace(/""/g, '"')),
      };
    }
    const rawKey = elements.has(`${uuid}.0/text`)
      ? `${uuid}.0/text`
      : `${uuid}.0`;
    const bytes = elements.get(rawKey);
    if (!bytes) return null;
    return { target: { rawKey, kind: "element" }, bytes };
  };

  const files = new Map<string, Uint8Array>();
  const edits = new Map<string, V8EditTarget>();
  const roots: BuildNode[] = [];
  const rootDir = makeDir(configName, "");
  roots.push(rootDir);
  files.set(configName, textToBytes(rootText));

  const addObject = (parent: BuildNode, def: V8TypeDef, uuid: string): void => {
    const brace = parseObj(uuid);
    const name = brace ? getObjectName(def, brace) : null;
    const nodeName = name || uuid.slice(0, 8);

    const nested: Array<[V8TypeDef, string[]]> = [];
    if (brace) collectIncludes(brace, nested);

    const md = moduleTarget(uuid, def);
    const hasModule = md !== null;

    // Формы всегда являются каталогами (метаданные + модуль + возможные
    // вложенные объекты), даже если у них нет отдельного модуля.
    // Листовой объект без модуля и вложенных объектов — обычный файл.
    if (!hasModule && nested.length === 0 && !def?.form) {
      const fileNode = makeFile(nodeName, parent.path);
      parent.children.push(fileNode);
      if (brace) {
        files.set(
          fileNode.path,
          textToBytes(bytesToText(elements.get(uuid) as Uint8Array))
        );
        edits.set(fileNode.path, { rawKey: uuid, kind: "element" });
      }
      return;
    }

    const dir = makeDir(nodeName, parent.path);
    parent.children.push(dir);

    // Метаданные самого объекта (скобкофайл) — читаемо.
    const meta = makeFile(`${nodeName}.txt`, dir.path);
    dir.children.push(meta);
    const raw = elements.get(uuid);
    if (raw) {
      files.set(meta.path, raw);
      edits.set(meta.path, { rawKey: uuid, kind: "element" });
    }

    if (hasModule && md) {
      const mod = makeFile("Module.bsl", dir.path);
      dir.children.push(mod);
      files.set(mod.path, md.bytes);
      edits.set(mod.path, md.target);
    }

    for (const [nestedDef, objs] of nested) {
      const typeDir = makeDir(nestedDef.folder, dir.path);
      dir.children.push(typeDir);
      for (const obj of objs) {
        addObject(typeDir, nestedDef, obj);
      }
    }
  };

  const includes: Array<[V8TypeDef, string[]]> = [];
  collectIncludes(configObj, includes);
  const seen = new Set<string>();
  for (const [def, objs] of includes) {
    const typeDir = makeDir(def.folder, rootDir.path);
    rootDir.children.push(typeDir);
    for (const obj of objs) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      addObject(typeDir, def, obj);
    }
  }

  // Модули самой конфигурации (модуль приложения и др.). Они не входят ни в одну
  // группу метаданных, а хранятся как вложенные элементы объекта конфигурации,
  // поэтому добавляются отдельно, как при распаковке средствами 1С.
  const configUuid = getConfigObjectUuid(configObj);
  if (configUuid) {
    for (const mod of CONFIG_MODULES) {
      const key = `${configUuid}.${mod.index}/text`;
      const bytes = elements.get(key);
      if (!bytes) continue;
      const modNode = makeFile(`${mod.name}.bsl`, rootDir.path);
      rootDir.children.push(modNode);
      files.set(modNode.path, bytes);
      edits.set(modNode.path, { rawKey: key, kind: "element" });
    }
  }

  // Сортируем: папки впереди, файлы и объекты в алфавитном порядке.
  const sortEntries = (list: BuildNode[]) => {
    list.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, "ru");
    });
    list.forEach((n) => n.isDirectory && sortEntries(n.children));
  };
  sortEntries(roots);

  const entries = flatten(roots, files);

  return { name: configName, entries, files, edits };
}
