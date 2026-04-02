import type { ProjectContextMenuProps } from "../types";

export function ProjectContextMenu(props: ProjectContextMenuProps) {
  if (!props.contextMenuProject) {
    return null;
  }

  const { project, x, y } = props.contextMenuProject;

  return (
    <div className="context-menu-backdrop" onClick={props.onClose}>
      <div
        className="context-menu"
        style={{ top: y, left: x }}
        onClick={(event) => event.stopPropagation()}
      >
        {props.projectHasSessions(project) ? (
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              props.onHideProject(project);
              props.onClose();
            }}
          >
            Hide
          </button>
        ) : (
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              props.onDeleteProject(project);
              props.onClose();
            }}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="context-menu-item"
          onClick={() => {
            props.onEditProject(project);
            props.onClose();
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}
