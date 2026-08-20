"use client";

import { useEffect } from "react";
import { installAgentApi } from "@/lib/agent-api";

/**
 * Устанавливает глобальный window.__oneCEditor__ для ИИ-агентов.
 * Компонент ничего не отображает.
 */
export function AgentApi() {
  useEffect(() => {
    installAgentApi();
  }, []);

  return null;
}