import { useState } from "react";

import type { AddProjectModalProps } from "../types";

export function AddProjectModal(props: AddProjectModalProps) {
  const [draft, setDraft] = useState("");

  function handleAddProject() {
    if (!draft.trim()) {
      return;
    }

    props.onAddProject(draft);
    setDraft("");
    props.onClose();
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Add project</h3>
        <input
          className="text-input"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAddProject();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
          placeholder="/path/to/project or ~/project"
        />
        <div className="modal-actions">
          <button type="button" className="button primary" onClick={handleAddProject} disabled={!draft.trim()}>
            Add
          </button>
          <button type="button" className="button secondary" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
