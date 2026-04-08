import { useState } from "react";

import type { TagDefinition } from "../types";

const DEFAULT_TAG_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#14b8a6",
  "#64748b",
];

interface EditTagModalProps {
  tag: TagDefinition;
  onUpdateTag: (currentName: string, nextName: string, color: string) => string | null;
  onClose: () => void;
}

export function EditTagModal(props: EditTagModalProps) {
  const { tag, onUpdateTag, onClose } = props;
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const result = onUpdateTag(tag.name, name, color);
    if (result) {
      setError(result);
      return;
    }

    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Edit tag</h3>
        <input
          className="text-input"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Tag name"
        />
        <div className="create-tag-colors">
          {DEFAULT_TAG_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`session-tag-color-swatch ${color.toLowerCase() === entry.toLowerCase() ? "active" : ""}`}
              style={{ backgroundColor: entry }}
              onClick={() => setColor(entry)}
              title={entry}
              aria-label={`Select ${entry}`}
            />
          ))}
        </div>
        <input
          className="text-input"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          placeholder="#22c55e"
        />
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="button primary" onClick={handleSave} disabled={!name.trim()}>
            Save
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
