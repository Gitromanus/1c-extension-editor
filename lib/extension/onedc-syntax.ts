/**
 * Вспомогательные функции для определения файлов-модулей языка 1С.
 * Подсветка синтаксиса выполняется библиотекой highlight.js (см.
 * components/code-highlight.tsx).
 */

const ONE_C_EXTENSIONS = new Set(["bsl", "1c", "cls", "form"]);

/** Является ли файл модулем на языке 1С (для включения подсветки). */
export function isOneCFile(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return base === "module";
  return ONE_C_EXTENSIONS.has(base.slice(dot + 1));
}
