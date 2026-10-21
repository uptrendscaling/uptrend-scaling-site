import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { ThemeToggle } from "../components/theme-toggle";
import { getCurrentBusiness } from "../lib/reviews.server";
import {
  adminGetSite,
  adminRegenerate,
  adminSaveContent,
  adminSetDomain,
  adminSiteAction,
  type AdminSiteDetail,
} from "../lib/site-gen/sites.server";
import {
  SITE_STYLES,
  SITE_STYLE_INFO,
  SITE_WIDGETS,
  type SiteContent,
} from "../lib/site-gen/types";
import { WIDGET_LABELS } from "../lib/site-gen/widgets";
import siteDetailsCss from "../site-details.css?url";

// Colby's editor for one customer's website: change any word, add sections the
// customer asked for, rewrite with AI, then send it for approval or publish.
export const Route = createFileRoute("/admin_/site/$businessId")({
  head: () => ({
    meta: [
      { title: "Edit website | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: siteDetailsCss }],
  }),
  loader: async ({ params }) => {
    const business = await getCurrentBusiness();
    if (!business) throw redirect({ to: "/login" });
    const result = await adminGetSite({
      data: { businessId: params.businessId },
    });
    return result;
  },
  component: SiteEditor,
});

type Extra = SiteContent["extras"][number];

const PRESETS: Array<{ label: string; make: () => Extra }> = [
  {
    label: "Special offer banner",
    make: () => ({
      id: uid(),
      kind: "banner",
      title: "Special offer",
      body: "Mention this site when you call.",
      items: [],
      placement: "after_hero",
    }),
  },
  {
    label: "Emergency banner",
    make: () => ({
      id: uid(),
      kind: "banner",
      title: "Need help right now?",
      body: "Call us any time. We answer.",
      items: [],
      placement: "after_services",
    }),
  },
  {
    label: "Financing",
    make: () => ({
      id: uid(),
      kind: "text",
      title: "Financing available",
      body: "Ask us about payment options for larger jobs.",
      items: [],
      placement: "after_services",
    }),
  },
  {
    label: "Guarantee list",
    make: () => ({
      id: uid(),
      kind: "list",
      title: "Our promises",
      body: "",
      items: [
        "Clear quotes before work starts",
        "We clean up after ourselves",
        "We stand behind our work",
      ],
      placement: "after_why",
    }),
  },
  {
    label: "Blank section",
    make: () => ({
      id: uid(),
      kind: "text",
      title: "New section",
      body: "",
      items: [],
      placement: "after_services",
    }),
  },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sd-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SiteEditor() {
  const data = Route.useLoaderData();
  if (!data.ok) {
    return (
      <main className="sd">
        <h1>Website editor</h1>
        <div className="sd-note bad">{data.message}</div>
        <p>
          <a href="/admin">Back to admin</a>
        </p>
      </main>
    );
  }
  return <Editor site={data.site} />;
}

function Editor({ site: initial }: { site: AdminSiteDetail }) {
  const [site, setSite] = useState(initial);
  const [content, setContent] = useState<SiteContent | null>(initial.content);
  const [notes, setNotes] = useState("");
  const [domain, setDomain] = useState(
    initial.customDomain ?? initial.requestedDomain ?? "",
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  async function refresh() {
    const r = await adminGetSite({ data: { businessId: site.businessId } });
    if (r.ok) {
      setSite(r.site);
      setContent(r.site.content);
    }
    setFrameKey((k) => k + 1);
  }

  async function run(
    name: string,
    fn: () => Promise<{ ok: boolean; message?: string }>,
    reload = true,
  ) {
    setBusy(name);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({
        ok: r.ok,
        text: r.message ?? (r.ok ? "Done." : "Something went wrong."),
      });
      if (r.ok && reload) await refresh();
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      if (!content) return { ok: false, message: "Nothing to save." };
      const r = await adminSaveContent({
        data: { businessId: site.businessId, content },
      });
      return {
        ...r,
        message: r.ok
          ? "Saved."
          : (r.message ??
            "Could not save. Check for fields that are too long."),
      };
    });

  async function saveThen(
    action: "send_to_customer" | "publish" | "unpublish",
  ) {
    await run(action, async () => {
      if (content) {
        const saved = await adminSaveContent({
          data: { businessId: site.businessId, content },
        });
        if (!saved.ok)
          return {
            ok: false,
            message: saved.message ?? "Could not save your edits first.",
          };
      }
      return adminSiteAction({ data: { businessId: site.businessId, action } });
    });
  }

  const c = content;
  const upd = (fn: (c: SiteContent) => SiteContent) =>
    setContent((cur) => (cur ? fn(cur) : cur));

  return (
    <div className="site-shell start-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="/admin" aria-label="Back to admin">
            <span>
              UpTrend <em>Admin</em>
            </span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main className="sd" style={{ maxWidth: 1000 }}>
        <p>
          <a href="/admin/sites">&larr; All websites</a>
        </p>
        <h1>{site.businessName}</h1>
        <p className="sd-lead">
          Status: <b>{site.status.replace("_", " ")}</b> &middot;{" "}
          <a href={site.previewUrl} target="_blank" rel="noreferrer">
            Open preview
          </a>
          {site.status === "live" || site.status === "paused" ? (
            <>
              {" "}
              &middot;{" "}
              <a href={site.liveUrl} target="_blank" rel="noreferrer">
                Open live site
              </a>
            </>
          ) : null}{" "}
          &middot; {site.email}
        </p>

        {msg ? (
          <div
            className={msg.ok ? "sd-note ok" : "sd-note bad"}
            role="status"
            style={{ marginBottom: 14 }}
          >
            {msg.text}
          </div>
        ) : null}
        {site.lastError ? (
          <div className="sd-note" style={{ marginBottom: 14 }}>
            Last note from the builder: {site.lastError}
          </div>
        ) : null}
        {!site.aiConfigured ? (
          <div className="sd-note" style={{ marginBottom: 14 }}>
            AI writing is off (no API key set), so sites use plain copy built
            from the customer's answers. Everything below is still editable.
          </div>
        ) : null}

        {site.changeRequests.length > 0 ? (
          <section className="sd-card">
            <h2>What the customer asked to change</h2>
            {site.changeRequests.map((r, i) => (
              <div key={i} className="sd-note">
                <small>{new Date(r.at).toLocaleString()}</small>
                <br />
                {r.text}
              </div>
            ))}
          </section>
        ) : null}

        {!c ? (
          <section className="sd-card">
            <h2>No site yet</h2>
            <p>
              The customer has not sent their business details.{" "}
              {site.status === "generating"
                ? "A site is being written right now. Refresh in a minute."
                : "They have an email with the link, or you can send it from their dashboard."}
            </p>
            {site.lastError ? <p>Last problem: {site.lastError}</p> : null}
            <div className="sd-row">
              <button
                className="sd-btn"
                type="button"
                onClick={() => void refresh()}
              >
                Refresh
              </button>
              {site.brief ? (
                <button
                  className="sd-btn pri"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run("regen", () =>
                      adminRegenerate({
                        data: { businessId: site.businessId },
                      }),
                    )
                  }
                >
                  {busy === "regen"
                    ? "Writing the site..."
                    : "Write the site from their form now"}
                </button>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            <section className="sd-card">
              <h2>Publish</h2>
              <div className="sd-row">
                <button
                  className="sd-btn pri"
                  type="button"
                  disabled={busy !== null}
                  onClick={save}
                >
                  {busy === "save" ? "Saving..." : "Save edits"}
                </button>
                <button
                  className="sd-btn"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveThen("send_to_customer")}
                >
                  {busy === "send_to_customer"
                    ? "Sending..."
                    : "Send to customer for approval"}
                </button>
                <button
                  className="sd-btn"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveThen("publish")}
                >
                  {busy === "publish" ? "Publishing..." : "Publish now"}
                </button>
                {site.status === "live" || site.status === "customer_review" ? (
                  <button
                    className="sd-btn"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void saveThen("unpublish")}
                  >
                    Take back to review
                  </button>
                ) : null}
              </div>
              <p>
                "Send to customer" emails them the private preview with Approve
                and Request changes buttons. "Publish now" skips their approval
                and emails them the live address.
              </p>
              <Field label="Rewrite with AI (optional notes)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Example: make it sound more family friendly and mention weekend appointments."
                />
              </Field>
              <div>
                <button
                  className="sd-btn"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run("regen", () =>
                      adminRegenerate({
                        data: {
                          businessId: site.businessId,
                          ...(notes.trim() ? { notes: notes.trim() } : {}),
                        },
                      }),
                    )
                  }
                >
                  {busy === "regen"
                    ? "Rewriting..."
                    : "Rewrite the text from the customer's form"}
                </button>
              </div>
              <p>
                Rewriting replaces the text with a fresh version but keeps the
                extra sections you added. Save your edits first if you want to
                keep them elsewhere.
              </p>
            </section>

            <section className="sd-card">
              <h2>Look</h2>
              <div className="sd-grid">
                <Field label="Style">
                  <select
                    value={c.style}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        style: e.target.value as SiteContent["style"],
                      }))
                    }
                  >
                    {SITE_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {SITE_STYLE_INFO[s].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Accent color">
                  <input
                    type="color"
                    value={c.accent}
                    onChange={(e) =>
                      upd((x) => ({ ...x, accent: e.target.value }))
                    }
                    style={{ height: 44 }}
                  />
                </Field>
                <Field label="Interactive piece at the top">
                  <select
                    value={c.hero.widget}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: {
                          ...x.hero,
                          widget: e.target
                            .value as SiteContent["hero"]["widget"],
                        },
                      }))
                    }
                  >
                    {SITE_WIDGETS.map((w) => (
                      <option key={w} value={w}>
                        {WIDGET_LABELS[w]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Logo">
                  <select
                    value={c.brand.logoId ?? ""}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        brand: { ...x.brand, logoId: e.target.value || null },
                      }))
                    }
                  >
                    <option value="">No logo (letter mark)</option>
                    {site.assets.map((a, i) => (
                      <option key={a.id} value={a.id}>
                        {a.kind === "logo" ? "Logo" : "Photo"} {i + 1}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Main photo (top of page)">
                  <select
                    value={c.hero.imageId ?? ""}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, imageId: e.target.value || null },
                      }))
                    }
                  >
                    <option value="">None</option>
                    {site.assets.map((a, i) => (
                      <option key={a.id} value={a.id}>
                        {a.kind === "logo" ? "Logo" : "Photo"} {i + 1}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {site.assets.length > 0 ? (
                <>
                  <span className="sd-legend">
                    Gallery photos (tick to show)
                  </span>
                  <div className="sd-up">
                    {site.assets
                      .filter((a) => a.kind === "photo")
                      .map((a) => (
                        <label
                          key={a.id}
                          className="sd-thumb"
                          style={{ cursor: "pointer" }}
                        >
                          <img src={`/site-assets/${a.id}`} alt="" />
                          <input
                            type="checkbox"
                            checked={c.gallery.includes(a.id)}
                            onChange={(e) =>
                              upd((x) => ({
                                ...x,
                                gallery: e.target.checked
                                  ? [...x.gallery, a.id].slice(0, 8)
                                  : x.gallery.filter((g) => g !== a.id),
                              }))
                            }
                            style={{
                              position: "absolute",
                              left: 6,
                              bottom: 6,
                              width: 18,
                              height: 18,
                            }}
                          />
                        </label>
                      ))}
                  </div>
                </>
              ) : null}
            </section>

            <section className="sd-card">
              <h2>Top of the page</h2>
              <div className="sd-grid">
                <Field label="Small label">
                  <input
                    type="text"
                    value={c.hero.eyebrow}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, eyebrow: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="text"
                    value={c.brand.phone}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        brand: { ...x.brand, phone: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Headline">
                  <input
                    type="text"
                    value={c.hero.headline}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, headline: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Headline, colored ending">
                  <input
                    type="text"
                    value={c.hero.headlineAccent}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, headlineAccent: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Main button">
                  <input
                    type="text"
                    value={c.hero.primaryCta}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, primaryCta: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Call button">
                  <input
                    type="text"
                    value={c.hero.secondaryCta}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        hero: { ...x.hero, secondaryCta: e.target.value },
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="Intro text">
                <textarea
                  value={c.hero.sub}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      hero: { ...x.hero, sub: e.target.value },
                    }))
                  }
                />
              </Field>
              <div className="sd-grid">
                <Field label="Badges (one per line)">
                  <textarea
                    value={c.badges.join("\n")}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        badges: e.target.value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .slice(0, 6),
                      }))
                    }
                  />
                </Field>
                <Field label="Numbers (one per line: value | label)">
                  <textarea
                    value={c.stats
                      .map((s) => `${s.value} | ${s.label}`)
                      .join("\n")}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        stats: e.target.value
                          .split("\n")
                          .map((l) => l.split("|"))
                          .filter((p) => p[0]?.trim() && p[1]?.trim())
                          .map((p) => ({
                            value: (p[0] ?? "").trim(),
                            label: (p[1] ?? "").trim(),
                          }))
                          .slice(0, 4),
                      }))
                    }
                  />
                </Field>
              </div>
            </section>

            <ListCard
              title="Services"
              heading={c.servicesTitle}
              onHeading={(v) => upd((x) => ({ ...x, servicesTitle: v }))}
              rows={c.services}
              onRows={(rows) =>
                upd((x) => ({ ...x, services: rows.slice(0, 10) }))
              }
              min={1}
            />
            <ListCard
              title="How it works"
              heading={c.processTitle}
              onHeading={(v) => upd((x) => ({ ...x, processTitle: v }))}
              rows={c.process}
              onRows={(rows) =>
                upd((x) => ({ ...x, process: rows.slice(0, 5) }))
              }
              min={2}
            />
            <ListCard
              title="Why choose them"
              heading={c.whyTitle}
              onHeading={(v) => upd((x) => ({ ...x, whyTitle: v }))}
              rows={c.why}
              onRows={(rows) => upd((x) => ({ ...x, why: rows.slice(0, 6) }))}
              min={2}
            />

            <section className="sd-card">
              <h2>About, areas and questions</h2>
              <Field label="About title">
                <input
                  type="text"
                  value={c.about.title}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      about: { ...x.about, title: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="About text">
                <textarea
                  value={c.about.body}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      about: { ...x.about, body: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Areas served (one per line)">
                <textarea
                  value={c.areas.join("\n")}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      areas: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(0, 24),
                    }))
                  }
                />
              </Field>
              <span className="sd-legend">Questions and answers</span>
              {c.faq.map((f, i) => (
                <div key={i} className="sd-card" style={{ marginBottom: 0 }}>
                  <input
                    type="text"
                    value={f.q}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        faq: x.faq.map((r, j) =>
                          j === i ? { ...r, q: e.target.value } : r,
                        ),
                      }))
                    }
                    aria-label="Question"
                  />
                  <textarea
                    value={f.a}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        faq: x.faq.map((r, j) =>
                          j === i ? { ...r, a: e.target.value } : r,
                        ),
                      }))
                    }
                    aria-label="Answer"
                  />
                  <div>
                    <button
                      className="sd-btn"
                      type="button"
                      onClick={() =>
                        upd((x) => ({
                          ...x,
                          faq: x.faq.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {c.faq.length < 8 ? (
                <div>
                  <button
                    className="sd-btn"
                    type="button"
                    onClick={() =>
                      upd((x) => ({
                        ...x,
                        faq: [...x.faq, { q: "New question", a: "Answer" }],
                      }))
                    }
                  >
                    Add a question
                  </button>
                </div>
              ) : null}
            </section>

            <section className="sd-card">
              <h2>Extra sections (anything the customer asked for)</h2>
              <p>
                Add options the AI missed: an offer, financing, a guarantee, a
                banner with a call button. They appear on the site where you
                place them.
              </p>
              <div className="sd-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="sd-btn"
                    type="button"
                    disabled={c.extras.length >= 8}
                    onClick={() =>
                      upd((x) => ({ ...x, extras: [...x.extras, p.make()] }))
                    }
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
              {c.extras.map((ex, i) => {
                const setEx = (patch: Partial<Extra>) =>
                  upd((x) => ({
                    ...x,
                    extras: x.extras.map((r, j) =>
                      j === i ? { ...r, ...patch } : r,
                    ),
                  }));
                return (
                  <div
                    key={ex.id}
                    className="sd-card"
                    style={{ marginBottom: 0 }}
                  >
                    <div className="sd-grid">
                      <Field label="Type">
                        <select
                          value={ex.kind}
                          onChange={(e) =>
                            setEx({ kind: e.target.value as Extra["kind"] })
                          }
                        >
                          <option value="text">Heading and paragraph</option>
                          <option value="list">Heading and bullet list</option>
                          <option value="banner">
                            Colored banner with call button
                          </option>
                        </select>
                      </Field>
                      <Field label="Where">
                        <select
                          value={ex.placement}
                          onChange={(e) =>
                            setEx({
                              placement: e.target.value as Extra["placement"],
                            })
                          }
                        >
                          <option value="after_hero">
                            Right under the top
                          </option>
                          <option value="after_services">After services</option>
                          <option value="after_why">After about</option>
                          <option value="after_faq">After questions</option>
                          <option value="end">At the very end</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Title">
                      <input
                        type="text"
                        value={ex.title}
                        onChange={(e) => setEx({ title: e.target.value })}
                      />
                    </Field>
                    <Field label="Text">
                      <textarea
                        value={ex.body}
                        onChange={(e) => setEx({ body: e.target.value })}
                      />
                    </Field>
                    {ex.kind === "list" ? (
                      <Field label="Bullets (one per line)">
                        <textarea
                          value={ex.items.join("\n")}
                          onChange={(e) =>
                            setEx({
                              items: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .slice(0, 14),
                            })
                          }
                        />
                      </Field>
                    ) : null}
                    <div>
                      <button
                        className="sd-btn"
                        type="button"
                        onClick={() =>
                          upd((x) => ({
                            ...x,
                            extras: x.extras.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Remove this section
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="sd-card">
              <h2>Bottom of the page and search listing</h2>
              <div className="sd-grid">
                <Field label="Contact title">
                  <input
                    type="text"
                    value={c.cta.title}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        cta: { ...x.cta, title: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Form button">
                  <input
                    type="text"
                    value={c.cta.button}
                    onChange={(e) =>
                      upd((x) => ({
                        ...x,
                        cta: { ...x.cta, button: e.target.value },
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="Contact text">
                <textarea
                  value={c.cta.text}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      cta: { ...x.cta, text: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Hours">
                <input
                  type="text"
                  value={c.brand.hours}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      brand: { ...x.brand, hours: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Google title">
                <input
                  type="text"
                  value={c.seo.title}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      seo: { ...x.seo, title: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Google description">
                <textarea
                  value={c.seo.description}
                  onChange={(e) =>
                    upd((x) => ({
                      ...x,
                      seo: { ...x.seo, description: e.target.value },
                    }))
                  }
                />
              </Field>
              <div>
                <button
                  className="sd-btn pri"
                  type="button"
                  disabled={busy !== null}
                  onClick={save}
                >
                  {busy === "save" ? "Saving..." : "Save edits"}
                </button>
              </div>
            </section>

            <section className="sd-card">
              <h2>Live preview</h2>
              <p>Shows the last saved version. Save, then it refreshes.</p>
              <iframe
                key={frameKey}
                title="Website preview"
                src={site.previewUrl}
                style={{
                  width: "100%",
                  height: 720,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: "#fff",
                }}
              />
            </section>
          </>
        )}

        <section className="sd-card">
          <h2>Customer's own web address</h2>
          <p>
            {site.requestedDomain
              ? `They asked for ${site.requestedDomain}. `
              : "They have not entered one yet. "}
            Connect it first (add the domain in Vercel, give the customer the
            DNS records), then enter it here so the site loads there.
          </p>
          <div className="sd-row">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="yourcustomer.com"
            />
            <button
              className="sd-btn"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run("domain", () =>
                  adminSetDomain({
                    data: { businessId: site.businessId, domain },
                  }),
                )
              }
            >
              {busy === "domain" ? "Saving..." : "Save domain"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function ListCard({
  title,
  heading,
  onHeading,
  rows,
  onRows,
  min,
}: {
  title: string;
  heading: string;
  onHeading: (v: string) => void;
  rows: Array<{ title: string; text: string }>;
  onRows: (rows: Array<{ title: string; text: string }>) => void;
  min: number;
}) {
  return (
    <section className="sd-card">
      <h2>{title}</h2>
      <Field label="Section heading">
        <input
          type="text"
          value={heading}
          onChange={(e) => onHeading(e.target.value)}
        />
      </Field>
      {rows.map((r, i) => (
        <div key={i} className="sd-card" style={{ marginBottom: 0 }}>
          <input
            type="text"
            value={r.title}
            onChange={(e) =>
              onRows(
                rows.map((x, j) =>
                  j === i ? { ...x, title: e.target.value } : x,
                ),
              )
            }
            aria-label="Title"
          />
          <textarea
            value={r.text}
            onChange={(e) =>
              onRows(
                rows.map((x, j) =>
                  j === i ? { ...x, text: e.target.value } : x,
                ),
              )
            }
            aria-label="Text"
          />
          <div className="sd-row">
            <button
              className="sd-btn"
              type="button"
              disabled={i === 0}
              onClick={() =>
                onRows(
                  rows.map((x, j) =>
                    j === i - 1
                      ? (rows[i] as typeof x)
                      : j === i
                        ? (rows[i - 1] as typeof x)
                        : x,
                  ),
                )
              }
            >
              Move up
            </button>
            <button
              className="sd-btn"
              type="button"
              disabled={rows.length <= min}
              onClick={() => onRows(rows.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <div>
        <button
          className="sd-btn"
          type="button"
          onClick={() =>
            onRows([...rows, { title: "New item", text: "Describe it here." }])
          }
        >
          Add one
        </button>
      </div>
    </section>
  );
}
