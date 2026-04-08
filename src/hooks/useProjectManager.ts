import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  deleteProjectIcon,
  fetchEnvHome,
  fetchProjectSessionState,
  fetchProjectState,
  saveProjectSessionState,
  saveProjectState,
  uploadProjectIcon,
} from "../client/api";
import { resizeImageFileToPngBlob, encodeProjectId, reorderProjectEntries } from "../lib/projects";
import { getErrorMessage } from "../lib/errors";
import type {
  ProjectSessionStateSaveData,
  ProjectStateEntry,
  TagDefinition,
  UseProjectManagerOptions,
} from "../types";

const DONE_TAG: TagDefinition = { name: "done", color: "#22c55e" };
const PROTECTED_TAG_NAMES = new Set(["done", "archived"]);

function normalizeTags(tags: TagDefinition[]): TagDefinition[] {
  return tags.some((tag) => tag.name === DONE_TAG.name) ? tags : [...tags, DONE_TAG];
}

function normalizeSessionState(state?: ProjectSessionStateSaveData): ProjectSessionStateSaveData {
  return { threads: state?.threads ?? {} };
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function updateSessionStateTags(
  state: ProjectSessionStateSaveData,
  updater: (tags: string[]) => string[],
): ProjectSessionStateSaveData {
  return {
    threads: Object.fromEntries(
      Object.entries(state.threads).flatMap(([threadId, threadState]) => {
        const nextTags = Array.from(new Set(updater(threadState.tags ?? []).filter(Boolean)));
        const nextArchived = Boolean(threadState.archived);
        if (nextTags.length === 0 && !nextArchived) {
          return [];
        }

        return [[
          threadId,
          {
            ...(nextArchived ? { archived: true } : {}),
            ...(nextTags.length > 0 ? { tags: nextTags } : {}),
          },
        ]];
      }),
    ),
  };
}

function resolveRestoredProject(
  initialUi: UseProjectManagerOptions["initialUi"],
  threadsById: UseProjectManagerOptions["threadsById"],
): string {
  const hashThreadId = window.location.hash.replace(/^#/, "") || null;
  const restoreThreadId = (hashThreadId && threadsById[hashThreadId]) ? hashThreadId : initialUi.activeThreadId;
  return restoreThreadId ? threadsById[restoreThreadId]?.cwd?.trim() ?? "" : "";
}

function hasRequestedRestoredThread(initialUi: UseProjectManagerOptions["initialUi"]): boolean {
  const hashThreadId = window.location.hash.replace(/^#/, "") || null;
  return Boolean(hashThreadId || initialUi.activeThreadId);
}

export function useProjectManager(options: UseProjectManagerOptions) {
  const {
    initialUi,
    onOpenThread,
    setActionError,
    setActiveThread,
    threadOrder,
    threadsById,
  } = options;

  const [currentProject, setCurrentProject] = useState(() => {
    const restoredProject = resolveRestoredProject(initialUi, threadsById);
    if (restoredProject) {
      return restoredProject;
    }

    if (hasRequestedRestoredThread(initialUi)) {
      return "";
    }

    return initialUi.currentProject || "";
  });
  const [customProjects, setCustomProjects] = useState<string[]>(initialUi.customProjects ?? []);
  const [envHome, setEnvHome] = useState("");
  const [hiddenProjects, setHiddenProjects] = useState<string[]>([]);
  const [projectIconVersions, setProjectIconVersions] = useState<Record<string, number>>({});
  const [projectState, setProjectState] = useState<ProjectStateEntry[]>([]);
  const [projectTags, setProjectTags] = useState<TagDefinition[]>([DONE_TAG]);
  const [projectSessionStates, setProjectSessionStates] = useState<Record<string, ProjectSessionStateSaveData>>({});
  const initialProjectResolvedRef = useRef(false);

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
  const currentProjectSessionState = normalizeSessionState(projectSessionStates[currentProject]);

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
          setProjectTags(normalizeTags(state.tags ?? []));

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
    if (!currentProject || projectSessionStates[currentProject]) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const state = await fetchProjectSessionState(currentProject);
        if (!cancelled) {
          setProjectSessionStates((previous) => ({
            ...previous,
            [currentProject]: normalizeSessionState(state),
          }));
        }
      } catch {
        if (!cancelled) {
          setProjectSessionStates((previous) => ({
            ...previous,
            [currentProject]: normalizeSessionState(),
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentProject, projectSessionStates]);

  useLayoutEffect(() => {
    if (initialProjectResolvedRef.current) {
      return;
    }

    const hasRestoreRequest = hasRequestedRestoredThread(initialUi);
    if (hasRestoreRequest && threadOrder.length === 0) {
      return;
    }

    const restoredProject = resolveRestoredProject(initialUi, threadsById);
    if (restoredProject) {
      initialProjectResolvedRef.current = true;
      if (currentProject !== restoredProject) {
        setCurrentProject(restoredProject);
      }
      return;
    }

    if (!hasRestoreRequest && threadOrder.length === 0 && projectOptions.length === 0) {
      return;
    }

    initialProjectResolvedRef.current = true;
    if (currentProject && projectOptions.includes(currentProject)) {
      return;
    }

    if (projectOptions[0]) {
      setCurrentProject(projectOptions[0]);
    }
  }, [currentProject, initialUi, projectOptions, threadOrder.length, threadsById]);

  useEffect(() => {
    if (!initialProjectResolvedRef.current || projectOptions.length === 0) {
      return;
    }

    if (currentProject && projectOptions.includes(currentProject)) {
      return;
    }

    setCurrentProject(projectOptions[0]);
  }, [currentProject, projectOptions]);

  function persistProjectState(projects: ProjectStateEntry[], hidden: string[], tags: TagDefinition[]) {
    void saveProjectState({ projects, hidden, tags });
  }

  function persistProjectSessionState(project: string, state: ProjectSessionStateSaveData) {
    void saveProjectSessionState(project, state);
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

    if (resolved.length > 1) {
      resolved = resolved.replace(/\/+$/g, "");
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
      persistProjectState(projectState, next, projectTags);
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
      persistProjectState(projectState, next, projectTags);
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

      persistProjectState(next, hiddenProjects, projectTags);
      return next;
    });
  }

  function reorderProjects(projects: string[]) {
    setProjectState((previous) => {
      const next = reorderProjectEntries(projects, previous);
      persistProjectState(next, hiddenProjects, projectTags);
      return next;
    });
  }

  function createTag(name: string, color: string): string | null {
    const nextName = name.trim();
    const nextColor = color.trim();

    if (!nextName) {
      return "Tag name is required.";
    }

    if (!isHexColor(nextColor)) {
      return "Tag color must be a 6-digit hex value.";
    }

    if (projectTags.some((tag) => tag.name.toLowerCase() === nextName.toLowerCase())) {
      return "A tag with that name already exists.";
    }

    const nextTags = [...projectTags, { name: nextName, color: nextColor }];
    setProjectTags(nextTags);
    persistProjectState(projectState, hiddenProjects, nextTags);
    return null;
  }

  function applyTagMutationToProjects(updater: (tags: string[]) => string[]) {
    const projects = Array.from(new Set([
      currentProject,
      ...projectOptions,
      ...Object.keys(projectSessionStates),
    ].filter(Boolean)));

    setProjectSessionStates((previous) => (
      Object.fromEntries(
        Object.entries(previous).map(([project, state]) => [project, updateSessionStateTags(state, updater)]),
      )
    ));

    void (async () => {
      try {
        const updates = await Promise.all(projects.map(async (project) => {
          const currentState = projectSessionStates[project]
            ? normalizeSessionState(projectSessionStates[project])
            : normalizeSessionState(await fetchProjectSessionState(project).catch(() => ({ threads: {} })));
          const nextState = updateSessionStateTags(currentState, updater);
          await saveProjectSessionState(project, nextState);
          return [project, nextState] as const;
        }));

        setProjectSessionStates((previous) => ({
          ...previous,
          ...Object.fromEntries(updates),
        }));
      } catch (error) {
        setActionError(getErrorMessage(error));
      }
    })();
  }

  function updateTag(currentName: string, nextName: string, color: string): string | null {
    const currentTag = projectTags.find((tag) => tag.name === currentName);
    const trimmedName = nextName.trim();
    const trimmedColor = color.trim();

    if (!currentTag) {
      return "Tag not found.";
    }

    if (PROTECTED_TAG_NAMES.has(currentTag.name.toLowerCase())) {
      return "That tag cannot be edited.";
    }

    if (!trimmedName) {
      return "Tag name is required.";
    }

    if (!isHexColor(trimmedColor)) {
      return "Tag color must be a 6-digit hex value.";
    }

    if (projectTags.some((tag) => (
      tag.name !== currentTag.name && tag.name.toLowerCase() === trimmedName.toLowerCase()
    ))) {
      return "A tag with that name already exists.";
    }

    const nextTags = projectTags.map((tag) => (
      tag.name === currentTag.name ? { name: trimmedName, color: trimmedColor } : tag
    ));
    setProjectTags(nextTags);
    persistProjectState(projectState, hiddenProjects, nextTags);

    if (trimmedName !== currentTag.name) {
      applyTagMutationToProjects((tags) => tags.map((tag) => (tag === currentTag.name ? trimmedName : tag)));
    }

    return null;
  }

  function deleteTag(name: string): string | null {
    const currentTag = projectTags.find((tag) => tag.name === name);
    if (!currentTag) {
      return "Tag not found.";
    }

    if (PROTECTED_TAG_NAMES.has(currentTag.name.toLowerCase())) {
      return "That tag cannot be deleted.";
    }

    const nextTags = projectTags.filter((tag) => tag.name !== currentTag.name);
    setProjectTags(nextTags);
    persistProjectState(projectState, hiddenProjects, nextTags);
    applyTagMutationToProjects((tags) => tags.filter((tag) => tag !== currentTag.name));
    return null;
  }

  function updateCurrentProjectSessionState(
    updater: (state: ProjectSessionStateSaveData) => ProjectSessionStateSaveData,
  ) {
    if (!currentProject) {
      return;
    }

    setProjectSessionStates((previous) => {
      const currentState = normalizeSessionState(previous[currentProject]);
      const nextState = updater(currentState);
      const normalizedState = normalizeSessionState(nextState);
      persistProjectSessionState(currentProject, normalizedState);
      return {
        ...previous,
        [currentProject]: normalizedState,
      };
    });
  }

  function updateThreadSessionState(threadId: string, updater: (state: { archived?: boolean; tags?: string[] }) => { archived?: boolean; tags?: string[] }) {
    updateCurrentProjectSessionState((state) => {
      const currentThreadState = state.threads[threadId] ?? {};
      const nextThreadState = updater(currentThreadState);
      const nextTags = Array.from(new Set((nextThreadState.tags ?? []).filter(Boolean)));
      const nextArchived = Boolean(nextThreadState.archived);
      const threads = { ...state.threads };

      if (nextTags.length === 0 && !nextArchived) {
        delete threads[threadId];
      } else {
        threads[threadId] = {
          ...(nextArchived ? { archived: true } : {}),
          ...(nextTags.length > 0 ? { tags: nextTags } : {}),
        };
      }

      return { threads };
    });
  }

  function toggleThreadTag(threadId: string, tagName: string) {
    updateThreadSessionState(threadId, (state) => {
      const tags = new Set(state.tags ?? []);
      if (tags.has(tagName)) {
        tags.delete(tagName);
      } else {
        tags.add(tagName);
      }
      return { ...state, tags: Array.from(tags) };
    });
  }

  function toggleThreadDone(threadId: string) {
    toggleThreadTag(threadId, DONE_TAG.name);
  }

  function toggleThreadArchived(threadId: string) {
    updateThreadSessionState(threadId, (state) => ({
      ...state,
      archived: !state.archived,
    }));
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
    projectTags,
    projectSessionStateByThreadId: currentProjectSessionState.threads,
    visibleProjects,
    addProject,
    createTag,
    deleteTag,
    hideProject,
    removeProject,
    removeProjectIcon,
    reorderProjects,
    saveProjectIcon,
    saveProjectName,
    selectProject,
    setCurrentProject,
    toggleThreadArchived,
    toggleThreadDone,
    toggleThreadTag,
    unhideProject,
    updateTag,
  };
}
