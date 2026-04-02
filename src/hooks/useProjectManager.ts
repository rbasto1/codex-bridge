import { useEffect, useState } from "react";

import {
  deleteProjectIcon,
  fetchEnvHome,
  fetchProjectState,
  saveProjectState,
  uploadProjectIcon,
} from "../client/api";
import { resizeImageFileToPngBlob, encodeProjectId, reorderProjectEntries } from "../lib/projects";
import { getErrorMessage } from "../lib/errors";
import type { ProjectStateEntry, UseProjectManagerOptions } from "../types";

export function useProjectManager(options: UseProjectManagerOptions) {
  const {
    initialUi,
    onOpenThread,
    setActionError,
    setActiveThread,
    threadOrder,
    threadsById,
  } = options;

  const [currentProject, setCurrentProject] = useState(initialUi.currentProject ?? "");
  const [customProjects, setCustomProjects] = useState<string[]>(initialUi.customProjects ?? []);
  const [envHome, setEnvHome] = useState("");
  const [hiddenProjects, setHiddenProjects] = useState<string[]>([]);
  const [projectIconVersions, setProjectIconVersions] = useState<Record<string, number>>({});
  const [projectState, setProjectState] = useState<ProjectStateEntry[]>([]);

  const projectOptions = Array.from(
    new Set(
      [...customProjects, ...Object.values(threadsById).map((thread) => thread.cwd)].filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const visibleProjectsUnordered = projectOptions.filter((project) => !hiddenProjects.includes(project));
  const visibleProjects = projectState.length === 0
    ? visibleProjectsUnordered
    : [
        ...projectState
          .map((entry) => entry.id)
          .filter((projectId) => visibleProjectsUnordered.includes(projectId)),
        ...visibleProjectsUnordered.filter((projectId) => !projectState.some((entry) => entry.id === projectId)),
      ];
  const overflowProjects = projectOptions.filter((project) => hiddenProjects.includes(project));

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const home = await fetchEnvHome();
        if (!cancelled) {
          setEnvHome(home);
        }
      } catch {
        // non-critical
      }
    })();

    void (async () => {
      try {
        const state = await fetchProjectState();
        if (!cancelled) {
          setProjectState(state.projects ?? []);
          setHiddenProjects(state.hidden ?? []);

          const versions: Record<string, number> = {};
          for (const id of state.iconIds ?? []) {
            versions[id] = Date.now();
          }
          setProjectIconVersions(versions);
        }
      } catch {
        // non-critical
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectOptions.length === 0) {
      return;
    }

    if (currentProject && projectOptions.includes(currentProject)) {
      return;
    }

    setCurrentProject(projectOptions[0]);
  }, [currentProject, projectOptions]);

  function persistProjectState(projects: ProjectStateEntry[], hidden: string[]) {
    void saveProjectState({ projects, hidden });
  }

  async function selectProject(project: string) {
    if (project === currentProject) {
      return;
    }

    setCurrentProject(project);

    const firstThread = threadOrder.find((threadId) => threadsById[threadId]?.cwd === project);
    if (firstThread) {
      await onOpenThread(firstThread, "live");
      return;
    }

    setActiveThread(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function addProject(project: string) {
    let resolved = project.trim();
    if (!resolved) {
      return;
    }

    if (resolved.startsWith("~") && envHome) {
      resolved = envHome + resolved.slice(1);
    }

    setCustomProjects((previous) => (previous.includes(resolved) ? previous : [...previous, resolved]));
    void selectProject(resolved);
  }

  function removeProject(project: string) {
    setCustomProjects((previous) => previous.filter((entry) => entry !== project));
    if (currentProject !== project) {
      return;
    }

    const remaining = projectOptions.filter((entry) => entry !== project);
    setCurrentProject(remaining[0] ?? "");
  }

  function hideProject(project: string) {
    setHiddenProjects((previous) => {
      const next = previous.includes(project) ? previous : [...previous, project];
      persistProjectState(projectState, next);
      return next;
    });

    if (currentProject !== project) {
      return;
    }

    const remaining = projectOptions.filter((entry) => entry !== project && !hiddenProjects.includes(entry));
    setCurrentProject(remaining[0] ?? "");
  }

  function unhideProject(project: string) {
    setHiddenProjects((previous) => {
      const next = previous.filter((entry) => entry !== project);
      persistProjectState(projectState, next);
      return next;
    });
  }

  function saveProjectName(project: string, name: string) {
    setProjectState((previous) => {
      const next = [...previous];
      const index = next.findIndex((entry) => entry.id === project);
      const nextEntry = { id: project, name: name.trim() };

      if (index >= 0) {
        next[index] = nextEntry;
      } else {
        next.push(nextEntry);
      }

      persistProjectState(next, hiddenProjects);
      return next;
    });
  }

  function reorderProjects(projects: string[]) {
    setProjectState((previous) => {
      const next = reorderProjectEntries(projects, previous);
      persistProjectState(next, hiddenProjects);
      return next;
    });
  }

  async function saveProjectIcon(project: string, file: File) {
    try {
      const projectId = encodeProjectId(project);
      const blob = await resizeImageFileToPngBlob(file);
      await uploadProjectIcon(projectId, blob);
      setProjectIconVersions((previous) => ({ ...previous, [projectId]: Date.now() }));
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function removeProjectIcon(project: string) {
    try {
      const projectId = encodeProjectId(project);
      await deleteProjectIcon(projectId);
      setProjectIconVersions((previous) => {
        const next = { ...previous };
        delete next[projectId];
        return next;
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  function projectHasSessions(project: string): boolean {
    return threadOrder.some((threadId) => threadsById[threadId]?.cwd === project);
  }

  return {
    currentProject,
    customProjects,
    envHome,
    hiddenProjects,
    overflowProjects,
    projectHasSessions,
    projectIconVersions,
    projectOptions,
    projectState,
    visibleProjects,
    addProject,
    hideProject,
    removeProject,
    removeProjectIcon,
    reorderProjects,
    saveProjectIcon,
    saveProjectName,
    selectProject,
    setCurrentProject,
    unhideProject,
  };
}
