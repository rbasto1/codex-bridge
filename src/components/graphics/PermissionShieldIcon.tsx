import type { PermissionShieldIconProps } from "../../types";

export function PermissionShieldIcon(props: PermissionShieldIconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="composer-permission-icon">
      <path
        d="M8 1.5 13 3.4v3.7c0 3-2 5.7-5 7.4-3-1.7-5-4.4-5-7.4V3.4L8 1.5Z"
        fill={props.active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.8 7.8 7.3 9.3 10.4 6.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
