# 1C Extension API — Cloudflare Worker

Серверное HTTP API для ИИ-агентов: принимает расширение 1С (`.cfe`), читает/меняет
модули и возвращает готовый `.cfe`. Логика разборки/сборки переиспользуется из
1C Extension Editor (`lib/extension/*`, jszip + pako).

> Это **серверная альтернатива** браузерному API `window.__oneCEditor__` — запросы
> идут по HTTP напрямую, без управления браузером.

## Быстрый старт

```bash
npm install
npx wrangler login
npx wrangler deploy
```

После деплоя Worker доступен на вашем `.workers.dev`-адресе, например
`https://1c-extension-api.<ваш-аккаунт>.workers.dev`.

### Сборка монолитного `index.js` (для вставки в Dashboard)

```bash
npm run build
```

Скрипт генерирует единый файл `index.js` (jszip + pako + lib в одном бандле),
который можно вставить вручную в Cloudflare Dashboard → Worker → Edit code → Save.

## Эндпоинты

### JSON (base64-кодирование файла на стороне клиента)

Все JSON-эндпоинты принимают `file_base64` — содержимое `.cfe` в base64 одной строкой.

#### `POST /api/tree`

```bash
curl -X POST https://<worker>/api/tree \
  -H "Content-Type: application/json" \
  -d '{"file_base64":"<b64>"}'
```
→ `{ "success": true, "entries": [ { "path", "isDirectory", "editable" } ] }`

#### `POST /api/read`

```bash
curl -X POST https://<worker>/api/read \
  -H "Content-Type: application/json" \
  -d '{"file_base64":"<b64>","module_path":"CommonModules/X/Module.bsl"}'
```
→ `{ "success": true, "path", "text" }`

#### `POST /api/edit`

```bash
curl -X POST https://<worker>/api/edit \
  -H "Content-Type: application/json" \
  -d '{"file_base64":"<b64>","module_path":"CommonModules/X/Module.bsl","new_code":"// новый код"}'
```
→ `{ "success": true, "file_base64": "<b64 изменённого .cfe>" }`

#### `POST /api/edit-all` (добавить префикс-комментарий во все `.bsl`)

```bash
curl -X POST https://<worker>/api/edit-all \
  -H "Content-Type: application/json" \
  -d '{"file_base64":"<b64>","comment":"// AI: изменено\n"}'
```
→ `{ "success": true, "file_base64": "...", "edited": ["пути к .bsl"] }`

### Multipart (файл передаётся напрямую, без локального base64)

Удобно для агентов: `curl -F "file=@input.cfe"`. Для текстовых полей с кириллицей
рекомендуется передавать содержимое из файла через `-F "поле=<файл"`.

#### `POST /api/tree-form`

```bash
curl -X POST https://<worker>/api/tree-form \
  -F "file=@input.cfe" -o tree.json
```
→ `{ "success": true, "entries": [...] }`

#### `POST /api/read-form`

```bash
# путь модуля лежит в module_path.txt (UTF-8)
curl -X POST https://<worker>/api/read-form \
  -F "file=@input.cfe" -F "module_path=<module_path.txt" -o module.json
```
→ `{ "success": true, "path", "text" }`

#### `POST /api/edit-form` — возвращает готовый `.cfe` бинарником

```bash
curl -X POST https://<worker>/api/edit-form \
  -F "file=@input.cfe" \
  -F "module_path=<module_path.txt" \
  -F "new_code=<new_code.txt" \
  -o output.cfe
```
Ответ — `application/octet-stream` с содержимым изменённого `.cfe` (сохраняется напрямую).

### Служебные

- `GET /` — список эндпоинтов.
- `GET /api/health` — проверка работоспособности: `{ "status": "ok", "service": "1c-extension-api" }`.
- CORS разрешён (`*`).

## Ошибки

Ответы с ошибками возвращаются со статусом 400/404/422/500:

```json
{ "error": "сообщение" }
```

## Полный цикл (multipart, без Node/PowerShell)

```bash
# 1. Структура
curl -s -X POST https://<worker>/api/tree-form -F "file=@input.cfe" -o tree.json

# 2. Чтение модуля (путь из tree.json)
curl -s -X POST https://<worker>/api/read-form \
  -F "file=@input.cfe" -F "module_path=<module_path.txt" -o module.json

# 3. Правка и получение результата
curl -s -X POST https://<worker>/api/edit-form \
  -F "file=@input.cfe" \
  -F "module_path=<module_path.txt" \
  -F "new_code=<new_code.txt" \
  -o output.cfe
```

## Локальный запуск

```bash
npm install
npx wrangler dev
```

## Примечания и ограничения

- **module_path** должен совпадать с путём внутри `.cfe` (см. `entries` из `/api/tree*`).
- В нативном контейнере 1С редактируются только модули **`.bsl`**. Модули форм тоже
  `.bsl`, но их перезапись возможна только при безопасном формате.
- Формат ответа единый: `{ success, ... }` / `{ error }`.
- Тело запроса до 100 МБ; CPU-таймаут ~30 с на бесплатном тарифе — для больших
  `.cfe` на `/api/edit-all` возможна неполная отдача тела; при необходимости
  переходите на платный тариф Workers.