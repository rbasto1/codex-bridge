import { useEffect, useState } from "react";

import { readPersistedUi, writePersistedUi } from "../lib/storage";
import type { PersistedUi } from "../types";

export function usePersistedUi(value?: PersistedUi) {
  const [initialUi] = useState(() => readPersistedUi());

  useEffect(() => {
    if (!value) {
      return;
    }

    writePersistedUi(value);
  }, [
    value?.activeMode,
    value?.activeThreadId,
    value?.currentProject,
    value?.customProjects,
    value?.threadControlDrafts,
    value?.threadPermissionBaselines,
  ]);

  return initialUi;
}
