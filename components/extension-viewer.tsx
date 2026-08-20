"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileCode2,
  Binary,
  Folder,
  FolderOpen,
  RotateCcw,
  ChevronRight,
  Loader2,
  Pencil,
  Save,
  X,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CodeHighlight } from "@/components/code-highlight";
import { CodeEditor } from "@/components/code-editor";
import { isOneCFile } from "@/lib/extension/onedc-syntax";
import { readEntryText, type UnpackedArchive } from "@/lib/extension/extract";
import {
  createDownloadUrl,
  revokeDownloadUrl,
  triggerDownloadUrl,
} from "@/lib/extension/pack";
import {
  buildFileTree,
  collectFiles,
  type FileTreeNode,
} from "@/lib/extension/tree";

export interface ExtensionViewerProps {
  name: string;
  archive: UnpackedArchive;
  onReset: () => void;
}

export function ExtensionViewer({
  name,
  archive,
  onReset,
}: ExtensionViewerProps) {
  const tree = useMemo(() => buildFileTree(archive.entries), [archive]);

  const fileCount = useMemo(() => collectFiles(tree).length, [tree]);
  const editable = Boolean(archive.writeEntry);
  const downloadable = Boolean(archive.toBlob);

  const initialExpanded = useMemo(
    () =>
      new Set(tree.filter((node) => node.isDirectory).map((node) => node.path)),
    [tree]
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dirty = editing && draft !== content;

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function openEntry(path: string) {
    setSelected(path);
    setContent(null);
    setBinary(false);
    setEditing(false);
    setLoading(true);
    const text = await readEntryText(archive, path);
    setLoading(false);
    if (text === null) setBinary(true);
    else setContent(text);
  }

  function startEdit() {
    if (content === null) return;
    setDraft(content);
    setEditing(true);
  }

  function saveEdit() {
    if (!selected || content === null || !archive.writeEntry) return;
    try {
      archive.writeEntry(selected, draft);
      setContent(draft);
      setEditing(false);
      toast.success("Изменения сохранены");
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Не удалось сохранить изменения.";
      toast.error(message);
    }
  }

  function discardEdit() {
    setDraft(content ?? "");
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveEdit();
    }
  }

  const [packing, setPacking] = useState(false);

  async function downloadCfe() {
    if (packing || !archive.toBlob) return;
    setPacking(true);
    const toastId = toast.loading("Упаковка расширения…");
    try {
      const blob = await archive.toBlob();
      const url = createDownloadUrl(blob, name);
      toast.success("Расширение упаковано и готово к скачиванию", {
        id: toastId,
        duration: 20_000,
        action: {
          label: "Скачать ещё раз",
          onClick: () => triggerDownloadUrl(url, name),
        },
      });
      revokeDownloadUrl(url);
    } catch {
      toast.error("Не удалось упаковать расширение. Попробуйте ещё раз.", {
        id: toastId,
      });
    } finally {
      setPacking(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              Распаковано · {fileCount} файлов
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {downloadable && (
            <Button onClick={downloadCfe} disabled={packing} size="sm">
              {packing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {packing ? "Упаковка…" : "Скачать .cfe"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Открыть другой файл
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
          <div className="shrink-0 border-b px-3 py-2 font-mono text-xs font-medium text-muted-foreground">
            Содержимое
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {tree.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Файлы не найдены
              </p>
            ) : (
              tree.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selected={selected}
                  onToggle={toggleFolder}
                  onOpen={openEntry}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
              {selected ?? "Файл не выбран"}
            </span>
            {selected &&
              content !== null &&
              !editing &&
              editable &&
              (!archive.canEdit || archive.canEdit(selected)) && (
                <Button variant="outline" size="sm" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </Button>
              )}
            {selected && editing && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={discardEdit}
                  disabled={!dirty}
                >
                  <X className="h-3.5 w-3.5" />
                  Отменить
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={!dirty}>
                  <Save className="h-3.5 w-3.5" />
                  Сохранить
                </Button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-0">
            {!selected ? (
              <EmptyState text="Выберите файл, чтобы просмотреть его содержимое" />
            ) : loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Чтение файла…
              </div>
            ) : binary ? (
              <EmptyState text="Бинарный или нетекстовый файл. Просмотр и редактирование кода недоступны." />
            ) : editing ? (
              <CodeEditor
                value={draft}
                onChange={setDraft}
                onKeyDown={handleKeyDown}
                highlight={selected ? isOneCFile(selected) : false}
                label="Редактор кода"
              />
            ) : (
              <pre className="p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {selected && content !== null && isOneCFile(selected) ? (
                  <CodeHighlight code={content} />
                ) : (
                  content
                )}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onOpen,
}: TreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const active = node.path === selected;

  if (node.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-1.5 py-1 pr-3 text-left text-sm transition-colors hover:bg-muted/60"
          style={{ paddingLeft: depth * 16 + 12 }}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )}
          />
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500/80" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500/80" />
          )}
          <span className="truncate font-mono text-xs">{node.name}</span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-3 text-left text-sm transition-colors hover:bg-muted/60",
        active && "bg-primary/10"
      )}
      style={{ paddingLeft: depth * 16 + 12 + 14 }}
    >
      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-xs">{node.name}</span>
      <ChevronRight
        className={cn(
          "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
          active && "rotate-90"
        )}
      />
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Binary className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
