import { useRef, useState } from "react";

import type { QrCodeView } from "../../lib/dashboard-types";
import { archiveQrCode } from "../../lib/qr.server";
import { agoPhrase } from "./format";
import { DashButton } from "./primitives";
import {
  copyText,
  downloadBlob,
  downloadText,
  svgToPngBlob,
} from "./tabs-browser";
import { fileSlug, svgWithSize } from "./tabs-format";
import { IconArchive, IconCopy, IconDownload, IconPrinter } from "./tabs-icons";

const FILE_PIXELS = 1024;

function createdLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// One QR code: the image on a white tile (so it still scans on the dark
// page), the numbers, the link to copy, and the things you can do with it.
export function QrCard({
  code,
  nowMs,
  onPrint,
  onArchived,
}: {
  code: QrCodeView;
  nowMs: number;
  onPrint: (code: QrCodeView) => void;
  onArchived: (code: QrCodeView) => void;
}) {
  const linkRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "selected">("idle");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"png" | "archive" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const slug = fileSlug(code.label, "qr-code");

  async function handleCopy() {
    const copied = await copyText(code.scanUrl, linkRef.current);
    setCopy(copied ? "copied" : "selected");
    if (copied) window.setTimeout(() => setCopy("idle"), 2000);
  }

  function handleSvg() {
    setProblem(null);
    downloadText(
      svgWithSize(code.svg, FILE_PIXELS),
      `${slug}-qr.svg`,
      "image/svg+xml;charset=utf-8",
    );
  }

  async function handlePng() {
    setProblem(null);
    setBusy("png");
    try {
      downloadBlob(await svgToPngBlob(code.svg, FILE_PIXELS), `${slug}-qr.png`);
    } catch (error) {
      console.error(error);
      setProblem(
        "We couldn't make the PNG in this browser. Try Download SVG instead.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive() {
    setProblem(null);
    setBusy("archive");
    try {
      const result = await archiveQrCode({ data: { id: code.id } });
      if (result.ok) {
        onArchived(code);
        return;
      }
      setProblem(result.message);
    } catch (error) {
      console.error(error);
      setProblem(
        "We couldn't archive that QR code just now. Please try again.",
      );
    }
    setBusy(null);
  }

  const lastScan = code.lastScannedAt
    ? agoPhrase(code.lastScannedAt, nowMs)
    : "Never";

  return (
    <li className="dash-qr-card">
      <div
        className="dash-qr-tile"
        role="img"
        aria-label={`QR code for ${code.label}`}
        // The markup comes from our own server (numbers and path data only,
        // never the owner's text), so it is safe to inline.
        dangerouslySetInnerHTML={{ __html: code.svg }}
      />

      <div className="dash-qr-name">
        <h3>{code.label}</h3>
        <span>Made {createdLabel(code.createdAt)}</span>
      </div>

      <dl className="dash-qr-stats">
        <div>
          <dt>Total scans</dt>
          <dd>{code.scanCount.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Last 7 days</dt>
          <dd>{code.scansLast7Days.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Last scanned</dt>
          <dd className={code.lastScannedAt ? undefined : "is-none"}>
            {lastScan}
          </dd>
        </div>
      </dl>

      <div className="dash-qr-link">
        <input
          ref={linkRef}
          className="dash-input dash-qr-url"
          value={code.scanUrl}
          readOnly
          aria-label={`Scan link for ${code.label}`}
          title={code.scanUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
        <DashButton size="sm" onClick={() => void handleCopy()}>
          <IconCopy size={14} />
          {copy === "copied" ? "Copied" : "Copy"}
        </DashButton>
      </div>
      {copy === "selected" ? (
        <p className="dash-qr-msg">
          The link is selected. Press Ctrl+C (or Cmd+C on a Mac) to copy it.
        </p>
      ) : null}

      {confirming ? (
        <div className="dash-qr-confirm" role="group" aria-label="Archive">
          <p>
            <strong>Archive this code?</strong> It leaves this list. Anyone who
            scans a printed copy still reaches your review page, and the scans
            still count in your reports.
          </p>
          <div className="dash-qr-confirm-actions">
            <DashButton
              variant="danger"
              size="sm"
              disabled={busy === "archive"}
              onClick={() => void handleArchive()}
            >
              {busy === "archive" ? "Archiving..." : "Yes, archive it"}
            </DashButton>
            <DashButton
              variant="quiet"
              size="sm"
              disabled={busy === "archive"}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </DashButton>
          </div>
        </div>
      ) : (
        <div className="dash-qr-actions">
          <DashButton size="sm" onClick={handleSvg}>
            <IconDownload size={14} />
            Download SVG
          </DashButton>
          <DashButton
            size="sm"
            disabled={busy === "png"}
            onClick={() => void handlePng()}
          >
            <IconDownload size={14} />
            {busy === "png" ? "Making PNG..." : "Download PNG"}
          </DashButton>
          <DashButton size="sm" onClick={() => onPrint(code)}>
            <IconPrinter size={14} />
            Print
          </DashButton>
          <DashButton
            size="sm"
            variant="quiet"
            onClick={() => {
              setProblem(null);
              setConfirming(true);
            }}
          >
            <IconArchive size={14} />
            Archive
          </DashButton>
        </div>
      )}
      {problem ? <p className="dash-qr-msg is-error">{problem}</p> : null}
    </li>
  );
}
