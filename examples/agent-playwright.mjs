/**
 * Пример автоматизации ИИ-агента: открыть статический сайт 1C Extension Editor,
 * загрузить .cfe, прочитать/изменить модуль через window.__oneCEditor__ и сохранить.
 *
 * Запуск (нужен Node на стороне агента):
 *   npm i -D playwright        (или: npx playwright install chromium)
 *   node examples/agent-playwright.mjs <входной.cfe> [выходной.cfe] [путь к Module.bsl]
 *
 * Переменная окружения SITE_URL — адрес сайта (по умолчанию http://localhost:8090).
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = process.env.SITE_URL || "http://localhost:8090";
const INPUT = process.argv[2];
const OUTPUT = process.argv[3] || "out.cfe";
const MODULE_ARG = process.argv[4];

if (!INPUT) {
  console.error("Укажите путь к входному .cfe.");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(SITE, { waitUntil: "networkidle" });

  // 1) Загрузка .cfe через поле ввода (data-testid) — надёжный путь Playwright.
  const bytes = readFileSync(INPUT);
  await page.setInputFiles('[data-testid="cfe-upload-input"]', {
    name: INPUT.split(/[\\/]/).pop(),
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await page.waitForSelector('[data-testid="download-cfe"]', { timeout: 20000 });

  // 2) Работа через глобальный API.
  const info = await page.evaluate(() => window.__oneCEditor__.getInfo());
  console.log("INFO:", JSON.stringify(info));

  // Дерево файлов.
  const tree = await page.evaluate(() => window.__oneCEditor__.getTree());
  console.log("TREE:", JSON.stringify(tree));

  // Выбрать редактируемый модуль (.bsl), если путь не передан.
  let modulePath = MODULE_ARG;
  if (!modulePath) {
    const files = await page.evaluate(() => window.__oneCEditor__.getFiles());
    const editable = await page.evaluate(
      (paths) => paths.filter((p) => window.__oneCEditor__.canEdit(p)),
      files.map((f) => f.path)
    );
    modulePath =
      editable.find((p) => p.endsWith(".bsl")) || editable[0] || null;
  }

  if (!modulePath) {
    console.error("Не найден редактируемый модуль.");
    process.exit(1);
  }

  // Читаем содержимое.
  const content = await page.evaluate(
    (p) => window.__oneCEditor__.readFile(p),
    modulePath
  );
  console.log(`MODULE ${modulePath} (${content?.length ?? 0} chars)`);
  console.log("--- начало ---");
  console.log(content);
  console.log("--- конец ---");

  // Правим: добавляем комментарий в конец (замените на свою логику).
  const edit = (await page.evaluate(
    (p) => window.__oneCEditor__.readFile(p),
    modulePath
  ));
  const newContent = `${edit}\n\n// edited by AI agent (example)\n`;
  await page.evaluate(
    ([p, t]) => window.__oneCEditor__.writeFile(p, t),
    [modulePath, newContent]
  );

  // Проверяем, что правка применилась.
  const verified = await page.evaluate(
    (p) => window.__oneCEditor__.readFile(p),
    modulePath
  );
  if (!verified?.includes("edited by AI agent")) {
    console.error("Правка не сохранилась!");
    process.exit(1);
  }

  // 3) Сборка и сохранение.
  const result = await page.evaluate(async () => {
    const built = await window.__oneCEditor__.buildFile();
    const buf = await built.blob.arrayBuffer();
    return { name: built.name, bytes: Array.from(new Uint8Array(buf)) };
  });
  writeFileSync(OUTPUT, Buffer.from(result.bytes));
  console.log(`Сохранено: ${OUTPUT} (${result.bytes.length} bytes), расширение: ${result.name}`);
} finally {
  await browser.close();
}