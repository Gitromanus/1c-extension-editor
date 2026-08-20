"use client";

import { useState } from "react";
import { ShieldCheck, Cpu, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExtensionDropzone } from "@/components/extension-dropzone";

const features = [
  {
    icon: Archive,
    title: "Распаковка .cfe",
    text: "Формат расширений 1С по логике v8unpack",
  },
  {
    icon: Cpu,
    title: "Локальная обработка",
    text: "Данные не покидают ваш браузер",
  },
  {
    icon: ShieldCheck,
    title: "Правка модулей",
    text: "Редактирование кода и упаковка результата",
  },
];

export default function HomePage() {
  // true — открыт редактор расширения (полноэкранный режим)
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pattern-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />

      {/* ExtensionDropzone всегда на одном месте в дереве, чтобы не терять
          состояние открытого файла при переключении isOpen. */}
      <div
        className={cn(
          "relative mx-auto flex w-full flex-1 flex-col",
          isOpen ? "px-4 py-4" : "max-w-7xl gap-10 overflow-y-auto px-4 py-14"
        )}
      >
        {!isOpen && (
          <div className="space-y-4 text-center">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1 font-mono text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              local editor · v0.1
            </div>
            <h1 className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="text-primary">$</span> 1C Extension Editor
            </h1>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              Инструмент разработчика для работы с расширениями 1С: загрузка,
              просмотр структуры и редактирование модулей файла{" "}
              <span className="font-mono">.cfe</span>.
            </p>
          </div>
        )}

        <ExtensionDropzone onOpenChange={setIsOpen} />

        {!isOpen && (
          <div className="mx-auto grid w-full max-w-5xl gap-3 sm:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border bg-background p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="mb-2 flex items-center gap-2">
                  <f.icon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-mono text-sm font-medium">{f.title}</h2>
                </div>
                <p className="text-xs text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
