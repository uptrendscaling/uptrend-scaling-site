// Draws a finished website (one self-contained HTML page) from a SiteContent.
// Pure: no database, no network. The server routes in sites.server.ts call it
// and hand the HTML back to the visitor.

import { buildCss, fontLink } from "./render-css";
import { telHref, type SiteContent } from "./types";

export type RenderContext = {
  // Where a quote form posts to, and how an uploaded picture is addressed.
  leadUrl: string;
  assetUrl: (id: string) => string;
  // Canonical address of the page, for the link preview and search engines.
  canonicalUrl: string | null;
  // True while the site is not public yet. Adds noindex and a notice bar, and
  // keeps the quote form from sending real requests.
  preview: boolean;
  // Raw HTML for the bar at the top of a preview (built by the server).
  previewBar?: string;
};

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const PHONE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>';
const ARROW =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LEAF =
  '<svg viewBox="0 0 200 200" fill="currentColor" aria-hidden="true"><path d="M20 180C20 90 80 20 180 20c0 100-60 160-160 160zM20 180C70 120 110 80 150 50" /></svg>';

function brandMark(c: SiteContent, ctx: RenderContext): string {
  const name = esc(c.brand.name);
  if (c.brand.logoId) {
    return `<a class="brand" href="#top" aria-label="${name}"><img src="${esc(ctx.assetUrl(c.brand.logoId))}" alt="${name} logo" width="170" height="40"></a>`;
  }
  const letter = esc((c.brand.name.trim().charAt(0) || "S").toUpperCase());
  return `<a class="brand" href="#top" aria-label="${name}"><span class="mark" aria-hidden="true">${letter}</span><span class="brand-n">${name}</span></a>`;
}

function formHtml(
  c: SiteContent,
  ctx: RenderContext,
  heading: string,
  idp: string,
): string {
  const options = c.services
    .map((s) => `<option value="${esc(s.title)}">${esc(s.title)}</option>`)
    .join("");
  return `<form class="qform" data-action="${esc(ctx.leadUrl)}" data-preview="${ctx.preview ? "1" : "0"}" novalidate>
  <h3>${esc(heading)}</h3>
  <p class="sub">Tell us what you need and ${esc(c.brand.name)} will get back to you.</p>
  <label class="sr" for="${idp}n" style="position:absolute;left:-9999px">Your name</label>
  <input id="${idp}n" name="name" type="text" placeholder="Your name" autocomplete="name" required maxlength="80">
  <label class="sr" for="${idp}p" style="position:absolute;left:-9999px">Phone number</label>
  <input id="${idp}p" name="phone" type="tel" placeholder="Phone number" autocomplete="tel" required maxlength="30">
  <label class="sr" for="${idp}s" style="position:absolute;left:-9999px">What do you need?</label>
  <select id="${idp}s" name="service" data-svc-select><option value="">What do you need?</option>${options}</select>
  <label class="sr" for="${idp}m" style="position:absolute;left:-9999px">Message</label>
  <textarea id="${idp}m" name="message" rows="3" placeholder="Tell us a little about the job (optional)" maxlength="1200"></textarea>
  <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="btn btn-a" type="submit">${esc(c.cta.button)} ${ARROW}</button>
  <p class="fmsg" role="status" aria-live="polite"></p>
</form>`;
}

function badgesHtml(c: SiteContent): string {
  if (c.badges.length === 0) return "";
  return `<ul class="badges">${c.badges.map((b) => `<li>${CHECK}${esc(b)}</li>`).join("")}</ul>`;
}

function heroHtml(c: SiteContent, ctx: RenderContext): string {
  const h = c.hero;
  const tel = telHref(c.brand.phone);
  const h1 = `${esc(h.headline)}${h.headlineAccent ? ` <em>${esc(h.headlineAccent)}</em>` : ""}`;
  const buttons = `<div class="cta-row"><a class="btn btn-a" href="#quote">${esc(h.primaryCta)} ${ARROW}</a><a class="btn btn-g" href="${esc(tel)}">${PHONE} ${esc(h.secondaryCta)}</a></div>`;
  const photo = h.imageId
    ? `<div class="hero-photo"><img src="${esc(ctx.assetUrl(h.imageId))}" alt="${esc(c.brand.name)}" loading="eager"></div>`
    : "";

  if (c.style === "warm") {
    return `<section class="hero" id="top">
  <div class="wrap hero-g">
    <div class="hero-t">
      <span class="pill">${esc(h.eyebrow)}</span>
      <h1>${h1}</h1>
      <p class="lede">${esc(h.sub)}</p>
      ${buttons}
      ${badgesHtml(c)}
    </div>
    <aside class="qcard" id="top-form">${photo}${formHtml(c, ctx, c.cta.button, "h")}</aside>
  </div>
  <svg class="hills" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden="true"><path fill="var(--bg)" d="M0 160V96c120-38 230-70 360-46 150 28 230 86 400 60 150-22 250-82 420-84 100-1 190 22 260 52v82z"/><path fill="#00000022" d="M0 160V118c140-30 250-46 400-24 160 24 260 62 430 40 140-18 260-64 400-58 80 3 150 22 210 40v44z"/></svg>
</section>`;
  }

  if (c.style === "copper") {
    return `<section class="hero" id="top">
  <div class="wrap hero-g">
    <div class="hero-t">
      <span class="pill">${esc(h.eyebrow)}</span>
      <h1>${h1}</h1>
      <p class="lede">${esc(h.sub)}</p>
      ${buttons}
      ${badgesHtml(c)}
    </div>
    <aside class="qcard" id="top-form">
      <div class="fig"><span>Fig. 01 / Request service</span><b>&#9679; Live</b></div>
      ${photo}
      ${formHtml(c, ctx, c.cta.button, "h")}
    </aside>
  </div>
</section>`;
  }

  // green
  const side = `<div class="hero-side"><p class="lede">${esc(h.sub)}</p>${buttons}</div>`;
  const image = h.imageId
    ? `<img class="hp-photo" src="${esc(ctx.assetUrl(h.imageId))}" alt="${esc(c.brand.name)}" loading="eager">`
    : `<span class="leaf">${LEAF}</span><span class="leaf2">${LEAF}</span>`;
  return `<section class="hero" id="top">
  <div class="wrap">
    <div class="hero-top">
      <div><span class="pill">${esc(h.eyebrow)}</span><h1>${esc(h.headline)}${h.headlineAccent ? ` <em>${esc(h.headlineAccent)}</em>` : ""}</h1></div>
      ${side}
    </div>
    <div class="hero-img">${image}
      <div class="hero-card"><div class="t">${esc(c.brand.name)}</div><div class="p">${esc(c.brand.tagline || h.eyebrow)}</div><a class="btn btn-a" href="${esc(tel)}">${PHONE} ${esc(c.brand.phone)}</a></div>
    </div>
    ${c.badges.length ? `<div class="badge-row">${badgesHtml(c)}</div>` : ""}
  </div>
</section>`;
}

function statsHtml(c: SiteContent): string {
  if (c.stats.length === 0) return "";
  return `<div class="strip"><div class="wrap strip-in">${c.stats
    .map(
      (s) =>
        `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`,
    )
    .join("")}</div></div>`;
}

function servicesHtml(c: SiteContent): string {
  const cards = c.services
    .map((s, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `<article class="card rv"><div class="ico" aria-hidden="true">${n}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><button class="ask" type="button" data-svc="${esc(s.title)}">Ask about this &rarr;</button></article>`;
    })
    .join("");
  return `<section class="sec" id="services"><div class="wrap"><div class="sec-h rv"><span class="eyebrow">Services</span><h2>${esc(c.servicesTitle)}</h2>${c.servicesIntro ? `<p>${esc(c.servicesIntro)}</p>` : ""}</div><div class="grid">${cards}</div></div></section>`;
}

function processHtml(c: SiteContent): string {
  const steps = c.process
    .map(
      (s) =>
        `<div class="step rv"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`,
    )
    .join("");
  return `<section class="sec" id="process" style="padding-top:0"><div class="wrap"><div class="sec-h rv"><span class="eyebrow">Process</span><h2>${esc(c.processTitle)}</h2></div><div class="steps">${steps}</div></div></section>`;
}

function whyAboutHtml(c: SiteContent): string {
  const why = c.why
    .map(
      (w) =>
        `<div class="why-i rv">${CHECK}<div><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></div></div>`,
    )
    .join("");
  return `<section class="sec" id="about"><div class="wrap split"><div class="about rv"><span class="eyebrow">About</span><h2 style="font-size:clamp(34px,4.6vw,56px);margin-bottom:18px">${esc(c.about.title)}</h2><p>${esc(c.about.body)}</p></div><div><h3 class="rv" style="font-size:clamp(26px,3vw,34px);margin-bottom:16px">${esc(c.whyTitle)}</h3><div class="why">${why}</div></div></div></section>`;
}

function galleryHtml(c: SiteContent, ctx: RenderContext): string {
  if (c.gallery.length === 0) return "";
  return `<section class="sec" style="padding-top:0"><div class="wrap"><div class="sec-h rv"><span class="eyebrow">Our work</span><h2>See what we do</h2></div><div class="gal">${c.gallery
    .map(
      (id) =>
        `<img class="rv" src="${esc(ctx.assetUrl(id))}" alt="Photo from ${esc(c.brand.name)}" loading="lazy">`,
    )
    .join("")}</div></div></section>`;
}

function areasHtml(c: SiteContent): string {
  if (c.areas.length === 0) return "";
  return `<section class="sec" id="areas" style="padding-top:0"><div class="wrap"><div class="sec-h rv"><span class="eyebrow">Service area</span><h2>${esc(c.areasTitle)}</h2></div><ul class="areas rv">${c.areas
    .map((a) => `<li>${esc(a)}</li>`)
    .join("")}</ul></div></section>`;
}

function faqHtml(c: SiteContent): string {
  if (c.faq.length === 0) return "";
  return `<section class="sec" id="faq" style="padding-top:0"><div class="wrap"><div class="sec-h rv"><span class="eyebrow">FAQ</span><h2>${esc(c.faqTitle)}</h2></div><div class="faq">${c.faq
    .map(
      (f, i) =>
        `<details class="rv"${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`,
    )
    .join("")}</div></div></section>`;
}

function extrasHtml(
  c: SiteContent,
  placement: SiteContent["extras"][number]["placement"],
): string {
  return c.extras
    .filter((x) => x.placement === placement)
    .map((x) => {
      const tel = telHref(c.brand.phone);
      if (x.kind === "banner") {
        return `<section class="xtra"><div class="wrap"><div class="banner rv"><div><h2>${esc(x.title)}</h2>${x.body ? `<p>${esc(x.body)}</p>` : ""}</div><a class="btn" href="${esc(tel)}">${PHONE} ${esc(c.brand.phone)}</a></div></div></section>`;
      }
      const list =
        x.kind === "list" && x.items.length
          ? `<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
          : "";
      return `<section class="xtra"><div class="wrap rv"><h2>${esc(x.title)}</h2>${x.body ? `<p>${esc(x.body)}</p>` : ""}${list}</div></section>`;
    })
    .join("");
}

function quoteHtml(c: SiteContent, ctx: RenderContext): string {
  const tel = telHref(c.brand.phone);
  const hours = c.brand.hours ? `<span>${esc(c.brand.hours)}</span>` : "";
  return `<section class="sec quote" id="quote"><div class="wrap quote-g"><div><span class="eyebrow" style="color:inherit;opacity:.8">Contact</span><h2>${esc(c.cta.title)}</h2><p class="lede">${esc(c.cta.text)}</p><div class="quote-ph"><span>Call or text</span><a href="${esc(tel)}">${esc(c.brand.phone)}</a>${hours}</div></div><div class="qcard">${formHtml(c, ctx, c.cta.button, "q")}</div></div></section>`;
}

function footerHtml(c: SiteContent): string {
  const email = c.brand.email
    ? ` &middot; <a href="mailto:${esc(c.brand.email)}">${esc(c.brand.email)}</a>`
    : "";
  return `<footer class="ftr"><div class="wrap ftr-in"><div>&copy; <span data-year>2026</span> ${esc(c.brand.name)}. ${esc(c.brand.city)}${c.brand.state ? `, ${esc(c.brand.state)}` : ""}${email}</div><div>Website by <a href="https://www.uptrendscaling.com/websites" rel="noopener">UpTrend Scaling</a></div></div></footer>`;
}

const SCRIPT = `
(function(){
  var d=document;
  var y=d.querySelector('[data-year]');if(y)y.textContent=new Date().getFullYear();
  var b=d.querySelector('.burger'),n=d.querySelector('.nav');
  if(b&&n){b.addEventListener('click',function(){var o=n.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false')});
    n.addEventListener('click',function(e){if(e.target.tagName==='A'){n.classList.remove('open');b.setAttribute('aria-expanded','false')}})}
  var els=d.querySelectorAll('.rv');
  if('IntersectionObserver' in window){
    d.documentElement.classList.add('js');
    els.forEach(function(el){var r=el.getBoundingClientRect();if(r.top>innerHeight)el.style.opacity='0'});
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.style.opacity='';e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12,rootMargin:'0px 0px -40px 0px'});
    els.forEach(function(el){io.observe(el)});
    setTimeout(function(){els.forEach(function(el){el.style.opacity='';el.classList.add('in')})},4500);
  }else{els.forEach(function(el){el.classList.add('in')})}
  d.querySelectorAll('[data-svc]').forEach(function(btn){btn.addEventListener('click',function(){
    var v=btn.getAttribute('data-svc');
    d.querySelectorAll('[data-svc-select]').forEach(function(s){s.value=v});
    var q=d.getElementById('quote');if(q)q.scrollIntoView({behavior:'smooth'});
    var f=q&&q.querySelector('input[name=name]');if(f)setTimeout(function(){f.focus({preventScroll:true})},500);
  })});
  d.querySelectorAll('.qform').forEach(function(form){
    form.addEventListener('submit',function(ev){
      ev.preventDefault();
      var msg=form.querySelector('.fmsg');
      function say(t,c){msg.textContent=t;msg.className='fmsg '+c}
      var name=form.name.value.trim(),phone=form.phone.value.trim();
      if(!name||phone.replace(/\\D/g,'').length<7){say('Please add your name and a phone number.','bad');return}
      if(form.getAttribute('data-preview')==='1'){say('Preview only. The form starts sending requests once the site is live.','ok');return}
      var btn=form.querySelector('button[type=submit]');btn.disabled=true;
      fetch(form.getAttribute('data-action'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,phone:phone,service:form.service.value,message:form.message.value,website:form.website.value})})
        .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,j:j}})})
        .then(function(x){if(x.ok){say('Thank you! We got your request and will be in touch soon.','ok');form.reset()}else{say((x.j&&x.j.message)||'Something went wrong. Please call us instead.','bad')}btn.disabled=false})
        .catch(function(){say('Something went wrong. Please call us instead.','bad');btn.disabled=false});
    });
  });
})();
`;

function jsonLd(c: SiteContent, ctx: RenderContext): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: c.brand.name,
    telephone: c.brand.phone,
    email: c.brand.email || undefined,
    areaServed: c.areas,
    address: {
      "@type": "PostalAddress",
      addressLocality: c.brand.city,
      addressRegion: c.brand.state || undefined,
    },
    url: ctx.canonicalUrl || undefined,
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function renderSite(c: SiteContent, ctx: RenderContext): string {
  const tel = telHref(c.brand.phone);
  const topbar =
    c.style === "copper"
      ? `<div class="topbar"><i></i>${esc(c.badges.slice(0, 2).join(" · ") || c.brand.tagline || c.hero.eyebrow)}</div>`
      : "";
  const nav = `<nav class="nav" id="nav" aria-label="Main"><a href="#services">Services</a><a href="#about">About</a>${c.areas.length ? '<a href="#areas">Areas</a>' : ""}${c.faq.length ? '<a href="#faq">FAQ</a>' : ""}<a class="btn btn-a btn-sm" href="${esc(tel)}">${PHONE} ${esc(c.brand.phone)}</a></nav>`;
  const canonical =
    ctx.canonicalUrl && !ctx.preview
      ? `<link rel="canonical" href="${esc(ctx.canonicalUrl)}">`
      : "";
  const og = ctx.preview
    ? ""
    : `<meta property="og:title" content="${esc(c.seo.title)}"><meta property="og:description" content="${esc(c.seo.description)}"><meta property="og:type" content="website">`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.seo.title)}</title>
<meta name="description" content="${esc(c.seo.description)}">
<meta name="theme-color" content="${esc(c.accent)}">
${ctx.preview ? '<meta name="robots" content="noindex,nofollow">' : ""}
${canonical}${og}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontLink(c.style)}">
<style>${buildCss(c.style, c.accent)}</style>
${ctx.preview ? "" : jsonLd(c, ctx)}
</head>
<body>
${ctx.previewBar ?? ""}
<a class="skip" href="#services">Skip to content</a>
${topbar}
<header class="hdr"><div class="wrap hdr-in">${brandMark(c, ctx)}<button class="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>${nav}</div></header>
<main>
${heroHtml(c, ctx)}
${extrasHtml(c, "after_hero")}
${statsHtml(c)}
${servicesHtml(c)}
${extrasHtml(c, "after_services")}
${processHtml(c)}
${whyAboutHtml(c)}
${extrasHtml(c, "after_why")}
${galleryHtml(c, ctx)}
${areasHtml(c)}
${faqHtml(c)}
${extrasHtml(c, "after_faq")}
${quoteHtml(c, ctx)}
${extrasHtml(c, "end")}
</main>
${footerHtml(c)}
<div class="callbar"><a class="c1" href="${esc(tel)}">Call ${esc(c.brand.phone)}</a><a class="c2" href="#quote">Get a quote</a></div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// Shown at a site's free address once the 7 days are up and no domain or upkeep.
export function renderPausedPage(name: string, phone: string | null): string {
  const n = esc(name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${n}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#fafafa;font:16px/1.6 system-ui,sans-serif;padding:24px;text-align:center}main{max-width:460px}h1{font-size:30px;margin:0 0 12px}p{color:#b4b4b8}a{color:#facc15}</style></head><body><main><h1>${n}</h1><p>This website is being moved to its own address. Please check back soon${phone ? `, or call <a href="${esc(telHref(phone))}">${esc(phone)}</a>` : ""}.</p></main></body></html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#fafafa;font:16px/1.6 system-ui,sans-serif;padding:24px;text-align:center}</style></head><body><main><h1>Page not found</h1><p><a style="color:#facc15" href="https://www.uptrendscaling.com">uptrendscaling.com</a></p></main></body></html>`;
}
