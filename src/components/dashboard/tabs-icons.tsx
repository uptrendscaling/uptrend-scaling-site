import type { ReactNode, SVGProps } from "react";

// A few more small icons for the Requests, Reports and QR codes tabs. Same
// style as icons.tsx: 24 by 24 box, drawn with the current text color,
// decorative (aria-hidden).

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({
  size = 16,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-5.2L8 19.5V16H7a2.5 2.5 0 0 1-2.5-2.5z" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v10M7.5 10l4.5 4.5 4.5-4.5M5 19h14" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
      <path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8" />
    </Svg>
  );
}

export function IconPrinter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 9V4.5h10V9" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <path d="M7 14h10v5.5H7z" />
    </Svg>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="4.5" rx="1.2" />
      <path d="M5 9.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9.5M10 13h4" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconBars(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19V11M12 19V5M19 19v-6" />
    </Svg>
  );
}
