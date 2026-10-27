// The photo showcase layout, for photographers and anyone else whose work is
// best shown in pictures. Two pieces:
//   1. a full-screen photo opening with a slow zoom as you scroll
//   2. a "film strip": the page pins in place and scrolling down slides the
//      photos sideways, then the page carries on. Tap a photo to enlarge it.
// Without JavaScript, or with reduced motion on, the strip is a normal row you
// swipe through. Pure: no database, no network.

import { telHref, type SiteContent } from "./types";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ARROW =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const PHONE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>';

// A showcase needs enough pictures to be worth scrolling.
export const SHOWCASE_MIN_PHOTOS = 3;

export function usesShowcase(c: SiteContent): boolean {
  return (
    c.galleryStyle === "reel" &&
    c.gallery.length >= SHOWCASE_MIN_PHOTOS &&
    !!(c.hero.imageId ?? c.gallery[0])
  );
}

export function showcaseHeroHtml(
  c: SiteContent,
  assetUrl: (id: string) => string,
): string {
  const h = c.hero;
  const tel = telHref(c.brand.phone);
  const img = h.imageId ?? c.gallery[0] ?? "";
  const h1 = `${esc(h.headline)}${h.headlineAccent ? ` <em>${esc(h.headlineAccent)}</em>` : ""}`;
  return `<section class="sc-hero" id="top">
  <div class="sc-hero-bg" data-sc-zoom><img src="${esc(assetUrl(img))}" alt="${esc(c.brand.name)}" loading="eager" fetchpriority="high"></div>
  <div class="sc-hero-shade" aria-hidden="true"></div>
  <div class="wrap sc-hero-in">
    <span class="pill">${esc(h.eyebrow)}</span>
    <h1>${h1}</h1>
    <p class="lede">${esc(h.sub)}</p>
    <div class="cta-row"><a class="btn btn-a" href="#work">See our work ${ARROW}</a><a class="btn btn-g" href="${esc(tel)}">${PHONE} ${esc(h.secondaryCta)}</a></div>
    <a class="sc-down" href="#work" aria-label="Scroll to our work"><span>Scroll</span><i></i></a>
  </div>
</section>`;
}

export function showcaseReelHtml(
  c: SiteContent,
  assetUrl: (id: string) => string,
): string {
  const total = c.gallery.length;
  const slides = c.gallery
    .map((id, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `<figure class="sc-slide" data-i="${i}"><button type="button" class="sc-open" data-sc-open="${i}" aria-label="Enlarge photo ${i + 1} of ${total}"><img src="${esc(assetUrl(id))}" alt="Photo ${i + 1} by ${esc(c.brand.name)}" loading="${i < 3 ? "eager" : "lazy"}" decoding="async"></button><figcaption>${n}</figcaption></figure>`;
    })
    .join("");
  return `<section class="sc-reel" id="work" data-sc-reel data-total="${total}" aria-label="Our work">
  <div class="sc-pin">
    <div class="sc-top"><div><span class="eyebrow">Our work</span><h2>${esc(c.galleryTitle || "See it for yourself")}</h2></div><div class="sc-count" aria-hidden="true"><b data-sc-now>01</b><span> / ${String(total).padStart(2, "0")}</span></div></div>
    <div class="sc-track" data-sc-track>${slides}<div class="sc-end"><p>Like what you see?</p><a class="btn btn-a" href="#quote">${esc(c.cta.button)} ${ARROW}</a></div></div>
    <div class="sc-foot"><div class="sc-bar" aria-hidden="true"><i data-sc-bar></i></div><span class="sc-hint" aria-hidden="true">Keep scrolling</span></div>
  </div>
</section>
<div class="sc-lb" data-sc-lb hidden role="dialog" aria-modal="true" aria-label="Photo viewer">
  <button type="button" class="sc-x" data-sc-close aria-label="Close">&times;</button>
  <button type="button" class="sc-nav sc-prev" data-sc-prev aria-label="Previous photo">&#8249;</button>
  <img data-sc-lbimg alt="">
  <button type="button" class="sc-nav sc-next" data-sc-next aria-label="Next photo">&#8250;</button>
  <div class="sc-lbn" data-sc-lbn></div>
</div>`;
}

export const SHOWCASE_CSS = `
.sc-hero{position:relative;min-height:92vh;min-height:92svh;display:flex;align-items:flex-end;overflow:hidden;color:#fff;background:#000}
.sc-hero-bg{position:absolute;inset:0;will-change:transform}
.sc-hero-bg img{width:100%;height:100%;object-fit:cover;max-width:none}
.sc-hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,#0006 0%,#0000 30%,#000b 100%)}
.sc-hero-in{position:relative;z-index:2;padding-top:120px;padding-bottom:72px;width:100%}
.sc-hero h1{font-size:clamp(44px,8.4vw,112px);max-width:14ch;color:#fff;text-shadow:0 2px 30px #0008}
.sc-hero h1 em{font-style:normal;color:var(--a)}
.sc-hero .lede{max-width:560px;color:#fffd;margin:18px 0 26px;font-size:clamp(16px,1.6vw,19px);text-shadow:0 1px 12px #0009}
.sc-hero .pill{background:#0008;color:#fff;border:1px solid #fff4;backdrop-filter:blur(6px)}
.sc-hero .cta-row{display:flex;gap:12px;flex-wrap:wrap}
.sc-hero .btn-g{background:#0007;color:#fff;border-color:#fff5;backdrop-filter:blur(6px)}
.sc-down{position:absolute;right:22px;bottom:26px;display:flex;flex-direction:column;align-items:center;gap:10px;color:#fff;text-decoration:none;font:600 12px var(--body);letter-spacing:.18em;text-transform:uppercase}
.sc-down i{width:1px;height:54px;background:linear-gradient(#fff,#fff0);animation:sc-drip 1.8s ease-in-out infinite}
@keyframes sc-drip{0%{transform:scaleY(0);transform-origin:top}50%{transform:scaleY(1);transform-origin:top}51%{transform-origin:bottom}100%{transform:scaleY(0);transform-origin:bottom}}

.sc-reel{position:relative;background:var(--bg);height:300vh}
.sc-pin{position:sticky;top:68px;height:calc(100vh - 68px);height:calc(100svh - 68px);display:flex;flex-direction:column;justify-content:center;gap:clamp(14px,2.4vh,26px);overflow:hidden;padding:clamp(10px,2vh,24px) 0}
.sc-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:0 max(22px,calc((100vw - 1180px)/2 + 22px))}
.sc-top h2{font-size:clamp(30px,4.4vw,56px);margin-top:6px}
.sc-count{font:600 15px var(--body);color:var(--muted);letter-spacing:.08em;white-space:nowrap}
.sc-count b{font:var(--hw) clamp(30px,4vw,48px)/1 var(--head);color:var(--ink);letter-spacing:0}
.sc-track{display:flex;align-items:center;gap:clamp(14px,2vw,28px);padding:0 max(22px,calc((100vw - 1180px)/2 + 22px));width:max-content;will-change:transform;flex:1;min-height:0}
.sc-slide{margin:0;flex:none;height:100%;max-height:74vh;max-height:74svh;position:relative}
.sc-slide .sc-open{display:block;height:100%;padding:0;border:0;background:var(--card);cursor:zoom-in;border-radius:var(--br);overflow:hidden;box-shadow:0 30px 60px -30px #0009}
.sc-slide img{height:100%;width:auto;max-width:none;display:block;transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.sc-slide .sc-open:hover img{transform:scale(1.03)}
.sc-slide figcaption{position:absolute;left:14px;bottom:12px;font:600 12px var(--body);letter-spacing:.14em;color:#fff;text-shadow:0 1px 8px #000a;pointer-events:none}
.sc-end{flex:none;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:16px;padding:0 clamp(24px,6vw,90px) 0 20px;min-width:min(78vw,420px)}
.sc-end p{white-space:normal;max-width:9em;font:var(--hw) clamp(30px,4vw,52px)/1.05 var(--head);text-transform:var(--hc);letter-spacing:var(--ht)}
.sc-foot{display:flex;align-items:center;gap:16px;padding:0 max(22px,calc((100vw - 1180px)/2 + 22px))}
.sc-bar{flex:1;height:3px;background:var(--line);border-radius:3px;overflow:hidden}
.sc-bar i{display:block;height:100%;width:100%;background:var(--a);transform:scaleX(0);transform-origin:left}
.sc-hint{font:600 12px var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}

/* No script, or reduced motion: a plain row you swipe through. */
.sc-reel.sc-plain{height:auto}
.sc-reel.sc-plain .sc-pin{position:static;height:auto;overflow:visible}
.sc-reel.sc-plain .sc-track{width:auto;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:12px}
.sc-reel.sc-plain .sc-slide{height:62vh;height:62svh;scroll-snap-align:center}
.sc-reel.sc-plain .sc-foot{display:none}
@media (prefers-reduced-motion:reduce){.sc-hero-bg{transform:none!important}.sc-down i{animation:none}}

.sc-lb{position:fixed;inset:0;z-index:200;background:#000e;display:flex;align-items:center;justify-content:center;padding:24px}
.sc-lb[hidden]{display:none}
.sc-lb img{max-width:min(94vw,1500px);max-height:88vh;max-height:88svh;border-radius:6px;box-shadow:0 30px 90px #000}
.sc-x,.sc-nav{position:absolute;background:#fff1;color:#fff;border:1px solid #fff3;border-radius:50%;width:48px;height:48px;font:400 30px/1 var(--body);cursor:pointer;display:grid;place-items:center;padding:0 0 4px}
.sc-x{top:16px;right:16px}
.sc-prev{left:16px;top:50%;transform:translateY(-50%)}
.sc-next{right:16px;top:50%;transform:translateY(-50%)}
.sc-x:hover,.sc-nav:hover{background:#fff3}
.sc-lbn{position:absolute;bottom:18px;left:0;right:0;text-align:center;color:#fffb;font:600 13px var(--body);letter-spacing:.14em}

@media (max-width:820px){
  .sc-hero{min-height:88vh;min-height:88svh}
  .sc-hero-in{padding-bottom:96px}
  .sc-down{display:none}
  .sc-pin{top:68px;height:calc(100vh - 68px - 84px);height:calc(100svh - 68px - 84px)}
  .sc-slide{max-height:100%}
  .sc-top{align-items:center}
  .sc-prev,.sc-next{display:none}
}
`;

export const SHOWCASE_SCRIPT = `
(function(){
  var d=document,reel=d.querySelector('[data-sc-reel]');
  var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Slow zoom on the opening photo as you scroll past it.
  var zoom=d.querySelector('[data-sc-zoom]');
  if(zoom&&!rm){
    var zt=false;
    var zf=function(){zt=false;var y=Math.min(scrollY,innerHeight*1.2);var s=1+y/innerHeight*0.12;zoom.style.transform='translate3d(0,'+(y*0.18)+'px,0) scale('+s+')'};
    addEventListener('scroll',function(){if(!zt){zt=true;requestAnimationFrame(zf)}},{passive:true});zf();
  }
  if(!reel)return;
  var track=reel.querySelector('[data-sc-track]'),bar=reel.querySelector('[data-sc-bar]'),now=reel.querySelector('[data-sc-now]');
  var slides=[].slice.call(reel.querySelectorAll('.sc-slide'));
  var pin=reel.querySelector('.sc-pin');
  var total=slides.length;

  // ---- Lightbox (works in both modes) ----
  var lb=d.querySelector('[data-sc-lb]'),lbi=lb.querySelector('[data-sc-lbimg]'),lbn=lb.querySelector('[data-sc-lbn]'),cur=0,lastFocus=null;
  function show(i){cur=(i+total)%total;lbi.src=slides[cur].querySelector('img').currentSrc||slides[cur].querySelector('img').src;lbi.alt=slides[cur].querySelector('img').alt;lbn.textContent=(cur+1)+' / '+total}
  function open(i){lastFocus=d.activeElement;show(i);lb.hidden=false;d.documentElement.style.overflow='hidden';lb.querySelector('[data-sc-close]').focus()}
  function close(){lb.hidden=true;d.documentElement.style.overflow='';if(lastFocus)lastFocus.focus()}
  reel.addEventListener('click',function(e){var b=e.target.closest('[data-sc-open]');if(b)open(+b.getAttribute('data-sc-open'))});
  lb.addEventListener('click',function(e){
    if(e.target.closest('[data-sc-close]')||e.target===lb)close();
    else if(e.target.closest('[data-sc-prev]'))show(cur-1);
    else if(e.target.closest('[data-sc-next]'))show(cur+1);
  });
  d.addEventListener('keydown',function(e){if(lb.hidden)return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')show(cur-1);else if(e.key==='ArrowRight')show(cur+1)});
  var tx=null;lb.addEventListener('touchstart',function(e){tx=e.touches[0].clientX},{passive:true});
  lb.addEventListener('touchend',function(e){if(tx===null)return;var dx=e.changedTouches[0].clientX-tx;tx=null;if(Math.abs(dx)>50)show(dx<0?cur+1:cur-1)},{passive:true});

  if(rm){reel.classList.add('sc-plain');return}

  // ---- The scroll-driven strip ----
  var dist=0,ticking=false;
  function measure(){
    var vw=innerWidth;
    dist=Math.max(0,track.scrollWidth-vw);
    // Scrolling moves the strip a bit faster than the finger, so a long strip
    // does not take forever to get through.
    reel.style.height=(Math.round(dist/1.8)+pin.offsetHeight)+'px';
    update();
  }
  function update(){
    ticking=false;
    var r=reel.getBoundingClientRect();
    var room=reel.offsetHeight-pin.offsetHeight;
    var p=room>0?Math.min(1,Math.max(0,-(r.top-68)/room)):0;
    track.style.transform='translate3d('+(-p*dist)+'px,0,0)';
    bar.style.transform='scaleX('+p+')';
    // Which photo is nearest the middle of the screen.
    var mid=innerWidth/2,best=0,bd=1e9;
    for(var i=0;i<total;i++){var b=slides[i].getBoundingClientRect();var c=Math.abs(b.left+b.width/2-mid);if(c<bd){bd=c;best=i}}
    now.textContent=String(best+1).padStart(2,'0');
  }
  function onScroll(){if(!ticking){ticking=true;requestAnimationFrame(update)}}
  addEventListener('scroll',onScroll,{passive:true});
  addEventListener('resize',measure);
  slides.forEach(function(s){var im=s.querySelector('img');if(!im.complete)im.addEventListener('load',measure)});
  // Photos far down the strip start loading right away so the strip never shows gaps.
  slides.forEach(function(s){var im=s.querySelector('img');im.loading='eager'});
  measure();
  addEventListener('load',measure);
  if(d.fonts&&d.fonts.ready)d.fonts.ready.then(measure);
  // Menu links must not hide the heading under the pinned header.
  reel.style.scrollMarginTop='0px';
})();
`;
