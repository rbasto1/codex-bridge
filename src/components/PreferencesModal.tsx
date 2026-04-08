import type { PreferencesModalProps } from "../types";

export function PreferencesModal(props: PreferencesModalProps) {
  return (
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-scrim"
        aria-label="Close preferences dialog"
        onClick={props.onClose}
      />
      <div
        className="modal-card preferences-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-modal-title"
      >
        <h3 id="preferences-modal-title" className="modal-title">Preferences</h3>

        <section className="preferences-section">
          <h4 className="preferences-section-title">Keyboard</h4>
          <p className="modal-text">
            Choose how sending works on desktop. Shift+Enter always inserts a new line. On mobile, Enter always inserts a new line.
          </p>

          <div className="preferences-option-list" role="radiogroup" aria-label="Send message shortcut">
            <label className="preferences-option">
              <input
                type="radio"
                name="send-hotkey"
                checked={props.sendHotkey === "enter"}
                onChange={() => props.onSelectSendHotkey("enter")}
              />
              <span className="preferences-option-body">
                <span className="preferences-option-title">Enter sends</span>
                <span className="preferences-option-description">Press Shift+Enter for a new line.</span>
              </span>
            </label>

            <label className="preferences-option">
              <input
                type="radio"
                name="send-hotkey"
                checked={props.sendHotkey === "mod-enter"}
                onChange={() => props.onSelectSendHotkey("mod-enter")}
              />
              <span className="preferences-option-body">
                <span className="preferences-option-title">Ctrl/Cmd+Enter sends</span>
                <span className="preferences-option-description">Press Enter for a new line.</span>
              </span>
            </label>
          </div>
        </section>

        <div className="modal-actions">
          <button type="button" className="button primary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
