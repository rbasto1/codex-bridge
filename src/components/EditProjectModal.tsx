import { useEffect, useRef, useState } from "react";

import { encodeProjectId } from "../lib/projects";
import type { EditProjectModalProps } from "../types";
import { projectIconUrl } from "../client/api";

export function EditProjectModal(props: EditProjectModalProps) {
  const [draftName, setDraftName] = useState(props.projectDisplayName);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const projectId = encodeProjectId(props.project);

  useEffect(() => {
    setDraftName(props.projectDisplayName);
  }, [props.project, props.projectDisplayName]);

  function handleSave() {
    props.onSaveProjectName(props.project, draftName);
    props.onClose();
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Edit project</h3>
        <label className="field-label">Display name</label>
        <input
          className="text-input"
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
          placeholder="Project name"
        />
        <label className="field-label" style={{ marginTop: 12 }}>Icon</label>
        <div className="icon-upload-area">
          {props.projectIconVersion ? (
            <div className="icon-upload-preview">
              <img
                src={`${projectIconUrl(projectId)}?v=${props.projectIconVersion}`}
                alt="Project icon"
                className="icon-upload-img"
              />
              <button type="button" className="button secondary" onClick={() => void props.onRemoveProjectIcon(props.project)}>
                Remove
              </button>
            </div>
          ) : (
            <label className="icon-upload-btn">
              Upload image
              <input
                ref={iconInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  void props.onUploadProjectIcon(props.project, file);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button primary" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="button secondary" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
