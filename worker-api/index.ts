/**
 * Cloudflare Worker: настоящее серверное HTTP API для ИИ-агентов.
 *
 * POST /api/edit       — изменить один модуль: { file_base64, module_path, new_code }
 * POST /api/edit-all   — добавить префикс-комментарий во ВСЕ редактируемые .bsl:
 *                        { file_base64, comment? } -> { success, file_base64, edited[] }
 * POST /api/tree       — список файлов: { file_base64 } -> { success, entries[] }
 * GET  /api/health     — проверка.
 *
 * Логика разборки/сборки .cfe переиспользуется из lib/extension/* (jszip + pako).
 */

import { extractCfe } from "./lib/extension/extract";
import { readEntryText } from "./lib/extension/extract";

interface EditRequest {
  file_base64?: string;
  module_path?: string;
  new_code?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  return btoa(binary);
}

function makeFileLike(bytes: Uint8Array, name: string): File {
  return {
    name,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function openArchive(body: EditRequest & { comment?: string }) {
  const { file_base64 } = body ?? {};
  if (!file_base64) {
    return { err: json({ error: "Отсутствует поле file_base64" }, 400) };
  }
  let archive;
  try {
    const bytes = base64ToBytes(file_base64);
    archive = await extractCfe(makeFileLike(bytes, "extension.cfe"));
  } catch (e) {
    return { err: json({ error: `Не удалось открыть .cfe: ${msg(e)}` }, 422) };
  }
  return { archive };
}

async function handleTree(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const { archive, err } = await openArchive(body);
  if (err) return err;

  const entries = archive.entries.map((en) => ({
    path: en.path,
    isDirectory: en.isDirectory,
    editable:
      !en.isDirectory &&
      Boolean(archive.writeEntry) &&
      (!archive.canEdit || archive.canEdit(en.path)),
  }));
  return json({ success: true, entries });
}

async function handleEditAll(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const { archive, err } = await openArchive(body);
  if (err) return err;

  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment
      : "// AI: изменено ИИ-агентом\n";

  const edited: string[] = [];
  for (const en of archive.entries) {
    if (en.isDirectory) continue;
    if (!en.path.toLowerCase().endsWith(".bsl")) continue;
    if (archive.canEdit && !archive.canEdit(en.path)) continue;
    if (!archive.writeEntry) continue;
    const text = await readEntryText(archive, en.path);
    if (text === null) continue;
    archive.writeEntry(en.path, `${comment}${text}`);
    edited.push(en.path);
  }

  if (edited.length === 0) {
    return json({ error: "Редактируемые модули (.bsl) не найдены" }, 404);
  }
  if (!archive.toBlob) return json({ error: "Упаковка недоступна" }, 500);

  try {
    const blob = await archive.toBlob();
    const out = new Uint8Array(await blob.arrayBuffer());
    return json({ success: true, file_base64: bytesToBase64(out), edited });
  } catch (e) {
    return json({ error: `Не удалось собрать .cfe: ${msg(e)}` }, 500);
  }
}

async function handleRead(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const { archive, err } = await openArchive(body);
  if (err) return err;

  const path = typeof body.module_path === "string" ? body.module_path : "";
  if (!path) return json({ error: "Отсутствует поле module_path" }, 400);

  const bytes = await archive.readFile(path);
  if (!bytes) {
    return json({ error: `Файл не найден: ${path}` }, 404);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return json({ success: true, path, text });
}

async function handleEdit(request: Request): Promise<Response> {
  let body: EditRequest;
  try {
    body = (await request.json()) as EditRequest;
  } catch {
    return json({ error: "Не удалось прочитать JSON" }, 400);
  }

  const { file_base64, module_path, new_code } = body ?? {};
  if (!file_base64 || !module_path || new_code === undefined) {
    return json(
      { error: "Отсутствуют поля: file_base64, module_path, new_code" },
      400
    );
  }

  const { archive, err } = await openArchive(body);
  if (err) return err;

  const target = archive.entries.find(
    (en) => !en.isDirectory && en.path === module_path
  );
  if (!target) {
    return json({ error: `Модуль не найден: ${module_path}` }, 404);
  }
  if (archive.canEdit && !archive.canEdit(module_path)) {
    return json({ error: "Файл недоступен для редактирования" }, 422);
  }
  if (!archive.writeEntry) {
    return json({ error: "Контейнер не поддерживает редактирование" }, 422);
  }

  try {
    archive.writeEntry(module_path, new_code);
  } catch (e) {
    return json({ error: `Не удалось сохранить: ${msg(e)}` }, 422);
  }
  if (!archive.toBlob) {
    return json({ error: "Упаковка расширения недоступна" }, 500);
  }
  try {
    const blob = await archive.toBlob();
    const out = new Uint8Array(await blob.arrayBuffer());
    return json({ success: true, file_base64: bytesToBase64(out) });
  } catch (e) {
    return json({ error: `Не удалось собрать .cfe: ${msg(e)}` }, 500);
  }
}

// ---------- Multipart-эндпоинты (прямая работа с файлом, без локального base64) ----------

function formField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function formFile(form: FormData, name: string): Promise<File | null> {
  const v = form.get(name);
  return v instanceof File ? v : null;
}

async function handleTreeForm(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Ожидалось multipart/form-data" }, 400);
  const file = await formFile(form, "file");
  if (!file) return json({ error: "Поле file не найдено" }, 400);
  try {
    const archive = await extractCfe(file);
    const entries = archive.entries.map((en) => ({
      path: en.path,
      isDirectory: en.isDirectory,
      editable:
        !en.isDirectory &&
        Boolean(archive.writeEntry) &&
        (!archive.canEdit || archive.canEdit(en.path)),
    }));
    return json({ success: true, entries });
  } catch (e) {
    return json({ error: `Не удалось открыть .cfe: ${msg(e)}` }, 422);
  }
}

async function handleReadForm(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Ожидалось multipart/form-data" }, 400);
  const file = await formFile(form, "file");
  const modulePath = formField(form, "module_path");
  if (!file) return json({ error: "Поле file не найдено" }, 400);
  if (!modulePath) return json({ error: "Поле module_path не найдено" }, 400);
  try {
    const archive = await extractCfe(file);
    const bytes = await archive.readFile(modulePath);
    if (!bytes) return json({ error: `Файл не найден: ${modulePath}` }, 404);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return json({ success: true, path: modulePath, text });
  } catch (e) {
    return json({ error: `Ошибка чтения: ${msg(e)}` }, 422);
  }
}

async function handleEditForm(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Ожидалось multipart/form-data" }, 400);
  const file = await formFile(form, "file");
  const modulePath = formField(form, "module_path");
  const newCode = formField(form, "new_code");
  if (!file) return json({ error: "Поле file не найдено" }, 400);
  if (!modulePath) return json({ error: "Поле module_path не найдено" }, 400);
  if (!newCode) return json({ error: "Поле new_code не найдено" }, 400);

  let archive;
  try {
    archive = await extractCfe(file);
  } catch (e) {
    return json({ error: `Не удалось открыть .cfe: ${msg(e)}` }, 422);
  }
  if (!archive.writeEntry) {
    return json({ error: "Контейнер не поддерживает редактирование" }, 422);
  }
  try {
    archive.writeEntry(modulePath, newCode);
  } catch (e) {
    return json({ error: `Не удалось сохранить: ${msg(e)}` }, 422);
  }
  if (!archive.toBlob) {
    return json({ error: "Упаковка расширения недоступна" }, 500);
  }
  try {
    const blob = await archive.toBlob();
    const out = new Uint8Array(await blob.arrayBuffer());
    const binHeaders = {
      ...CORS_HEADERS,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="extension.cfe"',
    };
    return new Response(out, { status: 200, headers: binHeaders });
  } catch (e) {
    return json({ error: `Не удалось собрать .cfe: ${msg(e)}` }, 500);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "POST" && url.pathname.endsWith("/api/tree")) {
      return handleTree(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/edit-all")) {
      return handleEditAll(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/edit")) {
      return handleEdit(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/read")) {
      return handleRead(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/tree-form")) {
      return handleTreeForm(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/read-form")) {
      return handleReadForm(request);
    }
    if (request.method === "POST" && url.pathname.endsWith("/api/edit-form")) {
      return handleEditForm(request);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok", service: "1c-extension-api" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        status: "ok",
        endpoints: [
          "POST /api/edit { file_base64, module_path, new_code }",
          "POST /api/edit-all { file_base64, comment? }",
          "POST /api/tree { file_base64 }",
          "POST /api/read { file_base64, module_path }",
          "POST /api/tree-form  (multipart: file)",
          "POST /api/read-form  (multipart: file, module_path)",
          "POST /api/edit-form  (multipart: file, module_path, new_code) -> .cfe",
        ],
      });
    }

    return json({ error: "Not found" }, 404);
  },
};