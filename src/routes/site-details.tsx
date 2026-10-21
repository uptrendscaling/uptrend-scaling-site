import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { z } from "zod";

import { SiteStatus } from "../components/site-status";
import { ThemeToggle } from "../components/theme-toggle";
import { shrinkImage } from "../lib/site-gen/image-client";
import {
  deleteSiteAsset,
  getMySiteState,
  submitSiteBrief,
  uploadSiteAsset,
  type MySiteState,
} from "../lib/site-gen/sites.server";
import {
  HIGHLIGHTS,
  SITE_STYLES,
  SITE_STYLE_INFO,
  TRADES,
  type SiteStyle,
} from "../lib/site-gen/types";
import siteDetailsCss from "../site-details.css?url";

// Where a customer who bought a website tells us about their business. Reached
// from the link in their order email (?b=<id>&t=<token>, no login needed) or
// from their dashboard while signed in.
const searchSchema = z.object({
  b: z.string().trim().uuid().optional().catch(undefined),
  t: z.string().trim().max(80).optional().catch(undefined),
});

export const Route = createFileRoute("/site-details")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Your website | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: siteDetailsCss }],
  }),
  component: SiteDetailsPage,
});

const SWATCHES = [
  "#2457ff",
  "#0ea5e9",
  "#16a34a",
  "#15803d",
  "#facc15",
  "#f59e0b",
  "#e8872b",
  "#b8532a",
  "#d58f61",
  "#111827",
  "#6b7280",
  "#7c3aed",
];

type Ready = Extract<MySiteState, { ok: true }>;

function SiteDetailsPage() {
  const { b, t } = Route.useSearch();
  const auth = { ...(b ? { businessId: b } : {}), ...(t ? { token: t } : {}) };
  const [state, setState] = useState<MySiteState | null>(null);

  const load = useCallback(() => {
    getMySiteState({ data: auth })
      .then(setState)
      .catch(() => setState({ ok: false, reason: "no_site" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="site-shell start-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="/" aria-label="UpTrend Scaling home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28">
                <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
              </svg>
            </span>
            <span>
              UpTrend <em>Scaling</em>
            </span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main className="sd">
        {state === null ? (
          <p className="sd-lead">Loading...</p>
        ) : !state.ok ? (
          <>
            <h1>We could not find your website order</h1>
            <p className="sd-lead">
              {state.reason === "not_signed_in"
                ? "Open the link in your order email, or log in to your dashboard."
                : "If you just paid, give it a minute and refresh. Still stuck? Email hello@uptrendscaling.com."}
            </p>
            <a className="sd-btn pri" href="/login">
              Log in
            </a>
          </>
        ) : (
          <Loaded state={state} auth={auth} reload={load} />
        )}
      </main>
    </div>
  );
}

function Loaded({
  state,
  auth,
  reload,
}: {
  state: Ready;
  auth: { businessId?: string; token?: string };
  reload: () => void;
}) {
  const here =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/site-details";
  return (
    <>
      <h1>
        {state.status === "awaiting_details"
          ? "Tell us about your business"
          : "Your website"}
      </h1>
      <p className="sd-lead">
        {state.status === "awaiting_details"
          ? `Thanks for your order. Answer a few questions and we will build ${state.businessName}'s website. You approve it before it goes live.`
          : state.businessName}
      </p>
      <SiteStatus
        state={state}
        auth={auth}
        detailsHref={here}
        onChanged={reload}
      />
      {state.status === "awaiting_details" ? (
        <BriefForm state={state} auth={auth} onDone={reload} />
      ) : null}
    </>
  );
}

function BriefForm({
  state,
  auth,
  onDone,
}: {
  state: Ready;
  auth: { businessId?: string; token?: string };
  onDone: () => void;
}) {
  const saved = state.brief;
  const [businessName, setBusinessName] = useState(
    saved?.businessName ?? state.defaults.businessName,
  );
  const [trade, setTrade] = useState(saved?.trade ?? "HVAC");
  const [city, setCity] = useState(saved?.city ?? "");
  const [stateCode, setStateCode] = useState(saved?.state ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? state.defaults.phone);
  const [email, setEmail] = useState(saved?.email ?? state.defaults.email);
  const [services, setServices] = useState(saved?.services.join("\n") ?? "");
  const [serviceArea, setServiceArea] = useState(saved?.serviceArea ?? "");
  const [years, setYears] = useState(
    saved?.yearsInBusiness ? String(saved.yearsInBusiness) : "",
  );
  const [highlights, setHighlights] = useState<string[]>(
    saved?.highlights ?? [],
  );
  const [about, setAbout] = useState(saved?.about ?? "");
  const [special, setSpecial] = useState(saved?.specialRequests ?? "");
  const [hours, setHours] = useState(saved?.hours ?? "");
  const [style, setStyle] = useState<SiteStyle>(saved?.style ?? "warm");
  const [accent, setAccent] = useState(
    saved?.accent ?? SITE_STYLE_INFO.warm.defaultAccent,
  );
  const accentTouched = useRef(Boolean(saved));
  const [assets, setAssets] = useState(state.assets);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logo = assets.find((a) => a.kind === "logo") ?? null;
  const photos = assets.filter((a) => a.kind === "photo");

  function pickStyle(next: SiteStyle) {
    setStyle(next);
    if (!accentTouched.current) setAccent(SITE_STYLE_INFO[next].defaultAccent);
  }
  function pickAccent(value: string) {
    accentTouched.current = true;
    setAccent(value);
  }
  function toggle(id: string) {
    setHighlights((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function upload(
    kind: "logo" | "photo",
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files.slice(
        0,
        kind === "logo" ? 1 : 8 - photos.length,
      )) {
        const shrunk = await shrinkImage(file, kind);
        const result = await uploadSiteAsset({
          data: { ...auth, kind, mime: shrunk.mime, data: shrunk.data },
        });
        if (!result.ok) {
          setError(result.message);
          break;
        }
        setAssets((cur) => [
          ...cur.filter((a) => (kind === "logo" ? a.kind !== "logo" : true)),
          { id: result.id, kind },
        ]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That picture could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setAssets((cur) => cur.filter((a) => a.id !== id));
    await deleteSiteAsset({ data: { ...auth, assetId: id } }).catch(() => {});
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const list = services
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (list.length === 0) {
      setError("Add at least one service you offer.");
      return;
    }
    if (!city.trim()) {
      setError("Add the city you are based in.");
      return;
    }
    setBusy(true);
    try {
      const result = await submitSiteBrief({
        data: {
          ...auth,
          brief: {
            businessName: businessName.trim(),
            trade,
            city: city.trim(),
            state: stateCode.trim(),
            phone: phone.trim(),
            email: email.trim(),
            services: list,
            serviceArea: serviceArea.trim(),
            yearsInBusiness: years.trim()
              ? Math.max(0, Math.min(150, parseInt(years, 10) || 0))
              : null,
            highlights,
            about: about.trim(),
            specialRequests: special.trim(),
            hours: hours.trim(),
            style,
            accent,
            logoId: logo?.id ?? null,
            photoIds: photos.map((p) => p.id),
          },
        },
      });
      if (result.ok) {
        onDone();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setError(result.message);
      }
    } catch {
      setError(
        "Something went wrong. Check the highlighted details and try again, or email hello@uptrendscaling.com.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <section className="sd-card">
        <h2>Your business</h2>
        <div className="sd-grid">
          <label className="sd-field">
            <span>Business name</span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label className="sd-field">
            <span>What kind of business</span>
            <select value={trade} onChange={(e) => setTrade(e.target.value)}>
              {TRADES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="sd-field">
            <span>City</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              maxLength={60}
            />
          </label>
          <label className="sd-field">
            <span>State</span>
            <input
              type="text"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              maxLength={30}
              placeholder="AZ"
            />
          </label>
          <label className="sd-field">
            <span>Phone number customers call</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              maxLength={30}
            />
          </label>
          <label className="sd-field">
            <span>Email for quote requests</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={120}
            />
          </label>
        </div>
      </section>

      <section className="sd-card">
        <h2>What you do</h2>
        <label className="sd-field">
          <span>Your services (one per line)</span>
          <textarea
            value={services}
            onChange={(e) => setServices(e.target.value)}
            placeholder={"AC repair\nNew system installs\nMaintenance plans"}
            required
          />
          <small>
            Up to 10. These become the cards on your site and the choices in
            your quote form.
          </small>
        </label>
        <div className="sd-grid">
          <label className="sd-field">
            <span>Areas you serve</span>
            <input
              type="text"
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="Mesa, Gilbert, Chandler"
              maxLength={240}
            />
          </label>
          <label className="sd-field">
            <span>Hours (optional)</span>
            <input
              type="text"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Mon to Sat, 7am to 6pm"
              maxLength={120}
            />
          </label>
          <label className="sd-field">
            <span>Years in business (optional)</span>
            <input
              type="number"
              min={0}
              max={150}
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sd-legend" style={{ marginBottom: 8 }}>
            Tick what is true for you
          </legend>
          <div className="sd-checks">
            {HIGHLIGHTS.map((h) => (
              <label key={h.id} className="sd-check">
                <input
                  type="checkbox"
                  checked={highlights.includes(h.id)}
                  onChange={() => toggle(h.id)}
                />
                {h.label}
              </label>
            ))}
          </div>
          <p style={{ marginTop: 8 }}>
            We only put these on your site if you tick them.
          </p>
        </fieldset>
        <label className="sd-field">
          <span>About your business (optional)</span>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={1200}
            placeholder="Your story, what makes you different, anything you want customers to know."
          />
        </label>
        <label className="sd-field">
          <span>Anything specific you want on the site? (optional)</span>
          <textarea
            value={special}
            onChange={(e) => setSpecial(e.target.value)}
            maxLength={1200}
            placeholder="Example: mention we are open on Sundays, add a financing section, use the slogan 'Cool comfort, fair prices'."
          />
        </label>
      </section>

      <section className="sd-card">
        <h2>Pick a look</h2>
        <div className="sd-styles" role="radiogroup" aria-label="Website look">
          {SITE_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={style === s}
              className={style === s ? "sd-style on" : "sd-style"}
              onClick={() => pickStyle(s)}
            >
              <img src={SITE_STYLE_INFO[s].example} alt="" loading="lazy" />
              <b>{SITE_STYLE_INFO[s].label}</b>
              <small>{SITE_STYLE_INFO[s].blurb}</small>
            </button>
          ))}
        </div>
        <details className="sd-colors">
          <summary>
            <span className="sd-dot" style={{ background: accent }} /> Choose
            your color
          </summary>
          <div className="sd-sw">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={accent.toLowerCase() === c ? "on" : ""}
                style={{ background: c }}
                aria-label={`Use ${c}`}
                onClick={() => pickAccent(c)}
              />
            ))}
          </div>
          <label className="sd-custom">
            <input
              type="color"
              value={accent}
              onChange={(e) => pickAccent(e.target.value)}
              aria-label="Pick any custom color"
            />
            Or pick any color
          </label>
        </details>
      </section>

      <section className="sd-card">
        <h2>Logo and photos (optional)</h2>
        <p>
          A logo and a few photos of your work make the site feel like yours.
          You can skip this and add them later.
        </p>
        <div className="sd-up">
          {logo ? (
            <div className="sd-thumb">
              <img src={`/site-assets/${logo.id}`} alt="Your logo" />
              <button
                type="button"
                onClick={() => remove(logo.id)}
                aria-label="Remove logo"
              >
                &times;
              </button>
            </div>
          ) : null}
          <label className="sd-btn">
            {logo ? "Replace logo" : "Add your logo"}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => upload("logo", e)}
            />
          </label>
        </div>
        <div className="sd-up">
          {photos.map((p) => (
            <div key={p.id} className="sd-thumb">
              <img src={`/site-assets/${p.id}`} alt="Uploaded photo" />
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label="Remove photo"
              >
                &times;
              </button>
            </div>
          ))}
          {photos.length < 8 ? (
            <label className="sd-btn">
              Add photos
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => upload("photo", e)}
              />
            </label>
          ) : null}
        </div>
        {uploading ? <p>Uploading...</p> : null}
      </section>

      {error ? (
        <div className="sd-note bad" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}
      <button className="sd-btn pri" type="submit" disabled={busy || uploading}>
        {busy ? "Sending..." : "Send my details and build my website"}
      </button>
      <p
        style={{
          marginTop: 12,
          color: "var(--muted-foreground)",
          fontSize: 13.5,
        }}
      >
        Nothing goes live until you approve it.
      </p>
    </form>
  );
}
