import type JSZip from "jszip";

export async function packToBlob(source: JSZip): Promise<Blob> {
  const blob = await source.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: "application/zip",
  });
  return blob;
}

function ensureCfeExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith(".cfe") ? fileName : `${fileName}.cfe`;
}

/**
 * Создаёт blob-URL для файла и сразу инициирует скачивание через off-screen
 * ссылку. Возвращает blob-URL, чтобы вызывающий код мог предложить
 * пользователю ручной повтор (например, если окружение — sandboxed iframe или
 * WebView — заблокировало программный click и требуется настоящий жест
 * пользователя). Освобождать URL следует через revokeDownloadUrl.
 */
export function createDownloadUrl(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  triggerDownloadUrl(url, fileName);
  return url;
}

/**
 * Инициирует скачивание по уже созданному blob-URL через off-screen ссылку.
 *
 * Не используем display:none и не удаляем ссылку синхронно сразу после
 * click(): в ряде браузеров и WebView скрытая/немедленно удалённая ссылка
 * молча отменяет скачивание, хотя событие click уже сработало. Прячем ссылку
 * за пределы экрана, но оставляем её в DOM, пока браузер не начнёт
 * скачивание, и только потом убираем её.
 */
export function triggerDownloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ensureCfeExtension(fileName);
  anchor.rel = "noopener";
  anchor.style.position = "fixed";
  anchor.style.left = "-9999px";
  anchor.style.top = "-9999px";
  anchor.style.width = "0";
  anchor.style.height = "0";
  document.body.appendChild(anchor);
  anchor.click();

  window.setTimeout(() => {
    if (anchor.parentNode === document.body) {
      document.body.removeChild(anchor);
    }
  }, 1000);
}

/**
 * Отложенно освобождает blob-URL. Период выбран так, чтобы у браузера было
 * достаточно времени начать скачивание, а у пользователя — возможность
 * повторить скачивание через ручной fallback (кнопку в уведомлении).
 */
export function revokeDownloadUrl(url: string): void {
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
