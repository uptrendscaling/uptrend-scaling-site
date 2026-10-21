// Stylesheets for the three site looks. Each look sets its own tokens and a
// few look-specific blocks; the layout rules they share live in BASE_CSS.

import { mix, onColor, readableOn } from "./colors";
import type { SiteStyle } from "./types";

const FONT_LINKS: Record<SiteStyle, string> = {
  warm: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&display=swap",
  copper:
    "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
  green:
    "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap",
};

export function fontLink(style: SiteStyle): string {
  return FONT_LINKS[style];
}

type Tokens = {
  bg: string;
  ink: string;
  muted: string;
  card: string;
  line: string;
  head: string;
  body: string;
  mono: string;
  headWeight: number;
  headCase: string;
  headTrack: string;
  radius: string;
};

const TOKENS: Record<SiteStyle, Tokens> = {
  warm: {
    bg: "#fbf3e6",
    ink: "#2a1f1a",
    muted: "#6b5a50",
    card: "#fffaf2",
    line: "#eadcc7",
    head: "'Fraunces',Georgia,'Times New Roman',serif",
    body: "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif",
    mono: "'Inter',system-ui,sans-serif",
    headWeight: 700,
    headCase: "none",
    headTrack: "-0.02em",
    radius: "18px",
  },
  copper: {
    bg: "#13171a",
    ink: "#ece6dc",
    muted: "#a39d93",
    card: "#1b2024",
    line: "#2b3238",
    head: "'Barlow Condensed','Arial Narrow',Impact,sans-serif",
    body: "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif",
    mono: "'JetBrains Mono',ui-monospace,Menlo,monospace",
    headWeight: 800,
    headCase: "uppercase",
    headTrack: "0.005em",
    radius: "10px",
  },
  green: {
    bg: "#fbf6ee",
    ink: "#1f3a2e",
    muted: "#5d6f64",
    card: "#fffdf8",
    line: "#e6dccb",
    head: "'Instrument Serif',Georgia,'Times New Roman',serif",
    body: "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif",
    mono: "'Inter',system-ui,sans-serif",
    headWeight: 400,
    headCase: "none",
    headTrack: "-0.015em",
    radius: "22px",
  },
};

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--body);color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{max-width:100%;display:block}
a{color:inherit}
h1,h2,h3{font-family:var(--head);font-weight:var(--hw);text-transform:var(--hc);letter-spacing:var(--ht);margin:0;line-height:1.05}
p{margin:0}
.wrap{max-width:1180px;margin:0 auto;padding:0 22px}
.skip{position:absolute;left:-999px;top:8px;background:var(--a);color:var(--on);padding:10px 14px;border-radius:8px;z-index:100}
.skip:focus{left:8px}
.pbar{position:sticky;top:0;z-index:60;background:#111;color:#fff;font:600 14px/1.4 Inter,system-ui,sans-serif;padding:10px 14px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}
.pbar b{color:#facc15}
.pbar a,.pbar button{font:600 14px Inter,system-ui,sans-serif;background:#facc15;color:#111;border:0;border-radius:999px;padding:8px 16px;text-decoration:none;cursor:pointer}
.pbar button.alt{background:transparent;color:#fff;border:1px solid #fff6}
.hdr{position:sticky;top:0;z-index:40;background:var(--hbg);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.pbar + .hdr{top:0}
.hdr-in{display:flex;align-items:center;gap:18px;min-height:68px}
.brand{display:flex;align-items:center;gap:11px;text-decoration:none;min-width:0}
.brand img{height:40px;width:auto;max-width:170px;object-fit:contain}
.mark{width:40px;height:40px;border-radius:12px;background:var(--a);color:var(--on);display:grid;place-items:center;font:800 20px var(--head);flex:none}
.brand-n{font:var(--hw) 21px/1.1 var(--head);text-transform:var(--hc);letter-spacing:var(--ht);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav{display:flex;gap:6px;margin-left:auto;align-items:center}
.nav a{text-decoration:none;font-size:14.5px;font-weight:500;color:var(--muted);padding:8px 12px;border-radius:8px}
.nav a:hover{color:var(--ink);background:var(--soft)}
.nav .btn{margin-left:6px;color:var(--on)}
.burger{display:none;margin-left:auto;background:none;border:1px solid var(--line);border-radius:10px;width:44px;height:44px;color:var(--ink);cursor:pointer}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 24px;border-radius:var(--br);font:600 16px var(--body);text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .15s ease,box-shadow .2s ease,background .2s ease;line-height:1.2}
.btn:hover{transform:translateY(-1px)}
.btn:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--at);outline-offset:2px}
.btn-a{background:var(--a);color:var(--on);box-shadow:0 10px 26px -10px var(--a)}
.btn-a:hover{box-shadow:0 14px 32px -10px var(--a)}
.btn-g{background:transparent;color:var(--gtxt);border-color:var(--gline)}
.btn-g:hover{background:var(--gh)}
.btn-sm{padding:10px 18px;font-size:14.5px}
.cta-row{display:flex;gap:12px;flex-wrap:wrap}
.hero{position:relative;overflow:hidden}
.hero h1 em{font-style:normal;color:var(--hacc)}
.lede{font-size:clamp(17px,1.5vw,20px);max-width:56ch}
.badges{display:flex;flex-wrap:wrap;gap:8px 18px;list-style:none;padding:0;margin:26px 0 0}
.badges li{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:600}
.badges svg{width:18px;height:18px;flex:none;color:var(--hacc)}
.qcard{border-radius:calc(var(--br) + 8px);padding:26px}
.qform{display:grid;gap:11px}
.qform h3{font-size:30px;margin-bottom:2px}
.qform .sub{font-size:14.5px;margin:-2px 0 6px;opacity:.8}
.qform input,.qform select,.qform textarea{width:100%;font:500 16px var(--body);padding:13px 14px;border-radius:calc(var(--br) - 4px);border:1px solid var(--fline);background:var(--fbg);color:var(--fink);appearance:none}
.qform select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:38px}
.qform textarea{resize:vertical;min-height:86px}
.qform input::placeholder,.qform textarea::placeholder{color:var(--fph)}
.qform .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.qform .btn{width:100%;margin-top:4px}
.fmsg{font-size:14.5px;font-weight:600;min-height:1.2em}
.fmsg.ok{color:var(--ok)}
.fmsg.bad{color:var(--bad)}
.strip{border-block:1px solid var(--line);background:var(--card)}
.strip-in{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 28px;padding:26px 22px}
.stat b{display:block;font:var(--hw) clamp(30px,3.4vw,44px)/1 var(--head);text-transform:var(--hc);color:var(--at)}
.stat span{font-size:14px;color:var(--muted)}
.sec{padding:clamp(56px,8vw,104px) 0}
.sec-h{max-width:720px;margin-bottom:38px}
.sec-h h2{font-size:clamp(34px,4.6vw,56px)}
.sec-h p{margin-top:14px;color:var(--muted);font-size:18px}
.eyebrow{display:inline-block;font:600 12.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--at);margin-bottom:14px}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--br);padding:26px;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease;display:flex;flex-direction:column;gap:10px}
.card:hover{transform:translateY(-3px);border-color:var(--a);box-shadow:0 18px 40px -22px var(--a)}
.card h3{font-size:25px}
.card p{color:var(--muted);font-size:16px}
.ico{width:46px;height:46px;border-radius:13px;background:var(--soft);color:var(--at);display:grid;place-items:center;margin-bottom:6px;font:700 17px var(--mono)}
.ask{margin-top:auto;padding-top:6px;background:none;border:0;color:var(--at);font:600 15px var(--body);text-align:left;cursor:pointer;padding-left:0}
.ask:hover{text-decoration:underline}
.steps{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));counter-reset:s}
.step{position:relative;padding:26px 26px 26px 26px;border-radius:var(--br);background:var(--card);border:1px solid var(--line)}
.step::before{counter-increment:s;content:"0" counter(s);display:block;font:600 14px var(--mono);color:var(--at);letter-spacing:.1em;margin-bottom:14px}
.step h3{font-size:25px;margin-bottom:8px}
.step p{color:var(--muted)}
.split{display:grid;gap:42px;grid-template-columns:1fr 1fr;align-items:start}
.why{display:grid;gap:14px}
.why-i{display:flex;gap:14px;padding:18px 20px;border-radius:var(--br);background:var(--card);border:1px solid var(--line)}
.why-i svg{flex:none;width:24px;height:24px;color:var(--at);margin-top:2px}
.why-i h3{font:700 17px var(--body);text-transform:none;letter-spacing:0;margin-bottom:3px}
.why-i p{color:var(--muted);font-size:15.5px}
.about p{color:var(--muted);font-size:18px;white-space:pre-line}
.gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--br);border:1px solid var(--line)}
.areas{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:0}
.areas li{padding:10px 18px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-weight:600;font-size:15.5px}
.faq{display:grid;gap:10px;max-width:860px}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:var(--br);padding:0 22px}
.faq summary{list-style:none;cursor:pointer;padding:20px 0;font:700 18px var(--body);display:flex;justify-content:space-between;gap:16px;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font:500 26px/1 var(--body);color:var(--at);flex:none;transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding:0 0 20px;color:var(--muted);font-size:16.5px}
.xtra{padding:clamp(40px,6vw,72px) 0}
.xtra h2{font-size:clamp(30px,4vw,46px);margin-bottom:16px}
.xtra p{color:var(--muted);font-size:18px;max-width:70ch;white-space:pre-line}
.xtra ul{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.xtra li{display:flex;gap:10px;font-weight:500;padding:14px 18px;border-radius:var(--br);background:var(--card);border:1px solid var(--line)}
.xtra li::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--a);margin-top:9px;flex:none}
.banner{background:var(--a);color:var(--on);border-radius:calc(var(--br) + 6px);padding:clamp(28px,5vw,48px);display:flex;gap:22px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.banner h2{color:inherit;margin:0}
.banner p{color:inherit;opacity:.9;margin-top:8px}
.banner .btn{background:var(--on);color:var(--a)}
.quote{background:var(--qbg);color:var(--qink)}
.quote-g{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,64px);align-items:center}
.quote h2{font-size:clamp(36px,5vw,60px)}
.quote .lede{margin-top:16px;opacity:.85}
.quote-ph{margin-top:24px;display:grid;gap:4px;font-size:15px;opacity:.9}
.quote-ph a{font:700 clamp(26px,3vw,36px) var(--head);text-transform:var(--hc);text-decoration:none}
.ftr{padding:34px 0 96px;border-top:1px solid var(--line);color:var(--muted);font-size:14.5px}
.ftr-in{display:flex;gap:14px 30px;justify-content:space-between;flex-wrap:wrap;align-items:center}
.ftr a{text-decoration:none;font-weight:600;color:var(--ink)}
.ftr a:hover{text-decoration:underline}
.callbar{display:none}
.rv{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}
.rv.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.rv{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}.btn,.card{transition:none}}
@media (max-width:900px){
 .nav{display:none;position:absolute;left:0;right:0;top:100%;flex-direction:column;align-items:stretch;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 22px 18px;gap:2px}
 .nav.open{display:flex}
 .nav a{padding:13px 8px;font-size:16px}
 .nav .btn{margin:8px 0 0;padding:14px}
 .burger{display:grid;place-items:center}
 .split,.quote-g{grid-template-columns:1fr}
 .callbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));background:var(--hbg);border-top:1px solid var(--line);backdrop-filter:blur(10px)}
 .callbar a{flex:1;padding:14px;border-radius:var(--br);text-align:center;font:700 16px var(--body);text-decoration:none}
 .callbar .c1{background:var(--a);color:var(--on)}
 .callbar .c2{border:1px solid var(--line);color:var(--ink)}
}
`;

const WARM_CSS = `
.hero{background:linear-gradient(180deg,var(--h1) 0%,var(--h2) 46%,var(--h3) 100%);color:#fff;padding:clamp(48px,7vw,92px) 0 clamp(110px,14vw,190px)}
.hero::before{content:"";position:absolute;right:-8%;top:-10%;width:62%;aspect-ratio:1;background:radial-gradient(circle,var(--glow) 0%,transparent 62%);opacity:.85;pointer-events:none}
.hero-g{display:grid;grid-template-columns:1.15fr .85fr;gap:clamp(28px,5vw,60px);align-items:center;position:relative;z-index:2}
.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:#ffffff1f;border:1px solid #ffffff38;font-weight:600;font-size:14.5px;margin-bottom:22px;backdrop-filter:blur(6px)}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--hacc);box-shadow:0 0 0 4px #ffffff22}
.hero h1{font-size:clamp(42px,6.6vw,88px);margin-bottom:22px}
.hero .lede{color:#ffffffe6;margin-bottom:30px}
.hero .btn-g{--gtxt:#fff;--gline:#ffffff66;--gh:#ffffff1f}
.hero .badges{color:#fff}
.hills{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:clamp(70px,11vw,150px);z-index:1;display:block}
.hero .qcard{background:#fffaf2f2;color:#2a1f1a;box-shadow:0 40px 80px -30px #00000088;--fbg:#fff;--fline:#e3d3bb;--fink:#2a1f1a;--fph:#9a8878}
.hero .qform h3{color:#2a1f1a}
.hero-photo{border-radius:calc(var(--br) + 8px);overflow:hidden;margin-bottom:16px;aspect-ratio:16/10;box-shadow:0 30px 60px -30px #0008}
.hero-photo img{width:100%;height:100%;object-fit:cover}
.card .ico{border-radius:50%}
.strip{margin-top:-1px}
.quote{--qbg:linear-gradient(150deg,var(--h1),var(--h2));--qink:#fff}
.quote .qcard{background:#fffaf2;color:#2a1f1a;--fbg:#fff;--fline:#e3d3bb;--fink:#2a1f1a;--fph:#9a8878}
@media (max-width:900px){.hero-g,.hero-top{grid-template-columns:1fr}.hero-side{max-width:none}}
`;

const COPPER_CSS = `
body{background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:44px 44px;background-attachment:fixed}
.topbar{background:#0d1012;border-bottom:1px solid var(--line);font:500 12px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:center;padding:9px 14px}
.topbar i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--a);margin-right:9px;box-shadow:0 0 10px var(--a)}
.hero{padding:clamp(48px,7vw,96px) 0 clamp(56px,8vw,100px)}
.hero::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,transparent,var(--a),transparent);opacity:.7}
.hero-g{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(28px,5vw,64px);align-items:center;position:relative}
.pill{display:inline-flex;align-items:center;gap:10px;font:500 12.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--at);margin-bottom:20px}
.pill::before{content:"00";background:var(--soft);color:var(--at);padding:4px 8px;border-radius:6px}
.hero h1{font-size:clamp(44px,7vw,96px);line-height:.94;margin-bottom:24px}
.hero h1 em{display:block;background:linear-gradient(180deg,var(--hacc),var(--a));-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.hero .lede{color:var(--muted);margin-bottom:30px}
.hero .btn-g{--gtxt:var(--ink);--gline:var(--line);--gh:#ffffff0f}
.hero .qcard{background:var(--card);border:1px solid var(--line);position:relative;--fbg:#12161a;--fline:#2f373e;--fink:var(--ink);--fph:#7c8790}
.hero .qcard::before,.hero .qcard::after{content:"";position:absolute;width:14px;height:14px;border:2px solid var(--a);opacity:.8}
.hero .qcard::before{left:10px;top:10px;border-right:0;border-bottom:0}
.hero .qcard::after{right:10px;bottom:10px;border-left:0;border-top:0}
.fig{display:flex;justify-content:space-between;font:500 11.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.fig b{color:var(--at);font-weight:500}
.hero-photo{border-radius:var(--br);overflow:hidden;margin-bottom:16px;aspect-ratio:16/10;border:1px solid var(--line)}
.hero-photo img{width:100%;height:100%;object-fit:cover}
.badges{color:var(--ink)}
.stat b{font-size:clamp(34px,4vw,52px)}
.card,.step,.why-i,.faq details{background:linear-gradient(180deg,#1d2226,#171b1f)}
.card h3,.step h3{letter-spacing:.01em}
.sec-h h2{font-size:clamp(38px,5.4vw,66px)}
.quote{--qbg:#0d1012;--qink:var(--ink);border-top:1px solid var(--line)}
.quote .qcard{background:var(--card);border:1px solid var(--line);--fbg:#12161a;--fline:#2f373e;--fink:var(--ink);--fph:#7c8790}
.btn-a{background:linear-gradient(180deg,var(--ah),var(--a))}
@media (max-width:900px){.hero-g,.hero-top{grid-template-columns:1fr}.hero-side{max-width:none}}
`;

const GREEN_CSS = `
.hero{padding:clamp(40px,6vw,80px) 0 clamp(30px,4vw,50px)}
.hero-top{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(24px,5vw,64px);align-items:end}
.pill{display:inline-flex;align-items:center;gap:12px;font:600 12.5px var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--at);margin-bottom:20px}
.pill::before{content:"";width:34px;height:2px;background:var(--a)}
.hero h1{font-size:clamp(50px,7.4vw,104px);line-height:.98}
.hero h1 em{font-style:italic;color:var(--hacc);display:block}
.hero-side .lede{color:var(--muted);margin-bottom:24px}
.hero-img{margin-top:clamp(28px,4vw,48px);position:relative;border-radius:calc(var(--br) + 8px);overflow:hidden;min-height:clamp(260px,38vw,520px);background:linear-gradient(135deg,var(--g1),var(--g2))}
.hero-img img.hp-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-img .leaf{position:absolute;right:-4%;bottom:-18%;width:60%;color:#ffffff22}
.hero-img .leaf2{position:absolute;left:-6%;top:-20%;width:40%;color:#ffffff14;transform:rotate(120deg)}
.hero-card{position:absolute;left:clamp(14px,3vw,30px);bottom:clamp(14px,3vw,30px);right:clamp(14px,3vw,30px);max-width:460px;background:#fffdf8f0;color:#1f3a2e;border-radius:var(--br);padding:20px 22px;backdrop-filter:blur(8px);box-shadow:0 24px 50px -24px #0006}
.hero-card .t{font:400 28px/1.1 var(--head);margin-bottom:6px}
.hero-card .p{font-size:15px;color:#4b5f54;margin-bottom:14px}
.hero-card .btn{padding:12px 18px;font-size:15px}
.badges{color:var(--ink);margin-top:0}
.badge-row{padding:22px 0 0}
.card h3,.step h3{font-size:30px}
.card .ico{border-radius:50%}
.quote{--qbg:#1f3a2e;--qink:#fbf6ee}
.quote .qcard{background:#fffdf8;color:#1f3a2e;--fbg:#fff;--fline:#e0d5c2;--fink:#1f3a2e;--fph:#8a968d}
.quote .qform h3{color:#1f3a2e}
.hero .btn-g{--gtxt:var(--ink);--gline:#1f3a2e55;--gh:#1f3a2e0d}
@media (max-width:900px){.hero-g,.hero-top{grid-template-columns:1fr}.hero-side{max-width:none}}
`;

export function buildCss(style: SiteStyle, accent: string): string {
  const t = TOKENS[style];
  const a = accent;
  const on = onColor(a);
  const dark = style === "copper";
  const soft = mix(t.bg, a, dark ? 0.16 : 0.12);
  const at = readableOn(a, t.bg);
  const hacc =
    style === "green" ? readableOn(a, t.bg) : mix(a, "#ffffff", 0.42);
  const hbg = dark
    ? "rgba(19,23,26,.86)"
    : style === "warm"
      ? "rgba(251,243,230,.9)"
      : "rgba(251,246,238,.9)";

  const warm = {
    h1: "#2a0f2e",
    h2: mix("#2a0f2e", a, 0.55),
    h3: mix(a, "#ffffff", 0.18),
    glow: mix(a, "#ffffff", 0.35),
  };
  const green = {
    g1: mix("#1f3a2e", a, 0.2),
    g2: mix("#1f3a2e", "#6b8f71", 0.55),
  };

  const vars = `:root{--bg:${t.bg};--ink:${t.ink};--muted:${t.muted};--card:${t.card};--line:${t.line};--head:${t.head};--body:${t.body};--mono:${t.mono};--hw:${t.headWeight};--hc:${t.headCase};--ht:${t.headTrack};--br:${t.radius};--a:${a};--ah:${mix(a, "#ffffff", 0.18)};--on:${on};--at:${at};--soft:${soft};--hacc:${hacc};--hbg:${hbg};--gtxt:${t.ink};--gline:${t.line};--gh:${soft};--ok:${dark ? "#7be0a4" : "#16794a"};--bad:${dark ? "#ff9b8a" : "#b42318"};--grid:rgba(255,255,255,.028);--h1:${warm.h1};--h2:${warm.h2};--h3:${warm.h3};--glow:${warm.glow};--g1:${green.g1};--g2:${green.g2};--fbg:#fff;--fline:${t.line};--fink:${t.ink};--fph:#9a9a9a}`;

  const extra =
    style === "warm" ? WARM_CSS : style === "copper" ? COPPER_CSS : GREEN_CSS;
  return `${vars}${BASE_CSS}${extra}`;
}
