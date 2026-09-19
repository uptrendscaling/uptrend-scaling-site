import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { MONTHLY_PRICE_CENTS, SETUP_FEE_CENTS, TRIAL_DAYS, formatUsd } from "../lib/pricing";

const START_TRIAL = "/start?plan=trial";
const START_MEMBERSHIP = "/start?plan=membership";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UpTrend Scaling | Google Review Automation" },
      {
        name: "description",
        content:
          "Turn finished jobs into genuine Google reviews with automated SMS and email requests, reminders, QR codes, and simple reporting.",
      },
      { property: "og:title", content: "UpTrend Scaling | Put your reputation on an uptrend" },
      {
        property: "og:description",
        content: "Google review automation built for local businesses and owner-operators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const progressRef = useRef<HTMLDivElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const closingVideoRef = useRef<HTMLVideoElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMotionAllowed(!reduceMotion);
    const revealElements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 },
    );
    revealElements.forEach((element) => observer.observe(element));

    const updateScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
      progressRef.current?.style.setProperty("--scroll-progress", `${progress * 100}%`);
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    const videos = [heroVideoRef.current, closingVideoRef.current].filter(
      (video): video is HTMLVideoElement => video !== null,
    );
    const videoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting && !reduceMotion) {
            void video.play().catch(() => undefined);
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.15 },
    );
    videos.forEach((video) => videoObserver.observe(video));

    return () => {
      observer.disconnect();
      videoObserver.disconnect();
      window.removeEventListener("scroll", updateScroll);
    };
  }, []);

  return (
    <div className="site-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="#top" aria-label="UpTrend Scaling home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28"><path d="M4 20 11 13l4 4 9-10M17 7h7v7" /></svg>
            </span>
            <span>UpTrend <em>Scaling</em></span>
          </a>
          <nav className="nav-links" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#industries">Industries</a>
            <a href="#why-us">Why us</a>
          </nav>
          <div className="nav-actions">
            <a className="button button-ghost nav-cta" href="/login">Log in</a>
            <a className="button button-primary nav-cta" href={START_TRIAL}>Start Free Trial <ArrowIcon /></a>
          </div>
        </div>
        <div ref={progressRef} className="scroll-progress" aria-hidden="true" />
      </header>

      <main>
        <section id="top" className="hero-section">
          <video
            ref={heroVideoRef}
            className="section-video"
            src="https://videos.pexels.com/video-files/4320605/4320605-sd_960_540_30fps.mp4"
            autoPlay={motionAllowed}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
          <div className="video-scrim" aria-hidden="true" />
          <div className="hero-grid page-width">
            <div className="hero-copy" data-reveal>
              <p className="eyebrow eyebrow-light"><span /> Google review automation</p>
              <h1>Put your reputation on an <strong>uptrend.</strong></h1>
              <p className="hero-lead">
                UpTrend Scaling turns every finished job into a 5-star Google review with automatic SMS and email follow-ups, timed reminders, and in-person QR codes your customers actually use.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href={START_TRIAL}>Start Free Trial <ArrowIcon /></a>
                <a className="button button-ghost" href={START_MEMBERSHIP}>Start Membership</a>
              </div>
              <p className="hero-price-note">
                {formatUsd(MONTHLY_PRICE_CENTS)}/mo per location + {formatUsd(SETUP_FEE_CENTS)} one-time setup · {TRIAL_DAYS}-day free trial · cancel anytime
              </p>
              <p className="honesty-note"><ShieldIcon /> Built for owner-operators. No review is ever purchased or faked. We only make it effortless to ask.</p>
            </div>

          </div>
          <div className="trend-card-wrap" data-reveal>
            <div className="trend-card">
              <div className="trend-card-head">
                <span>Review momentum</span>
                <span className="example-pill">Illustrative example</span>
              </div>
              <svg className="trend-chart" viewBox="0 0 620 390" role="img" aria-label="Illustrative rising trend line with five star markers">
                <defs>
                  <linearGradient id="area-fill" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
                    <stop offset="1" stopColor="var(--primary)" stopOpacity=".12" />
                  </linearGradient>
                  <symbol id="star" viewBox="0 0 24 24">
                    <path d="m12 2.4 2.84 5.75 6.35.92-4.6 4.48 1.09 6.32L12 16.88l-5.68 2.99 1.09-6.32-4.6-4.48 6.35-.92L12 2.4Z" />
                  </symbol>
                </defs>
                <g className="chart-grid">
                  <path d="M44 70H576M44 150H576M44 230H576M44 310H576" />
                </g>
                <path className="trend-area" d="M56 300 C126 298 137 267 195 261 S285 234 326 202 S420 157 454 119 S522 76 566 55 L566 326 L56 326Z" />
                <path className="trend-path" pathLength="1" d="M56 300 C126 298 137 267 195 261 S285 234 326 202 S420 157 454 119 S522 76 566 55" />
                <g className="chart-stars">
                  <g className="star-point star-1" transform="translate(56 300)"><circle r="19" /><use href="#star" x="-8" y="-8" width="16" height="16" /></g>
                  <g className="star-point star-2" transform="translate(195 261)"><circle r="23" /><use href="#star" x="-10" y="-10" width="20" height="20" /></g>
                  <g className="star-point star-3" transform="translate(326 202)"><circle r="27" /><use href="#star" x="-12" y="-12" width="24" height="24" /></g>
                  <g className="star-point star-4" transform="translate(454 119)"><circle r="31" /><use href="#star" x="-14" y="-14" width="28" height="28" /></g>
                  <g className="star-point star-5" transform="translate(566 55)"><circle r="36" /><use href="#star" x="-17" y="-17" width="34" height="34" /></g>
                </g>
              </svg>
              <div className="trend-card-foot">
                <span>Automated ask</span><i /><span>Reminder</span><i /><span>Review</span>
              </div>
            </div>
          </div>
          <div className="hero-rule" />
        </section>

        <section className="trust-strip" aria-label="Service highlights">
          <div className="page-width trust-grid">
            {["Set up in under a day", "SMS & email, no app required", "Month-to-month, cancel anytime", "Only genuine customer reviews"].map((item) => (
              <div key={item} className="trust-item"><CheckIcon /> <span>{item}</span></div>
            ))}
          </div>
        </section>

        <section className="section stats-section" aria-labelledby="stats-heading">
          <div className="page-width">
            <div className="stats-heading" data-reveal>
              <p className="eyebrow"><span /> Why this works</p>
              <h2 id="stats-heading">Customers already want to leave reviews. Most just need to be asked.</h2>
            </div>
            <div className="stats-grid">
              <Stat value="97%">of consumers read reviews for local businesses before deciding</Stat>
              <Stat value="83%">of customers asked to leave a review actually leave one</Stat>
              <Stat value="92%">of consumers say star ratings influence which business they choose</Stat>
              <Stat value="80%">are more likely to use a business that responds to its reviews</Stat>
            </div>
            <p className="stats-source" data-reveal>Source: BrightLocal, 2026 Local Consumer Review Survey</p>
          </div>
        </section>

        <section id="how-it-works" className="section how-section">
          <div className="page-width">
            <div className="section-heading" data-reveal>
              <p className="eyebrow"><span /> How it works</p>
              <h2>Three moments. One steady stream of reviews.</h2>
              <p>From finished job to public proof, every step happens while you get back to running the business.</p>
            </div>
            <div className="steps-grid">
              <Step number="01" label="Request" title="Ask at the right moment" delay="delay-1">
                The instant a job is marked complete, your customer gets a short, friendly text or email asking for a Google review while the experience is still fresh.
              </Step>
              <Step number="02" label="Remind" title="Follow up, automatically" delay="delay-2">
                No response in 48 hours? A single, polite reminder goes out. No spam and no nagging, just one more chance timed sensibly.
              </Step>
              <Step number="03" label="Showcase" title="Capture reviews in person, too" delay="delay-3">
                Printed or digital QR codes on invoices, vehicles, or countertops let customers leave a review on the spot, no text required.
              </Step>
            </div>
          </div>
        </section>

        <section className="section feature-band">
          <div className="page-width feature-grid">
            <div className="feature-copy reveal-left" data-reveal>
              <p className="eyebrow"><span /> SMS & email follow-up</p>
              <h2>A message customers actually read</h2>
              <p>No generic blasts. Every message is short, comes from your business name, and links straight to your Google review page with one tap and no sign-in required.</p>
              <FeatureList items={["Sent within minutes of job completion", "Customized with your business name and tone", "One-tap opt-out, fully compliant"]} />
            </div>
            <div className="phone-stage reveal-right" data-reveal>
              <div className="message-label">Example message</div>
              <div className="phone-frame">
                <div className="phone-bar"><span>9:41</span><i /><span>5G</span></div>
                <div className="contact-avatar">AP</div>
                <strong>Ace Plumbing</strong>
                <span className="conversation-note">Text Message · Sample</span>
                <div className="bubble bubble-in">Hi Maria, thanks for choosing Ace Plumbing today! Got 20 seconds to leave us a quick Google review?<br /><a href="#sample-link" onClick={(event) => event.preventDefault()}>uptrend.review/ace</a></div>
                <div className="bubble bubble-out">On it. You guys were great.</div>
                <div className="phone-stars">★★★★★</div>
              </div>
            </div>
          </div>
        </section>

        <section className="section qr-section">
          <div className="page-width feature-grid reverse">
            <div className="feature-copy reveal-right" data-reveal>
              <p className="eyebrow"><span /> In-person QR codes</p>
              <h2>Catch the customers who are standing right in front of you</h2>
              <p>Not every review starts with a text. A QR code on a receipt, a service vehicle, or a countertop stand takes customers straight to your review page with no typing or searching.</p>
              <FeatureList items={["Print-ready code, sized for counters, vehicles, and invoices", "Points to the same tracked review link as SMS & email"]} />
            </div>
            <div className="qr-stage reveal-left" data-reveal>
              <div className="qr-card">
                <div className="qr-top"><span className="mini-mark">↗</span><span>How did we do?</span></div>
                <DecorativeQR />
                <strong>Scan to leave a review</strong>
                <div className="qr-stars">★★★★★</div>
                <small>Scan-to-review QR code · mockup</small>
              </div>
            </div>
          </div>
        </section>

        <section className="section reporting-section">
          <div className="page-width feature-grid">
            <div className="feature-copy reveal-left" data-reveal>
              <p className="eyebrow"><span /> Simple reporting</p>
              <h2>Watch the trend line move, week over week</h2>
              <p>One dashboard shows requests sent, reviews earned, and your response rate, so you know the follow-ups are working without having to guess.</p>
              <FeatureList items={["Weekly summary emailed to you automatically", "See which requests convert, and which need a better nudge"]} />
            </div>
            <div className="chart-panel reveal-right" data-reveal>
              <div className="panel-head"><span>Reviews earned / week</span><span className="example-pill">Sample data</span></div>
              <div className="bar-chart" aria-label="Illustrative six-week bar chart trending upward">
                {["W1", "W2", "W3", "W4", "W5", "W6"].map((week, index) => (
                  <div className={`bar-column bar-${index + 1}`} key={week}><div className="bar"><span>{[3, 5, 7, 8, 11, 14][index]}</span></div><small>{week}</small></div>
                ))}
                <svg className="bar-trend" viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M50 174 150 151 250 128 350 116 450 80 550 39" /></svg>
              </div>
              <div className="panel-summary"><span>6 week direction</span><strong><ArrowUpIcon /> Trending up</strong></div>
            </div>
          </div>
        </section>

        <section id="industries" className="section industries-section">
          <div className="page-width">
            <div className="industries-copy" data-reveal>
              <p className="eyebrow eyebrow-light"><span /> Built for</p>
              <h2>Local businesses that live and die by their reviews</h2>
              <p>If customers Google you before they call you, UpTrend Scaling fits your business.</p>
            </div>
            <div className="industry-list" data-reveal>
              {["Home services", "Auto sales & service", "Restaurants & cafés", "Salons & spas", "Medical & dental", "Retail & specialty shops"].map((industry, index) => (
                <div key={industry}><span>0{index + 1}</span>{industry}<ArrowIcon /></div>
              ))}
            </div>
          </div>
        </section>

        <section id="why-us" className="section why-section">
          <div className="page-width">
            <div className="section-heading split-heading" data-reveal>
              <div><p className="eyebrow"><span /> Why UpTrend Scaling</p><h2>Built to earn its place in your business.</h2></div>
              <p>No bloated software. No manufactured praise. Just a practical system that helps happy customers speak up.</p>
            </div>
            <div className="why-grid">
              <WhyCard number="01" title="Minutes to set up">Connect your customer list and your Google Business Profile. The first requests go out the same day.</WhyCard>
              <WhyCard number="02" title="No long contracts">Month-to-month pricing. If it's not earning its keep, you're not locked in.</WhyCard>
              <WhyCard number="03" title="Built by a small-business owner">UpTrend Scaling is a new, owner-operated company, and you'll talk to the person who actually built it.</WhyCard>
            </div>
          </div>
        </section>

        <section id="pricing" className="section pricing-section">
          <div className="page-width">
            <div className="pricing-card" data-reveal>
              <div className="pricing-card-copy">
                <p className="eyebrow"><span /> Simple pricing</p>
                <h2>One plan. No demo required.</h2>
                <p>Sign up in minutes and start requesting reviews today. Cancel anytime, no long-term contract.</p>
                <ul className="pricing-features">
                  <li><CheckIcon />SMS & email requests, reminders, and QR codes</li>
                  <li><CheckIcon />Weekly reporting dashboard</li>
                  <li><CheckIcon />{TRIAL_DAYS}-day free trial, nothing charged until it ends</li>
                  <li><CheckIcon />Month-to-month, cancel anytime</li>
                </ul>
                <div className="pricing-actions">
                  <a className="button button-primary" href={START_TRIAL}>Start Free Trial <ArrowIcon /></a>
                  <a className="button button-ghost" href={START_MEMBERSHIP}>Start Membership</a>
                </div>
              </div>
              <div className="pricing-figures">
                <span className="pricing-amount">{formatUsd(MONTHLY_PRICE_CENTS)}<small>/mo per location</small></span>
                <p className="pricing-setup">+ {formatUsd(SETUP_FEE_CENTS)} one-time setup fee</p>
              </div>
            </div>
          </div>
        </section>

        <section className="closing-cta">
          <video
            ref={closingVideoRef}
            className="section-video"
            src="https://videos.pexels.com/video-files/853987/853987-hd_1920_1080_25fps.mp4"
            autoPlay={motionAllowed}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
          <div className="video-scrim" aria-hidden="true" />
          <div className="closing-line" aria-hidden="true"><svg viewBox="0 0 1440 180" preserveAspectRatio="none"><path pathLength="1" d="M0 160C240 145 320 165 520 120S830 112 960 69s270-31 480-62" /></svg></div>
          <div className="page-width closing-inner" data-reveal>
            <p className="eyebrow eyebrow-light"><span /> Ready when you are</p>
            <h2>Stop hoping customers remember to leave a review.</h2>
            <p>Start your free trial in under two minutes. No demo, no sales call, just sign up and go.</p>
            <div className="hero-actions closing-actions">
              <a className="button button-primary" href={START_TRIAL}>Start Free Trial <ArrowIcon /></a>
              <a className="button button-ghost" href={START_MEMBERSHIP}>Start Membership</a>
            </div>
            <p className="closing-secondary">
              Have questions first? <a href="mailto:hello@uptrendscaling.com?subject=Question%20about%20UpTrend%20Scaling">Email us <MailIcon /></a>
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-width footer-inner">
          <div><a className="brand footer-brand" href="#top"><span className="brand-mark"><svg viewBox="0 0 28 28"><path d="M4 20 11 13l4 4 9-10M17 7h7v7" /></svg></span><span>UpTrend <em>Scaling</em></span></a><p>Google review automation for local businesses.</p></div>
          <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>
          <span>© 2026 UpTrend Scaling, LLC. All rights reserved. · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span>
        </div>
      </footer>
    </div>
  );
}

function Step({ number, label, title, children, delay }: { number: string; label: string; title: string; children: string; delay: string }) {
  return <article className={`step-card ${delay}`} data-reveal><div className="step-top"><span>{number}</span><small>{label}</small></div><h3>{title}</h3><p>{children}</p><div className="step-progress" /></article>;
}

function FeatureList({ items }: { items: string[] }) {
  return <ul className="feature-list">{items.map((item) => <li key={item}><CheckIcon />{item}</li>)}</ul>;
}

function WhyCard({ number, title, children }: { number: string; title: string; children: string }) {
  return <article className="why-card" data-reveal><span>{number}</span><div className="why-arrow"><ArrowIcon /></div><h3>{title}</h3><p>{children}</p></article>;
}

function Stat({ value, children }: { value: string; children: string }) {
  return <article className="stat-item" data-reveal><strong>{value}</strong><p>{children}</p></article>;
}

function DecorativeQR() {
  const squares = [[1,1,5,5],[17,1,5,5],[1,17,5,5],[8,2,2,2],[11,1,2,4],[7,6,3,2],[12,6,2,3],[16,7,5,2],[4,9,3,3],[9,10,2,4],[13,11,4,2],[18,11,3,3],[2,13,2,2],[6,14,4,2],[11,15,3,3],[16,15,2,2],[19,17,3,5],[6,18,3,3],[10,20,5,2],[14,18,2,2]];
  return <svg className="qr-code" viewBox="0 0 24 24" role="img" aria-label="Decorative QR code mockup"><rect width="24" height="24" rx="1" />{squares.map(([x,y,w,h], index) => <rect className="qr-block" key={index} x={x} y={y} width={w} height={h} rx=".35" />)}</svg>;
}

function ArrowIcon() { return <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>; }
function ArrowUpIcon() { return <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 13 5-5 3 3 4-5m-4 0h4v4" /></svg>; }
function MailIcon() { return <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="m3 5 7 6 7-6" /></svg>; }
function ShieldIcon() { return <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16 5v4.5c0 3.8-2.5 6.4-6 8-3.5-1.6-6-4.2-6-8V5l6-2.5Z"/><path d="m7 10 2 2 4-4" /></svg>; }
function CheckIcon() { return <svg className="check-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9" /></svg>; }
