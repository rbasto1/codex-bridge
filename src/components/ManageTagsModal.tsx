import { useState } from "react";

import type { TagDefinition } from "../types";
import { EditTagModal } from "./EditTagModal";

interface ManageTagsModalProps {
  tags: TagDefinition[];
  onUpdateTag: (currentName: string, nextName: string, color: string) => string | null;
  onDeleteTag: (name: string) => string | null;
  onCreateNew: () => void;
  onClose: () => void;
}

export function ManageTagsModal(props: ManageTagsModalProps) {
  const { tags, onUpdateTag, onDeleteTag, onCreateNew, onClose } = props;
  const [editingTag, setEditingTag] = useState<TagDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleDelete(tag: TagDefinition) {
    if (!window.confirm(`Delete tag "${tag.name}"? This removes it from all sessions.`)) {
      return;
    }

    const result = onDeleteTag(tag.name);
    if (result) {
      setError(result);
      return;
    }

    setError(null);
    if (editingTag?.name === tag.name) {
      setEditingTag(null);
    }
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card manage-tags-modal-card" onClick={(event) => event.stopPropagation()}>
          <h3 className="modal-title">Manage tags</h3>
          <p className="modal-text">Edit names and colors, or remove tags from all sessions.</p>

          <div className="manage-tags-list">
            {tags.length === 0 ? (
              <div className="modal-subtle">No custom tags yet.</div>
            ) : (
              tags.map((tag) => (
                <div key={tag.name} className="manage-tags-row">
                  <div className="manage-tags-summary">
                    <span className="session-tag-dot" style={{ backgroundColor: tag.color }} />
                    <span className="manage-tags-name">{tag.name}</span>
                  </div>

                  <div className="manage-tags-row-actions">
                    <button
                      type="button"
                      className="manage-tags-icon-button"
                      aria-label={`Edit ${tag.name}`}
                      title={`Edit ${tag.name}`}
                      onClick={() => {
                        setError(null);
                        setEditingTag(tag);
                      }}
                    >
                      <EditGlyph />
                    </button>
                    <button
                      type="button"
                      className="manage-tags-icon-button danger"
                      aria-label={`Delete ${tag.name}`}
                      title={`Delete ${tag.name}`}
                      onClick={() => handleDelete(tag)}
                    >
                      <TrashGlyph />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {error ? <div className="modal-error">{error}</div> : null}

          <div className="modal-actions split">
            <button type="button" className="button primary" onClick={onCreateNew}>
              New tag
            </button>
            <div className="modal-actions-group">
              <button type="button" className="button secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {editingTag ? (
        <EditTagModal
          tag={editingTag}
          onUpdateTag={onUpdateTag}
          onClose={() => setEditingTag(null)}
        />
      ) : null}
    </>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none">
      <path fill="currentColor" d="M14 4a.5.5 0 0 0 0-1zm7 6a.5.5 0 0 0-1 0zm-7-7H4v1h10zM3 4v16h1V4zm1 17h16v-1H4zm17-1V10h-1v10zm-1 1a1 1 0 0 0 1-1h-1zM3 20a1 1 0 0 0 1 1v-1zM4 3a1 1 0 0 0-1 1h1z" />
      <path stroke="currentColor" d="m17.5 4.5-8.458 8.458a.25.25 0 0 0-.06.098l-.824 2.47a.25.25 0 0 0 .316.316l2.47-.823a.25.25 0 0 0 .098-.06L19.5 6.5m-2-2 2.323-2.323a.25.25 0 0 1 .354 0l1.646 1.646a.25.25 0 0 1 0 .354L19.5 6.5m-2-2 2 2" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
