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
    </>
  );
}
