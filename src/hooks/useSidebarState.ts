import { useState } from "react";

function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}

export function useSidebarState() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobileViewport);

  function toggleSidebar() {
    setSidebarCollapsed((value) => !value);
  }

  return {
    isMobileViewport,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
  };
}
