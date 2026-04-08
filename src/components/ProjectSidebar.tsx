import { useCallback, useDeferredValue, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const SESSION_RECENCY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MIN_VISIBLE_SESSION_COUNT = 5;

import { useAppStore } from "../client/store";
import { encodeProjectId, formatProjectTileLabel } from "../lib/projects";
import { useSidebarState } from "../hooks/useSidebarState";
import type { ProjectContextMenuState, ProjectSidebarProps } from "../types";
import { projectIconUrl } from "../client/api";
import { AddProjectModal } from "./AddProjectModal";
import { EditProjectModal } from "./EditProjectModal";
import { PreferencesModal } from "./PreferencesModal";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { SessionRow } from "./SessionRow";

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    activeThreadId,
    availableTags,
    backendStatus,
    currentProject,
    envHome,
    listLoading,
    overflowProjects,
    projectIconVersions,
    projectOptions,
    projectState,
    sendHotkey,
    sessionStateByThreadId,
    threadOrder,
    threadsById,
    visibleProjects,
    onAddProject,
    onHideProject,
    onOpenThread,
    onRemoveProject,
    onRemoveProjectIcon,
    onReorderProjects,
    onSaveProjectName,
    onSelectProject,
    onSelectSendHotkey,
    onStartThread,
    onUnhideProject,
    onUploadProjectIcon,
    onToggleThreadDone,
  } = props;
  const unreadThreadIds = useAppStore((state) => state.unreadThreadIds);

  const { isMobileViewport, sidebarCollapsed, setSidebarCollapsed, toggleSidebar } = useSidebarState();
  const [searchTerm, setSearchTerm] = useState("");
  const [showOlderSessions, setShowOlderSessions] = useState(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [showHiddenProjects, setShowHiddenProjects] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [contextMenuProject, setContextMenuProject] = useState<ProjectContextMenuState | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    project: string;
    dropIndex: number;
    pointerId: number;
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{
    project: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const dragStateRef = useRef<typeof dragState>(null);
  const visibleProjectsRef = useRef(visibleProjects);
  const reorderProjectsRef = useRef(onReorderProjects);
  const projectTileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const suppressProjectClickRef = useRef(false);
  const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());
  visibleProjectsRef.current = visibleProjects;
  reorderProjectsRef.current = onReorderProjects;

  const filteredThreadIds = threadOrder.filter((threadId) => {
    const thread = threadsById[threadId];
    if (!thread) {
      return false;
    }

    if (currentProject && thread.cwd !== currentProject) {
      return false;
    }

    if (!deferredSearchTerm) {
      return true;
    }

    const haystack = [thread.name ?? "", thread.preview, thread.cwd].join(" ").toLowerCase();
    return haystack.includes(deferredSearchTerm);
  });
  const visibleThreadIds = filteredThreadIds.filter((threadId) => !sessionStateByThreadId[threadId]?.archived);
  const archivedThreadIds = filteredThreadIds.filter((threadId) => sessionStateByThreadId[threadId]?.archived);
  const recentWindowStart = Math.floor(Date.now() / 1000) - SESSION_RECENCY_WINDOW_SECONDS;
  const recentVisibleThreadIds = visibleThreadIds.filter((threadId) => {
    const thread = threadsById[threadId];
    return thread ? thread.updatedAt >= recentWindowStart : false;
  });
  const primaryVisibleThreadIds = recentVisibleThreadIds.length >= MIN_VISIBLE_SESSION_COUNT
    ? recentVisibleThreadIds
    : visibleThreadIds.slice(0, MIN_VISIBLE_SESSION_COUNT);
  const primaryVisibleThreadIdSet = new Set(primaryVisibleThreadIds);
  const olderVisibleThreadIds = visibleThreadIds.filter((threadId) => !primaryVisibleThreadIdSet.has(threadId));
  const sidebarProjectLabel = (() => {
    if (!currentProject) {
      return "Codex Bridge";
    }

    const stateEntry = projectState.find((entry) => entry.id === currentProject);
    if (stateEntry?.name) {
      return stateEntry.name;
    }

    return currentProject.split("/").filter(Boolean).pop() ?? "Codex Bridge";
  })();
  const sidebarProjectPath = envHome && currentProject.startsWith(envHome)
    ? `~${currentProject.slice(envHome.length)}`
    : currentProject;

  function setProjectTileRef(project: string, element: HTMLButtonElement | null) {
    projectTileRefs.current[project] = element;
  }

  const computeDropIndex = useCallback((clientY: number, draggedProject: string) => {
    const remainingProjects = visibleProjectsRef.current.filter((project) => project !== draggedProject);
    for (let index = 0; index < remainingProjects.length; index += 1) {
      const element = projectTileRefs.current[remainingProjects[index]];
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return index;
      }
    }

    return remainingProjects.length;
  }, []);

  const clearDrag = useCallback(() => {
    pendingDragRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
  }, []);

  const handleWindowPointerMove = useCallback((event: PointerEvent) => {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag) {
      return;
    }

    if (event.pointerId !== pendingDrag.pointerId) {
      return;
    }

    const activeDrag = dragStateRef.current;
    if (!activeDrag) {
      const movedX = event.clientX - pendingDrag.startX;
      const movedY = event.clientY - pendingDrag.startY;
      if (Math.hypot(movedX, movedY) < 4) {
        return;
      }

      const nextDragState = {
        project: pendingDrag.project,
        dropIndex: computeDropIndex(event.clientY, pendingDrag.project),
        pointerId: pendingDrag.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: pendingDrag.offsetX,
        offsetY: pendingDrag.offsetY,
      };
      suppressProjectClickRef.current = true;
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
      return;
    }

    const nextDropIndex = computeDropIndex(event.clientY, activeDrag.project);
    const nextDragState = nextDropIndex === activeDrag.dropIndex
      && event.clientX === activeDrag.pointerX
      && event.clientY === activeDrag.pointerY
      ? activeDrag
      : {
        ...activeDrag,
        dropIndex: nextDropIndex,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
    if (nextDragState !== activeDrag) {
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    }
  }, [computeDropIndex]);

  const handleWindowPointerUp = useCallback((event: PointerEvent) => {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) {
      return;
    }

    const activeDrag = dragStateRef.current;
    if (activeDrag) {
      const reordered = visibleProjectsRef.current.filter((project) => project !== activeDrag.project);
      reordered.splice(activeDrag.dropIndex, 0, activeDrag.project);
      const currentProjects = visibleProjectsRef.current;
      const changed = reordered.length !== currentProjects.length
        || reordered.some((project, index) => project !== currentProjects[index]);
      if (changed) {
        reorderProjectsRef.current(reordered);
      }
    }

    clearDrag();
  }, [clearDrag]);

  useEffect(() => {
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", clearDrag);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", clearDrag);
    };
  }, [clearDrag, handleWindowPointerMove, handleWindowPointerUp]);

  function handleProjectPointerDown(project: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || event.ctrlKey || event.pointerType === "touch") {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    pendingDragRef.current = {
      project,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
  }

  const previewProjects = (() => {
    if (!dragState) {
      return visibleProjects;
    }

    const preview = visibleProjects.filter((project) => project !== dragState.project);
    preview.splice(dragState.dropIndex, 0, dragState.project);
    return preview;
  })();

  function openProject(project: string) {
    void (async () => {
      await onSelectProject(project);
      if (isMobileViewport()) {
        setSidebarCollapsed(true);
      }
    })();
  }

  function openThread(threadId: string) {
    onOpenThread(threadId, "live");
    if (isMobileViewport()) {
      setSidebarCollapsed(true);
    }
  }

  const editingProjectName = editingProject
    ? (projectState.find((entry) => entry.id === editingProject)?.name
      || editingProject.split("/").filter(Boolean).pop()
      || "")
    : "";

  function getProjectIndicatorState(project: string) {
    const hasRunningThread = threadOrder.some((threadId) => {
      const thread = threadsById[threadId];
      return thread?.cwd === project && thread.status.type === "active";
    });
    if (hasRunningThread) {
      return "running";
    }

    const hasUnreadThread = threadOrder.some((threadId) => {
      const thread = threadsById[threadId];
      return thread?.cwd === project && Boolean(unreadThreadIds[threadId]);
    });
    return hasUnreadThread ? "unread" : null;
  }

  function getProjectTileData(project: string) {
    const projectId = encodeProjectId(project);
    const stateEntry = projectState.find((entry) => entry.id === project);

    return {
      projectId,
      hasIcon: projectId in projectIconVersions,
      tileLabel: formatProjectTileLabel(stateEntry?.name || project),
      projectIndicatorState: getProjectIndicatorState(project),
    };
  }

  function renderSessionRow(threadId: string) {
    const activeTagNames = sessionStateByThreadId[threadId]?.tags ?? [];
    const activeTags = availableTags.filter((tag) => activeTagNames.includes(tag.name));

    return (
      <SessionRow
        key={threadId}
        threadId={threadId}
        active={threadId === activeThreadId}
        tags={activeTags}
        showUnread={Boolean(unreadThreadIds[threadId]) && threadId !== activeThreadId}
        onOpen={() => openThread(threadId)}
        onToggleDone={() => onToggleThreadDone(threadId)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop ${sidebarCollapsed ? "hidden" : ""}`}
        onClick={() => setSidebarCollapsed(true)}
      />

      {sidebarCollapsed ? (
        <button type="button" className="floating-toggle" onClick={toggleSidebar} title="Open sidebar">
          &#9776;
        </button>
      ) : null}

      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="project-rail">
          <div className="project-rail-brand" title="Codex Bridge">
            <img src="/codex-bridge-dark.png" alt="" className="project-rail-brand-logo" />
          </div>
          <div className="project-rail-list">
            {previewProjects.map((project) => {
              const { projectId, hasIcon, tileLabel, projectIndicatorState } = getProjectTileData(project);

              return (
                <div
                  key={project}
                  className={`project-tile-wrapper${dragState?.project === project ? " dragging" : ""}`}
                >
                  <button
                    ref={(element) => setProjectTileRef(project, element)}
                    type="button"
                    className={`project-tile ${project === currentProject ? "active" : ""}`}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => handleProjectPointerDown(project, event)}
                    onClick={(event) => {
                      if (suppressProjectClickRef.current) {
                        suppressProjectClickRef.current = false;
                        event.preventDefault();
                        return;
                      }
                      openProject(project);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenuProject({ project, x: event.clientX, y: event.clientY });
                    }}
                    onTouchStart={() => {
                      longPressTimerRef.current = window.setTimeout(() => {
                        const element = document.querySelector(`[data-project="${CSS.escape(project)}"]`);
                        const rect = element?.getBoundingClientRect();
                        setContextMenuProject({ project, x: (rect?.right ?? 64) + 4, y: rect?.top ?? 0 });
                      }, 500);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimerRef.current) {
                        window.clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    onTouchMove={() => {
                      if (longPressTimerRef.current) {
                        window.clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    title={project}
                    data-project={project}
                    data-drag-preview={dragState?.project === project ? "true" : undefined}
                  >
                    {hasIcon ? (
                      <img
                        src={`${projectIconUrl(projectId)}?v=${projectIconVersions[projectId]}`}
                        alt=""
                        className="project-tile-icon"
                        draggable={false}
                      />
                    ) : tileLabel}
                  </button>
                  {projectIndicatorState ? <span className={`project-status-dot ${projectIndicatorState}`} /> : null}
                </div>
              );
            })}

            {overflowProjects.length > 0 ? (
              <>
                <button
                  type="button"
                  className={`project-tile ${showHiddenProjects ? "active" : ""}`}
                  onClick={() => setShowHiddenProjects((value) => !value)}
                  title={showHiddenProjects ? "Collapse hidden projects" : "Show hidden projects"}
                >
                  {showHiddenProjects ? "\u25B2" : "\u2026"}
                </button>
                {showHiddenProjects ? overflowProjects.map((project) => {
                  const { projectId, hasIcon, tileLabel, projectIndicatorState } = getProjectTileData(project);

                  return (
                    <div key={project} className="project-tile-wrapper">
                      <button
                        type="button"
                        className={`project-tile ${project === currentProject ? "active" : ""}`}
                        onClick={() => {
                          onUnhideProject(project);
                          openProject(project);
                          setShowHiddenProjects(false);
                        }}
                        title={project}
                        data-project={project}
                      >
                        {hasIcon ? (
                          <img
                            src={`${projectIconUrl(projectId)}?v=${projectIconVersions[projectId]}`}
                            alt=""
                            className="project-tile-icon"
                            draggable={false}
                          />
                        ) : tileLabel}
                      </button>
                      {projectIndicatorState ? <span className={`project-status-dot ${projectIndicatorState}`} /> : null}
                    </div>
                  );
                }) : null}
              </>
            ) : null}

            <button
              type="button"
              className="project-tile project-tile-add"
              onClick={() => setShowAddProjectModal(true)}
              title="Add project"
            >
              +
            </button>

            {dragState ? (() => {
              const { projectId, hasIcon, tileLabel, projectIndicatorState } = getProjectTileData(dragState.project);

              return (
                <div
                  className="project-drag-overlay"
                  style={{
                    left: dragState.pointerX - dragState.offsetX,
                    top: dragState.pointerY - dragState.offsetY,
                  }}
                >
                  <div className="project-tile-wrapper dragging-overlay">
                    <div className={`project-tile ${dragState.project === currentProject ? "active" : ""}`}>
                      {hasIcon ? (
                        <img
                          src={`${projectIconUrl(projectId)}?v=${projectIconVersions[projectId]}`}
                          alt=""
                          className="project-tile-icon"
                          draggable={false}
                        />
                      ) : tileLabel}
                    </div>
                    {projectIndicatorState ? <span className={`project-status-dot ${projectIndicatorState}`} /> : null}
                  </div>
                </div>
              );
            })() : null}
          </div>

          <button
            type="button"
            className="project-tile"
            onClick={() => setShowPreferencesModal(true)}
            title="Preferences"
            aria-label="Preferences"
          >
            <SettingsGlyph />
          </button>
        </div>

        <div className="sidebar-panel">
          <div className="sidebar-header">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="sidebar-title">{sidebarProjectLabel}</h1>
              {currentProject ? <div className="sidebar-subtitle">{sidebarProjectPath}</div> : null}
            </div>
            <button type="button" className="sidebar-toggle" onClick={toggleSidebar} title="Collapse sidebar">
              &#x2190;
            </button>
          </div>

          <button
            type="button"
            className="sidebar-new-session"
            onClick={() => {
              onStartThread();
              if (isMobileViewport()) {
                setSidebarCollapsed(true);
              }
            }}
            disabled={backendStatus !== "ready"}
          >
            New Session
          </button>

          <input
            className="sidebar-search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search sessions..."
          />

          <div className="sidebar-stats">
            <span>{listLoading ? "Loading..." : `${filteredThreadIds.length} sessions`}</span>
          </div>

          <div className="session-list">
            {primaryVisibleThreadIds.map(renderSessionRow)}
            {showOlderSessions ? olderVisibleThreadIds.map(renderSessionRow) : null}
            {olderVisibleThreadIds.length > 0 || archivedThreadIds.length > 0 || showOlderSessions || showArchivedSessions ? (
              <div className="session-list-controls">
                {olderVisibleThreadIds.length > 0 || showOlderSessions ? (
                  <button
                    type="button"
                    className="session-load-more"
                    onClick={() => setShowOlderSessions((value) => !value)}
                  >
                    {showOlderSessions ? "Hide older sessions" : `Load more (${olderVisibleThreadIds.length} older)`}
                  </button>
                ) : null}
                {archivedThreadIds.length > 0 || showArchivedSessions ? (
                  <button
                    type="button"
                    className="session-load-more"
                    onClick={() => setShowArchivedSessions((value) => !value)}
                  >
                    {showArchivedSessions ? "Hide archived" : `Show archived (${archivedThreadIds.length})`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {showArchivedSessions ? archivedThreadIds.map(renderSessionRow) : null}
            {!listLoading && filteredThreadIds.length === 0 ? (
              <div className="empty-card small-empty">No sessions match the current project.</div>
            ) : null}
          </div>
        </div>
      </aside>

      <ProjectContextMenu
        contextMenuProject={contextMenuProject}
        projectState={projectState}
        onClose={() => setContextMenuProject(null)}
        onDeleteProject={onRemoveProject}
        onEditProject={(project) => setEditingProject(project)}
        onHideProject={onHideProject}
        projectHasSessions={(project) => threadOrder.some((threadId) => threadsById[threadId]?.cwd === project)}
      />

      {editingProject ? (
        <EditProjectModal
          project={editingProject}
          projectDisplayName={editingProjectName}
          projectIconVersion={projectIconVersions[encodeProjectId(editingProject)]}
          onClose={() => setEditingProject(null)}
          onRemoveProjectIcon={onRemoveProjectIcon}
          onSaveProjectName={onSaveProjectName}
          onUploadProjectIcon={onUploadProjectIcon}
        />
      ) : null}

      {showAddProjectModal ? (
        <AddProjectModal
          envHome={envHome}
          onAddProject={onAddProject}
          onClose={() => setShowAddProjectModal(false)}
          projectOptions={projectOptions}
        />
      ) : null}

      {showPreferencesModal ? (
        <PreferencesModal
          sendHotkey={sendHotkey}
          onClose={() => setShowPreferencesModal(false)}
          onSelectSendHotkey={onSelectSendHotkey}
        />
      ) : null}
    </>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M10.323 1.627c.828 0 1.595.439 2.014 1.154l.822 1.4.053.07c.062.06.145.096.233.096l1.615.013.154.007c.768.057 1.463.49 1.85 1.164l.329.571.073.136c.315.642.318 1.395.008 2.04l-.071.136-.803 1.422a.34.34 0 0 0 0 .329l.803 1.42.071.137c.31.645.308 1.398-.008 2.04l-.073.136-.328.571a2.34 2.34 0 0 1-1.85 1.165l-.155.005-1.615.014a.34.34 0 0 0-.233.097l-.053.068-.822 1.401a2.34 2.34 0 0 1-2.014 1.155h-.647c-.777 0-1.499-.387-1.931-1.024l-.082-.13-.822-1.402a.34.34 0 0 0-.2-.153l-.086-.012-1.615-.014A2.34 2.34 0 0 1 3.016 14.6l-.081-.13-.328-.572a2.34 2.34 0 0 1-.01-2.312l.802-1.421.033-.08a.34.34 0 0 0 0-.17l-.033-.08-.802-1.421a2.33 2.33 0 0 1 .01-2.312l.328-.571.081-.13A2.34 2.34 0 0 1 4.94 4.36l1.615-.013.086-.011a.34.34 0 0 0 .2-.155l.822-1.4.082-.13a2.34 2.34 0 0 1 1.931-1.024zm-.647 1.33c-.312 0-.603.144-.792.386l-.074.11-.821 1.401c-.26.443-.706.737-1.206.807l-.217.016-1.615.013c-.312.003-.603.15-.79.394l-.074.11-.328.571a1 1 0 0 0-.004.995l.802 1.421.095.196c.161.399.16.846 0 1.246l-.095.196-.802 1.42c-.174.31-.173.688.004.996l.328.57.075.11c.186.245.476.392.789.394l1.615.014.217.015c.5.07.946.366 1.206.808l.821 1.4.074.11c.189.242.48.388.792.388h.647c.356 0 .686-.19.867-.497l.821-1.4.122-.181c.31-.4.788-.639 1.301-.643l1.615-.014.132-.01c.304-.042.576-.223.732-.494l.328-.57.057-.118c.1-.243.102-.515.004-.758l-.057-.12-.803-1.42a1.67 1.67 0 0 1 0-1.638l.803-1.42.057-.12a1 1 0 0 0-.004-.758l-.057-.118-.328-.571a1 1 0 0 0-.732-.494l-.132-.01-1.615-.013a1.67 1.67 0 0 1-1.3-.642l-.123-.18-.821-1.401a1 1 0 0 0-.867-.497zM11.586 10A1.586 1.586 0 1 0 8.413 10 1.586 1.586 0 0 0 11.585 10m1.329 0a2.915 2.915 0 1 1-5.83 0 2.915 2.915 0 0 1 5.83 0" />
    </svg>
  );
}
