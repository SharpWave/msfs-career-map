import { forwardRef, type ButtonHTMLAttributes } from "react";

/** Line icons on a 24-unit grid, drawn in the current text color. */
const PATHS = {
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  sidebar: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9.5 4v16",
  layers: "M12 3.5 3 8.25 12 13l9-4.75L12 3.5zM3 12.25 12 17l9-4.75M3 16.25 12 21l9-4.75",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  "eye-off": "M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  trash: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  "arrow-up": "M12 19V5M6 11l6-6 6 6",
  "arrow-down": "M12 5v14M6 13l6 6 6-6",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
} as const;

export type IconName = keyof typeof PATHS;

// @spec APP-UI-026
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon-svg ${className}` : "icon-svg"}
      data-icon={name}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label"> & {
  icon: IconName;
  /** What the button does; its accessible name and its tooltip. */
  label: string;
};

/** A button that shows only an icon, named by `label` for screen readers and on hover. */
// @spec APP-UI-026
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={className ? `icon ${className}` : "icon"} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
});
