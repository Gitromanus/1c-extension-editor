import Link from "next/link";

const methods = [
  {
    name: "loadFile(file)",
    type: "async",
    desc: "Загрузить .cfe (объект File из браузера).",
  },
  {
    name: "getInfo()",
    type: "sync",
    desc: "{ name, fileCount, editable } или null, если файл не открыт.",
  },
  {
    name: "getTree()",
    type: "sync",
    desc: "Дерево файлов (папки/файлы) в машиночитаемом виде.",
  },
  {
    name: "getFiles()",
    type: "sync",
    desc: "Плоский список [{ path, isDirectory }].",
  },
  {
    name: "readFile(path)",
    type: "async",
    desc: "Текст файла; null, если бинарный/недоступный.",
  },
  {
    name: "canEdit(path)",
    type: "sync",
    desc: "Можно ли редактировать файл (true для .bsl).",
  },
  {
    name: "writeFile(path, text)",
    type: "sync",
    desc: "Сохранить изменённое содержимое файла.",
  },
  {
    name: "buildFile()",
    type: "async",
    desc: "Упаковать обратно; вернёт { blob, url, name }.",
  },
  {
    name: "saveAndDownload()",
    type: "async",
    desc: "Упаковать и скачать .cfe через браузер.",
  },
];

const selectors = [
  ['[data-testid="cfe-upload-input"]', "Поле загрузки .cfe"],
  ['[data-testid="tree-file"]', "Кнопки файлов в дереве (атрибуты data-path, data-bsl)"],
  ['[data-testid="code-editor"]', "Текстовое поле редактора"],
  ['[data-testid="download-cfe"]', "Кнопка «Скачать .cfe»"],
];

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-10">
      <div className="mb-8">
        <Link
          href="/"
          className="text-xs font-medium text-primary hover:underline"
        >
          ← На главную
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-bold">
          Инструкции для ИИ-агентов
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Сервис позволяет ИИ-агенту (или скрипту) программно открыть расширение
          1С (<span className="font-mono">.cfe</span>), изменить его модули и
          сохранить новый файл — прямо в браузере, без бэкенда.
          Обработка выполняется на клиенте; агенту нужен доступ к браузеру
          (Playwright / Puppeteer / computer-use).
        </p>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-lg font-semibold">
          Глобальный API: window.__oneCEditor__
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Объект доступен на всех страницах сайта. Вызывается через{" "}
          <span className="font-mono">page.evaluate()</span>.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Метод</th>
                <th className="px-4 py-2">Тип</th>
                <th className="px-4 py-2">Описание</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.name} className="border-t">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[13px]">
                    {m.name}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-primary">
                    {m.type}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {m.desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-lg font-semibold">
          Серверный API (Cloudflare Worker)
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Альтернатива без браузера: запросы по HTTP напрямую к Cloudflare Worker.
          Обработка выполняется на edge, локальный Node/PowerShell и base64 не нужны —
          файл передаётся через <span className="font-mono">curl -F "file=@input.cfe"</span>.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Эндпоинт</th>
                <th className="px-4 py-2">Формат</th>
                <th className="px-4 py-2">Назначение</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["POST /api/tree", "JSON", "Список файлов"],
                ["POST /api/read", "JSON", "Прочитать текст модуля"],
                ["POST /api/edit", "JSON", "Изменить модуль (возвращает file_base64)"],
                ["POST /api/edit-all", "JSON", "Добавить комментарий во все .bsl"],
                ["POST /api/tree-form", "multipart", "Список файлов (файл напрямую)"],
                ["POST /api/read-form", "multipart", "Прочитать текст модуля"],
                ["POST /api/edit-form", "multipart", "Изменить модуль → готовый .cfe"],
              ].map(([ep, fmt, desc]) => (
                <tr key={ep} className="border-t">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                    {ep}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-primary">{fmt}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed">{`# 1. Структура
curl -s -X POST https://<worker>/api/tree-form -F "file=@input.cfe" -o tree.json

# 2. Чтение модуля (путь кладём в module_path.txt, UTF-8)
curl -s -X POST https://<worker>/api/read-form \\
  -F "file=@input.cfe" -F "module_path=<module_path.txt" -o module.json

# 3. Правка и получение результата
curl -s -X POST https://<worker>/api/edit-form \\
  -F "file=@input.cfe" -F "module_path=<module_path.txt" -F "new_code=<new_code.txt" \\
  -o output.cfe`}</pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Документация — файл <span className="font-mono">worker-api/README.md</span>.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-lg font-semibold">Рабочий цикл агента</h2>
        <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Открой сайт (http://s96346ix.beget.tech/) и дождись window.__oneCEditor__.</li>
          <li>Загрузи расширение .cfe (loadFile или через поле ввода).</li>
          <li>Прочитай дерево и найди редактируемые модули (*.bsl).</li>
          <li>Для нужных модулей: прочитай текст, внеси изменения, запиши writeFile.</li>
          <li>Собери новый .cfe через buildFile() и сохрани файл.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-lg font-semibold">
          data-testid (резервный путь через DOM)
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Селектор</th>
                <th className="px-4 py-2">Назначение</th>
              </tr>
            </thead>
            <tbody>
              {selectors.map(([sel, desc]) => (
                <tr key={sel} className="border-t">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                    {sel}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-lg font-semibold">Пример скрипта</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Готовый пример агента на Playwright — в репозитории проекта:{" "}
          <span className="font-mono">examples/agent-playwright.mjs</span>.
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed">{`npm i -D playwright && npx playwright install chromium
SITE_URL=http://s96346ix.beget.tech/ node examples/agent-playwright.mjs input.cfe out.cfe`}</pre>
      </section>

      <p className="text-xs text-muted-foreground">
        Полная версия — файл <span className="font-mono">AGENT_USAGE.md</span> в
        репозитории{" "}
        <a
          href="https://github.com/Gitromanus/1c-extension-editor"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Gitromanus/1c-extension-editor
        </a>
        .
      </p>
    </div>
  );
}