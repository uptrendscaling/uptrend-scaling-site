// Homepage markup (route "/"). Built as a string so the page can run its small
// interactive pieces (live builder, design viewer, price builder, review demo)
// from home-client.ts after it loads. All prices, the trial length and the FAQ
// come from the same constants the rest of the site uses, so they cannot drift.
// Every class is styled in ../home.css under the .uh wrapper.

export type HomeMarkupInput = {
  trial: number;
  setup: string;
  starter: string;
  startTrial: string;
  faq: { question: string; answer: string }[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHomeHtml(input: HomeMarkupInput): string {
  const { trial, setup, starter } = input;
  const START_TRIAL = input.startTrial;
  const faq = input.faq
    .map(
      (item, index) =>
        `<details${index === 0 ? " open" : ""}><summary>${esc(item.question)}<i></i></summary><p>${esc(item.answer)}</p></details>`,
    )
    .join("");
  return `<header class="hdr">
  <div class="hdr-in">
    <a class="logo" href="#top" aria-label="UpTrend Scaling home">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="currentColor"/><path d="M6 15.5l4-4.2 3 3 5-6" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>UpTrend <i>Scaling</i></span>
    </a>
    <nav class="nav" aria-label="Main">
      <a href="#websites">Websites</a><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#reviews">Reviews tool</a><a href="#faq">FAQ</a>
    </nav>
    <button class="tgl" id="theme" type="button" aria-label="Switch between light and dark mode">
      <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>
    </button>
    <a class="login" href="/login">Log in</a>
    <a class="btn btn-k" href="/start?website=build" id="hdrOrder">Order<span class="lg"> a website</span></a>
  </div>
</header>

<main id="main">
<section class="hero">
  <canvas class="bgc" id="bgHero" aria-hidden="true"></canvas>
  <div class="wrap">
    <span class="pill"><i></i>Websites from $299, one time</span>
    <h1>A website that <span class="mute">makes your phone ring.</span></h1>
    <p class="lede">We design and build a fast, mobile-first website for your business. <b>You approve it before it goes live.</b> Want us to keep it running? Upkeep is optional at $99 a month.</p>
    <div class="hero-cta">
      <a class="btn btn-y" href="/start?website=build">Order my website <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      <a class="btn" href="#websites">See live designs</a>
    </div>
    <ul class="facts">
      <li><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>One time payment</li>
      <li><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>Approve before launch</li>
      <li><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>Built for phones first</li>
    </ul>

    <div class="hst" id="hst" aria-label="Live preview of your website">
      <div class="hst-in" id="hin">
        <div class="lap"><div class="bar"><i></i><i></i><i></i><span class="url" id="url">sunrisehome.com</span><span class="sp"></span></div><div class="screen" id="scrL"></div></div>
        <div class="phw"><div class="pho"><div class="screen" id="scrP"></div></div></div>
      </div>
    </div>

    <div class="ctl" id="bld">
      <div><label class="lab" for="bn">Your business name</label><input id="bn" type="text" value="Sunrise Home Services" maxlength="28" autocomplete="off" spellcheck="false"></div>
      <div><span class="lab" id="trl">Your trade</span><div class="chips" id="trades" role="group" aria-labelledby="trl"></div></div>
      <div class="ctl-end">
        <div class="clr"><span class="lab" id="acl">Color</span><button type="button" class="clr-b" id="clrB" aria-expanded="false" aria-controls="clrP" aria-labelledby="acl"><i id="clrDot"></i>Choose a color<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
          <div class="clr-p" id="clrP" hidden><div class="clr-g" id="clrG" role="group" aria-label="Brand colors"></div><label class="clr-c"><input type="color" id="clrC" value="#2457ff" aria-label="Pick any custom color"><span>Pick any custom color</span></label></div></div>
        <button class="rand" id="rand" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>Shuffle</button>
      </div>
    </div>
  </div>
  <div class="tick" aria-hidden="true"><div class="tick-t" id="marq"></div></div>
</section>

<section class="sec" id="websites">
  <div class="wrap">
    <div class="sec-hd pre rv-t">
      <span class="eyebrow"><b>01</b> Designs</span>
      <h2>Three live designs. Open one and use it.</h2>
      <p>Every site is built phone first, loads fast, and has a quote form and tap-to-call button built in. These are real, working sites. Open any one and try it.</p>
    </div>
    <div class="dgrid" id="dgrid"></div>
  </div>
</section>

<section class="sec" id="how">
  <div class="wrap">
    <div class="sec-hd pre rv-t"><span class="eyebrow"><b>02</b> Process</span><h2>You talk. We build. You approve.</h2><p>No sales calls, no long contracts, and nothing goes live until you say so.</p></div>
    <div class="steps pre rv-t">
      <div class="step"><span class="n">01</span><h3>Tell us about your business</h3><p>Your name, services, area and phone number, plus a few photos if you have them. About five minutes.</p></div>
      <div class="step"><span class="n">02</span><h3>We build your site</h3><p>A mobile-first site in the style you picked, with tap-to-call, a quote form and your services up front.</p></div>
      <div class="step"><span class="n">03</span><h3>You approve it, then it goes live</h3><p>Ask for changes until it feels right. When you say yes, we launch it. Upkeep is optional after that.</p></div>
    </div>
    <div class="inc pre rv-t">
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg><p><b>Built for phones first</b><span>Looks right on every screen your customers use.</span></p></div>
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg><p><b>Tap to call</b><span>One tap puts a customer on the phone with you.</span></p></div>
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 14h5"/></svg><p><b>Quote form</b><span>Requests come straight to you, day or night.</span></p></div>
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg><p><b>Fast loading</b><span>Light pages, so nobody gives up and goes back to Google.</span></p></div>
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg><p><b>You approve first</b><span>Nothing goes live until you say yes.</span></p></div>
      <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/></svg><p><b>Your services up front</b><span>What you do and where you work, in the first screen.</span></p></div>
    </div>
  </div>
</section>

<section class="sec" id="pricing">
  <div class="wrap">
    <div class="sec-hd pre rv-t"><span class="eyebrow"><b>03</b> Pricing</span><h2>One flat price. Add only what you need.</h2><p>Your website is a single payment. Upkeep and automatic Google review requests are optional add-ons, billed monthly, so you only ever pay for what you pick.</p></div>
    <div class="pz">
      <div class="opts">
        <div class="opt on">
          <div class="opt-top"><h3>Website build</h3><div class="pp">$299<small>one time</small></div></div>
          <p>A custom mobile-first site, approved by you before launch. Always included.</p>
        </div>
        <div class="opt" id="oUp">
          <div class="opt-top"><h3>Upkeep</h3><div class="r"><div class="pp">$99<small>per month</small></div><button class="sw2" id="tUp" role="switch" aria-checked="false" aria-label="Add upkeep"></button></div></div>
          <p>Hosting, small updates and support. Optional, and you can skip it.</p>
        </div>
        <div class="opt" id="oRv">
          <div class="opt-top"><h3>Google review automation</h3><div class="r"><div class="pp" id="rvp">${starter}<small>per location, per month</small></div><button class="sw2" id="tRv" role="switch" aria-checked="false" aria-label="Add review automation"></button></div></div>
          <p>Automatic text and email review requests after every job. ${trial}-day free trial, plus a one-time ${setup} setup fee.</p>
          <div class="sub">
            <div class="tier" id="tier" role="group" aria-label="Review request plan"></div>
            <div class="stepper"><span>Locations</span><button type="button" id="lm" aria-label="Fewer locations">-</button><output id="ln" aria-live="polite">1</output><button type="button" id="lp" aria-label="More locations">+</button></div>
          </div>
        </div>
      </div>
      <div class="rcpt" id="rcpt" aria-live="polite">
        <h3>Your plan</h3>
        <div class="ln"><span>Website build</span><span>$299</span></div>
        <div class="ln off" id="lUp"><span>Upkeep</span><span>$99 / mo</span></div>
        <div class="ln off" id="lRv"><span id="lRvT">Review automation</span><span id="lRvP">${starter} / mo</span></div>
        <div class="ln off" id="lSu"><span>Review setup fee</span><span>${setup} once</span></div>
        <div class="big">
          <div class="y"><small>Website, one time</small><strong id="vToday">$299</strong></div>
          <div><small>Add-ons, per month</small><strong id="vMonth">$0</strong></div>
        </div>
        <p class="note" id="rnote">Just the website. One payment, and you approve it before it goes live.</p>
        <a class="btn btn-y" href="/start?website=build" id="order">Get started</a>
      </div>
    </div>
  </div>
</section>

<section class="sec" id="reviews">
  <div class="wrap rv">
    <div class="pre rv-t">
      <div class="ph2w"><div class="ph2" aria-label="Review request text message demo">
        <div class="in">
          <div class="top"><span class="av" id="avT">SH</span><div><b id="nmT">Sunrise Home Services</b><small>Text message</small></div></div>
          <div class="msgs" id="msgs">
            <div class="bub" id="b1"></div>
            <div class="bub" id="b2">It takes about 10 seconds and no sign-in.<a href="#reviews" id="b2a">Leave a Google review</a></div>
            <div class="bub" id="b3" style="align-self:center;background:transparent;box-shadow:none;text-align:center;max-width:100%"><div class="stars" id="stars" role="group" aria-label="Tap to rate"></div><div class="thx" id="thx">Tap a star</div></div>
          </div>
        </div>
      </div></div>
    </div>
    <div class="rvt pre rv-t">
      <span class="eyebrow"><b>04</b> Reviews tool</span>
      <h2>A great site gets the click. Reviews get the call.</h2>
      <p>Our review tool texts and emails every customer a one-tap Google review link after the job, with one reminder after 48 hours. It connects to the tools you already use, and it never buys, fakes or filters reviews.</p>
      <div class="ints"><span>QuickBooks</span><span>Square</span><span>Jobber</span><span>Zapier</span><span>QR codes</span></div>
      <div class="stats" id="stats">
        <div class="stat"><b data-n="97" data-s="%">97%</b><span>read reviews before choosing</span></div>
        <div class="stat"><b data-n="83" data-s="%">83%</b><span>leave one when asked</span></div>
        <div class="stat"><b data-n="92" data-s="%">92%</b><span>say star ratings sway them</span></div>
        <div class="stat"><b data-n="80" data-s="%">80%</b><span>prefer a business that replies</span></div>
      </div>
      <p class="src">Source: BrightLocal 2026 Local Consumer Review Survey.</p>
      <div class="row"><a class="btn btn-k" href="${START_TRIAL}">Start ${trial}-day free trial</a><a class="btn" href="#pricing">See review pricing</a></div>
    </div>
  </div>
</section>

<section class="sec" id="faq">
  <div class="wrap">
    <div class="sec-hd pre rv-t"><span class="eyebrow"><b>05</b> Questions</span><h2>Straight answers.</h2><p>Still wondering? Email <a class="mail" href="mailto:hello@uptrendscaling.com?subject=Question%20about%20UpTrend%20Scaling">hello@uptrendscaling.com</a>.</p></div>
    <div class="faq pre rv-t" id="faqs">${faq}</div>
  </div>
</section>

<section class="cta">
  <canvas class="bgc" id="bgCta" aria-hidden="true"></canvas>
  <div class="wrap">
    <h2>Your website, live and working.</h2>
    <p>$299 one time. You approve it before it goes live.</p>
    <a class="btn btn-y" href="/start?website=build" id="ctaBtn">Order a website <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
</section>
</main>
<footer>
  <div class="wrap">
    <div class="foot-g">
      <div><a class="logo" href="#top"><svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="currentColor"/><path d="M6 15.5l4-4.2 3 3 5-6" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>UpTrend <i>Scaling</i></span></a><p style="margin-top:14px;max-width:22rem">Websites and Google review automation for local businesses.</p><p style="margin-top:10px"><a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a></p></div>
      <div><h4>Websites</h4><a href="#websites">Live designs</a><a href="/websites">All websites</a><a href="/get-a-website-built-for-you">Get a website built for you</a><a href="/website-for/hvac-companies">HVAC websites</a><a href="/website-for/plumbers">Plumber websites</a><a href="/website-for/landscapers">Landscaper websites</a></div>
      <div><h4>Reviews tool</h4><a href="/login">Log in</a><a href="${START_TRIAL}">Start free trial</a><a href="#reviews">How it works</a><a href="/compare/nicejob">vs NiceJob</a><a href="/compare/podium">vs Podium</a><a href="/compare/birdeye">vs Birdeye</a></div>
      <div><h4>Company</h4><a href="/affiliates">Affiliates</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="#faq">FAQ</a><a href="https://www.facebook.com/profile.php?id=61594598074617" target="_blank" rel="noopener noreferrer">Facebook</a><a href="https://www.instagram.com/uptrendscaling/" target="_blank" rel="noopener noreferrer">Instagram</a></div>
    </div>
    <a class="badge" href="https://affylist.com/" title="Listed on AffyList"><img class="badge-light" src="https://affylist.com/badge/affylist-v1-light.svg" alt="Listed on AffyList" width="200" height="54" loading="lazy"><img class="badge-dark" src="https://affylist.com/badge/affylist-v1-dark.svg" alt="Listed on AffyList" width="200" height="54" loading="lazy"></a>
    <div class="foot-b" style="margin-top:28px">&copy; 2026 UpTrend Scaling, LLC. All rights reserved.</div>
  </div>
</footer>`;
}
