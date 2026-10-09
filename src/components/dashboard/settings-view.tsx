import { useState, type FormEvent, type ReactNode } from "react";

import {
  disconnectConnection,
  type ConnectionSummary,
  type CrmProvider,
} from "../../lib/crm/connections.server";
import { PROVIDER_LABELS, ZAPIER_APP_URL } from "../../lib/crm/providers";
import { createZapierKey, getZapierKey } from "../../lib/crm/zapier.server";
import type { GoogleLocationOption } from "../../lib/dashboard-types";
import {
  setRepeatGuardEnabled,
  setWeeklySummaryEnabled,
} from "../../lib/dashboard.server";
import {
  chooseGoogleLocation,
  refreshGoogleNow,
} from "../../lib/google.server";
import { cancelMembership } from "../../lib/membership.server";
import { updateGoogleReviewUrl } from "../../lib/reviews.server";
import { agoPhrase, cx } from "./format";
import {
  DashAlert,
  DashButton,
  DashInput,
  DashPageHead,
  DashPanel,
  DashPill,
  DashSwitch,
  DashText,
} from "./primitives";
import type { DashboardShell } from "./types";
import { useNow } from "./use-now";

// ------------------------------------------------------- Google review link

function ReviewLinkPanel({
  initialUrl,
  onSaved,
}: {
  initialUrl: string | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateGoogleReviewUrl({
        data: { googleReviewUrl: url },
      });
      if (result.ok) {
        setMessage({ text: "Saved.", error: false });
        onSaved();
      } else {
        setMessage({ text: result.message ?? "Could not save.", error: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({
        text: "Could not save. Check the link and try again.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashPanel title="Your Google review link">
      <DashText>
        Every review request points customers here after they click their
        personal link.
      </DashText>
      <form className="dash-inline-form" onSubmit={handleSave}>
        <DashInput
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://g.page/r/your-business/review"
          aria-label="Your Google review link"
          required
        />
        <DashButton type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </DashButton>
      </form>
      {message ? (
        <p
          className={cx(
            "dash-form-message",
            message.error && "dash-form-message-error",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </DashPanel>
  );
}

// ------------------------------------------------------------- connections

function ConnectionRow({
  name,
  status,
  detail,
  actions,
  children,
}: {
  name: string;
  status: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dash-conn-row">
      <div className="dash-conn-main">
        <div className="dash-conn-name">
          <span>{name}</span>
          {status}
        </div>
        {detail ? <div className="dash-conn-detail">{detail}</div> : null}
        {children}
      </div>
      {actions ? <div className="dash-conn-actions">{actions}</div> : null}
    </div>
  );
}

function CrmConnectionRow({
  provider,
  connection,
  nowMs,
  onChanged,
}: {
  provider: "quickbooks" | "square" | "jobber";
  connection: ConnectionSummary | undefined;
  nowMs: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = PROVIDER_LABELS[provider];

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnectConnection({ data: { provider } });
      onChanged();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (!connection) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill>Not connected</DashPill>}
        detail={`Send a review request automatically when an invoice is paid in ${name}.`}
        actions={
          <DashButton
            href={`/connect/${provider}/start`}
            variant="primary"
            size="sm"
          >
            Connect
          </DashButton>
        }
      />
    );
  }

  const disconnect = (
    <DashButton
      variant="ghost"
      size="sm"
      onClick={() => void handleDisconnect()}
      disabled={busy}
    >
      {busy ? "Disconnecting..." : "Disconnect"}
    </DashButton>
  );

  if (connection.lastErrorMessage) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill tone="warn">Needs reconnect</DashPill>}
        detail={`We lost access to your ${name} account. New paid invoices will not get a review request until you reconnect.`}
        actions={
          <>
            <DashButton
              href={`/connect/${provider}/start`}
              variant="primary"
              size="sm"
            >
              Reconnect
            </DashButton>
            {disconnect}
          </>
        }
      />
    );
  }

  return (
    <ConnectionRow
      name={name}
      status={<DashPill tone="ok">Connected</DashPill>}
      detail={
        connection.lastEventAt
          ? `Last paid invoice ${agoPhrase(new Date(connection.lastEventAt).toISOString(), nowMs)}.`
          : "Listening for paid invoices. Nothing has come in yet."
      }
      actions={disconnect}
    />
  );
}

// Zapier (and anything else that can call our API): the owner creates a key
// here and pastes it into our Zapier app. Covers Housecall Pro, Workiz,
// ServiceM8 and thousands of other tools without a connector of our own.
function ZapierConnectionRow({
  connection,
  nowMs,
  onChanged,
}: {
  connection: ConnectionSummary | undefined;
  nowMs: number;
  onChanged: () => void;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "create" | "show" | "rotate" | "off">(
    null,
  );
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(
    kind: "create" | "show" | "rotate",
    action: () => Promise<
      { ok: true; key: string | null } | { ok: false; message: string }
    >,
  ) {
    setBusy(kind);
    setMessage(null);
    setCopied(false);
    try {
      const result = await action();
      if (result.ok) {
        setKey(result.key);
        if (kind !== "show") onChanged();
      } else {
        setMessage(result.message);
      }
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
      setConfirmRotate(false);
    }
  }

  async function handleTurnOff() {
    setBusy("off");
    try {
      await disconnectConnection({ data: { provider: "zapier" } });
      setKey(null);
      onChanged();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setMessage("Couldn't copy automatically. Select the key and copy it.");
    }
  }

  const openZapier = ZAPIER_APP_URL ? (
    <DashButton
      href={ZAPIER_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      variant="ghost"
      size="sm"
    >
      Open in Zapier
    </DashButton>
  ) : null;

  const keyBox = key ? (
    <div className="dash-key-box">
      <DashInput
        readOnly
        value={key}
        aria-label="Your Zapier API key"
        className="dash-key-input"
        onFocus={(event) => event.currentTarget.select()}
      />
      <DashButton size="sm" variant="primary" onClick={() => void handleCopy()}>
        {copied ? "Copied" : "Copy"}
      </DashButton>
    </div>
  ) : null;

  const help = (
    <p className="dash-key-help">
      In Zapier, add the UpTrend Scaling app, pick the{" "}
      <strong>Send Review Request</strong> action, and paste this key when it
      asks. Then choose your trigger, like &ldquo;Job completed&rdquo; in
      Housecall Pro or &ldquo;Invoice paid&rdquo; in QuickBooks. Only send for
      customers who agreed to be contacted. Treat the key like a password.
    </p>
  );

  if (!connection) {
    return (
      <ConnectionRow
        name="Zapier"
        status={<DashPill>Not connected</DashPill>}
        detail="Connect Housecall Pro, QuickBooks, Workiz, ServiceM8 and thousands of other apps through Zapier."
        actions={
          <>
            {openZapier}
            <DashButton
              variant="primary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run("create", () => createZapierKey())}
            >
              {busy === "create" ? "Creating..." : "Create API key"}
            </DashButton>
          </>
        }
      >
        {message ? <DashAlert tone="error">{message}</DashAlert> : null}
      </ConnectionRow>
    );
  }

  return (
    <ConnectionRow
      name="Zapier"
      status={<DashPill tone="ok">Connected</DashPill>}
      detail={
        connection.lastEventAt
          ? `Last review request from Zapier ${agoPhrase(new Date(connection.lastEventAt).toISOString(), nowMs)}.`
          : "Your API key is ready. Nothing has come in from Zapier yet."
      }
      actions={
        <>
          {openZapier}
          {key ? null : (
            <DashButton
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run("show", () => getZapierKey())}
            >
              {busy === "show" ? "Loading..." : "Show key"}
            </DashButton>
          )}
          {confirmRotate ? (
            <>
              <DashButton
                variant="danger"
                size="sm"
                disabled={busy !== null}
                onClick={() => void run("rotate", () => createZapierKey())}
              >
                {busy === "rotate" ? "Replacing..." : "Yes, replace it"}
              </DashButton>
              <DashButton
                variant="quiet"
                size="sm"
                onClick={() => setConfirmRotate(false)}
              >
                Keep current key
              </DashButton>
            </>
          ) : (
            <DashButton
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmRotate(true)}
            >
              New key
            </DashButton>
          )}
          <DashButton
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => void handleTurnOff()}
          >
            {busy === "off" ? "Turning off..." : "Turn off"}
          </DashButton>
        </>
      }
    >
      {confirmRotate ? (
        <p className="dash-key-help">
          A new key stops the old one right away. You&rsquo;ll need to paste the
          new key into Zapier.
        </p>
      ) : null}
      {keyBox}
      {key ? help : null}
      {message ? <DashAlert tone="error">{message}</DashAlert> : null}
    </ConnectionRow>
  );
}

function GoogleConnectionRow({
  shell,
  locations,
  locationsError,
  nowMs,
  onChanged,
}: {
  shell: DashboardShell;
  locations: GoogleLocationOption[] | null;
  locationsError: string | null;
  nowMs: number;
  onChanged: () => void;
}) {
  const google = shell.google;
  const name = PROVIDER_LABELS.google;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [picked, setPicked] = useState<string>(locations?.[0]?.id ?? "");

  async function handleDisconnect() {
    setBusy(true);
    setMessage(null);
    try {
      await disconnectConnection({ data: { provider: "google" } });
      onChanged();
    } catch (err) {
      console.error(err);
      setMessage({
        text: "Something went wrong. Please try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await refreshGoogleNow();
      if (result.ok) {
        setMessage({ text: "Updated just now.", error: false });
        onChanged();
      } else {
        setMessage({ text: result.message, error: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({
        text: "Something went wrong. Please try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose(event: FormEvent) {
    event.preventDefault();
    if (!picked) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await chooseGoogleLocation({
        data: { locationId: picked },
      });
      if (result.ok) {
        onChanged();
      } else {
        setMessage({ text: result.message, error: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({
        text: "Something went wrong. Please try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const feedback = message ? (
    <p
      className={cx(
        "dash-form-message",
        message.error && "dash-form-message-error",
      )}
    >
      {message.text}
    </p>
  ) : null;

  // Google has not approved us yet (or the keys are not set).
  if (!google.configured) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill>Coming soon</DashPill>}
        detail="Coming soon, pending Google approval. Once Google opens access you will be able to connect here and see your real rating and new reviews on your dashboard. Nothing is wrong on your end."
      />
    );
  }

  if (!google.connected) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill>Not connected</DashPill>}
        detail="Connect your Google account to see your real rating, your new reviews and how many you earn each week."
        actions={
          <DashButton href="/connect/google/start" variant="primary" size="sm">
            Connect Google
          </DashButton>
        }
      />
    );
  }

  const disconnect = (
    <DashButton
      variant="ghost"
      size="sm"
      onClick={() => void handleDisconnect()}
      disabled={busy}
    >
      Disconnect
    </DashButton>
  );

  if (google.needsReconnect) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill tone="warn">Needs reconnect</DashPill>}
        detail="Google access was lost, so your rating and new reviews have stopped updating."
        actions={
          <>
            <DashButton
              href="/connect/google/start"
              variant="primary"
              size="sm"
            >
              Reconnect
            </DashButton>
            {disconnect}
          </>
        }
      >
        {feedback}
      </ConnectionRow>
    );
  }

  if (google.awaitingLocation) {
    return (
      <ConnectionRow
        name={name}
        status={<DashPill tone="warn">Choose your location</DashPill>}
        detail="Your Google account is connected. Pick which business location is yours."
        actions={disconnect}
      >
        {locations && locations.length > 0 ? (
          <form className="dash-location-form" onSubmit={handleChoose}>
            <div
              className="dash-location-list"
              role="radiogroup"
              aria-label="Business location"
            >
              {locations.map((location) => (
                <label
                  key={location.id}
                  className={cx(
                    "dash-location",
                    picked === location.id && "is-picked",
                  )}
                >
                  <input
                    type="radio"
                    name="google-location"
                    value={location.id}
                    checked={picked === location.id}
                    onChange={() => setPicked(location.id)}
                  />
                  <span>
                    <strong>{location.name}</strong>
                    {location.address ? <em>{location.address}</em> : null}
                  </span>
                </label>
              ))}
            </div>
            <DashButton
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || !picked}
            >
              {busy ? "Saving..." : "Use this location"}
            </DashButton>
          </form>
        ) : (
          <p className="dash-form-message">
            {locationsError ??
              "We could not find any locations on that Google account yet."}
          </p>
        )}
        {feedback}
      </ConnectionRow>
    );
  }

  return (
    <ConnectionRow
      name={name}
      status={<DashPill tone="ok">Connected</DashPill>}
      detail={
        <>
          {google.locationName ? (
            <strong>{google.locationName}. </strong>
          ) : null}
          {google.lastSyncedAt
            ? `Last synced ${agoPhrase(google.lastSyncedAt, nowMs)}.`
            : "The first sync is on its way."}
          {google.errorMessage ? ` ${google.errorMessage}` : ""}
        </>
      }
      actions={
        <>
          <DashButton
            variant="ghost"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={busy}
          >
            {busy ? "Working..." : "Refresh now"}
          </DashButton>
          {disconnect}
        </>
      }
    >
      {feedback}
    </ConnectionRow>
  );
}

function ConnectionsPanel({
  shell,
  crmError,
  locations,
  locationsError,
  onChanged,
}: {
  shell: DashboardShell;
  crmError: CrmProvider | undefined;
  locations: GoogleLocationOption[] | null;
  locationsError: string | null;
  onChanged: () => void;
}) {
  const nowMs = useNow(shell.generatedAt);
  const byProvider = new Map(
    shell.connections.map((connection) => [connection.provider, connection]),
  );

  return (
    <DashPanel title="Connections">
      <DashText>
        Connect{" "}
        {shell.quickbooksOffered
          ? "QuickBooks, Square or Jobber"
          : "Jobber or Square"}{" "}
        and we&rsquo;ll automatically send a review request the moment an
        invoice is paid. Use Zapier for other apps. No manual entry needed. By
        connecting, you confirm your customers have already agreed to be
        contacted about their service.
      </DashText>
      {crmError ? (
        <DashAlert tone="error">
          Couldn&rsquo;t connect {PROVIDER_LABELS[crmError]}. Please try again.
        </DashAlert>
      ) : null}
      <div className="dash-conn-list">
        {shell.quickbooksOffered || byProvider.has("quickbooks") ? (
          <CrmConnectionRow
            provider="quickbooks"
            connection={byProvider.get("quickbooks")}
            nowMs={nowMs}
            onChanged={onChanged}
          />
        ) : null}
        <CrmConnectionRow
          provider="square"
          connection={byProvider.get("square")}
          nowMs={nowMs}
          onChanged={onChanged}
        />
        <CrmConnectionRow
          provider="jobber"
          connection={byProvider.get("jobber")}
          nowMs={nowMs}
          onChanged={onChanged}
        />
        <ZapierConnectionRow
          connection={byProvider.get("zapier")}
          nowMs={nowMs}
          onChanged={onChanged}
        />
        <GoogleConnectionRow
          shell={shell}
          locations={locations}
          locationsError={locationsError}
          nowMs={nowMs}
          onChanged={onChanged}
        />
      </div>
    </DashPanel>
  );
}

// ---------------------------------------------------------- weekly summary

function WeeklySummaryPanel({
  initialEnabled,
  onChanged,
}: {
  initialEnabled: boolean;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const result = await setWeeklySummaryEnabled({ data: { enabled: next } });
      if (result.ok) {
        onChanged();
      } else {
        setEnabled(!next);
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setEnabled(!next);
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashPanel title="Weekly summary email">
      <DashSwitch
        checked={enabled}
        onChange={(next) => void handleChange(next)}
        disabled={busy}
        label="Email me a summary every Monday"
        description="A short recap of last week: new reviews, requests sent and your rating."
      />
      {error ? (
        <p className="dash-form-message dash-form-message-error">{error}</p>
      ) : null}
    </DashPanel>
  );
}

// ------------------------------------------------------ repeat customers

function RepeatGuardPanel({
  initialEnabled,
  onChanged,
}: {
  initialEnabled: boolean;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const result = await setRepeatGuardEnabled({ data: { enabled: next } });
      if (result.ok) {
        onChanged();
      } else {
        setEnabled(!next);
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setEnabled(!next);
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashPanel title="Repeat customers">
      <DashSwitch
        checked={enabled}
        onChange={(next) => void handleChange(next)}
        disabled={busy}
        label="Ask each customer at most once every 90 days"
        description="Regulars (weekly lawn care, monthly pool service and so on) won't get a review request after every visit. Turn this off to ask after every paid job."
      />
      {error ? (
        <p className="dash-form-message dash-form-message-error">{error}</p>
      ) : null}
    </DashPanel>
  );
}

// ----------------------------------------------------------------- account

function AccountPanel({ shell }: { shell: DashboardShell }) {
  const { business } = shell;
  return (
    <DashPanel title="Your account">
      <dl className="dash-facts">
        <div>
          <dt>Business</dt>
          <dd>{business.businessName}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{business.contactName}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{business.email}</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{shell.timezone.replace(/_/g, " ")}</dd>
        </div>
      </dl>
      <DashText>
        Need to change any of this? Email{" "}
        <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
      </DashText>
    </DashPanel>
  );
}

// -------------------------------------------------------------- membership

// Cancel membership. Two steps on purpose: the first click only asks "are you
// sure?", the second does it. Canceling takes effect right away, so the page
// then reloads into the "Your subscription has ended" screen.
function MembershipPanel({
  plan,
  onChanged,
}: {
  plan: string | null;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      const result = await cancelMembership();
      if (result.ok) {
        // Stay on "Canceling..." until the dashboard reloads into the ended
        // screen, so a second click cannot happen.
        onChanged();
        return;
      }
      setError(result.message);
    } catch (err) {
      console.error(err);
      setError(
        "Something went wrong and nothing was changed. Please try again, or email hello@uptrendscaling.com.",
      );
    }
    setBusy(false);
  }

  return (
    <DashPanel title="Your membership">
      <DashText>
        {plan === "trial"
          ? "You are on the 7 day free trial. Cancel any time before it ends and you will not be charged anything."
          : "Cancel any time. Your access ends right away and you will not be billed again."}
      </DashText>
      {confirming ? (
        <>
          <DashAlert tone="warn">
            Cancel your membership? Your dashboard locks right away and review
            requests stop going out. Your customer data is kept.
          </DashAlert>
          <div className="dash-conn-actions">
            <DashButton
              variant="danger"
              onClick={() => void handleCancel()}
              disabled={busy}
            >
              {busy ? "Canceling..." : "Yes, cancel my membership"}
            </DashButton>
            <DashButton
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={busy}
            >
              Keep my membership
            </DashButton>
          </div>
        </>
      ) : (
        <div className="dash-conn-actions">
          <DashButton variant="danger" onClick={() => setConfirming(true)}>
            Cancel membership
          </DashButton>
        </div>
      )}
      {error ? (
        <p className="dash-form-message dash-form-message-error">{error}</p>
      ) : null}
    </DashPanel>
  );
}

// ----------------------------------------------------------------- the view

// Settings is a view, not a tab: it is reached from the avatar menu and from
// the integration chips (/app?tab=settings).
export function SettingsView({
  shell,
  crmError,
  locations,
  locationsError,
  refresh,
}: {
  shell: DashboardShell;
  crmError: CrmProvider | undefined;
  locations: GoogleLocationOption[] | null;
  locationsError: string | null;
  refresh: () => void;
}) {
  return (
    <div className="dash-stack dash-settings">
      <DashPageHead
        title="Settings"
        description="Your review link, your connections, your weekly email and your membership."
      />
      <ReviewLinkPanel
        initialUrl={shell.business.googleReviewUrl}
        onSaved={refresh}
      />
      <ConnectionsPanel
        shell={shell}
        crmError={crmError}
        locations={locations}
        locationsError={locationsError}
        onChanged={refresh}
      />
      <RepeatGuardPanel
        initialEnabled={shell.repeatGuardEnabled}
        onChanged={refresh}
      />
      <WeeklySummaryPanel
        initialEnabled={shell.weeklySummaryEnabled}
        onChanged={refresh}
      />
      <AccountPanel shell={shell} />
      <MembershipPanel plan={shell.business.plan} onChanged={refresh} />
    </div>
  );
}
