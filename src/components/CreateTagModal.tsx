import { useState } from "react";

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

interface CreateTagModalProps {
  onCreateTag: (name: string, color: string) => string | null;
  onToggleTag: (name: string) => void;
  onClose: () => void;
}

export function CreateTagModal(props: CreateTagModalProps) {
  const { onCreateTag, onToggleTag, onClose } = props;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_TAG_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const result = onCreateTag(name, color);
    if (result) {
      setError(result);
      return;
    }

    onToggleTag(name.trim());
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Create new tag</h3>
        <input
          className="text-input"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleCreate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Tag name"
        />
        <div className="create-tag-colors">
          {DEFAULT_TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`session-tag-color-swatch ${color.toLowerCase() === c.toLowerCase() ? "active" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              title={c}
              aria-label={`Select ${c}`}
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
          <button type="button" className="button primary" onClick={handleCreate} disabled={!name.trim()}>
            Create
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
