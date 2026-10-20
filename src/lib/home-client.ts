/* eslint-disable */
// @ts-nocheck
// Interactive pieces of the homepage (route "/"): the live website builder and
// animated backdrop, the design viewer, the price builder and the review-text
// demo. Plain DOM code that runs once after the page loads. initHome() returns
// a cleanup function that stops every timer, observer and listener, so leaving
// the page (or React dev double-mounting it) leaves nothing running.

export function initHome(root: HTMLElement): () => void {

var dead=false,off=[];
var $=function(s,r){return (r||root).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||root).querySelectorAll(s))};
var HST=function(f,ms){var id=setTimeout(f,ms);off.push(function(){clearTimeout(id)});return id};
var HSI=function(f,ms){var id=setInterval(f,ms);off.push(function(){clearInterval(id)});return id};
var HIO=function(cb,o){var x=new IntersectionObserver(cb,o);off.push(function(){x.disconnect()});return x};
var HRO=function(cb){var x=new ResizeObserver(cb);off.push(function(){x.disconnect()});return x};
var HRAF=function(f){return requestAnimationFrame(function(t){if(!dead)f(t)})};
var HON=function(t,ev,fn){t.addEventListener(ev,fn);off.push(function(){t.removeEventListener(ev,fn)})};
off.push(function(){dead=true});
['#trades','#clrG','#tier','#stars','#dlist','#marq'].forEach(function(s){var e=$(s);if(e)e.innerHTML=''});
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
var IMG={desert_d:'/home/desert-d.jpg',desert_m:'/home/desert-m.jpg',copper_d:'/home/copper-d.jpg',copper_m:'/home/copper-m.jpg',green_d:'/home/green-d.jpg',green_m:'/home/green-m.jpg'};
var CFG=JSON.parse(root.getAttribute('data-cfg')||'{}');
var docEl=document.documentElement;
$('#theme').addEventListener('click',function(){var n=docEl.getAttribute('data-theme')==='dark'?'light':'dark';docEl.setAttribute('data-theme',n);try{localStorage.setItem('uptrend_theme',n)}catch(e){}});
/* reveal: only arm things below the fold; always safe at rest */
var pres=$$('.pre');
pres.forEach(function(n){if(n.getBoundingClientRect().top<innerHeight)n.classList.remove('pre')});
var io=HIO(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.remove('pre');io.unobserve(e.target)}})},{threshold:.08});
pres.forEach(function(n){if(n.classList.contains('pre'))io.observe(n)});
HST(function(){$$('.pre').forEach(function(n){n.classList.remove('pre')})},12000);
/* ticker */
var TR=['HVAC','Plumbing','Roofing','Landscaping','Electrical','Cleaning','Auto detailing','Salons','Restaurants','Dental','Pest control','Painting'];
var h='';for(var k=0;k<4;k++)TR.forEach(function(t){h+='<span>'+t+'</span>'});$('#marq').innerHTML=h;
/* builder */
var ICO={snow:'<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',home:'<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',wrench:'<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3.5-3.5 8-8zM3 21l5-5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',drop:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',flame:'<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-4 0-7 1-10z"/>',leaf:'<path d="M5 19C5 10 11 5 20 5c0 9-5 15-14 15zM5 19l7-7"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',bolt:'<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',spark:'<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',car:'<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16M4 16h16v3H4zM7 19v1M17 19v1"/>',cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8L20 18M8.5 16L20 6"/>',brush:'<path d="M4 20c3 0 5-1 5-4l9-9-3-3-9 9c-3 0-4 2-4 4 0 2 1 3 2 3z"/>',phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>'};
var PHONE='(480) 555-0100';
var TRADES=[
 {k:'hvac',l:'HVAC',c:'#2457ff',dark:1,badge:'Licensed and insured',h:['Your home doesn’t ','have to be hot.'],sub:'Fast repairs, honest prices and tune-ups that catch trouble before summer does.',cta:'Book a tune-up',
  stats:[['4.9','Google rating'],['2,400+','Systems serviced'],['Same day','Repair visits'],['24/7','Emergency line']],
  sv:[['snow','AC repair','Diagnosed and fixed fast'],['home','New installs','Sized right for your home'],['wrench','Tune-ups','Catch problems early'],['clock','Emergency','Day or night']],
  plan:{e:'Maintenance plans',t:'Pay a little now. Skip the surprise later.',p:'Every plan includes priority scheduling and a written report after each visit.',items:[['Breeze Check','$24','/mo','One visit a year for the budget-minded.'],['Comfort Club','$39','/mo','Two tune-ups and our fastest scheduling.',1],['Total Care','$69','/mo','Everything covered, with parts discounts.']]},
  q:[['They were out the same afternoon and the house was cool by dinner.','Maria T.'],['Honest quote, no pressure, and the tech cleaned up after himself.','James R.'],['The tune-up caught a failing part before the July heat hit.','Dana K.']]},
 {k:'plumb',l:'Plumbing',c:'#ef7a2d',dark:1,f:'cond',badge:'Flat-rate pricing',h:['We follow the pipe. ','Then we fix it right.'],sub:'Leaks, water heaters and drains handled by a real local plumber, with a price before any work starts.',cta:'Request service',
  stats:[['45 min','Average arrival'],['Flat','Rate pricing'],['24/7','Dispatch'],['4.9','Google rating']],
  sv:[['drop','Leak repair','Found and fixed'],['flame','Water heaters','Hot all day'],['wrench','Drain cleaning','Clear and flowing'],['clock','Emergency','24/7 dispatch']],
  plan:{e:'How pricing works',t:'No surprises on the invoice.',p:'You see one clear price before anyone picks up a wrench.',items:[['Diagnose','Free','','We find the cause first and explain it plainly.'],['Flat quote','Upfront','','One price in writing before we start.',1],['Fixed right','Warranty','','Parts and labor backed by us.']]},
  q:[['Showed up in under an hour and quoted a flat price on the spot.','Chris M.'],['Fixed a leak two other companies could not find.','Lena P.'],['Clean work, fair price, and he explained everything.','Tom W.']]},
 {k:'land',l:'Landscaping',c:'#17a05d',f:'serif',badge:'Design and build',h:['See your yard ','before we build it.'],sub:'Patios, plants and lighting designed around how you actually live outside.',cta:'Book a design walk',
  stats:[['12 yrs','In business'],['900+','Yards finished'],['Fixed','Quotes'],['Local','Crew']],
  sv:[['leaf','Design','Your whole yard'],['drop','Irrigation','Smart drip'],['home','Patios','Built to last'],['shield','Maintenance','Monthly care']],
  plan:{e:'How it works',t:'From a walk to a finished yard.',p:'Three steps, one crew, and a price you agree to first.',steps:1,items:[['1','Walk the yard','We listen, measure and take photos.'],['2','See your plan','Pick what you love and see the range.'],['3','We build it','One crew from the first shovel to the last plant.']]},
  q:[['They showed us the whole yard before a single shovel hit the dirt.','Priya S.'],['On time, on budget, and the patio is our favorite room now.','Mark and Jen L.'],['The plant picker saved us from killing another garden.','Ruth A.']]},
 {k:'roof',l:'Roofing',c:'#d9482b',badge:'Free roof inspection',h:['Roofs that hold up ','to the sun.'],sub:'Repairs, replacements and honest advice before any big spend.',cta:'Get a roof check',
  stats:[['25 yr','Warranty'],['3,100+','Roofs done'],['48 hr','Written quote'],['A+','Rated']],
  sv:[['home','Repairs','Fast patches'],['shield','Replacement','Built to last'],['spark','Inspections','No pressure'],['bolt','Storm damage','Quick response']],
  plan:{e:'Packages',t:'Pick the fix that fits.',p:'Every quote is written, itemized and good for 30 days.',items:[['Patch and repair','From $350','','Leaks, flashing and missing shingles.'],['Full replacement','From $8,900','','Tear-off, new underlayment and a 25 year warranty.',1],['Premium system','From $14,500','','Heavy-duty materials and extended coverage.']]},
  q:[['They found the leak in ten minutes and fixed it the same day.','Aaron B.'],['Fair price, written quote, and no pressure at all.','Cheryl D.'],['Our new roof looks great and the crew left the yard spotless.','Victor H.']]},
 {k:'clean',l:'Cleaning',c:'#0fa3a3',badge:'Trusted local team',h:['A spotless home, ','every visit.'],sub:'Weekly, deep and move-out cleaning from a crew you can trust.',cta:'Get a cleaning quote',
  stats:[['4.9','Average rating'],['50k+','Rooms cleaned'],['Insured','And bonded'],['Eco','Options']],
  sv:[['spark','Regular cleaning','Weekly or monthly'],['brush','Deep cleans','Top to bottom'],['home','Move out','Deposit-ready'],['shield','Offices','After hours']],
  plan:{e:'Plans',t:'A clean home on your schedule.',p:'Same crew every visit. Skip or pause any time.',items:[['Weekly','$129','/visit','The easiest way to stay ahead.'],['Every other week','$149','/visit','Our most popular schedule.',1],['Monthly','$169','/visit','A fresh reset once a month.']]},
  q:[['Same lovely crew every time and the house smells amazing.','Hannah G.'],['They got our deposit back in full. Worth every dollar.','Luis F.'],['Easy booking, fair pricing and they actually show up on time.','Nora C.']]},
 {k:'auto',l:'Auto detailing',c:'#ff3d3d',dark:1,badge:'We come to you',h:['Showroom shine ','at your door.'],sub:'Mobile detailing, ceramic coating and interior resets that fit your schedule.',cta:'Book a detail',
  stats:[['4.9','Google rating'],['1,800+','Cars detailed'],['90 min','Typical visit'],['We come','To you']],
  sv:[['car','Full detail','Inside and out'],['spark','Ceramic coat','Long-lasting shine'],['brush','Interior','Fresh and clean'],['clock','Quick wash','Done in an hour']],
  plan:{e:'Packages',t:'Pick your shine.',p:'Pricing is for a standard sedan. SUVs and trucks are quoted at booking.',items:[['Express','$49','','Wash, wax and tires.'],['Full detail','$149','','Deep interior and a hand polish.',1],['Ceramic coating','$499','','Years of protection and gloss.']]},
  q:[['My truck looked brand new and they did it in my driveway.','Eric N.'],['The interior reset was unreal. Pet hair gone completely.','Sofia V.'],['Booked online in a minute and they were right on time.','Daniel O.']]},
 {k:'salon',l:'Salons',c:'#c2417a',f:'serif',badge:'Book online',h:['Look good. ','Feel even better.'],sub:'Cuts, color and styling from a team that listens first.',cta:'Book an appointment',
  stats:[['4.9','Client rating'],['12','Stylists'],['Walk-ins','Welcome'],['Gift','Cards']],
  sv:[['cut','Cuts','Fresh and sharp'],['brush','Color','Custom blends'],['spark','Styling','Event ready'],['clock','Express','Lunch-break fast']],
  plan:{e:'Popular services',t:'Our most booked.',p:'Prices start at the amounts below and depend on length and thickness.',items:[['Cut and style','$65','','Consultation, wash, cut and finish.'],['Color','$120','','Single process or highlights.',1],['Blowout','$45','','Smooth, shiny and ready to go.']]},
  q:[['She finally got my color right on the very first try.','Bree T.'],['Booked online, walked in, felt like a new person.','Jada M.'],['Calm, friendly and the best cut I have had in years.','Olivia R.']]}];
var SWH=[0,22,45,75,140,170,200,225,255,285,325],SWL=[74,62,50,40,30];
var NEUT=['#0b0d12','#27272a','#52525b','#71717a','#a1a1aa','#d4d4d8','#7c4a2d','#b08d57','#1e3a2f','#0b2545','#6d1a2b'];
var st={name:'Sunrise Home Services',t:0,c:'#2457ff'},touched=false,cTouched=false;
var scrL=$('#scrL'),scrP=$('#scrP');
function esc(s){return s.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ini(n){var w=n.trim().split(/\s+/).filter(Boolean);return ((w[0]||'U')[0]+((w[1]||'')[0]||'')).toUpperCase()}
function slug(n){var s=n.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');return (s||'yourbusiness').slice(0,22)+'.com'}
function ico(k){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICO[k]+'</svg>'}
/* color helpers */
function h2r(x){x=x.replace('#','');return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)]}
function r2hsl(r,g,b){r/=255;g/=255;b/=255;var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,s=0,h=0;if(mx!==mn){var d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h*=60}return [h,s*100,l*100]}
function hsl(h,s,l){return 'hsl('+Math.round(h)+' '+Math.round(s)+'% '+Math.round(l)+'%)'}
function hsl2hex(h,s,l){s/=100;l/=100;var a=s*Math.min(l,1-l);function f(n){var k=(n+h/30)%12,c=l-a*Math.max(-1,Math.min(k-3,9-k,1));var v=Math.round(255*c).toString(16);return v.length<2?'0'+v:v}return '#'+f(0)+f(8)+f(4)}
function lum(x){var c=h2r(x).map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function pal(x,dark){var c=h2r(x),k=r2hsl(c[0],c[1],c[2]),h=k[0],s=k[1],l=k[2],ac=x,L=lum(x);
  if(dark&&L<.07)ac=hsl2hex(h,Math.min(s,30),72);
  if(!dark&&L>.8)ac=hsl2hex(h,Math.max(s,30),48);
  var act=lum(ac)>.4?'#0b0d12':'#ffffff',m=r2hsl.apply(null,h2r(ac));
  return {ac:ac,act:act,dk:hsl(h,Math.min(s,55)*.85,7),dk2:hsl(h,Math.min(s,50)*.8,13),lt:hsl(h,Math.min(s,80)*.45,97),lt2:hsl(h,Math.min(s,80)*.55,93),tx:hsl(h,Math.min(s,40)*.7,11),acl:hsl2hex(m[0],Math.max(m[1],20),Math.min(m[2],38))}}
function vars(dark){var P=pal(st.c,dark);return '--ac:'+P.ac+';--act:'+P.act+';--dk:'+P.dk+';--dk2:'+P.dk2+';--lt:'+P.lt+';--lt2:'+P.lt2+';--tx:'+P.tx+';--acl:'+P.acl}
/* widgets */
function wDial(){var t='';for(var i=0;i<=40;i++){var a=(135+270*i/40)*Math.PI/180,r1=120,r2=i%5?113:106;t+='<line x1="'+(160+r1*Math.cos(a)).toFixed(1)+'" y1="'+(160+r1*Math.sin(a)).toFixed(1)+'" x2="'+(160+r2*Math.cos(a)).toFixed(1)+'" y2="'+(160+r2*Math.sin(a)).toFixed(1)+'" stroke="rgba(255,255,255,'+(i%5?.25:.6)+')" stroke-width="'+(i%5?1.4:2)+'"/>'}
  return '<div class="w-dial"><svg viewBox="0 0 320 320" aria-hidden="true"><defs><linearGradient id="dgA" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8fd3ff"/><stop offset=".5" style="stop-color:var(--ac)"/><stop offset="1" stop-color="#ff8a4c"/></linearGradient></defs><circle cx="160" cy="160" r="154" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.14)"/><path d="M68.1 251.9A130 130 0 1 1 251.9 251.9" fill="none" stroke="url(#dgA)" stroke-width="14" stroke-linecap="round"/>'+t+
  '<g class="hot"><text x="160" y="182" text-anchor="middle" font-size="86" font-weight="650" fill="#fff" letter-spacing="-4">96<tspan font-size="30" dy="-34" letter-spacing="0">°F</tspan></text><text x="160" y="222" text-anchor="middle" font-size="12" letter-spacing="3.5" fill="#ffb089" font-weight="600">TOO HOT</text></g>'+
  '<g class="cool"><text x="160" y="182" text-anchor="middle" font-size="86" font-weight="650" fill="#fff" letter-spacing="-4">72<tspan font-size="30" dy="-34" letter-spacing="0">°F</tspan></text><text x="160" y="222" text-anchor="middle" font-size="12" letter-spacing="3.5" fill="#9fdcff" font-weight="600">COMFORTABLE</text></g>'+
  '<g class="knob"><circle cx="54.8" cy="83.6" r="14" fill="#fff"/><circle cx="54.8" cy="83.6" r="5.5" style="fill:var(--ac)"/></g></svg><div class="hint">Drag the dial to feel the difference</div></div>'}
function wGauge(){var t='',n='';for(var i=0;i<=24;i++){var a=(135+270*i/24)*Math.PI/180,r1=112,r2=i%4?105:98;t+='<line x1="'+(160+r1*Math.cos(a)).toFixed(1)+'" y1="'+(160+r1*Math.sin(a)).toFixed(1)+'" x2="'+(160+r2*Math.cos(a)).toFixed(1)+'" y2="'+(160+r2*Math.sin(a)).toFixed(1)+'" stroke="rgba(255,255,255,'+(i%4?.28:.7)+')" stroke-width="'+(i%4?1.4:2.2)+'"/>'}
  for(var j=0;j<=5;j++){var b=(135+270*j/5)*Math.PI/180;n+='<text x="'+(160+80*Math.cos(b)).toFixed(1)+'" y="'+(164+80*Math.sin(b)).toFixed(1)+'" text-anchor="middle" font-size="13" font-family="Geist Mono,monospace" fill="rgba(255,255,255,.7)">'+(j*20)+'</text>'}
  var beads='';for(var q=0;q<20;q++)beads+='<circle cx="'+(14+q*18)+'" cy="305" r="3" fill="#fff" opacity=".85"/>';
  return '<div class="w-gauge"><svg viewBox="0 0 320 330" aria-hidden="true"><defs><linearGradient id="cgA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" style="stop-color:var(--ac)"/><stop offset="1" style="stop-color:var(--ac);stop-opacity:.6"/></linearGradient></defs>'+
  '<circle cx="160" cy="160" r="140" fill="none" stroke="url(#cgA)" stroke-width="12"/><circle cx="160" cy="160" r="132" fill="#0b1013"/>'+t+n+
  '<rect x="118" y="208" width="84" height="30" rx="8" fill="rgba(255,255,255,.07)"/><text x="160" y="229" text-anchor="middle" font-size="15" font-weight="600" font-family="Geist Mono,monospace" fill="#fff">61.7 PSI</text>'+
  '<g class="needle"><line x1="160" y1="160" x2="160" y2="84" stroke-width="4.5" stroke-linecap="round" style="stroke:var(--ac)"/><circle cx="160" cy="160" r="11" fill="#fff"/><circle cx="160" cy="160" r="4" style="fill:var(--ac)"/></g>'+
  '<rect x="0" y="292" width="320" height="26" rx="13" fill="rgba(255,255,255,.08)"/><rect x="0" y="292" width="320" height="26" rx="13" fill="none" stroke="rgba(255,255,255,.16)"/><g class="bead">'+beads+'</g></svg><div class="w-cap">Test pressure held, no drop</div></div>'}
function wYard(){return '<div class="w-yard"><div class="w-scene"><svg viewBox="0 0 420 190" preserveAspectRatio="none" aria-hidden="true"><circle cx="330" cy="46" r="22" fill="#fff6d6" opacity=".95"/><path d="M0 118C70 92 130 104 190 120S330 112 420 92V190H0Z" style="fill:var(--ac);opacity:.5"/><path d="M0 148C80 126 160 140 240 150S360 142 420 128V190H0Z" style="fill:var(--ac)"/><g fill="rgba(0,0,0,.22)"><rect x="70" y="96" width="5" height="34"/><rect x="250" y="102" width="5" height="30"/><rect x="352" y="98" width="5" height="32"/></g><g style="fill:var(--ac)"><circle cx="72" cy="90" r="22"/><circle cx="252" cy="96" r="20"/><circle cx="354" cy="92" r="21"/></g><g fill="#fff" opacity=".22"><circle cx="64" cy="82" r="9"/><circle cx="246" cy="90" r="8"/><circle cx="348" cy="85" r="8"/></g><rect x="120" y="140" width="150" height="20" rx="10" fill="rgba(255,255,255,.5)"/></svg></div>'+
  '<div class="w-plan"><h6>Your yard plan<span>Typical range</span></h6><div class="w-row"><i></i><span>Paver patio<br><small>Patio and deck</small></span><b>$6k to $10k</b></div><div class="w-row"><i></i><span>Shade pergola<br><small>Shade and kitchen</small></span><b>$4k to $7k</b></div><div class="w-row"><i></i><span>Desert plants<br><small>Planting and gravel</small></span><b>$3k to $5k</b></div><div class="w-tot"><span>Total range</span><span>$13k to $22k</span></div></div></div>'}
function wRoof(){var sh='';for(var i=0;i<6;i++)sh+='<path d="M'+(92+i*8)+' '+(150-i*13)+'H'+(328-i*8)+'" stroke="rgba(0,0,0,.14)" stroke-width="2"/>';
  return '<div class="w-roof"><svg viewBox="0 0 440 300" aria-hidden="true"><circle class="sun" cx="372" cy="62" r="30" fill="#ffd45a"/><ellipse cx="60" cy="70" rx="46" ry="14" fill="#fff" opacity=".8"/><ellipse cx="96" cy="58" rx="30" ry="12" fill="#fff" opacity=".8"/><rect x="80" y="156" width="260" height="120" rx="8" fill="#fbf7f1" stroke="rgba(20,24,30,.12)"/><rect x="274" y="62" width="30" height="62" style="fill:var(--ac);opacity:.85"/><path d="M56 166L210 56L364 166Z" style="fill:var(--ac)"/>'+sh+'<path d="M56 166L210 56L364 166" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3" stroke-linejoin="round"/><rect x="112" y="190" width="56" height="50" rx="6" fill="#d9e4f2"/><rect x="252" y="190" width="56" height="50" rx="6" fill="#d9e4f2"/><rect x="186" y="198" width="48" height="78" rx="6" style="fill:var(--ac);opacity:.9"/><rect x="0" y="274" width="440" height="6" rx="3" fill="rgba(20,24,30,.12)"/></svg><div class="w-badge">25 year warranty<small>Free roof inspection</small></div></div>'}
function wClean(){var row=function(n,t){return '<div class="w-ck"><i>'+ico('check')+'</i>'+n+'<b>'+t+'</b></div>'};
  return '<div class="w-clean"><h6>Room by room</h6><p>Your checklist, ticked off as we go.</p>'+row('Kitchen','45 min')+row('Bathrooms','40 min')+row('Bedrooms','35 min')+row('Floors','30 min')+'<div class="w-price"><span>From, per visit</span><b>$129</b></div></div>'}
function wCar(){return '<div class="w-car"><svg viewBox="0 0 420 200" aria-hidden="true"><defs><clipPath id="carC"><path d="M24 150C24 128 44 118 74 112L114 78C128 66 152 60 192 60H252C278 60 294 76 314 98L340 110C362 116 376 126 376 148V164H24Z"/></clipPath><linearGradient id="carG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" style="stop-color:var(--ac)"/><stop offset="1" style="stop-color:var(--ac);stop-opacity:.75"/></linearGradient><linearGradient id="carS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><ellipse cx="200" cy="176" rx="170" ry="12" fill="rgba(0,0,0,.4)"/><path d="M24 150C24 128 44 118 74 112L114 78C128 66 152 60 192 60H252C278 60 294 76 314 98L340 110C362 116 376 126 376 148V164H24Z" fill="url(#carG)"/><g clip-path="url(#carC)"><rect class="sheen" x="0" y="40" width="70" height="140" fill="url(#carS)" transform="skewX(-20)"/></g><path d="M126 86L152 68H196V108H110Z" fill="rgba(10,14,20,.72)"/><path d="M206 68H250C264 68 276 78 292 106H206Z" fill="rgba(10,14,20,.72)"/><circle cx="102" cy="162" r="26" fill="#0b0d12"/><circle cx="102" cy="162" r="13" fill="#c9ced8"/><circle cx="302" cy="162" r="26" fill="#0b0d12"/><circle cx="302" cy="162" r="13" fill="#c9ced8"/></svg></div>'}
function wBook(){return '<div class="w-book"><h6 class="serif">Pick a time</h6><div class="w-days"><span>Mon<b>14</b></span><span class="on">Tue<b>15</b></span><span>Wed<b>16</b></span><span>Thu<b>17</b></span><span>Fri<b>18</b></span></div><div class="w-slots"><span>9:00</span><span>10:30</span><span class="on">12:00</span><span>1:30</span><span>3:00</span><span>4:30</span></div><div class="w-who"><i></i>With your stylist, 60 min</div><div class="w-go">Confirm booking</div></div>'}
var WIDGETS={hvac:wDial,plumb:wGauge,land:wYard,roof:wRoof,clean:wClean,auto:wCar,salon:wBook};
function mini(ph){var T=TRADES[st.t],nm=st.name.trim()||'Your Business',fc=T.f==='serif'?' serif':T.f==='cond'?' cond':'',dk=!!T.dark;
  var pl=T.plan,items='';
  if(pl.steps)items=pl.items.map(function(x){return '<div class="ms-pi"><div class="ms-step"><i>'+x[0]+'</i><div><div class="ms-pn">'+x[1]+'</div><div class="ms-pd" style="margin-top:0">'+x[2]+'</div></div></div></div>'}).join('');
  else items=pl.items.map(function(x){return '<div class="ms-pi'+(x[4]?' hot':'')+'">'+(x[4]?'<span class="ms-tag">Most popular</span>':'')+'<div class="ms-pn">'+x[0]+'</div><div class="ms-pp">'+x[1]+'<small>'+x[2]+'</small></div><div class="ms-pd">'+x[3]+'</div></div>'}).join('');
  var star='★★★★★';
  return '<div class="ms '+(dk?'dark':'light')+(ph?' ph':'')+'" style="'+vars(dk)+'"><div class="ms-in">'+
  '<div class="ms-nav"><div class="ms-logo"><i class="ji">'+esc(ini(nm))+'</i><b class="jn">'+esc(nm)+'</b></div><div class="ms-links"><span>Services</span><span>About</span><span>Reviews</span><span>Contact</span></div><div class="ms-call">'+ico('phone')+PHONE+'</div></div>'+
  '<div class="ms-hero"><div class="ms-copy"><span class="ms-badge">'+T.badge+'</span><div class="ms-h1'+fc+'">'+T.h[0]+'<em>'+T.h[1]+'</em></div><div class="ms-sub">'+T.sub+'</div><div class="ms-btns"><span class="b1">'+T.cta+ico('arrow')+'</span><span class="b2">Call now</span></div></div><div class="ms-art">'+WIDGETS[T.k]()+'</div></div>'+
  '<div class="ms-stats">'+T.stats.map(function(s){return '<div><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'}).join('')+'</div>'+
  '<div class="ms-sec"><span class="ms-eyebrow">What we do</span><div class="ms-h2'+fc+'">Everything your home needs, handled.</div><div class="ms-grid">'+T.sv.map(function(s){return '<div class="ms-card">'+ico(s[0])+'<b>'+s[1]+'</b><small>'+s[2]+'</small></div>'}).join('')+'</div></div>'+
  '<div class="ms-plan"><span class="ms-eyebrow">'+pl.e+'</span><div class="ms-h2'+fc+'">'+pl.t+'</div><p>'+pl.p+'</p><div class="ms-pl">'+items+'</div></div>'+
  '<div class="ms-sec"><span class="ms-eyebrow">Reviews</span><div class="ms-h2'+fc+'">Neighbors keep calling us back.</div><div class="ms-rv">'+T.q.map(function(q){return '<div class="ms-q"><div class="ms-st">'+star+'</div><p>'+q[0]+'</p><span>'+q[1]+'</span></div>'}).join('')+'</div></div>'+
  '<div class="ms-cta"><div><div class="ms-h2'+fc+'">Ready when you are.</div><p>Call '+PHONE+' or send a quick request. We reply fast.</p></div><div class="ms-fm"><i></i><i></i><em>'+T.cta+'</em></div></div>'+
  '<div class="ms-ft"><span><b class="jn">'+esc(nm)+'</b> &middot; Licensed and insured</span><span>'+PHONE+'</span></div>'+
  '</div></div>'}
var SCR=[[scrL,1100,687.5],[scrP,390,806]];
function fit(){SCR.forEach(function(a){var s=a[0],ms=s.firstChild;if(!ms||!s.clientWidth)return;ms.style.transform='scale('+(s.clientWidth/a[1])+')';var travel=Math.max(0,ms.firstChild.offsetHeight-a[2]);ms.style.setProperty('--travel',travel);ms.style.setProperty('--dur',Math.max(20,travel/48)+'s')})}
function applyName(){var nm=st.name.trim()||'Your Business';
  [scrL,scrP].forEach(function(s){$$('.jn',s).forEach(function(e){e.textContent=nm});$$('.ji',s).forEach(function(e){e.textContent=ini(nm)})});
  $('#url').textContent=slug(st.name);$('#nmT').textContent=nm;$('#avT').textContent=ini(nm);$('#b1').textContent='Hi Maria, thanks for choosing '+nm+' today! Could you share how we did?'}
function applyColor(){var dk=!!TRADES[st.t].dark,v=vars(dk);[scrL,scrP].forEach(function(s){var m=s.firstChild;if(m)m.setAttribute('style',(m.getAttribute('style')||'').replace(/--ac:[^]*$/,'')+v)});
  var dot=$('#clrDot');if(dot)dot.style.background=st.c;var cc=$('#clrC');if(cc)cc.value=st.c;
  $$('#clrG button').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-c')===st.c)})}
function render(){scrL.innerHTML=mini(false);scrP.innerHTML=mini(true);
  $$('#trades .chip').forEach(function(b,i){b.setAttribute('aria-pressed',i===st.t)});applyName();applyColor();fit()}
var trw=$('#trades');TRADES.forEach(function(t,i){var b=document.createElement('button');b.type='button';b.className='chip';b.textContent=t.l;b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){touched=true;st.t=i;if(!cTouched)st.c=t.c;render()});trw.appendChild(b)});
/* color menu: every color, tucked into a collapsible panel */
var clrB=$('#clrB'),clrP=$('#clrP'),clrG=$('#clrG'),clrC=$('#clrC');
function addSw(hex,label){var b=document.createElement('button');b.type='button';b.style.background=hex;b.setAttribute('data-c',hex);b.setAttribute('aria-label',label);b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){setColor(hex)});clrG.appendChild(b)}
SWL.forEach(function(l){SWH.forEach(function(h){addSw(hsl2hex(h,84,l),'Color '+hsl2hex(h,84,l))})});
NEUT.forEach(function(n){addSw(n,'Color '+n)});
function setColor(hex){touched=true;cTouched=true;st.c=hex;applyColor()}
function openClr(on){clrP.hidden=!on;clrB.setAttribute('aria-expanded',on?'true':'false');if(on)HST(function(){clrP.scrollIntoView({block:'nearest',behavior:reduce?'auto':'smooth'})},30)}
clrB.addEventListener('click',function(e){e.stopPropagation();openClr(clrP.hidden)});
clrP.addEventListener('click',function(e){e.stopPropagation()});
clrC.addEventListener('input',function(e){setColor(e.target.value)});
HON(document,'click',function(){if(!clrP.hidden)openClr(false)});
HON(document,'keydown',function(e){if(e.key==='Escape'&&!clrP.hidden){openClr(false);clrB.focus()}});
$('#bn').addEventListener('input',function(e){touched=true;st.name=e.target.value;applyName();fit()});
$('#rand').addEventListener('click',function(){touched=true;var names=['Blue Ridge','Canyon','Summit','Ironwood','Palo Verde','Mesa','Copper State','Cactus Flower','Sonoran','Saguaro'];var suf={hvac:'Heating and Air',plumb:'Plumbing',land:'Landscaping',roof:'Roofing',clean:'Cleaning Co',auto:'Auto Detail',salon:'Hair Studio'};
  st.t=Math.floor(Math.random()*TRADES.length);st.c=hsl2hex(SWH[Math.floor(Math.random()*SWH.length)],84,SWL[Math.floor(Math.random()*3)+1]);st.name=names[Math.floor(Math.random()*names.length)]+' '+suf[TRADES[st.t].k];$('#bn').value=st.name;render()});
render();
HRO(function(){fit()}).observe(scrL);HRO(function(){fit()}).observe(scrP);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){if(!dead)fit()});
HSI(function(){if(touched||reduce||document.hidden)return;st.t=(st.t+1)%TRADES.length;st.c=TRADES[st.t].c;
  var nm={hvac:'Sunrise Heating and Air',plumb:'Sunrise Plumbing',land:'Sunrise Landscaping',roof:'Sunrise Roofing',clean:'Sunrise Cleaning Co',auto:'Sunrise Auto Detail',salon:'Sunrise Hair Studio'};st.name=nm[TRADES[st.t].k];$('#bn').value=st.name;render()},9000);

/* live background: rising growth lines with data pulses that bend toward the pointer */
function initBg(cv,opt){
  var ctx=cv.getContext('2d'),host=cv.parentNode,W=0,H=0,dpr=1,t0=performance.now(),run=false,vis=true,px=-9999,py=-9999,tx=-9999,ty=-9999,infl=0,tinfl=0;
  var N=opt.n||9,L=[],P=[],seed=opt.seed||1;
  function rnd(i){var x=Math.sin(i*127.1+seed*311.7)*43758.5453;return x-Math.floor(x)}
  for(var i=0;i<N;i++){var u=i/(N-1);L.push({u:u,ph:rnd(i)*6.28,ph2:rnd(i+9)*6.28,f1:1.6+rnd(i+3)*1.4,f2:3.4+rnd(i+5)*2,s1:.35+rnd(i+7)*.3,s2:.25+rnd(i+11)*.3,w:1+(1-u)*1.1,a:.22+u*.38})}
  for(var j=0;j<26;j++){P.push({l:Math.floor(rnd(j+40)*N),x:rnd(j+60),v:.018+rnd(j+80)*.03,r:1.2+rnd(j+100)*1.8})}
  function dark(){var r=document.documentElement.getAttribute('data-theme');return opt.forceDark||r==='dark'||(r!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)}
  function yAt(l,nx,t){var e=Math.pow(nx,1.55),y0=H*(opt.y0-.06*l.u),y1=H*(opt.y1a+(opt.y1b-opt.y1a)*l.u);var base=y0+(y1-y0)*e;var amp=H*(.018+.03*l.u);
    var y=base+amp*Math.sin(nx*l.f1*Math.PI+t*l.s1+l.ph)+amp*.55*Math.sin(nx*l.f2*Math.PI-t*l.s2+l.ph2);
    if(infl>.01){var dx=nx*W-px,dy=y-py,d2=dx*dx+dy*dy,k=Math.exp(-d2/(2*150*150));y-=infl*k*46}return y}
  function size(){var r=host.getBoundingClientRect();dpr=Math.min(2,window.devicePixelRatio||1);W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
  function frame(now){
    var t=reduce?0:(now-t0)/1000,D=dark();infl+=(tinfl-infl)*.08;px+=(tx-px)*.18;py+=(ty-py)*.18;
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation=D?'lighter':'source-over';
    var g=ctx.createLinearGradient(0,0,W,0);
    if(D){g.addColorStop(0,'rgba(91,130,255,.35)');g.addColorStop(.25,'rgba(91,130,255,1)');g.addColorStop(.7,'rgba(180,200,255,1)');g.addColorStop(1,'rgba(255,210,63,1)')}
    else{g.addColorStop(0,'rgba(36,87,255,.3)');g.addColorStop(.25,'rgba(36,87,255,1)');g.addColorStop(.7,'rgba(70,110,255,1)');g.addColorStop(1,'rgba(242,189,15,1)')}
    ctx.lineJoin='round';ctx.lineCap='round';
    var step=Math.max(5,Math.round(W/160));
    for(var i=0;i<N;i++){var l=L[i];ctx.beginPath();
      for(var x=0;x<=W+step;x+=step){var y=yAt(l,Math.min(1,x/W),t);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}
      ctx.globalAlpha=l.a*(D?1:.9);ctx.strokeStyle=g;ctx.lineWidth=l.w;
      if(D){ctx.shadowColor='rgba(110,145,255,.9)';ctx.shadowBlur=14}else{ctx.shadowBlur=0}
      ctx.stroke()}
    ctx.shadowBlur=0;
    /* pulses travelling along the lines */
    for(var k=0;k<P.length;k++){var p=P[k];if(!reduce)p.x+=p.v*.016;if(p.x>1.02)p.x=-.02;var nx=Math.min(1,Math.max(0,p.x)),l2=L[p.l],yy=yAt(l2,nx,t),xx=nx*W;
      var fade=Math.sin(Math.min(1,Math.max(0,p.x))*Math.PI);
      var col=D?(nx>.72?'255,210,63':'200,215,255'):(nx>.72?'230,170,10':'36,87,255');
      var rg=ctx.createRadialGradient(xx,yy,0,xx,yy,p.r*6);rg.addColorStop(0,'rgba('+col+','+(.75*fade)+')');rg.addColorStop(1,'rgba('+col+',0)');
      ctx.globalAlpha=1;ctx.fillStyle=rg;ctx.beginPath();ctx.arc(xx,yy,p.r*6,0,6.283);ctx.fill();
      ctx.fillStyle='rgba('+col+','+fade+')';ctx.beginPath();ctx.arc(xx,yy,p.r*.9,0,6.283);ctx.fill()}
    ctx.globalAlpha=1;
    if(run&&!reduce)HRAF(frame)}
  function start(){if(run||reduce)return;run=true;HRAF(frame)}
  function stop(){run=false}
  size();frame(performance.now());
  if(window.ResizeObserver)HRO(function(){size();frame(performance.now())}).observe(host);else HON(window,'resize',function(){size();frame(performance.now())});
  HIO(function(es){vis=es[0].isIntersecting;if(vis&&!document.hidden)start();else stop()},{threshold:0}).observe(host);
  HON(document,'visibilitychange',function(){if(document.hidden)stop();else if(vis)start()});
  if(!reduce&&matchMedia('(hover:hover)').matches){host.addEventListener('pointermove',function(e){var r=cv.getBoundingClientRect();tx=e.clientX-r.left;ty=e.clientY-r.top;tinfl=1});host.addEventListener('pointerleave',function(){tinfl=0})}
  $('#theme').addEventListener('click',function(){HST(function(){frame(performance.now())},30)});
}
initBg($('#bgHero'),{n:9,seed:3,y0:.93,y1a:.08,y1b:.62});
initBg($('#bgCta'),{n:9,seed:8,y0:.98,y1a:.05,y1b:.55,forceDark:true});
/* hero parallax */
var hst=$('#hst'),hin=$('#hin');
if(!reduce&&matchMedia('(hover:hover)').matches){hst.addEventListener('pointermove',function(e){var r=hst.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;hin.style.transform='rotateY('+(x*5)+'deg) rotateX('+(-y*4)+'deg)'});hst.addEventListener('pointerleave',function(){hin.style.transform=''})}
/* designs: three live sites, each a card that scrolls itself */
var DES=[
 {id:'desert',n:'Desert Breeze HVAC',trade:'Heating and cooling',url:'/websites/hvac',p:'A thermostat dial you can drag, a quick "is my AC dying" quiz and a savings calculator. Built for emergency calls and quote requests.',tags:['Interactive dial','Quote quiz','Savings calculator']},
 {id:'copper',n:'Copperline Plumbing',trade:'Plumbing',url:'/websites/plumbing',p:'A copper pipe that draws itself as you scroll, an emergency triage tool and a find-your-shutoff-valve guide. Bold, trustworthy, easy to read.',tags:['Scroll-drawn pipe','Emergency triage','Shutoff guide']},
 {id:'green',n:'Greenway Landscaping',trade:'Landscaping',url:'/websites/landscaping',p:'A photo yard builder where visitors add real pools, patios and pergolas and watch a price range add up. Includes a plant picker and care calendar.',tags:['Photo yard builder','Price range','Plant picker']}];
var dg=$('#dgrid');
dg.innerHTML=DES.map(function(d,i){return '<article class="dc"><a class="dc-vis" href="'+d.url+'" aria-label="Open the live '+d.n+' site" tabindex="-1"><div class="dc-stage"><div class="dc-win"><div class="bar"><i></i><i></i><i></i></div><div class="vp"><img src="'+IMG[d.id+'_d']+'" alt="'+d.n+' on a desktop computer" loading="lazy" decoding="async"></div></div><div class="dc-ph"><div class="dc-pho"><div class="vp"><img src="'+IMG[d.id+'_m']+'" alt="'+d.n+' on a phone" loading="lazy" decoding="async"></div></div></div></div></a>'+
  '<div class="dc-b"><span class="dc-n">0'+(i+1)+' &middot; '+d.trade+'</span><h3>'+d.n+'</h3><p>'+d.p+'</p><ul class="tags">'+d.tags.map(function(x){return '<li>'+x+'</li>'}).join('')+'</ul><a class="btn btn-y" href="'+d.url+'">Open the live site</a></div></article>'}).join('');
function dfit(){$$('.dc .vp').forEach(function(vp){var im=vp.firstChild;if(!im||!im.complete||!im.naturalHeight)return;var over=Math.max(0,im.offsetHeight-vp.offsetHeight);vp.style.setProperty('--o',over+'px');vp.style.setProperty('--d',Math.max(14,over/40)+'s')})}
$$('.dc img').forEach(function(im){im.addEventListener('load',dfit)});
HON(window,'resize',dfit);dfit();
$$('.dc').forEach(function(c){HIO(function(es){c.classList.toggle('run',es[0].isIntersecting)},{threshold:.2}).observe(c)});
/* pricing */
var TIERS=CFG.tiers,SETUP=CFG.setup,TRIAL=CFG.trial;
var P={up:false,rv:false,t:0,loc:1},shown={vToday:299,vMonth:0},raf={};
var money=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
function roll(id,to){var el=$('#'+id),from=shown[id];cancelAnimationFrame(raf[id]);if(reduce){el.textContent=money(to);shown[id]=to;return}
  var t0=performance.now();(function f(n){var p=Math.min(1,(n-t0)/450),e=1-Math.pow(1-p,3);el.textContent=money(from+(to-from)*e);if(p<1)raf[id]=HRAF(f);else shown[id]=to})(t0)}
var tr=$('#tier');TIERS.forEach(function(t,i){var b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',i===0);b.innerHTML='<b>$'+t.p+'</b><small>'+t.n+'<br>'+t.r+' requests</small>';b.addEventListener('click',function(){P.t=i;calc()});tr.appendChild(b)});
$('#tUp').addEventListener('click',function(){P.up=!P.up;calc()});
$('#tRv').addEventListener('click',function(){P.rv=!P.rv;calc()});
$('#lm').addEventListener('click',function(){P.loc=Math.max(1,P.loc-1);calc()});$('#lp').addEventListener('click',function(){P.loc=Math.min(20,P.loc+1);calc()});
function calc(){var T=TIERS[P.t],rv=P.rv?T.p*P.loc:0,month=(P.up?99:0)+rv;
  $('#tUp').setAttribute('aria-checked',P.up);$('#tRv').setAttribute('aria-checked',P.rv);$('#oUp').classList.toggle('on',P.up);$('#oRv').classList.toggle('on',P.rv);
  $$('#tier button').forEach(function(b,i){b.setAttribute('aria-pressed',i===P.t)});$('#ln').textContent=P.loc;$('#rvp').innerHTML='$'+T.p+'<small>per location, per month</small>';
  $('#lUp').classList.toggle('off',!P.up);$('#lRv').classList.toggle('off',!P.rv);$('#lSu').classList.toggle('off',!P.rv);
  $('#lRvT').textContent='Reviews '+T.n+(P.loc>1?' x '+P.loc:'');$('#lRvP').textContent=money(rv)+' / mo';
  roll('vToday',299);roll('vMonth',month);
  var n='Just the website. One payment, and you approve it before it goes live.';
  if(P.up&&!P.rv)n='Website now, then $99 a month for hosting, small updates and support. Cancel upkeep any time.';
  if(P.rv)n='Reviews start with a '+TRIAL+'-day free trial. After that it is '+money(rv)+' a month plus a one-time $'+SETUP+' setup.'+(P.up?' Upkeep is $99 a month.':'');
  $('#rnote').textContent=n;$('#order').setAttribute('href','/start?website='+(P.up?'build_maintenance':'build')+(P.rv?'&reviews=yes&tier='+T.id:''))}
calc();
/* review demo */
var stw=$('#stars'),done=false;for(var s=1;s<=5;s++)(function(s){var b=document.createElement('button');b.type='button';b.setAttribute('aria-label',s+' star'+(s>1?'s':''));b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';
  function lit(n){$$('button',stw).forEach(function(x,i){x.classList.toggle('on',i<n)})}
  b.addEventListener('mouseenter',function(){if(!done)lit(s)});b.addEventListener('focus',function(){if(!done)lit(s)});
  b.addEventListener('click',function(){done=true;lit(s);$('#thx').textContent=s>=4?'Thank you! This is where the one-tap Google link opens.':'Thanks for telling us. We will make it right.'});
  stw.appendChild(b)})(s);
stw.addEventListener('mouseleave',function(){if(!done)$$('button',stw).forEach(function(x){x.classList.remove('on')})});
$('#b2a').addEventListener('click',function(e){e.preventDefault()});
var seq=false,mg=$('#msgs');if(mg.getBoundingClientRect().top>innerHeight*0.9&&!reduce){mg.classList.add('arm')}
HIO(function(es,o){if(!es[0].isIntersecting||seq)return;seq=true;o.disconnect();['b1','b2','b3'].forEach(function(id,i){HST(function(){$('#'+id).classList.add('show')},reduce?0:300+i*850)})},{threshold:.35}).observe($('.ph2'));
HST(function(){if(!seq)mg.classList.remove('arm')},12000);
/* stats */
var cs=false;HIO(function(es,o){if(!es[0].isIntersecting||cs)return;cs=true;o.disconnect();if(reduce)return;$$('#stats b').forEach(function(b){var to=+b.dataset.n,s=b.dataset.s,t0=performance.now();(function f(n){var p=Math.min(1,(n-t0)/1400),e=1-Math.pow(1-p,3);b.textContent=Math.round(to*e)+s;if(p<1)HRAF(f)})(t0)})},{threshold:.4}).observe($('#stats'));

  return function cleanup() {
    off.forEach(function (fn) {
      try {
        fn();
      } catch (e) {}
    });
  };
}
