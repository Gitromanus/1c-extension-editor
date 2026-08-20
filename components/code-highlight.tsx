"use client";

import { memo } from "react";
import hljs from "highlight.js/lib/core";
import onedc from "highlight.js/lib/languages/1c";

hljs.registerLanguage("1c", onedc);

interface CodeHighlightProps {
  code: string;
}

/**
 * Подсветка синтаксиса кода 1С через библиотеку highlight.js
 * (встроенный язык "1C:Enterprise"). Только чтение; редактирование
 * выполняется обычным textarea.
 */
export const CodeHighlight = memo(function CodeHighlight({
  code,
}: CodeHighlightProps) {
  const { value } = hljs.highlight(code, {
    language: "1c",
    ignoreIllegals: true,
  });
  return (
    <code className="hljs block" dangerouslySetInnerHTML={{ __html: value }} />
  );
});
