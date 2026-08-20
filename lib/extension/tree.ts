import type { ArchiveEntry } from "@/lib/extension/extract";

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
}

function normalizeDirPath(path: string): string {
  return path.replace(/\/+$/g, "");
}

export function buildFileTree(entries: ArchiveEntry[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const dirIndex = new Map<string, FileTreeNode>();

  function addDir(
    path: string,
    name: string,
    parentChildren: FileTreeNode[]
  ): FileTreeNode {
    const key = normalizeDirPath(path);
    const existing = dirIndex.get(key);
    if (existing) return existing;
    const node: FileTreeNode = {
      name,
      path: key,
      isDirectory: true,
      children: [],
    };
    parentChildren.push(node);
    dirIndex.set(key, node);
    return node;
  }

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    const name = parts[parts.length - 1] ?? entry.path;

    let currentChildren = roots;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      currentChildren = addDir(currentPath, parts[i], currentChildren).children;
    }

    if (entry.isDirectory) {
      addDir(entry.path, name, currentChildren);
    } else {
      currentChildren.push({
        name,
        path: entry.path,
        isDirectory: false,
        children: [],
      });
    }
  }

  return roots;
}

export function collectFiles(
  nodes: FileTreeNode[],
  acc: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.isDirectory) collectFiles(node.children, acc);
    else acc.push(node.path);
  }
  return acc;
}
