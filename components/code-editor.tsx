"use client";

import { useRef } from "react";
import hljs from "highlight.js/lib/core";
import onedc from "highlight.js/lib/languages/1c";

hljs.registerLanguage("1c", onedc);

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Подсвечивать ли синтаксис (язык 1С). Если false — обычный текст. */
  highlight?: boolean;
  label?: string;
}

/**
 * Редактор кода с живой подсветкой синтаксиса.
 *
 * Реализация: поверх подсвеченного через highlight.js слоя (<pre>) накладывается
 * «прозрачный» <textarea> (текст прозрачный, но виден курсор и выделение).
 * Слои имеют одинаковый шрифт, отступы и перенос строк, а прокрутка
 * синхронизируется по событию onScroll. Это сохраняет подсветку во время
 * редактирования и не сжимает область ввода.
 */
export function CodeEditor({
  value,
  onChange,
  onKeyDown,
  highlight = true,
  label,
}: CodeEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const html = highlight
    ? hljs.highlight(value, { language: "1c", ignoreIllegals: true }).value
    : "";

  function syncScroll() {
    const pre = preRef.current;
    const ta = textareaRef.current;
    if (pre && ta) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  }

  return (
    <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-background font-mono text-[13px] leading-relaxed">
      {/* Подсвеченный слой (только для отображения) */}
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 m-0 select-none overflow-auto whitespace-pre-wrap break-words p-4 text-foreground [scrollbar-gutter:stable]"
      >
        {highlight ? (
          <span
            className="block"
            dangerouslySetInnerHTML={{ __html: `${html}\n` }}
          />
        ) : (
          value
        )}
      </pre>

      {/* Прозрачный слой ввода (текст невидим, но курсор и выделение видны) */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        data-testid="code-editor"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={label}
        className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-4 text-transparent caret-primary selection:bg-primary/25 outline-none [scrollbar-gutter:stable]"
      />
    </div>
  );
}