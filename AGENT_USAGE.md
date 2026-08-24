# Использование сервиса ИИ-агентами

Этот документ описывает, как ИИ-агент (или любой скрипт) может программно открыть
расширение 1С (`.cfe`), изменить его модули и сохранить новый файл, используя
статический сайт 1C Extension Editor **без бэкенда и без Node на стороне сервиса**.

Обработка выполняется **в браузере**: агент управляет страницей (Playwright/
Puppeteer или режим computer-use) и обращается к глобальному API `window.__oneCEditor__`.

## Где это работает

- Сайт: http://s96346ix.beget.tech/
- Источник: https://github.com/Gitromanus/1c-extension-editor

## Глобальный API: window.__oneCEditor__

Объект доступен на всех страницах сайта. Все методы возвращают Promise (кроме
синхронных, отмеченных ниже).

| Метод | Тип | Описание |
| --- | --- | --- |
| `loadFile(file)` | async | Загрузить `.cfe` (объект `File` из браузера). |
| `getInfo()` | sync | `{ name, fileCount, editable }` или `null`, если файл не открыт. |
| `getTree()` | sync | Дерево файлов (папки/файлы) — машиночитаемая структура. |
| `getFiles()` | sync | Плоский список `[{ path, isDirectory }]`. |
| `readFile(path)` | async | Текст файла; `null`, если бинарный/недоступный. |
| `canEdit(path)` | sync | Можно ли редактировать файл (`true` для `.bsl`). |
| `writeFile(path, text)` | sync | Сохранить изменённое содержимое файла. |
| `buildFile()` | async | Упаковать обратно; вернёт `{ blob, url, name }`. |
| `saveAndDownload()` | async | Упаковать и скачать `.cfe` через браузер. |

Типичный цикл:

1. **Загрузить:** `await window.__oneCEditor__.loadFile(file)` (или через поле ввода).
2. **Осмотреть:** `getInfo()` → `getTree()`/`getFiles()`, выбрать путь к `.bsl`.
3. **Прочитать:** `const text = await readFile(path)`.
4. **Изменить:** построить `newText`, затем `writeFile(path, newText)`.
5. **Собрать:** `const { blob, name } = await buildFile()` — сохранить байты на свою сторону.

## Рабочий цикл агента (по шагам)

```text
1. Открой сайт http://s96346ix.beget.tech/
2. Дождись готовности window.__oneCEditor__.
3. Загрузи расширение .cfe.
4. Прочитай дерево и найди редактируемые модули (*.bsl).
5. Для каждого нужного модуля: прочитай текст, внеси изменения, запиши writeFile.
6. Собери новый .cfe через buildFile() и сохрани файл.
7. Если нужно — покажи пользователю сводку изменений.
```

## Доступные data-testid (резервный путь через DOM)

- `[data-testid="cfe-upload-input"]` — `<input type=file>` для загрузки `.cfe`.
- `[data-testid="tree-file"]` — кнопки файлов в дереве; атрибуты `data-path` и `data-bsl`.
- `[data-testid="code-editor"]` — `<textarea>` редактора кода.
- `[data-testid="download-cfe"]` — кнопка «Скачать .cfe».

## Пример скрипта

Готовый пример — [`examples/agent-playwright.mjs`](examples/agent-playwright.mjs).
Запуск (Node нужен на стороне агента):

```bash
npm i -D playwright && npx playwright install chromium
SITE_URL=http://s96346ix.beget.tech/ node examples/agent-playwright.mjs input.cfe output.cfe
```

## Серверный API (Cloudflare Worker) — без браузера

Если не нужно управлять страницей, используйте **серверное HTTP API** на
Cloudflare Worker (`worker-api/`). Запросы идут напрямую, обработка — на edge,
без локального Node и без браузера.

Развёрнутый экземпляр: `https://tight-waterfall-6bb.netesn.workers.dev`

### Основные эндпоинты

| Метод | Формат | Назначение |
| --- | --- | --- |
| `POST /api/tree` | JSON | Список файлов |
| `POST /api/read` | JSON | Прочитать текст модуля |
| `POST /api/edit` | JSON | Изменить модуль (возвращает `file_base64`) |
| `POST /api/edit-all` | JSON | Добавить комментарий во все `.bsl` |
| `POST /api/tree-form` | multipart | Список файлов (файл напрямую) |
| `POST /api/read-form` | multipart | Прочитать текст модуля |
| `POST /api/edit-form` | multipart | Изменить модуль (возвращает готовый `.cfe` бинарником) |

### Пример (multipart, curl, без локальной обработки)

```bash
# 1. Структура
curl -s -X POST https://<worker>/api/tree-form \
  -F "file=@input.cfe" -o tree.json

# 2. Читаем модуль (путь модуля кладём в module_path.txt, UTF-8)
curl -s -X POST https://<worker>/api/read-form \
  -F "file=@input.cfe" -F "module_path=<module_path.txt" -o module.json

# 3. Правка и получение результата
curl -s -X POST https://<worker>/api/edit-form \
  -F "file=@input.cfe" \
  -F "module_path=<module_path.txt" \
  -F "new_code=<new_code.txt" \
  -o output.cfe
```

Подробная документация и JSON-эндпоинты — в [`worker-api/README.md`](worker-api/README.md).

## Примечания и ограничения

- Обработка **локальная** — данные не уходят с машины, где открыт браузер.
- Правки применяются к **текущему загруженному** расширению в памяти браузера.
  После перезагрузки страницы/открытия другого файла состояние сбрасывается.
- Редактировать можно **только модули `.bsl`** (в нативном контейнере 1С).
  Модули форм тоже `.bsl`, но их перезапись возможна только при безопасном формате.
- `readFile` возвращает расшифрованный текст; бинарные файлы возвращают `null`.
- Не существует сессий/авторизации: сервис публичный, статический.