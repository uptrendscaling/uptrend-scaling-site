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
['#trades','#sw','#tier','#stars','#dlist','#marq'].forEach(function(s){var e=$(s);if(e)e.innerHTML=''});
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
var ICO={snow:'<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',home:'<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',wrench:'<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3.5-3.5 8-8zM3 21l5-5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',drop:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',flame:'<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-4 0-7 1-10z"/>',leaf:'<path d="M5 19C5 10 11 5 20 5c0 9-5 15-14 15zM5 19l7-7"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',bolt:'<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',spark:'<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',car:'<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16M4 16h16v3H4zM7 19v1M17 19v1"/>',cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8L20 18M8.5 16L20 6"/>',brush:'<path d="M4 20c3 0 5-1 5-4l9-9-3-3-9 9c-3 0-4 2-4 4 0 2 1 3 2 3z"/>'};
var TRADES=[
 {k:'hvac',l:'HVAC',b:'Licensed and insured',h:'Fast, honest AC repair.',s:'Same-day service, upfront pricing and a cool house by tonight.',cta:'Get a free quote',ch:['Same-day service','Upfront pricing','Licensed','24/7 emergency'],sv:[['snow','AC repair','Fixed fast'],['home','New installs','Right-sized'],['wrench','Tune-ups','Beat the heat'],['clock','Emergency','Day or night']]},
 {k:'plumb',l:'Plumbing',b:'Flat-rate pricing',h:'Plumbing fixed right the first time.',s:'Leaks, water heaters and drains handled by a real local plumber.',cta:'Request service',ch:['Flat rates','Fully licensed','Clean work','Emergency'],sv:[['drop','Leak repair','Found and fixed'],['flame','Water heaters','Hot all day'],['wrench','Drain cleaning','Clear and flowing'],['clock','Emergency','24/7 dispatch']]},
 {k:'land',l:'Landscaping',b:'Design and build',h:'Yards you will actually use.',s:'Patios, plants and lighting designed around how you live.',cta:'Book a design walk',ch:['Free design walk','Water-smart','Fixed quotes','Local crew'],sv:[['leaf','Design','Your whole yard'],['drop','Irrigation','Smart drip'],['home','Patios','Built to last'],['shield','Maintenance','Monthly care']]},
 {k:'roof',l:'Roofing',b:'Free roof inspection',h:'Roofs that hold up to the sun.',s:'Repairs, replacements and honest advice before any big spend.',cta:'Get a roof check',ch:['Free inspection','Clear pricing','Warranty','Storm help'],sv:[['home','Repairs','Fast patches'],['shield','Replacement','Built to last'],['spark','Inspections','No pressure'],['bolt','Storm damage','Quick response']]},
 {k:'clean',l:'Cleaning',b:'Trusted local team',h:'A spotless home, every visit.',s:'Weekly, deep and move-out cleaning from a crew you can trust.',cta:'Get a cleaning quote',ch:['Background checked','Insured','Flexible times','Eco options'],sv:[['spark','Regular cleaning','Weekly or monthly'],['brush','Deep cleans','Top to bottom'],['home','Move out','Deposit-ready'],['shield','Offices','After hours']]},
 {k:'auto',l:'Auto detailing',b:'We come to you',h:'Showroom shine at your door.',s:'Mobile detailing, ceramic coating and interior resets.',cta:'Book a detail',ch:['Mobile service','Ceramic coating','Fair prices','Fast booking'],sv:[['car','Full detail','Inside and out'],['spark','Ceramic coat','Long-lasting shine'],['brush','Interior','Fresh and clean'],['clock','Quick wash','Done in an hour']]},
 {k:'salon',l:'Salons',b:'Book online',h:'Look good. Feel even better.',s:'Cuts, color and styling from a team that listens.',cta:'Book an appointment',ch:['Online booking','Walk-ins','Top stylists','Gift cards'],sv:[['cut','Cuts','Fresh and sharp'],['brush','Color','Custom blends'],['spark','Styling','Event ready'],['clock','Express','Lunch-break fast']]}];
var ACC=[{n:'Blue',c:'#2457ff',t:'#ffffff'},{n:'Green',c:'#0f9d5c',t:'#ffffff'},{n:'Yellow',c:'#ffc928',t:'#09090b'},{n:'Black',c:'#111522',t:'#ffffff'}];
var st={name:'Sunrise Home Services',t:0,a:0},touched=false;
var scrL=$('#scrL'),scrP=$('#scrP');
function esc(s){return s.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ini(n){var w=n.trim().split(/\s+/).filter(Boolean);return ((w[0]||'U')[0]+((w[1]||'')[0]||'')).toUpperCase()}
function slug(n){var s=n.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');return (s||'yourbusiness').slice(0,22)+'.com'}
function ico(k){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+ICO[k]+'</svg>'}
function mini(ph){var T=TRADES[st.t],A=ACC[st.a],nm=st.name.trim()||'Your Business';
  return '<div class="mini'+(ph?' ph':'')+'" style="--ac:'+A.c+';--act:'+A.t+';--travel:'+(ph?'44%':'34%')+'">'+
  '<div class="m-nav"><div class="m-logo"><i>'+esc(ini(nm))+'</i><b>'+esc(nm)+'</b></div><div class="m-links"><span>Services</span><span>About</span><span>Reviews</span></div><div class="m-call">Call now</div></div>'+
  '<div class="m-hero"><span class="m-badge">'+T.b+'</span><h4>'+T.h+'</h4><p>'+T.s+'</p><div class="m-btns"><span class="b1">'+T.cta+'</span><span class="b2">(480) 555-0100</span></div></div>'+
  '<div class="m-strip">'+T.ch.map(function(c){return '<span>'+c+'</span>'}).join('')+'</div>'+
  '<div class="m-svc"><h5>What we do</h5><div class="m-grid">'+T.sv.map(function(s){return '<div class="m-card">'+ico(s[0])+'<b>'+s[1]+'</b><small>'+s[2]+'</small></div>'}).join('')+'</div></div>'+
  '<div class="m-form"><b>Get your free quote</b><i></i><i></i><i></i><em>'+T.cta+'</em></div></div>'}
function render(){scrL.innerHTML=mini(false);scrP.innerHTML=mini(true);$('#url').textContent=slug(st.name);
  $$('#trades .chip').forEach(function(b,i){b.setAttribute('aria-pressed',i===st.t)});$$('#sw button').forEach(function(b,i){b.setAttribute('aria-pressed',i===st.a)});
  var nm=st.name.trim()||'Your Business';$('#nmT').textContent=nm;$('#avT').textContent=ini(nm);$('#b1').textContent='Hi Maria, thanks for choosing '+nm+' today! Could you share how we did?'}
var trw=$('#trades');TRADES.forEach(function(t,i){var b=document.createElement('button');b.type='button';b.className='chip';b.textContent=t.l;b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){touched=true;st.t=i;render()});trw.appendChild(b)});
var swr=$('#sw');ACC.forEach(function(a,i){var b=document.createElement('button');b.type='button';b.style.background=a.c;b.setAttribute('aria-label',a.n);b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){touched=true;st.a=i;render()});swr.appendChild(b)});
$('#bn').addEventListener('input',function(e){touched=true;st.name=e.target.value;render()});
$('#rand').addEventListener('click',function(){touched=true;var names=['Blue Ridge','Canyon','Summit','Ironwood','Palo Verde','Mesa','Copper State','Cactus Flower','Sonoran','Saguaro'];var suf={hvac:'Heating and Air',plumb:'Plumbing',land:'Landscaping',roof:'Roofing',clean:'Cleaning Co',auto:'Auto Detail',salon:'Hair Studio'};
  st.t=Math.floor(Math.random()*TRADES.length);st.a=Math.floor(Math.random()*ACC.length);st.name=names[Math.floor(Math.random()*names.length)]+' '+suf[TRADES[st.t].k];$('#bn').value=st.name;render()});
render();
HSI(function(){if(touched||reduce||document.hidden)return;st.t=(st.t+1)%TRADES.length;if(st.t%2===0)st.a=(st.a+1)%ACC.length;
  var nm={hvac:'Sunrise Heating and Air',plumb:'Sunrise Plumbing',land:'Sunrise Landscaping',roof:'Sunrise Roofing',clean:'Sunrise Cleaning Co',auto:'Sunrise Auto Detail',salon:'Sunrise Hair Studio'};st.name=nm[TRADES[st.t].k];$('#bn').value=st.name;render()},4600);

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
/* designs */
var DES=[
 {id:'desert',n:'Desert Breeze HVAC',trade:'Heating and cooling',url:'/websites/hvac',p:'A thermostat dial you can drag, a quick "is my AC dying" quiz and a savings calculator. Built for emergency calls and quote requests.',tags:['Interactive dial','Quote quiz','Savings calculator','Tap to call']},
 {id:'copper',n:'Copperline Plumbing',trade:'Plumbing',url:'/websites/plumbing',p:'A copper pipe that draws itself as you scroll, an emergency triage tool and a find-your-shutoff-valve guide. Bold, trustworthy, easy to read.',tags:['Scroll-drawn pipe','Emergency triage','Shutoff guide','Request form']},
 {id:'green',n:'Greenway Landscaping',trade:'Landscaping',url:'/websites/landscaping',p:'A photo yard builder where visitors add real pools, patios and pergolas and watch a price range add up. Includes a plant picker and care calendar.',tags:['Photo yard builder','Price range','Plant picker','Care calendar']}];
var di=0,prog=0,playing=!reduce,lastT=0,pick=null;
var dl=$('#dlist');DES.forEach(function(d,i){var b=document.createElement('button');b.type='button';b.className='drow';b.setAttribute('role','tab');b.innerHTML='<span class="n">0'+(i+1)+'</span><span class="nm">'+d.n+'</span><span class="tr">'+d.trade+'</span>';b.addEventListener('click',function(){di=i;prog=0;setDes()});var inf=document.createElement('div');inf.className='dinfo';inf.id='di'+i;inf.innerHTML='<p>'+d.p+'</p><ul class="tags">'+d.tags.map(function(t){return '<li>'+t+'</li>'}).join('')+'</ul><div class="dcta"><a class="btn btn-y" href="'+d.url+'">View it live <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg></a><a class="btn" href="/start?website=build">Order a website</a></div>';dl.appendChild(b);dl.appendChild(inf)});
function setDes(){var d=DES[di];$$('#dlist .drow').forEach(function(b,i){b.setAttribute('aria-selected',i===di)});
  $('#imD').src=IMG[d.id+'_d'];$('#imD').alt=d.n+' on a desktop computer';$('#imM').src=IMG[d.id+'_m'];$('#imM').alt=d.n+' on a phone';apply()}
function apply(){function mv(vp,im){var over=Math.max(0,im.offsetHeight-vp.offsetHeight);im.style.transform='translateY('+(-over*prog/100)+'px)'}
  mv($('#vpD'),$('#imD'));mv($('#vpM'),$('#imM'));$('#scr').value=prog}
['imD','imM'].forEach(function(id){$('#'+id).addEventListener('load',apply)});
$('#scr').addEventListener('input',function(e){prog=+e.target.value;playing=false;setPlay();apply()});
function setPlay(){var b=$('#play');b.setAttribute('aria-label',playing?'Pause auto scroll':'Play auto scroll');b.innerHTML=playing?'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>':'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>'}
$('#play').addEventListener('click',function(){playing=!playing;setPlay()});
var dir=1,vis=false;HIO(function(es){vis=es[0].isIntersecting}).observe($('.dz-stage'));
(function loop(t){if(playing&&vis){var dt=lastT?Math.min(50,t-lastT):0;prog+=dir*dt*0.0042;if(prog>=100){prog=100;dir=-1}else if(prog<=0){prog=0;dir=1}apply()}lastT=t;HRAF(loop)})(0);
setDes();setPlay();HON(window,'resize',apply);
/* pricing */
var TIERS=CFG.tiers,SETUP=CFG.setup,TRIAL=CFG.trial;
var P={up:false,rv:false,t:0,loc:1},shown={vToday:299,vMonth:0,vYear:299},raf={};
var money=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
function roll(id,to){var el=$('#'+id),from=shown[id];cancelAnimationFrame(raf[id]);if(reduce){el.textContent=money(to);shown[id]=to;return}
  var t0=performance.now();(function f(n){var p=Math.min(1,(n-t0)/450),e=1-Math.pow(1-p,3);el.textContent=money(from+(to-from)*e);if(p<1)raf[id]=HRAF(f);else shown[id]=to})(t0)}
var tr=$('#tier');TIERS.forEach(function(t,i){var b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',i===0);b.innerHTML='<b>$'+t.p+'</b><small>'+t.n+'<br>'+t.r+' requests</small>';b.addEventListener('click',function(){P.t=i;calc()});tr.appendChild(b)});
$('#tUp').addEventListener('click',function(){P.up=!P.up;calc()});
$('#tRv').addEventListener('click',function(){P.rv=!P.rv;calc()});
$('#lm').addEventListener('click',function(){P.loc=Math.max(1,P.loc-1);calc()});$('#lp').addEventListener('click',function(){P.loc=Math.min(20,P.loc+1);calc()});
function calc(){var T=TIERS[P.t],rv=P.rv?T.p*P.loc:0,month=(P.up?99:0)+rv,setup=P.rv?SETUP:0,year=299+month*12+setup;
  $('#tUp').setAttribute('aria-checked',P.up);$('#tRv').setAttribute('aria-checked',P.rv);$('#oUp').classList.toggle('on',P.up);$('#oRv').classList.toggle('on',P.rv);
  $$('#tier button').forEach(function(b,i){b.setAttribute('aria-pressed',i===P.t)});$('#ln').textContent=P.loc;$('#rvp').innerHTML='$'+T.p+'<small>per location, per month</small>';
  $('#lUp').classList.toggle('off',!P.up);$('#lRv').classList.toggle('off',!P.rv);$('#lSu').classList.toggle('off',!P.rv);
  $('#lRvT').textContent='Reviews '+T.n+(P.loc>1?' x '+P.loc:'');$('#lRvP').textContent=money(rv)+' / mo';
  roll('vToday',299);roll('vMonth',month);roll('vYear',year);
  var n='Just the website. One payment, and you approve it before it goes live.';
  if(P.up&&!P.rv)n='Website now, then $99 a month for hosting, small updates and support. Cancel upkeep any time.';
  if(P.rv)n='The review tool starts with a '+TRIAL+'-day free trial, then it is '+money(rv)+' a month plus a one-time $'+SETUP+' setup fee.'+(P.up?' Upkeep is $99 a month.':'');
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
