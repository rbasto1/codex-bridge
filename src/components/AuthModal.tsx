import { useEffect, useRef, useState } from "react";

import type { AuthModalProps } from "../types";

export function AuthModal(props: AuthModalProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const token = draft.trim();
    if (!token) {
      return;
    }

    props.onSubmit(token);
  }

  return (
    <div className="modal-backdrop auth-modal-backdrop">
      <div className="modal-card">
        <h3 className="modal-title">Authentication required</h3>
        <p className="modal-text">Enter the access token to continue.</p>
        <input
          ref={inputRef}
          className="text-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Access token"
        />
        {props.errorMessage ? <p className="modal-error">{props.errorMessage}</p> : null}
        <div className="modal-actions">
          <button type="button" className="button primary" onClick={handleSubmit} disabled={!draft.trim()}>
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}
