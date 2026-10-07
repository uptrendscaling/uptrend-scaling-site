import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { QrCodeView } from "../../lib/dashboard-types";
import { createQrCode, listQrCodes } from "../../lib/qr.server";
import { dashButtonClass } from "./format";
import { IconQr, IconStar } from "./icons";
import { QrCard } from "./qr-card";
import {
  DashAlert,
  DashButton,
  DashEmpty,
  DashInput,
  DashPageHead,
  DashPanel,
} from "./primitives";
import { IconPlus } from "./tabs-icons";
import type { DashboardTabProps } from "./types";
import { useNow } from "./use-now";

// What a first code is called when the owner just presses the button without
// typing a name. Any later code needs a name (the server says so in plain
// words), because "which one is which" only matters with more than one.
const FIRST_CODE_NAME = "Main QR code";

// html[data-dash-print] is the marker the print stylesheet in styles.css
// looks for: while it is set, only the sign is printed, not the dashboard.
const PRINT_MARKER = "data-dash-print";

// ------------------------------------------------------------ create form

function CreateForm({
  first,
  onCreated,
}: {
  first: boolean;
  onCreated: (code: QrCodeView) => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const typed = label.trim();
      const result = await createQrCode({
        data: { label: typed || (first ? FIRST_CODE_NAME : "") },
      });
      if (result.ok && result.code) {
        setLabel("");
        onCreated(result.code);
      } else if (!result.ok) {
        // The server's own plain-language messages (empty name, name too
        // long, too many codes).
        setMessage(result.message);
      } else {
        setMessage("We couldn't make that QR code just now. Please try again.");
      }
    } catch (error) {
      console.error(error);
      setMessage("We couldn't make that QR code just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dash-qr-form" onSubmit={handleSubmit} noValidate>
      <div className="dash-inline-form">
        <DashInput
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Front counter"
          aria-label="Name for the new QR code"
          aria-invalid={message ? true : undefined}
          autoComplete="off"
        />
        <DashButton variant="primary" type="submit" disabled={busy}>
          <IconPlus size={14} />
          {busy
            ? "Creating..."
            : first
              ? "Create my first QR code"
              : "Create QR code"}
        </DashButton>
      </div>
      {message ? (
        <p className="dash-form-message dash-form-message-error" role="alert">
          {message}
        </p>
      ) : (
        <p className="dash-form-message dash-qr-form-hint">
          {first
            ? "Optional: give it a name first, like Front counter or Truck 2."
            : "A name helps you tell your codes apart, like Front counter or Truck 2."}
        </p>
      )}
    </form>
  );
}

// ------------------------------------------------------------- print sheet

// The sign that gets printed. It is on the page but hidden on screen; the
// print stylesheet hides everything else and shows only this.
function PrintSheet({
  businessName,
  code,
}: {
  businessName: string;
  code: QrCodeView;
}) {
  return (
    <div className="dash-print-sheet" aria-hidden="true">
      <p className="dash-print-business">{businessName}</p>
      <h2 className="dash-print-title">Leave us a Google review</h2>
      <div className="dash-print-stars">
        {Array.from({ length: 5 }, (_, index) => (
          <IconStar key={index} size={30} />
        ))}
      </div>
      <div
        className="dash-print-qr"
        dangerouslySetInnerHTML={{ __html: code.svg }}
      />
      <p className="dash-print-hint">Scan with your phone camera</p>
    </div>
  );
}

type CodesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; codes: QrCodeView[] };

// The QR codes tab: make a code, see how often it is scanned, copy its link,
// download it or print a sign, and archive the ones you no longer use.
export function QrTab({ business, shell }: DashboardTabProps) {
  const nowMs = useNow(shell.generatedAt);
  const [state, setState] = useState<CodesState>({ status: "loading" });
  const [printCode, setPrintCode] = useState<QrCodeView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listQrCodes();
      setState(
        result.ok
          ? { status: "ready", codes: result.codes }
          : { status: "error", message: result.message },
      );
    } catch (error) {
      console.error(error);
      setState({
        status: "error",
        message:
          "We couldn't load your QR codes just now. Please refresh and try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Printing: mark the page and which code to print, give the sign one
  // moment to draw, open the print dialog, and remove the marker again as
  // soon as the dialog closes (printed or cancelled) so the normal dashboard
  // is never left hidden.
  useEffect(() => {
    if (!printCode) return;
    const root = document.documentElement;
    root.setAttribute(PRINT_MARKER, "qr");
    const finish = () => {
      root.removeAttribute(PRINT_MARKER);
      setPrintCode(null);
    };
    window.addEventListener("afterprint", finish, { once: true });
    const timer = window.setTimeout(() => {
      try {
        window.print();
      } catch (error) {
        console.error(error);
        finish();
      }
    }, 60);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
      root.removeAttribute(PRINT_MARKER);
    };
  }, [printCode]);

  function handleCreated(code: QrCodeView) {
    setState((previous) =>
      previous.status === "ready"
        ? { status: "ready", codes: [code, ...previous.codes] }
        : previous,
    );
    setFlash(
      `Made "${code.label}". Print it, download it or copy its link below.`,
    );
  }

  function handleArchived(code: QrCodeView) {
    setState((previous) =>
      previous.status === "ready"
        ? {
            status: "ready",
            codes: previous.codes.filter((item) => item.id !== code.id),
          }
        : previous,
    );
    setFlash(`Archived "${code.label}".`);
  }

  const codes = state.status === "ready" ? state.codes : [];
  const noReviewLink = !business.googleReviewUrl;

  return (
    <div className="dash-stack">
      <div className="dash-qr-screen dash-stack">
        <DashPageHead
          title="QR codes"
          description="Print a code, put it where customers pay or wait. When they scan it they land on your Google review page, and we count every scan."
        />

        {noReviewLink ? (
          <DashAlert tone="warn" className="dash-qr-warn">
            <div className="dash-qr-warn-copy">
              <strong>Add your Google review link first.</strong>
              <span>
                Scans are counted, but anyone who scans will land on our home
                page until you add the link in Settings. You can make and print
                codes now. They start working properly the moment the link is
                saved.
              </span>
            </div>
            <Link
              to="/app"
              search={{ tab: "settings" }}
              className={dashButtonClass("primary", "sm")}
            >
              Add my review link
            </Link>
          </DashAlert>
        ) : null}

        {flash ? (
          <DashAlert tone="success" className="dash-qr-flash">
            {flash}
          </DashAlert>
        ) : null}

        {state.status === "loading" ? (
          <div className="dash-qr-grid" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="dash-qr-card dash-qr-skel">
                <span className="dash-skel dash-qr-skel-tile" />
                <span className="dash-skel" style={{ width: "55%" }} />
                <span className="dash-skel" style={{ width: "80%" }} />
              </div>
            ))}
          </div>
        ) : null}

        {state.status === "error" ? (
          <DashPanel>
            <DashAlert tone="error">{state.message}</DashAlert>
            <DashButton
              size="sm"
              onClick={() => {
                setState({ status: "loading" });
                void load();
              }}
            >
              Try again
            </DashButton>
          </DashPanel>
        ) : null}

        {state.status === "ready" && codes.length === 0 ? (
          <DashPanel>
            <DashEmpty
              icon={<IconQr size={18} />}
              title="No QR codes yet."
              action={<CreateForm first onCreated={handleCreated} />}
            >
              Make one for your counter, truck or invoices. It only takes a few
              seconds.
            </DashEmpty>
          </DashPanel>
        ) : null}

        {state.status === "ready" && codes.length > 0 ? (
          <>
            <DashPanel
              title="Make a new QR code"
              hint="One for each place you want people to scan"
            >
              <CreateForm first={false} onCreated={handleCreated} />
            </DashPanel>
            <ul className="dash-qr-grid" aria-label="Your QR codes">
              {codes.map((code) => (
                <QrCard
                  key={code.id}
                  code={code}
                  nowMs={nowMs}
                  onPrint={setPrintCode}
                  onArchived={handleArchived}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {printCode ? (
        <PrintSheet businessName={business.businessName} code={printCode} />
      ) : null}
    </div>
  );
}
