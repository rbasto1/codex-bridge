import { useDeferredValue, useRef, useState, type DragEvent } from "react";

import codexLogoUrl from "../../codex.svg";
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
    backendStatus,
    currentProject,
    listLoading,
    overflowProjects,
    projectIconVersions,
    projectState,
    threadOrder,
    threadsById,
    visibleProjects,
    doneThreadIds,
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
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showHiddenProjects, setShowHiddenProjects] = useState(false);
  const [contextMenuProject, setContextMenuProject] = useState<ProjectContextMenuState | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [draggedProject, setDraggedProject] = useState<string | null>(null);
  const [dragOverProject, setDragOverProject] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());

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

  const sidebarProjectLabel = (() => {
    if (!currentProject) {
      return "Codex Web";
    }

    const stateEntry = projectState.find((entry) => entry.id === currentProject);
    if (stateEntry?.name) {
      return stateEntry.name;
    }

    return currentProject.split("/").filter(Boolean).pop() ?? "Codex Web";
  })();

  function handleDragStart(project: string, event: DragEvent) {
    setDraggedProject(project);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", project);
  }

  function handleDragOver(project: string, event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (project !== dragOverProject) {
      setDragOverProject(project);
    }
  }

  function handleDrop(targetProject: string, event: DragEvent) {
    event.preventDefault();
    setDragOverProject(null);
    if (!draggedProject || draggedProject === targetProject) {
      setDraggedProject(null);
      return;
    }

    const fromIndex = visibleProjects.indexOf(draggedProject);
    const toIndex = visibleProjects.indexOf(targetProject);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedProject(null);
      return;
    }

    const reordered = [...visibleProjects];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedProject);
    onReorderProjects(reordered);
    setDraggedProject(null);
  }

  function handleDragEnd() {
    setDraggedProject(null);
    setDragOverProject(null);
  }

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
          <div className="project-rail-brand" title="Codex Web">
            <img src={codexLogoUrl} alt="" className="project-rail-brand-logo" />
          </div>
          <div className="project-rail-list">
            {visibleProjects.map((project) => {
              const projectId = encodeProjectId(project);
              const hasIcon = projectId in projectIconVersions;
              const stateEntry = projectState.find((entry) => entry.id === project);
              const tileLabel = formatProjectTileLabel(stateEntry?.name || project);
              const isDragOver = dragOverProject === project && draggedProject !== project;
              const projectHasUnread = threadOrder.some((threadId) => {
                const thread = threadsById[threadId];
                return thread?.cwd === project && Boolean(unreadThreadIds[threadId]) && thread.status.type !== "active";
              });

              return (
                <div
                  key={project}
                  className={`project-tile-wrapper${isDragOver ? " drag-over" : ""}${draggedProject === project ? " dragging" : ""}`}
                >
                  <button
                    type="button"
                    className={`project-tile ${project === currentProject ? "active" : ""}`}
                    draggable
                    onDragStart={(event) => handleDragStart(project, event)}
                    onDragOver={(event) => handleDragOver(project, event)}
                    onDrop={(event) => handleDrop(project, event)}
                    onDragEnd={handleDragEnd}
                    onClick={() => openProject(project)}
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
                  >
                    {hasIcon ? (
                      <img
                        src={`${projectIconUrl(projectId)}?v=${projectIconVersions[projectId]}`}
                        alt=""
                        className="project-tile-icon"
                      />
                    ) : tileLabel}
                    {projectHasUnread ? <span className="project-unread-dot" /> : null}
                  </button>
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
                  const projectId = encodeProjectId(project);
                  const hasIcon = projectId in projectIconVersions;
                  const stateEntry = projectState.find((entry) => entry.id === project);
                  const tileLabel = formatProjectTileLabel(stateEntry?.name || project);

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
                          />
                        ) : tileLabel}
                      </button>
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
          </div>
        </div>

        <div className="sidebar-panel">
          <div className="sidebar-header">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="sidebar-title">{sidebarProjectLabel}</h1>
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
            {filteredThreadIds.map((threadId) => (
              <SessionRow
                key={threadId}
                threadId={threadId}
                active={threadId === activeThreadId}
                done={Boolean(doneThreadIds[threadId])}
                showUnread={Boolean(unreadThreadIds[threadId]) && threadId !== activeThreadId}
                onOpen={() => openThread(threadId)}
                onToggleDone={() => onToggleThreadDone(threadId)}
              />
            ))}
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
          onAddProject={onAddProject}
          onClose={() => setShowAddProjectModal(false)}
        />
      ) : null}
    </>
  );
}
