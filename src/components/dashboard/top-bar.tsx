import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { logoutBusiness } from "../../lib/reviews.server";
import { cx, initialsOf } from "./format";
import {
  IconCaret,
  IconGear,
  IconLogout,
  IconShield,
  IconTrend,
} from "./icons";
import { NAV_TABS, type DashboardTab } from "./types";

function AccountMenu({
  trigger,
  businessName,
  email,
  isAdmin,
  align,
}: {
  trigger: ReactNode;
  businessName: string;
  email: string;
  isAdmin: boolean;
  align: "start" | "end";
}) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logoutBusiness();
    void navigate({ to: "/" });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="dash-menu"
          align={align}
          sideOffset={8}
          collisionPadding={12}
        >
          <div className="dash-menu-head">
            <strong>{businessName}</strong>
            <span>{email}</span>
          </div>
          <DropdownMenu.Item asChild>
            <Link
              to="/app"
              search={{ tab: "settings" }}
              className="dash-menu-item"
            >
              <IconGear size={15} />
              Settings
            </Link>
          </DropdownMenu.Item>
          {isAdmin ? (
            <DropdownMenu.Item asChild>
              <a href="/admin" className="dash-menu-item">
                <IconShield size={15} />
                Admin
              </a>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="dash-menu-sep" />
          <DropdownMenu.Item
            className="dash-menu-item"
            onSelect={() => void handleLogout()}
          >
            <IconLogout size={15} />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The dark bar across the top: logo, business name with a menu, the section
// tabs, a LIVE (or SETUP) status pill and the avatar menu. Tabs scroll
// sideways on phones.
export function DashTopBar({
  businessName,
  email,
  isAdmin,
  activeTab,
  live,
  todoCount,
  paused,
}: {
  businessName: string;
  email: string;
  isAdmin: boolean;
  activeTab: DashboardTab;
  live: boolean;
  todoCount: number;
  paused: boolean;
}) {
  const menuProps = { businessName, email, isAdmin };

  return (
    <header className="dash-topbar">
      <div className="dash-container dash-topbar-inner">
        <a className="dash-brand" href="/" aria-label="UpTrend Scaling home">
          <span className="dash-brand-mark" aria-hidden="true">
            <IconTrend size={17} />
          </span>
          <span className="dash-brand-name">
            UpTrend <em>Scaling</em>
          </span>
        </a>
        <span className="dash-topbar-divider" aria-hidden="true" />
        <AccountMenu
          {...menuProps}
          align="start"
          trigger={
            <button
              type="button"
              className="dash-switcher"
              aria-label="Account menu"
            >
              <span className="dash-switcher-name">{businessName}</span>
              <IconCaret size={14} />
            </button>
          }
        />
        {paused ? null : (
          <nav className="dash-nav" aria-label="Dashboard sections">
            {NAV_TABS.map((tab) => (
              <Link
                key={tab.id}
                to="/app"
                search={tab.id === "overview" ? {} : { tab: tab.id }}
                className={cx(
                  "dash-nav-tab",
                  activeTab === tab.id && "is-active",
                )}
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="dash-topbar-right">
          {paused ? (
            <span className="dash-live is-off">PAUSED</span>
          ) : live ? (
            <span
              className="dash-live"
              title="Everything is running. Your review link is set and nothing needs attention."
            >
              <i className="dash-live-dot" aria-hidden="true" />
              LIVE
            </span>
          ) : (
            <Link
              to="/app"
              search={{}}
              hash="dash-setup"
              className="dash-live is-warn"
              title="A few things need your attention. Open the setup checklist."
            >
              <i className="dash-live-dot" aria-hidden="true" />
              SETUP
              {todoCount > 0 ? <b>{todoCount}</b> : null}
            </Link>
          )}
          <AccountMenu
            {...menuProps}
            align="end"
            trigger={
              <button
                type="button"
                className="dash-avatar"
                aria-label="Account menu"
              >
                {initialsOf(businessName)}
              </button>
            }
          />
        </div>
      </div>
    </header>
  );
}
