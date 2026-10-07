// Shapes shared between the server modules (qr.server.ts, google.server.ts,
// dashboard.server.ts) and the /app dashboard UI. Types only, no runtime code,
// so it is safe to import from both server and client files.

// ---------------------------------------------------------------- QR codes

export type QrCodeView = {
  id: string;
  token: string;
  // What the owner calls it, e.g. "Front counter stand".
  label: string;
  createdAt: string; // ISO string
  archived: boolean;
  scanCount: number; // all time
  scansLast7Days: number;
  lastScannedAt: string | null; // ISO string
  // The public URL encoded in the QR image, e.g.
  // https://www.uptrendscaling.com/q/abc123
  scanUrl: string;
  // Complete <svg>...</svg> markup of the QR image (dark modules on a white
  // background including the quiet zone), ready to inline or download.
  svg: string;
};

export type QrListResult =
  | { ok: true; codes: QrCodeView[] }
  | { ok: false; message: string };

export type QrMutationResult =
  | { ok: true; code?: QrCodeView }
  | { ok: false; message: string };

export type QrScanActivity = {
  id: string;
  scannedAt: Date;
  label: string; // the QR code's label
  city: string | null;
};

// ------------------------------------------------------------------ Google

export type GoogleStatus = {
  // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (and the shared db, auth and
  // encryption prerequisites) are all set on the server.
  configured: boolean;
  // A "google" row exists in crm_connections for this business.
  connected: boolean;
  // Refresh failed or access was revoked on Google's side.
  needsReconnect: boolean;
  // Connected, but the owner has not yet picked which business location.
  awaitingLocation: boolean;
  locationName: string | null;
  lastSyncedAt: string | null; // ISO string
  errorMessage: string | null;
};

export type GoogleLocationOption = {
  id: string;
  name: string;
  address: string | null;
};

export type GoogleSummary = {
  // True only when connected AND a location is chosen AND at least one
  // successful sync has stored data. Everything below is real, stored data
  // from the owner's own Google Business Profile; null / 0 / [] otherwise.
  connected: boolean;
  rating: number | null; // latest average rating, e.g. 4.9
  totalReviews: number | null;
  // rating now minus the rating from the snapshot closest to 90 days ago.
  // Null when we have no snapshot at least ~30 days old yet.
  ratingChange90d: number | null;
  // Counts of Google reviews by the date the reviewer posted them, in the
  // business's timezone.
  reviewsThisMonth: number;
  reviewsLastMonth: number;
  // Reviews our sync first saw within the last 24 hours.
  newSinceYesterday: number;
  // Last 52 weeks, oldest first. weekStart is the ISO date (YYYY-MM-DD) of
  // that week's Monday in the business's timezone.
  weeklyCounts: Array<{ weekStart: string; count: number }>;
  // Last 90 days of daily snapshots, oldest first. date is YYYY-MM-DD.
  ratingHistory: Array<{ date: string; rating: number }>;
  lastSyncedAt: Date | null;
  recentReviews: Array<{
    id: string;
    reviewerName: string | null;
    starRating: number;
    comment: string | null;
    reviewedAt: Date;
  }>;
};

export const EMPTY_GOOGLE_SUMMARY: GoogleSummary = {
  connected: false,
  rating: null,
  totalReviews: null,
  ratingChange90d: null,
  reviewsThisMonth: 0,
  reviewsLastMonth: 0,
  newSinceYesterday: 0,
  weeklyCounts: [],
  ratingHistory: [],
  lastSyncedAt: null,
  recentReviews: [],
};
