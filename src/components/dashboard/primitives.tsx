// Presentational building blocks for every dashboard tab. Props in, markup
// out: no data fetching here. The matching CSS lives in the dash-* block at
// the end of src/styles.css, so a screen built from these looks like the
// Overview tab without any extra styling.

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cx, dashButtonClass, type ButtonVariant } from "./format";
import { IconTriangle } from "./icons";
import type { PillTone } from "./types";

// ------------------------------------------------------------------ layout

// Title row at the top of a tab: "Customers" plus one line of explanation.
export function DashPageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="dash-page-head">
      <div>
        <h1 className="dash-page-title">{title}</h1>
        {description ? <p className="dash-page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="dash-page-actions">{actions}</div> : null}
    </div>
  );
}

// A bordered 12px card with an optional header: title, muted hint beside it
// ("last 12 weeks") and a slot on the right (usually a DashSegmented).
export function DashPanel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section className={cx("dash-panel", className)} id={id}>
      {title || actions ? (
        <div className="dash-panel-head">
          <div className="dash-panel-title">
            {title ? <h2>{title}</h2> : null}
            {hint ? <span className="dash-panel-hint">{hint}</span> : null}
          </div>
          {actions ? <div className="dash-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx("dash-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

// Plain explanatory paragraph used inside panels.
export function DashText({
  children,
  muted = true,
  className,
}: {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <p className={cx("dash-text", muted && "dash-text-muted", className)}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------- controls

// 4W / 12W / YTD style toggle. `value` is the active option.
export function DashSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="dash-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("dash-seg-btn", option.value === value && "is-active")}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Small rounded label. tone "up" and "down" add a little triangle.
export function DashPill({
  tone = "muted",
  children,
  className,
}: {
  tone?: PillTone | "warn" | "ok";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("dash-pill", `dash-pill-${tone}`, className)}>
      {tone === "up" || tone === "down" ? (
        <IconTriangle direction={tone} size={8} />
      ) : null}
      {children}
    </span>
  );
}

type DashButtonBase = {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
  children: ReactNode;
};

// A button. Pass href to get a link that looks the same.
export function DashButton(
  props: DashButtonBase &
    (
      | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
      | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
    ),
) {
  const { variant, size, className, children, ...rest } = props;
  const classes = dashButtonClass(variant, size, className);
  if ("href" in rest && rest.href !== undefined) {
    const anchorProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a {...anchorProps} className={classes}>
        {children}
      </a>
    );
  }
  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" {...buttonProps} className={classes}>
      {children}
    </button>
  );
}

export function DashInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("dash-input", className)} {...rest} />;
}

export function DashSelect({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("dash-input dash-select", className)} {...rest} />
  );
}

export function DashTextarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cx("dash-input dash-textarea", className)} {...rest} />
  );
}

// Label + control + optional hint, stacked.
export function DashField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("dash-field", className)}>
      <span className="dash-field-label">{label}</span>
      {children}
      {hint ? <span className="dash-field-hint">{hint}</span> : null}
    </label>
  );
}

// On/off switch with a visible label.
export function DashSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="dash-switch-row">
      <div className="dash-switch-copy">
        <div className="dash-switch-label">{label}</div>
        {description ? (
          <div className="dash-switch-desc">{description}</div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cx("dash-switch", checked && "is-on")}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="dash-switch-knob" />
      </button>
    </div>
  );
}

// -------------------------------------------------------------- feedback

export function DashAlert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "error" | "success" | "warn";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("dash-alert", `dash-alert-${tone}`, className)}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

// Friendly "nothing here yet" block.
export function DashEmpty({
  icon,
  title,
  children,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("dash-empty", compact && "dash-empty-compact")}>
      {icon ? <span className="dash-empty-icon">{icon}</span> : null}
      <p className="dash-empty-title">{title}</p>
      {children ? <p className="dash-empty-text">{children}</p> : null}
      {action ? <div className="dash-empty-action">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- tables

// Dark table inside a horizontally scrolling wrapper (phones). Put plain
// <thead>/<tbody> inside. Use .dash-cell-strong and .dash-cell-muted on
// cells for a bold name and a muted second line.
export function DashTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="dash-table-wrap">
      <table className={cx("dash-table", className)}>{children}</table>
    </div>
  );
}
