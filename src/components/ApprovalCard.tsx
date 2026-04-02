import { useState } from "react";

import { isRecord, type ThreadItem } from "../shared/codex.js";
import type { ApprovalCardProps } from "../types";
import { asString, extractFileChangePaths } from "../lib/threads";

export function ApprovalCard(props: ApprovalCardProps) {
  const { request, disabled, onRespond, relatedItem } = props;
  const [toolAnswers, setToolAnswers] = useState<Record<string, string>>({});

  if (request.method === "item/commandExecution/requestApproval") {
    const params = request.params ?? {};
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Command approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(params.reason) || "Codex wants to run a command."}</p>
        <pre className="code-slab">{asString(params.command) || "(command unavailable)"}</pre>
        <p className="approval-meta">cwd: {asString(params.cwd) || "unknown"}</p>
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "accept" } })}>
            Accept
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "decline" } })}>
            Decline
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "cancel" } })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/fileChange/requestApproval") {
    const paths = extractFileChangePaths(relatedItem as ThreadItem | undefined);
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">File change approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(request.params?.reason) || "Codex wants to apply file changes."}</p>
        <p className="approval-meta">{paths.length > 0 ? paths.join("\n") : "No file summary was available."}</p>
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "accept" } })}>
            Accept
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "decline" } })}>
            Decline
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "cancel" } })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/permissions/requestApproval") {
    const requestedPermissions = request.params?.permissions;
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Permission approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(request.params?.reason) || "Codex requested additional permissions."}</p>
        <pre className="code-slab">{JSON.stringify(requestedPermissions ?? {}, null, 2)}</pre>
        <div className="approval-actions">
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  permissions: requestedPermissions ?? {},
                  scope: "turn",
                },
              })
            }
          >
            Accept
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  permissions: {},
                  scope: "turn",
                },
              })
            }
          >
            Decline
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                error: {
                  code: -32001,
                  message: "User cancelled the permission request.",
                },
              })
            }
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/tool/requestUserInput") {
    const questions = Array.isArray(request.params?.questions) ? request.params.questions : [];

    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Tool input</span>
          <span className="badge danger">pending</span>
        </div>
        <div className="tool-question-list">
          {questions.map((question, index) => {
            if (!isRecord(question) || typeof question.id !== "string") {
              return null;
            }

            const questionId = question.id;
            const options = Array.isArray(question.options) ? question.options : null;
            const isSecret = Boolean(question.isSecret);
            const value = toolAnswers[questionId] ?? "";

            return (
              <div className="tool-question" key={questionId}>
                <span className="field-label">{asString(question.header) || `Question ${index + 1}`}</span>
                <span className="tool-question-copy">{asString(question.question)}</span>
                {options && options.length > 0 && !question.isOther ? (
                  <select
                    id={`${request.key}-${questionId}`}
                    className="select-input"
                    value={value}
                    onChange={(event) =>
                      setToolAnswers((previous) => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select an option</option>
                    {options.map((option) =>
                      isRecord(option) && typeof option.label === "string" ? (
                        <option key={`${questionId}-${option.label}`} value={option.label}>
                          {option.label}
                        </option>
                      ) : null,
                    )}
                  </select>
                ) : (
                  <input
                    id={`${request.key}-${questionId}`}
                    className="text-input"
                    type={isSecret ? "password" : "text"}
                    value={value}
                    onChange={(event) =>
                      setToolAnswers((previous) => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="approval-actions">
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  answers: Object.fromEntries(
                    questions
                      .map((question) => (isRecord(question) && typeof question.id === "string" ? question.id : null))
                      .filter((questionId): questionId is string => Boolean(questionId))
                      .map((questionId) => [questionId, { answers: toolAnswers[questionId] ? [toolAnswers[questionId]] : [] }]),
                  ),
                },
              })
            }
          >
            Send input
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                error: {
                  code: -32001,
                  message: "User cancelled the tool input request.",
                },
              })
            }
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="approval-card unsupported-card">
      <div className="approval-header">
        <span className="eyebrow">Unsupported request</span>
        <span className="badge danger">fallback</span>
      </div>
      <p className="approval-copy">{request.method}</p>
      <pre className="code-slab">{JSON.stringify(request.params ?? {}, null, 2)}</pre>
      <div className="approval-actions">
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() =>
            void onRespond(request, {
              error: {
                code: -32001,
                message: `Unsupported client request: ${request.method}`,
              },
            })
          }
        >
          Respond unsupported
        </button>
      </div>
    </div>
  );
}
