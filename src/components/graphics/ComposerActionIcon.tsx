import type { ComposerActionIconProps } from "../../types";

export function ComposerActionIcon(props: ComposerActionIconProps) {
  if (props.action === "stop") {
    return (
      <svg fill="none" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <rect x="5" y="5" width="10" height="10" fill="currentColor" />
      </svg>
    );
  }

  if (props.action === "steer") {
    return (
      <svg fill="none" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path
          d="M10 2.25 16.1 8.35 15.22 9.24 10.63 4.65v7.85H9.38V4.65L4.78 9.24l-.88-.88L10 2.25Z"
          fill="currentColor"
        />
        <path
          d="M3.75 14.25c0-1.66 1.34-3 3-3h3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M7.75 10.25 10.75 11.25 7.75 12.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.99991 2.24121L16.0921 8.33343L15.2083 9.21731L10.6249 4.63397V17.5001H9.37492V4.63398L4.7916 9.21731L3.90771 8.33343L9.99991 2.24121Z"
        fill="currentColor"
      />
    </svg>
  );
}
