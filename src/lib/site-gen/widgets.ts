// The interactive part of a site's top section. Like the three live designs
// (a draggable thermostat for HVAC, a pressure gauge and valve for plumbing, a
// yard planner for landscaping), every automatic site gets one hands-on piece
// that fits the trade. Pure string building: no database, no network.

import type { SiteContent, SiteWidget } from "./types";

export const WIDGET_LABELS: Record<SiteWidget, string> = {
  dial: "Thermostat dial (heating and cooling)",
  gauge: "Pressure gauge and valve (plumbing)",
  planner: "Project planner (any trade)",
  form: "Quote form only (no interactive piece)",
};

// Picks the interactive piece from what the customer said their trade is.
export function widgetForTrade(trade: string): SiteWidget {
  const t = trade.toLowerCase();
  if (/hvac|heating|cooling|air.?cond|furnace|\ba\/?c\b|heat pump/.test(t))
    return "dial";
  if (/plumb|drain|sewer|water heater|pipe|rooter/.test(t)) return "gauge";
  return "planner";
}

function e(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function polar(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(
  cx: number,
  cy: number,
  r: number,
  a1: number,
  a2: number,
): string {
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, r, a2);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// Both round instruments sweep 270 degrees, starting at the lower left.
const START = 135;
const SWEEP = 270;

function ticks(
  count: number,
  majorEvery: number,
  rMinor: [number, number],
  rMajor: [number, number],
): string {
  let out = "";
  for (let i = 0; i <= count; i++) {
    const ang = START + (SWEEP * i) / count;
    const major = i % majorEvery === 0;
    const [r1, r2] = major ? rMajor : rMinor;
    const [x1, y1] = polar(160, 160, r1, ang);
    const [x2, y2] = polar(160, 160, r2, ang);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${major ? "tk tk-m" : "tk"}"/>`;
  }
  return out;
}

const DIAL_START_T = 0.97; // 107 degrees, like the live HVAC design

function dialHtml(c: SiteContent): string {
  const ang = START + SWEEP * DIAL_START_T;
  const [kx, ky] = polar(160, 160, 128, ang);
  return `<div class="wx wx-dial" data-dial data-t="${DIAL_START_T}" style="--heat:${DIAL_START_T}">
  <div class="wx-fig"><span>Try it</span><b>${e(c.brand.city)} right now</b></div>
  <div class="dial-wrap">
    <svg viewBox="0 0 320 320" role="group" aria-label="Thermostat dial" class="dial-svg">
      <defs><linearGradient id="dg" gradientUnits="userSpaceOnUse" x1="30" y1="0" x2="290" y2="0"><stop offset="0" stop-color="#7ac6dc"/><stop offset=".5" stop-color="#f4b942"/><stop offset="1" stop-color="#ff6b3d"/></linearGradient></defs>
      <circle cx="160" cy="160" r="152" class="dial-face"/>
      ${ticks(36, 6, [100, 110], [94, 112])}
      <path d="${arc(160, 160, 128, START, START + SWEEP)}" class="dial-track"/>
      <path data-dial-arc d="${arc(160, 160, 128, START, ang)}" class="dial-val" stroke="url(#dg)"/>
      <g class="dial-knob" data-dial-knob transform="translate(${kx.toFixed(2)} ${ky.toFixed(2)})" tabindex="0" role="slider" aria-label="Temperature" aria-valuemin="72" aria-valuemax="108" aria-valuenow="107">
        <circle r="22" class="knob-halo"/><circle r="15" class="knob-body"/><circle r="5.5" class="knob-dot"/>
      </g>
    </svg>
    <div class="dial-read"><div class="dial-n"><b data-dial-n>107</b><sup>&deg;F</sup></div><span data-dial-l>TOO HOT</span></div>
    <i class="dial-lo">72&deg;</i><i class="dial-hi">108&deg;</i>
  </div>
  <p class="wx-msg" data-dial-msg>Drag the dial to 72&deg; and feel the difference.</p>
  <button type="button" class="wx-btn" data-dial-cool>Or tap here to cool it down</button>
</div>`;
}

const GAUGE_START_O = 0.617;

function gaugeHtml(c: SiteContent): string {
  const ang = START + SWEEP * GAUGE_START_O;
  const zone = (from: number, to: number, cls: string) =>
    `<path d="${arc(160, 160, 112, START + SWEEP * from, START + SWEEP * to)}" class="gz ${cls}"/>`;
  let labels = "";
  for (let v = 20; v <= 80; v += 20) {
    const [x, y] = polar(160, 160, 78, START + (SWEEP * v) / 100);
    labels += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="gl">${v}</text>`;
  }
  return `<div class="wx wx-gauge" data-gauge data-o="${GAUGE_START_O}">
  <div class="wx-fig"><span>Try it</span><b data-g-live>&#9679; Live</b></div>
  <div class="gauge-wrap">
    <svg viewBox="0 0 320 320" role="img" aria-label="Water pressure gauge" class="gauge-svg">
      <circle cx="160" cy="160" r="152" class="g-ring"/>
      <circle cx="160" cy="160" r="138" class="g-face"/>
      ${zone(0, 0.35, "gz-lo")}${zone(0.35, 0.8, "gz-ok")}${zone(0.8, 1, "gz-hi")}
      ${ticks(50, 10, [118, 126], [114, 128])}
      ${labels}
      <g class="g-needle" data-g-needle transform="rotate(${ang.toFixed(2)} 160 160)"><path d="M150 157L262 160L150 163Z" class="needle"/></g>
      <circle cx="160" cy="160" r="10" class="g-hub"/>
    </svg>
    <div class="gauge-read"><small data-g-s>STABLE</small><b data-g-n>61.7</b><em>PSI</em></div>
  </div>
  <div class="pipe" data-pipe><span class="pipe-flow"></span>
    <div class="valve" data-valve tabindex="0" role="slider" aria-label="Water valve" aria-valuemin="0" aria-valuemax="100" aria-valuenow="62">
      <svg viewBox="0 0 80 80" aria-hidden="true"><g class="valve-w" data-g-wheel><circle cx="40" cy="40" r="30" class="vw-ring"/><path d="M40 12V68M12 40H68M20 20L60 60M60 20L20 60" class="vw-spokes"/><circle cx="40" cy="40" r="8" class="vw-hub"/></g></svg>
    </div>
  </div>
  <p class="wx-msg">Drag the valve left or right, or use the buttons, and watch the pressure respond.</p>
  <div class="wx-row"><button type="button" class="wx-btn" data-g-close>Close valve</button><button type="button" class="wx-btn" data-g-open>Open valve</button></div>
</div>`;
}

function plannerHtml(c: SiteContent, imageUrl: string | null): string {
  const items = c.services
    .slice(0, 10)
    .map(
      (s) =>
        `<button type="button" class="plan-i" data-plan-i="${e(s.title)}" aria-pressed="false"><span>${e(s.title)}</span><i aria-hidden="true">+</i></button>`,
    )
    .join("");
  const photo = imageUrl
    ? `<div class="plan-photo"><img src="${e(imageUrl)}" alt="${e(c.brand.name)}" loading="eager"></div>`
    : "";
  return `<div class="wx wx-plan" data-plan>
  ${photo}
  <div class="wx-h"><h3>Plan your project</h3><button type="button" class="wx-link" data-plan-reset>Reset</button></div>
  <p class="wx-sub">Tap what you need. We will send it along with your request.</p>
  <div class="plan-list">${items}</div>
  <div class="plan-when" role="radiogroup" aria-label="How soon">
    <button type="button" class="on" role="radio" aria-checked="true" data-when="As soon as possible">As soon as possible</button>
    <button type="button" role="radio" aria-checked="false" data-when="This month">This month</button>
    <button type="button" role="radio" aria-checked="false" data-when="Just planning">Just planning</button>
  </div>
  <div class="plan-sum" aria-live="polite"><b data-plan-count>Nothing picked yet</b><span data-plan-names></span></div>
  <a class="btn btn-a" href="#quote" data-plan-send>Send my plan</a>
</div>`;
}

export function widgetHtml(
  c: SiteContent,
  assetUrl: (id: string) => string,
): string {
  switch (c.hero.widget) {
    case "dial":
      return dialHtml(c);
    case "gauge":
      return gaugeHtml(c);
    case "planner":
      return plannerHtml(c, c.hero.imageId ? assetUrl(c.hero.imageId) : null);
    default:
      return "";
  }
}

export const WIDGET_CSS = `
.wx{position:relative;border-radius:calc(var(--br) + 8px);padding:22px 22px 24px;color:#f6efe6;background:#18121d;border:1px solid #ffffff24;box-shadow:0 40px 80px -30px #000b;overflow:hidden;font-family:var(--body);text-transform:none;letter-spacing:0;text-align:left}
.wx *{box-sizing:border-box}
.wx-fig{display:flex;justify-content:space-between;gap:10px;font:600 11.5px var(--body);letter-spacing:.14em;text-transform:uppercase;color:#ffffffa8;margin-bottom:10px}
.wx-fig b{font-weight:600;color:#ffffffd0}
.wx-msg{margin:12px 0 0;text-align:center;font-size:14.5px;color:#ffffffc8;min-height:22px}
.wx-sub{margin:0 0 14px;font-size:14.5px;color:#ffffffb8}
.wx-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.wx-h h3{margin:0;font:var(--hw) 24px/1.15 var(--head);text-transform:none;letter-spacing:0;color:#fff}
.wx-link{background:none;border:0;color:#ffffffb0;text-decoration:underline;font:600 13px var(--body);cursor:pointer;padding:6px 2px}
.wx-btn{display:block;margin:12px auto 0;background:#ffffff1a;border:1px solid #ffffff3a;color:#fff;padding:11px 18px;border-radius:999px;font:600 14px var(--body);cursor:pointer;transition:background .15s ease}
.wx-btn:hover{background:#ffffff2e}
.wx-btn:focus-visible,.plan-i:focus-visible,.wx-link:focus-visible,.plan-when button:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.wx-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.wx-row .wx-btn{margin-top:12px}
.tk{stroke:#ffffff55;stroke-width:1.4;stroke-linecap:round}.tk-m{stroke:#ffffffcc;stroke-width:2.2}
/* dial */
.wx-dial{--heat:1;background:radial-gradient(120% 70% at 50% 108%,rgba(255,112,52,calc(.62*var(--heat))),transparent 62%),radial-gradient(120% 70% at 50% 108%,rgba(96,196,236,calc(.5*(1 - var(--heat)))),transparent 62%),#1a1220;transition:background .2s linear}
.dial-wrap{position:relative;width:100%;max-width:340px;margin:0 auto}
.dial-svg{display:block;width:100%;height:auto;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.dial-svg:active{cursor:grabbing}
.dial-face{fill:#150e1acc;stroke:#ffffff26;stroke-width:1.5}
.dial-track{fill:none;stroke:#ffffff1f;stroke-width:14;stroke-linecap:round}
.dial-val{fill:none;stroke-width:14;stroke-linecap:round}
.knob-halo{fill:#ffffff22}.knob-body{fill:#fff}.knob-dot{fill:var(--a)}
.dial-knob{cursor:grab;outline:none}.dial-knob:focus-visible .knob-halo{fill:#ffffff66}
.dial-read{position:absolute;left:0;right:0;top:50%;transform:translateY(-52%);text-align:center;pointer-events:none}
.dial-n{display:flex;justify-content:center;align-items:flex-start;gap:2px;color:#fff;font-family:var(--head);font-weight:var(--hw)}
.dial-n b{font-size:clamp(62px,17vw,92px);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.dial-n sup{font-size:clamp(22px,5.4vw,30px);line-height:1.4;font-weight:600}
.dial-read span{display:block;margin-top:2px;font:700 12px var(--body);letter-spacing:.2em;color:#ffffffb8}
.dial-lo,.dial-hi{position:absolute;bottom:6%;font:600 13px var(--body);font-style:normal;color:#ffffffb0}
.dial-lo{left:8%}.dial-hi{right:8%}
.wx-dial.cool .dial-read span{color:#a8e6ff}
.wx-dial .wx-msg{font-weight:600;color:#fff}
/* gauge */
.wx-gauge{background:linear-gradient(160deg,#1c2227,#12161a)}
.gauge-wrap{position:relative;width:100%;max-width:340px;margin:0 auto}
.gauge-svg{display:block;width:100%;height:auto}
.g-ring{fill:none;stroke:var(--a);stroke-width:10}
.g-face{fill:#10151a;stroke:#00000066;stroke-width:2}
.gz{fill:none;stroke-width:7;stroke-linecap:butt}.gz-lo,.gz-hi{stroke:#d8664a}.gz-ok{stroke:#6fc4a8}
.gl{fill:#e8e2d8;font:500 14px var(--mono,var(--body));text-anchor:middle}
.needle{fill:#f4efe6}.g-hub{fill:#e8e2d8;stroke:var(--a);stroke-width:3}
.gauge-read{position:absolute;left:0;right:0;top:60%;text-align:center;pointer-events:none;display:flex;flex-direction:column;align-items:center}
.gauge-read small{font:600 11px var(--body);letter-spacing:.2em;color:#6fc4a8}
.gauge-read b{font:600 clamp(30px,8vw,40px)/1.1 var(--mono,var(--body));color:#fff;font-variant-numeric:tabular-nums}
.gauge-read em{font:600 12px var(--body);font-style:normal;letter-spacing:.2em;color:#ffffffa0}
.wx-gauge[data-state="low"] .gauge-read small,.wx-gauge[data-state="high"] .gauge-read small{color:#ff9b82}
.wx-gauge[data-state="off"] .gauge-read small{color:#ffffff90}
.pipe{position:relative;margin:14px 4px 0;height:22px;border-radius:11px;background:linear-gradient(180deg,var(--a),#00000055 120%);border:1px solid #00000055;display:flex;align-items:center;justify-content:center}
.pipe-flow{position:absolute;left:12px;right:12px;top:50%;height:6px;transform:translateY(-50%);background:radial-gradient(circle,#c9f3e6 0 2.4px,transparent 2.8px) 0 50%/16px 6px repeat-x;animation:wxflow var(--flow,1.4s) linear infinite;opacity:.95}
.pipe.off .pipe-flow{opacity:0;animation-play-state:paused}
@keyframes wxflow{to{background-position:16px 50%}}
.valve{position:relative;z-index:2;width:56px;height:56px;margin-top:-34px;cursor:ew-resize;touch-action:none;border-radius:50%;outline:none;filter:drop-shadow(0 4px 8px #0008)}
.valve svg{width:100%;height:100%;display:block}
.valve:focus-visible{outline:3px solid #fff;outline-offset:2px}
.valve-w{transform-origin:40px 40px;transition:none}
.vw-ring{fill:#2a2018;stroke:var(--a);stroke-width:6}.vw-spokes{stroke:var(--a);stroke-width:5;stroke-linecap:round}.vw-hub{fill:#e8e2d8}
/* planner */
.wx-plan{background:#fffdf8;color:#1f2a24;border-color:#00000018;box-shadow:0 30px 60px -30px #0008}
.wx-plan .wx-h h3{color:#1c241f}
.wx-plan .wx-link{color:#4b5a51}
.wx-plan .wx-sub{color:#4b5a51}
.plan-photo{margin:-22px -22px 16px;aspect-ratio:16/8;overflow:hidden}
.plan-photo img{width:100%;height:100%;object-fit:cover;display:block}
.plan-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.plan-i{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;padding:12px 14px;border-radius:12px;border:1.5px solid #d9d2c3;background:#fff;color:#1c241f;font:600 14.5px/1.25 var(--body);cursor:pointer;transition:border-color .15s ease,background .15s ease}
.plan-i i{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#efe9db;font:700 16px/1 var(--body);font-style:normal;color:#1c241f}
.plan-i:hover{border-color:var(--a)}
.plan-i[aria-pressed="true"]{border-color:var(--a);background:color-mix(in srgb,var(--a) 12%,#fff)}
.plan-i[aria-pressed="true"] i{background:var(--a);color:var(--on)}
.plan-when{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 4px}
.plan-when button{flex:1 1 auto;padding:9px 10px;border-radius:999px;border:1.5px solid #d9d2c3;background:#fff;color:#1c241f;font:600 13px var(--body);cursor:pointer}
.plan-when button.on{background:#1c241f;border-color:#1c241f;color:#fff}
.plan-sum{margin:12px 0 14px;padding:12px 14px;border-radius:12px;background:#f3eee2;font-size:14px;color:#33413a;min-height:46px}
.plan-sum b{display:block;color:#1c241f}
.wx-plan .btn{width:100%;justify-content:center}
/* where it sits */
.wx-col{position:relative;z-index:2;min-width:0}
.hero-img.has-wx{display:flex;align-items:center;justify-content:flex-end;padding:clamp(14px,2.4vw,28px)}
.hero-img.has-wx .wx{position:relative;z-index:3;width:min(430px,100%)}
.hero-img.has-wx .hero-card{display:none}
@media (min-width:1100px){.hero-img.has-wx .hero-card{display:block;right:auto;width:min(380px,calc(100% - 520px))}}
@media (max-width:900px){.hero-img.has-wx{justify-content:center}}
@media (prefers-reduced-motion:reduce){.pipe-flow{animation:none}.wx-dial{transition:none}}
`;

export const WIDGET_SCRIPT = `
(function(){
  var d=document;
  function polar(r,deg){var a=deg*Math.PI/180;return [160+r*Math.cos(a),160+r*Math.sin(a)]}
  function arc(r,a1,a2){var p=polar(r,a1),q=polar(r,a2);return 'M'+p[0].toFixed(2)+' '+p[1].toFixed(2)+'A'+r+' '+r+' 0 '+((a2-a1)>180?1:0)+' 1 '+q[0].toFixed(2)+' '+q[1].toFixed(2)}
  function pointerT(svg,ev){
    var rc=svg.getBoundingClientRect(),k=320/rc.width;
    var x=(ev.clientX-rc.left)*k-160,y=(ev.clientY-rc.top)*k-160;
    var a=Math.atan2(y,x)*180/Math.PI;if(a<0)a+=360;
    var rel=(a-135+360)%360;
    if(rel<=270)return rel/270;
    return (rel-270)<(360-rel)?1:0;
  }
  d.querySelectorAll('[data-dial]').forEach(function(root){
    var svg=root.querySelector('svg'),knob=root.querySelector('[data-dial-knob]'),val=root.querySelector('[data-dial-arc]');
    var n=root.querySelector('[data-dial-n]'),l=root.querySelector('[data-dial-l]'),msg=root.querySelector('[data-dial-msg]'),cool=root.querySelector('[data-dial-cool]');
    var t=parseFloat(root.getAttribute('data-t'))||.97,raf=0;
    function render(v){
      t=Math.max(0,Math.min(1,v));
      var temp=Math.round(72+36*t),ang=135+270*t,p=polar(128,ang);
      knob.setAttribute('transform','translate('+p[0].toFixed(2)+' '+p[1].toFixed(2)+')');
      val.setAttribute('d',t<.004?'M0 0':arc(128,135,ang));
      n.textContent=temp;
      l.textContent=temp>=100?'TOO HOT':temp>=90?'UNCOMFORTABLE':temp>=80?'GETTING THERE':temp>=75?'ALMOST':'COMFORTABLE';
      root.style.setProperty('--heat',t.toFixed(3));
      var isCool=temp<=75;root.classList.toggle('cool',isCool);
      msg.textContent=isCool?'Now that feels right. Let us get your home here.':'Drag the dial to 72\\u00b0 and feel the difference.';
      knob.setAttribute('aria-valuenow',temp);knob.setAttribute('aria-valuetext',temp+' degrees');
    }
    function stop(){if(raf){cancelAnimationFrame(raf);raf=0}}
    svg.addEventListener('pointerdown',function(ev){
      ev.preventDefault();stop();
      try{svg.setPointerCapture(ev.pointerId)}catch(_){}
      render(pointerT(svg,ev));
      function mv(e){render(pointerT(svg,e))}
      function up(){svg.removeEventListener('pointermove',mv);svg.removeEventListener('pointerup',up);svg.removeEventListener('pointercancel',up)}
      svg.addEventListener('pointermove',mv);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',up);
    });
    knob.addEventListener('keydown',function(ev){
      var s=0;
      if(ev.key==='ArrowRight'||ev.key==='ArrowUp')s=1;else if(ev.key==='ArrowLeft'||ev.key==='ArrowDown')s=-1;
      if(s){ev.preventDefault();stop();render(t+s/36)}
    });
    cool.addEventListener('click',function(){
      stop();var from=t,t0=null,dur=1500;
      function step(ts){if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/dur),e=1-Math.pow(1-k,3);render(from*(1-e));if(k<1)raf=requestAnimationFrame(step);else raf=0}
      raf=requestAnimationFrame(step);
    });
  });
  d.querySelectorAll('[data-gauge]').forEach(function(root){
    var needle=root.querySelector('[data-g-needle]'),num=root.querySelector('[data-g-n]'),st=root.querySelector('[data-g-s]');
    var valve=root.querySelector('[data-valve]'),wheel=root.querySelector('[data-g-wheel]'),pipe=root.querySelector('[data-pipe]');
    var target=parseFloat(root.getAttribute('data-o'))||.617,cur=target,raf=0;
    function paint(){
      var psi=cur*100,ang=135+270*cur;
      needle.setAttribute('transform','rotate('+ang.toFixed(2)+' 160 160)');
      wheel.setAttribute('transform','rotate('+(cur*540).toFixed(1)+' 40 40)');
      num.textContent=psi.toFixed(1);
      var s=psi<1?'off':psi<35?'low':psi<=80?'stable':psi<=92?'high':'over';
      st.textContent={off:'SHUT OFF',low:'LOW',stable:'STABLE',high:'HIGH',over:'OVER PRESSURE'}[s];
      root.setAttribute('data-state',s==='over'?'high':s==='stable'?'ok':s);
      pipe.classList.toggle('off',psi<1);
      pipe.style.setProperty('--flow',(2.2-1.8*Math.min(1,cur)).toFixed(2)+'s');
      valve.setAttribute('aria-valuenow',Math.round(psi));
    }
    function tick(){
      var diff=target-cur;
      if(Math.abs(diff)<.0006){cur=target;paint();raf=0;return}
      cur+=diff*.16;paint();raf=requestAnimationFrame(tick);
    }
    function set(o){target=Math.max(0,Math.min(1,o));if(!raf)raf=requestAnimationFrame(tick)}
    valve.addEventListener('pointerdown',function(ev){
      ev.preventDefault();
      try{valve.setPointerCapture(ev.pointerId)}catch(_){}
      var x0=ev.clientX,o0=target;
      function mv(e){set(o0+(e.clientX-x0)/240)}
      function up(){valve.removeEventListener('pointermove',mv);valve.removeEventListener('pointerup',up);valve.removeEventListener('pointercancel',up)}
      valve.addEventListener('pointermove',mv);valve.addEventListener('pointerup',up);valve.addEventListener('pointercancel',up);
    });
    valve.addEventListener('keydown',function(ev){
      var s=0;if(ev.key==='ArrowRight'||ev.key==='ArrowUp')s=1;else if(ev.key==='ArrowLeft'||ev.key==='ArrowDown')s=-1;
      if(s){ev.preventDefault();set(target+s*.05)}
    });
    root.querySelector('[data-g-close]').addEventListener('click',function(){set(0)});
    root.querySelector('[data-g-open]').addEventListener('click',function(){set(.62)});
    paint();
  });
  d.querySelectorAll('[data-plan]').forEach(function(root){
    var items=root.querySelectorAll('[data-plan-i]'),whens=root.querySelectorAll('[data-when]');
    var count=root.querySelector('[data-plan-count]'),names=root.querySelector('[data-plan-names]');
    var when='As soon as possible';
    function picked(){var o=[];items.forEach(function(b){if(b.getAttribute('aria-pressed')==='true')o.push(b.getAttribute('data-plan-i'))});return o}
    function sum(){
      var p=picked();
      count.textContent=p.length===0?'Nothing picked yet':p.length+(p.length===1?' service picked':' services picked');
      names.textContent=p.join(', ');
    }
    items.forEach(function(b){b.addEventListener('click',function(){
      var on=b.getAttribute('aria-pressed')==='true';
      b.setAttribute('aria-pressed',on?'false':'true');
      b.querySelector('i').textContent=on?'+':'\\u2713';
      sum();
    })});
    whens.forEach(function(b){b.addEventListener('click',function(){
      when=b.getAttribute('data-when');
      whens.forEach(function(x){var s=x===b;x.classList.toggle('on',s);x.setAttribute('aria-checked',s?'true':'false')});
    })});
    root.querySelector('[data-plan-reset]').addEventListener('click',function(){
      items.forEach(function(b){b.setAttribute('aria-pressed','false');b.querySelector('i').textContent='+'});sum();
    });
    root.querySelector('[data-plan-send]').addEventListener('click',function(){
      var p=picked();
      if(p.length){
        d.querySelectorAll('[data-svc-select]').forEach(function(s){s.value=p[0]});
        d.querySelectorAll('.qform textarea[name=message]').forEach(function(m){m.value='I am interested in: '+p.join(', ')+'. Timing: '+when+'.'});
      }
    });
    sum();
  });
})();
`;
