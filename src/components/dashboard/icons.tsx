import type { ReactNode, SVGProps } from "react";

// Small inline icons for the dashboard. 24 by 24 box, drawn with the current
// text color. Decorative by default (aria-hidden); pass a title via the
// surrounding element when an icon carries meaning on its own.

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

export function IconStar(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" stroke="none">
      <path d="M12 2.6l2.8 6 6.5.7-4.8 4.5 1.3 6.5L12 17l-5.8 3.3 1.3-6.5L2.7 9.3l6.5-.7z" />
    </Svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="M4 7.5l8 6 8-6" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V9h-4.5" />
    </Svg>
  );
}

export function IconQr(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" stroke="none">
      <path d="M4 4h6.5v6.5H4zM6 6v2.5h2.5V6zM13.5 4H20v6.5h-6.5zM15.5 6v2.5H18V6zM4 13.5h6.5V20H4zM6 15.5V18h2.5v-2.5zM13.5 13.5h2.5v2.5h-2.5zM17.5 13.5H20v2.5h-2.5zM13.5 17.5H16V20h-2.5zM17.5 17.5H20V20h-2.5z" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6l9.2 16H2.8z" />
      <path d="M12 10v4.4M12 17.4v.1" />
    </Svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.2-1.2" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2.2}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconCaret(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" stroke="none">
      <path d="M7 10h10l-5 6z" />
    </Svg>
  );
}

export function IconTriangle({
  direction = "up",
  ...props
}: IconProps & { direction?: "up" | "down" }) {
  return (
    <Svg {...props} fill="currentColor" stroke="none" viewBox="0 0 10 10">
      {direction === "up" ? (
        <path d="M5 2l3.4 5.6H1.6z" />
      ) : (
        <path d="M5 8L1.6 2.4h6.8z" />
      )}
    </Svg>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.4l2 1.2M17.8 15.4l2 1.2M4.2 16.6l2-1.2M17.8 8.6l2-1.2" />
    </Svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3.5" />
      <path d="M14 8l4 4-4 4M18 12H9.5" />
    </Svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7.5 2.8v5.6c0 4.6-3.2 8.2-7.5 9.6-4.3-1.4-7.5-5-7.5-9.6V5.8z" />
    </Svg>
  );
}

export function IconTrend(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2.2} viewBox="0 0 28 28">
      <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
    </Svg>
  );
}
