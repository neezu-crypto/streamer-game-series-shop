// 몽실이 SVG 리그(상점 분양소 미리보기용). 파츠별 SVG를 스프링으로 움직이고 표정 파츠를 갈아 끼운다.
// 원본 작업물: tamagotchi-art/mongsil/work/v2/mongsil_v3.html (색 4종·표정·효과).
// PRESETS·COLORS_BY_ID는 DOM 없이 읽을 수 있어 Node 테스트가 상호작용 매핑을 검증한다.

import { createFrameGate } from './tamagotchi-gestures.mjs?v=20261112-tg-shop38';

export const PRESETS={
 '기본':{eye:'normal',mouth:'normal',arm:0},
 '기쁨':{eye:'happy',mouth:'open',armPose:'up',fx:'spark'},
 '쓰다듬 받음':{eye:'happy',mouth:'normal',armPose:'fwd',fx:'heart',squash:0.06},
 '졸림':{eye:'sleepy',mouth:'round',armPose:'down',sway:1},
 '잠':{eye:'closed',mouth:'sleep',armPose:'down',fx:'zzz'},
 '시무룩':{eye:'sad',mouth:'pout',armPose:'down',fx:'sweat'},
 '놀람':{eye:'surprised',mouth:'round',armPose:'up'},
 '놀기':{eye:'happy',mouth:'open',armPose:'up',fx:'spark',sway:1,bounce:1},
 '깨어남':{eye:'sleepy',mouth:'round',armPose:'up',squash:0.08},
 '컨디션 저하':{eye:'normal',mouth:'pout',armPose:'down'},
 '아픔':{eye:'sleepy',mouth:'pout',armPose:'down'},
 '쓰러짐':{eye:'dizzy',mouth:'wavy',armPose:'down'},
 '입원':{eye:'closed',mouth:'sleep',armPose:'down'},
 '노래':{eye:'closed',mouth:'round',armPose:'fwd',fx:'note',sway:1},
 '응원':{eye:'star',mouth:'open',armPose:'up',fx:'spark',bounce:1},
 '먹기':{eye:'happy',mouth:'chew',armPose:'fwd',chew:1},
 '털갈이':{eye:'closed',mouth:'normal',armPose:'fwd',fx:'spark',sway:1},
 '보석':{eye:'happy',mouth:'open',armPose:'up',fx:'heart'},
 '목욕':{eye:'closed',mouth:'open',armPose:'fwd',fx:'spark',sway:1},
 '산책':{eye:'normal',mouth:'open',armPose:'down',sway:1,bounce:1},
 '대화':{eye:'normal',mouth:'round',armPose:'fwd',fx:'speech'},
 '춤':{eye:'happy',mouth:'open',armPose:'up',fx:'note',sway:1,bounce:1},
};
export const PRESET_NAMES = Object.keys(PRESETS);
export const COLORS_BY_ID = { cream: ['#FCECD4', '#FCB5B5'], pink: ['#FFD9DF', '#F7A3B1'], mint: ['#D3F0E1', '#FCB5B5'], lavender: ['#E4DBFB', '#FCB5B5'] };

export function createMongsil(container, { color = 'cream', reduced = false } = {}) {
const OUT='#764C37', CREAM='#FCECD4', SW=17;
const NS='http://www.w3.org/2000/svg';
const el=(tag,attrs,parent)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);parent&&parent.append(e);return e;};
const svg=el('svg',{viewBox:'80 20 1250 1100',role:'img','aria-label':'몽실이'});svg.classList.add('tg-pet-svg');container.append(svg);
const C=[661,632];
const pt=(deg,r,c=C)=>[c[0]+r*Math.cos(deg*Math.PI/180),c[1]+r*Math.sin(deg*Math.PI/180)];
function circ3(a,b,c){const d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));
 const ux=((a[0]**2+a[1]**2)*(b[1]-c[1])+(b[0]**2+b[1]**2)*(c[1]-a[1])+(c[0]**2+c[1]**2)*(a[1]-b[1]))/d;
 const uy=((a[0]**2+a[1]**2)*(c[0]-b[0])+(b[0]**2+b[1]**2)*(a[0]-c[0])+(c[0]**2+c[1]**2)*(b[0]-a[0]))/d;return [ux,uy,Math.hypot(a[0]-ux,a[1]-uy)];}
// ---- body: closed fluffy outline of bumps between notches (outer radii measured from the reference) ----
const NOTCH=[[1,469],[20,452],[41,482],[55,470],[83,404],[102,407],[128,476],[141,487],[158,473],[178,444],[199,425],[218,407],[236,412],[252,430],[271,432],[291,435],[308,426],[321,421],[341,430]];
const PEAK=[462,500,488,506,418,520,496,511,493,462,440,425,436,446,450,444,438,443,478];
function bodyPath(){let d='';const ticks=[];
 for(let i=0;i<NOTCH.length;i++){const [a1,r1]=NOTCH[i];let [a2,r2]=NOTCH[(i+1)%NOTCH.length];if(a2<=a1)a2+=360;
  const p1=pt(a1,r1-SW/2),p2=pt(a2,r2-SW/2),pm=pt((a1+a2)/2,PEAK[i]-SW/2);const [,,R]=circ3(p1,pm,p2);
  if(i===0)d+=`M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
  const big=(a2-a1)>200?1:0; d+=` A${R.toFixed(1)} ${R.toFixed(1)} 0 ${big} 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  ticks.push([a2%360,r2]);}
 return [d+'Z',ticks];}
function tickPath([a,r]){ // short fur tick pointing inward at each notch
 const p=pt(a,r-SW/2),q=pt(a+3,r-SW/2-22);return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q${pt(a+0.5,r-18)[0].toFixed(1)} ${pt(a+0.5,r-18)[1].toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;}
// ---- parts ----
const parts={};
const root=el('g',{id:'root'},svg), squash=el('g',{id:'squash'},root);
function part(id,pivot,draw){const g=el('g',{id},squash);g.dataset.px=pivot[0];g.dataset.py=pivot[1];draw(g);parts[id]={g,pivot,a:0,v:0,target:0};return g;}
// tail (behind)
part('tail',[1112,756],g=>{
 // chubby rounded star: soft rounded tips, gently filleted inner corners, slightly uneven arms like a hand drawing
 const c=[1196,750], rot=-104, arms=[116,110,113,108,112], inner=[72,70,73,69,71];
 const P=[];for(let k=0;k<5;k++){P.push({p:pt(rot+k*72,arms[k],c),cut:42,o:true});P.push({p:pt(rot+36+k*72,inner[k],c),cut:18,o:false});}
 const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
 let d='';const n=P.length;
 for(let k=0;k<n;k++){const prv=P[(k-1+n)%n].p,cur=P[k].p,nxt=P[(k+1)%n].p;
  const L1=Math.hypot(cur[0]-prv[0],cur[1]-prv[1]),L2=Math.hypot(nxt[0]-cur[0],nxt[1]-cur[1]);
  const a=lerp(cur,prv,Math.min(0.48,P[k].cut/L1)), b=lerp(cur,nxt,Math.min(0.48,P[k].cut/L2));
  // tips bulge a little outward (fuller, cuter); inner corners are a plain fillet
  const ctl=P[k].o?lerp(cur,[ (cur[0]*2-c[0]*0+c[0])/2, (cur[1]*2-c[1]*0+c[1])/2 ],0):cur;
  const c1=lerp(a,ctl,P[k].o?0.9:0.55), c2=lerp(b,ctl,P[k].o?0.9:0.55);
  d+=(k===0?`M${a[0].toFixed(1)} ${a[1].toFixed(1)}`:` L${a[0].toFixed(1)} ${a[1].toFixed(1)}`)+` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;}
 d+='Z';
 // root that stays tucked under the body when the tail wags (same fill, no visible outline once covered)
 el('path',{d:'M1080 718 C 1105 708 1140 712 1150 750 C 1140 790 1105 796 1080 786 Z',fill:'#FDE9A6'},g);
 el('path',{d,fill:'#FDE9A6',stroke:OUT,'stroke-width':SW,'stroke-linejoin':'round'},g);
 // soft inner shine stroke (flat style, matches the cheek slashes)
 el('path',{d:`M${pt(rot-14,60,c)[0].toFixed(1)} ${pt(rot-14,60,c)[1].toFixed(1)} Q ${pt(rot,74,c)[0].toFixed(1)} ${pt(rot,74,c)[1].toFixed(1)} ${pt(rot+12,62,c)[0].toFixed(1)} ${pt(rot+12,62,c)[1].toFixed(1)}`,fill:'none',stroke:'#FFF6D2','stroke-width':9,'stroke-linecap':'round'},g);
});
// ears (behind)
for(const [id,cx,cy,R,px,py,pk] of [['earL',365,314,150,470,400,[357,312,80,76]],['earR',994,302,141,870,395,[997,312,78,77]]])
 part(id,[px,py],g=>{el('circle',{cx,cy,r:R,class:'bf',fill:CREAM,stroke:OUT,'stroke-width':SW},g);el('ellipse',{cx:pk[0],cy:pk[1],rx:pk[2],ry:pk[3],class:'ein',fill:'#FCB5B5'},g);});
// tuft (behind the head, complete shape)
part('tuft',[655,250],g=>{const L=[[655,128,78],[566,200,48],[752,168,46],[700,215,40],[610,232,40]];
 for(const [x,y,r] of L)el('circle',{cx:x,cy:y,r,fill:OUT,stroke:OUT,'stroke-width':SW*2},g);
 for(const [x,y,r] of L)el('circle',{cx:x,cy:y,r,class:'bf',fill:CREAM},g);
 el('path',{d:'M598 118 C 600 70 690 55 712 110 C 728 150 690 168 668 150',fill:'none',stroke:OUT,'stroke-width':13,'stroke-linecap':'round'},g);
 el('path',{d:'M548 214 C 560 236 600 240 622 226',fill:'none',stroke:OUT,'stroke-width':12,'stroke-linecap':'round'},g);});
// body
part('body',[661,1075],g=>{const [d,ticks]=bodyPath();el('path',{d,class:'bf',fill:CREAM,stroke:OUT,'stroke-width':SW,'stroke-linejoin':'round'},g);
 for(const t of ticks)el('path',{d:tickPath(t),fill:'none',stroke:OUT,'stroke-width':11,'stroke-linecap':'round'},g);});
// arms (front)
for(const [id,cx,cy,rot,px,py] of [['armL',351,771,-18,330,715],['armR',971,774,18,990,718]])
 part(id,[px,py],g=>el('ellipse',{cx,cy,rx:63,ry:57,transform:`rotate(${rot} ${cx} ${cy})`,class:'bf',fill:CREAM,stroke:OUT,'stroke-width':SW},g));
// face
part('cheeks',[661,613],g=>{for(const cx of [418,926]){el('ellipse',{cx,cy:613,rx:74,ry:52,fill:'#FCB7B7'},g);
 for(const dx of [-30,0,30])el('path',{d:`M${cx+dx-6} ${625} L${cx+dx+8} ${600}`,stroke:'#FB949F','stroke-width':7,'stroke-linecap':'round'},g);}});
part('heart',[671,812],g=>el('path',{d:'M671 874 C 612 828 594 802 594 780 C594 758 612 748 632 748 C650 748 664 758 671 772 C678 758 692 748 710 748 C730 748 748 758 748 780 C748 802 730 828 671 874Z',fill:'#FCA1AA'},g));
const DARK='#463328', HI='#FCFCFC', MOUTHIN='#8A4A3E';
function variants(id,pivot,defs){const g=part(id,pivot,()=>{});for(const k in defs){const v=el('g',{'data-v':k},g);defs[k](v);v.style.display=k==='normal'?'':'none';}return g;}
function sparkle(g,x,y,r,f){el('path',{d:`M${x} ${y-r} Q${x+r*0.18} ${y-r*0.18} ${x+r} ${y} Q${x+r*0.18} ${y+r*0.18} ${x} ${y+r} Q${x-r*0.18} ${y+r*0.18} ${x-r} ${y} Q${x-r*0.18} ${y-r*0.18} ${x} ${y-r}Z`,fill:f},g);}
for(const [id,cx,h1,h2,side] of [['eyeL',504,[493,495,19],[529,532,12],-1],['eyeR',838,[822,495,18],[859,533,12],1]]){
 const line=(g,d,w=15)=>el('path',{d,fill:'none',stroke:DARK,'stroke-width':w,'stroke-linecap':'round','stroke-linejoin':'round'},g);
 variants(id,[cx,521],{
  normal:g=>{el('ellipse',{cx,cy:521,rx:62,ry:64,fill:DARK},g);el('circle',{cx:h1[0],cy:h1[1],r:h1[2],fill:HI},g);el('circle',{cx:h2[0],cy:h2[1],r:h2[2],fill:HI},g);},
  happy:g=>line(g,`M${cx-50} 540 Q${cx} 470 ${cx+50} 540`),
  closed:g=>line(g,`M${cx-52} 522 Q${cx} 568 ${cx+52} 522`),
  sleepy:g=>{line(g,`M${cx-48} 528 Q${cx} 552 ${cx+48} 528`,13);line(g,`M${cx+side*44} 520 L${cx+side*60} 512`,9);},
  sad:g=>{el('ellipse',{cx,cy:526,rx:58,ry:58,fill:DARK},g);el('circle',{cx:h1[0],cy:h1[1]+12,r:16,fill:HI},g);el('circle',{cx:h2[0],cy:h2[1]+6,r:10,fill:HI},g);
   el('path',{d:`M${cx+side*-6} 450 L${cx+side*-54} 438`,fill:'none',stroke:'#764C37','stroke-width':11,'stroke-linecap':'round'},g);},
  surprised:g=>{el('ellipse',{cx,cy:518,rx:56,ry:72,fill:DARK},g);el('circle',{cx:cx-14,cy:488,r:14,fill:HI},g);el('circle',{cx:cx+18,cy:540,r:8,fill:HI},g);},
  dizzy:g=>line(g,`M${cx} 521 m -8 0 a 8 8 0 1 1 16 0 a 16 16 0 1 1 -32 0 a 26 26 0 1 1 52 0 a 36 36 0 1 1 -72 0`,10),
  star:g=>{el('ellipse',{cx,cy:521,rx:62,ry:64,fill:DARK},g);sparkle(g,cx-4,515,40,HI);el('circle',{cx:cx+30,cy:550,r:9,fill:HI},g);},
 });}
const ML=(g,d,w=12)=>el('path',{d,fill:'none',stroke:OUT,'stroke-width':w,'stroke-linecap':'round','stroke-linejoin':'round'},g);
variants('mouth',[671,568],{
 normal:g=>ML(g,'M614 551 C 616 590 656 594 671 558 C 686 594 726 590 728 551'),
 open:g=>{el('path',{d:'M618 552 Q 671 556 724 552 Q 718 628 671 630 Q 624 628 618 552 Z',fill:MOUTHIN,stroke:OUT,'stroke-width':11,'stroke-linejoin':'round'},g);el('path',{d:'M640 612 Q 671 588 702 612 Q 690 628 671 629 Q 652 628 640 612Z',fill:'#F49AA6'},g);},
 round:g=>el('ellipse',{cx:671,cy:578,rx:28,ry:33,fill:MOUTHIN,stroke:OUT,'stroke-width':11},g),
 pout:g=>ML(g,'M632 584 Q 671 552 710 584'),
 sleep:g=>el('ellipse',{cx:671,cy:576,rx:14,ry:16,fill:MOUTHIN,stroke:OUT,'stroke-width':9},g),
 chew:g=>ML(g,'M626 562 C 630 586 656 588 671 566 C 686 588 712 586 716 562'),
 wavy:g=>ML(g,'M618 578 Q 636 556 653 578 Q 671 600 689 578 Q 706 556 724 578'),
});
// 건강 상태 소품: 얼음주머니·체온계·반창고·이불(상태에 따라 보이기)
const acc=part('acc',[661,600],()=>{});const accs={};
function accItem(k,draw){const g=el('g',{'data-acc':k},acc);g.style.display='none';draw(g);accs[k]=g;}
accItem('blanket',g=>{el('path',{d:'M250 800 Q 661 700 1072 800 L 1080 1050 Q 661 1110 242 1050 Z',fill:'#CFE6F5',stroke:OUT,'stroke-width':14,'stroke-linejoin':'round'},g);
 el('path',{d:'M262 860 Q 661 770 1062 860',fill:'none',stroke:'#FFFFFF','stroke-width':26,'stroke-linecap':'round'},g);
 el('path',{d:'M262 860 Q 661 770 1062 860',fill:'none',stroke:'#A9CDE6','stroke-width':6,'stroke-linecap':'round','stroke-dasharray':'2 22'},g);});
accItem('ice',g=>{el('rect',{x:575,y:378,width:190,height:78,rx:36,fill:'#BFE3F2',stroke:OUT,'stroke-width':11},g);
 el('rect',{x:752,y:396,width:40,height:42,rx:10,fill:'#F7D77A',stroke:OUT,'stroke-width':9},g);
 el('path',{d:'M605 402 Q 625 392 650 396',fill:'none',stroke:'#FFFFFF','stroke-width':10,'stroke-linecap':'round'},g);});
accItem('thermo',g=>{el('line',{x1:700,y1:582,x2:842,y2:656,stroke:OUT,'stroke-width':30,'stroke-linecap':'round'},g);
 el('line',{x1:700,y1:582,x2:842,y2:656,stroke:'#FFFFFF','stroke-width':16,'stroke-linecap':'round'},g);
 el('line',{x1:705,y1:585,x2:770,y2:619,stroke:'#F27A7A','stroke-width':7,'stroke-linecap':'round'},g);});
accItem('bandage',g=>{for(const r of [35,-35])el('rect',{x:770,y:330,width:130,height:40,rx:16,fill:'#F9D7B5',stroke:OUT,'stroke-width':9,transform:`rotate(${r} 835 350)`},g);
 el('rect',{x:818,y:337,width:34,height:26,rx:6,fill:'#F3C49A'},g);});
// 목욕 거품: 몸에 붙어 쌓이고, 목욕을 멈추면 천천히 사라진다(얼굴은 피한다).
const foamG=el('g',{id:'foam'},squash); let foamLevel=0, foamAt=-9;
function addFoam(){
  if(foamG.children.length>=36)return;
  let x,y;for(let k=0;k<12;k++){x=400+Math.random()*520;y=280+Math.random()*700;if(!(x>470&&x<870&&y>420&&y<650))break;}
  const g=el('g',{transform:`translate(${x.toFixed(0)} ${y.toFixed(0)})`},foamG);const r=18+Math.random()*16;
  for(const [dx,dy,k] of [[0,0,1],[r*0.9,r*0.2,0.7],[-r*0.8,r*0.3,0.65],[r*0.2,-r*0.7,0.6]])el('circle',{cx:dx,cy:dy,r:r*k,fill:'#FFFFFF',stroke:'#BFE3EE','stroke-width':4},g);
  el('circle',{cx:-r*0.3,cy:-r*0.3,r:r*0.18,fill:'#EAF7FB'},g);
}
// effects layer (above everything, not squashed)
const fx=el('g',{id:'fx'},svg);
function burst(kind){const items={heart:['#FF8FA3',6],note:[OUT,4],zzz:[OUT,3],spark:['#FFD45E',6],sweat:['#9FD3F0',1],bubble:['#FFFFFF',3],cloud:['#B9B4C2',2],speech:['#FFFFFF',1]}[kind];
 for(let n=0;n<items[1];n++){const g=el('g',{},fx);const left=n%2===0; let x=left?360+Math.random()*120:840+Math.random()*120;let y0=300+Math.random()*80;
  if(kind==='heart')el('path',{d:'M0 22 C -18 8 -22 0 -22 -6 C -22 -14 -15 -18 -9 -18 C -4 -18 -1 -15 0 -11 C 1 -15 4 -18 9 -18 C 15 -18 22 -14 22 -6 C 22 0 18 8 0 22Z',fill:items[0],stroke:OUT,'stroke-width':4},g);
  if(kind==='note'){el('path',{d:'M6 -26 L6 10',stroke:OUT,'stroke-width':6,'stroke-linecap':'round'},g);el('ellipse',{cx:-2,cy:12,rx:10,ry:8,fill:OUT},g);el('path',{d:'M6 -26 Q 20 -20 18 -6',fill:'none',stroke:OUT,'stroke-width':6,'stroke-linecap':'round'},g);}
  if(kind==='zzz'){const t=el('text',{x:0,y:0,'font-size':46+n*12,'font-weight':800,'font-family':'Arial Rounded MT Bold, sans-serif',fill:'#FFFFFF',stroke:OUT,'stroke-width':6,'paint-order':'stroke'},g);t.textContent='Z';}
  if(kind==='spark')sparkle(g,0,0,18,items[0]);
  if(kind==='bubble'){const r=6+Math.random()*6;el('circle',{r,fill:'rgba(255,255,255,.75)',stroke:'#8FC8D6','stroke-width':2.5},g);el('path',{d:`M${-r*0.5} ${-r*0.1} Q ${-r*0.45} ${-r*0.5} ${-r*0.05} ${-r*0.6}`,fill:'none',stroke:'#fff','stroke-width':2.5,'stroke-linecap':'round'},g);}
  if(kind==='speech'){const words=['😊','💕','🎵','😆','✨','🍀','😮','👍','🌸','😋'];const w=words[Math.floor(Math.random()*words.length)];const bw=44;
   el('path',{d:`M${-bw/2} -30 H ${bw/2} Q ${bw/2+14} -30 ${bw/2+14} -16 V 10 Q ${bw/2+14} 24 ${bw/2} 24 H 8 L -6 40 L -4 24 H ${-bw/2} Q ${-bw/2-14} 24 ${-bw/2-14} 10 V -16 Q ${-bw/2-14} -30 ${-bw/2} -30 Z`,fill:'#FFFFFF',stroke:OUT,'stroke-width':5,'stroke-linejoin':'round'},g);
   const t=el('text',{x:0,y:8,'text-anchor':'middle','dominant-baseline':'middle','font-size':32,'font-family':'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif'},g);t.textContent=w;}
  if(kind==='cloud'){el('path',{d:'M-34 10 Q -40 -12 -18 -14 Q -12 -32 8 -26 Q 24 -36 34 -18 Q 50 -14 44 6 Q 46 20 28 20 L -26 20 Q -42 22 -34 10 Z',fill:items[0],stroke:OUT,'stroke-width':5,opacity:.85},g);}
  if(kind==='sweat'){el('path',{d:'M0 -20 Q 14 0 10 10 Q 0 20 -10 10 Q -14 0 0 -20Z',fill:items[0],stroke:OUT,'stroke-width':4},g);}
  if(kind==='speech'){x=Math.random()<0.5?380+Math.random()*80:880+Math.random()*80;y0=260+Math.random()*60;}
  if(kind==='bubble'){x=left?340+Math.random()*160:820+Math.random()*160;y0=560+Math.random()*260;}
  const born=performance.now()/1000+n*(kind==='bubble'?0.12:0.22), life=kind==='sweat'?1.4:1.8, dx=kind==='zzz'?50+n*30:(left?-50:50)*Math.random(), sx=kind==='sweat'?905:x, sy=kind==='sweat'?380:y0, base=kind==='zzz'?[900,300-n*30]:null;
  g.dataset.anim=JSON.stringify({born,life,dx,sx:base?base[0]:sx,sy:base?base[1]:sy});}}
function stepFx(t){for(const g of [...fx.children]){const a=g._anim||(g._anim=JSON.parse(g.dataset.anim));const u=(t-a.born)/a.life;if(u<0){g.style.opacity=0;continue;}if(u>1){g.remove();continue;}
 const e=1-(1-u)*(1-u); const rise=a.rise!=null?a.rise:(a.sx===905?-60:200); g.setAttribute('transform',`translate(${a.sx+a.dx*e} ${a.sy-rise*e}) scale(${(1.4+1.2*Math.min(1,u*4)).toFixed(3)})`); g.style.opacity=u<0.15?u/0.15:1-Math.max(0,(u-0.6)/0.4);}}
let chewShown='', cur=PRESETS['기본'], swapAt=-9, pending=null, armK=1, armFrom=null, armPrev=[0,0,0], armNow=[0,0,0];
function show(id,v){for(const n of parts[id].g.children)n.style.display=n.dataset.v===v?'':'none';}
function applyPreset(name,quiet=false){pending=PRESETS[name];swapAt=performance.now()/1000;if(!quiet){fx.replaceChildren();if(pending.fx)burst(pending.fx);}}
let cycling=false,cycleAt=0,ci=0,running=false,stopped=false,activeUntil=0;
const setColor=(c)=>{const v=COLORS_BY_ID[c]||COLORS_BY_ID.cream;svg.style.setProperty('--body',v[0]);svg.style.setProperty('--ein',v[1]);};
const P={wiggle:5,lag:1,tail:9,arm:8,breathe:3};
// ---- motion: body drives, ears/tuft/tail follow with springs (secondary motion) ----
let hopT=-9, petT=-9;
// 공 놀이처럼 펫이 포인터를 따라가는 동작: 목표(-1~1)를 향해 부드럽게 몸을 기울이고 이동하며 눈이 따라간다.
let chaseT=[0,0], chaseC=[0,0];
let prev=performance.now()/1000, prevY=0, prevS=1, blinkAt=1;
const setRot=(id,a)=>{const p=parts[id];p.g.setAttribute('transform',`rotate(${a.toFixed(2)} ${p.pivot[0]} ${p.pivot[1]})`);};
let rectCache=null, rectAt=-1, lowPower=false; const gate=createFrameGate(30);
// 저전력(크게 보기 가로)일 때는 상호작용 중에도 초당 30번만 그린다. 기본·세로는 매 프레임(원본 화질).
function step(){const t=performance.now()/1000;
 if(lowPower&&!reduced&&!gate.shouldDraw(t)){requestAnimationFrame(step);return;} rectAt=-1;
 const dt=Math.min(0.05,t-prev);prev=t;
 // body: breathing squash + hop (anticipation squash -> jump -> landing squash)
 const br=cond==='down'||cond==='hospital'?0.9:cond==='ok'?2.4:1.6; let s=1+P.breathe/100*Math.sin(t*br), y=0;
 const h=t-hopT; if(h>=0&&h<1.1){ if(h<0.15){s-=0.10*Math.sin(h/0.15*Math.PI/2);} else if(h<0.75){const u=(h-0.15)/0.6;y=-150*Math.sin(u*Math.PI);s+=0.06*Math.sin(u*Math.PI);} else {const u=(h-0.75)/0.35;s-=0.12*Math.sin(u*Math.PI);} }
 if(cur.squash)s-=cur.squash*Math.abs(Math.sin(t*5)); if(cur.bounce)y-=40*Math.abs(Math.sin(t*5));
 const pp=t-petT; if(pp>=0&&pp<1.2){s-=0.07*Math.sin(pp/1.2*Math.PI)*Math.abs(Math.sin(pp*12));}
 const vy=(y-prevY)/dt, vs=(s-prevS)/dt; prevY=y; prevS=s;
 chaseC[0]+=(chaseT[0]-chaseC[0])*Math.min(1,dt*5); chaseC[1]+=(chaseT[1]-chaseC[1])*Math.min(1,dt*5);
 const gx=Math.max(-1,Math.min(1,chaseC[0]/130)), gy=Math.max(-1,Math.min(1,chaseC[1]/40));
 lieA+=(lieT-lieA)*Math.min(1,dt*4); const shiver=cond==='sick'?3*Math.sin(t*38):0;
 root.setAttribute('transform',`translate(${(chaseC[0]+shiver).toFixed(1)} ${(y+chaseC[1]+Math.abs(lieA)*0.9).toFixed(1)}) rotate(${(gx*3).toFixed(2)} 661 1075) rotate(${lieA.toFixed(2)} 661 640)`);
 fx.setAttribute('transform',`translate(${chaseC[0].toFixed(1)} ${chaseC[1].toFixed(1)})`); // 반짝이·하트도 펫과 함께 이동
 squash.setAttribute('transform',`translate(661 1075) scale(${(2-s).toFixed(4)} ${s.toFixed(4)}) translate(-661 -1075)`);
 // springs
 const drive={earL:-1,earR:1,tuft:0.7,tail:0};
 for(const id of ['earL','earR','tuft','tail']){const p=parts[id];
  let target=id==='tail'?P.tail*Math.sin(t*3.1):P.wiggle*0.4*Math.sin(t*2.4+ (id==='earR'?0.4:0));
  target+= drive[id]*P.lag*(vy*0.02+vs*-6); target=Math.max(-25,Math.min(25,target));
  const k=90,c=9; p.v+=(k*(target-p.a)-c*p.v)*dt; p.a+=p.v*dt; setRot(id,id==='earL'?-p.a*-1:p.a);}
 // expression swap: quick vertical squish of the face features hides the switch
 if(cycling&&t-cycleAt>2.2){cycleAt=t;const names=Object.keys(PRESETS);applyPreset(names[ci++%names.length]);}
 let faceS=1; const su=t-swapAt; if(su>=0&&su<0.16)faceS=1-0.85*Math.sin(su/0.16*Math.PI);
 // 프레임이 띄엄띄엄 와도(탭 전환·느린 기기) 표정 교체가 빠지지 않게 구간 상한 없이 적용
 if(su>0.08&&pending){cur=pending;pending=null;show('eyeL',cur.eye);show('eyeR',cur.eye);show('mouth',cur.mouth);}
 const sway=cur.sway?6*Math.sin(t*3):0, chew=cur.chew?0.16*Math.abs(Math.sin(t*13)):0;
 // 먹는 동안에는 입을 크게 벌렸다 오므리기를 빠르게 반복한다(표정 전환 중에는 건드리지 않는다).
 if(cur.chew&&!(su>=0&&su<0.16)){const want=Math.sin(t*13)>0?'open':'chew';if(want!==chewShown){chewShown=want;show('mouth',want);}}else chewShown='';
 const AP={down:[0,0,0],up:[22,-150,-30],fwd:[40,-30,20]}; const ap=AP[cur.armPose||'down']; armK+= (1-armK)*Math.min(1,dt*10); 
 if(cur!==armFrom){armFrom=cur;armK=0;armPrev=armNow;} armNow=[0,1,2].map(i=>armPrev[i]+(ap[i]-armPrev[i])*armK);
 for(const [id,sg] of [['armL',1],['armR',-1]]){const p=parts[id],w=P.arm*Math.sin(t*2.4+1)*(cur.armPose==='up'?1.6:1);
  p.g.setAttribute('transform',`translate(${(sg*armNow[0]).toFixed(1)} ${armNow[1].toFixed(1)}) rotate(${(-sg*(armNow[2]+w)).toFixed(2)} ${p.pivot[0]} ${p.pivot[1]})`);}
 const mp=parts.mouth.pivot; parts.mouth.g.setAttribute('transform',`translate(${mp[0]} ${mp[1]}) scale(${1+chew*0.4} ${(1-chew)*faceS}) translate(${-mp[0]} ${-mp[1]})`);
 squash.setAttribute('transform',squash.getAttribute('transform')+` rotate(${sway} 661 1075)`);
 // 거품: 마지막으로 더한 뒤 2초가 지나면 6초에 걸쳐 옅어진다
 if(foamG.children.length){const idle=t-foamAt;foamLevel=idle<2?1:Math.max(0,1-(idle-2)/6);foamG.style.opacity=foamLevel.toFixed(3);if(foamLevel<=0)foamG.replaceChildren();else wake(0.5);}
 stepFx(t);
 // blink
 const b=((t%3.4)<0.13&&cur.eye==='normal'?0.12:1)*faceS; for(const id of ['eyeL','eyeR']){const p=parts[id];p.g.setAttribute('transform',`translate(${(gx*16).toFixed(1)} ${(gy*10).toFixed(1)}) translate(${p.pivot[0]} ${p.pivot[1]}) scale(1 ${b}) translate(${-p.pivot[0]} ${-p.pivot[1]})`);}
running=false; if(!stopped&&(!reduced||performance.now()/1000<activeUntil)){running=true;requestAnimationFrame(step);}}

setColor(color);
const wake=(sec=3.5)=>{activeUntil=performance.now()/1000+sec;if(!running&&!stopped){running=true;prev=performance.now()/1000;requestAnimationFrame(step);}};
let backTimer=0,holdName='';
// 건강 상태: ok / low(컨디션 저하) / sick(아픔) / down(쓰러짐) / hospital(입원). 쉬는 표정·소품·자세가 바뀐다.
let cond='ok',condTimer=0,lieT=0,lieA=0;
const COND={ok:{rest:'기본',acc:[]},low:{rest:'컨디션 저하',acc:[]},sick:{rest:'아픔',acc:['ice','thermo']},down:{rest:'쓰러짐',acc:['bandage']},hospital:{rest:'입원',acc:['bandage']}};
const restName=()=>COND[cond].rest;
// 낮잠: 한 번 재우면 다른 상호작용이 올 때까지 계속 잔다. 깨울 때는 기지개 애니메이션 뒤 요청한 동작을 한다.
let sleeping=false,wakingUntil=0,zzzTimer=0,afterWake=null;
const nowS=()=>performance.now()/1000;
function startWake(){
  sleeping=false;clearInterval(zzzTimer);holdName='';clearTimeout(backTimer);
  wakingUntil=nowS()+1.3;wake(2.5);applyPreset('깨어남');hopT=nowS()+0.35;
  backTimer=setTimeout(()=>{wakingUntil=0;const next=afterWake;afterWake=null;if(next)next();else applyPreset(restName());},1300);
}
const busy=()=>sleeping||nowS()<wakingUntil;
running=true;requestAnimationFrame(step);
const api={
  setColor,
  play(name,{hop=false,seconds=3.2}={}){
    if(!PRESETS[name])return;
    if(busy()){afterWake=()=>api.play(name,{hop,seconds});if(sleeping)startWake();return;}
    cycling=false;wake(seconds+1);holdName='';applyPreset(name);
    if(hop)hopT=performance.now()/1000;
    if(name==='쓰다듬 받음')petT=performance.now()/1000;
    clearTimeout(backTimer);backTimer=setTimeout(()=>applyPreset(restName()),seconds*1000);
  },
  // 도구로 쓰다듬는 동안처럼 이어지는 동작: 같은 프리셋이면 표정을 다시 바꾸지 않고 유지 시간만 늘린다.
  hold(name,seconds=1.2,{quiet=false}={}){
    if(!PRESETS[name])return;
    if(busy()){afterWake=()=>api.hold(name,seconds,{quiet});if(sleeping)startWake();return;}
    cycling=false;wake(seconds+1);
    if(holdName!==name){holdName=name;applyPreset(name,quiet);if(name==='쓰다듬 받음')petT=performance.now()/1000;}
    clearTimeout(backTimer);backTimer=setTimeout(()=>{holdName='';applyPreset(restName());},seconds*1000);
  },
  fx(kind){if(busy())return;wake(2.5);burst(kind);},
  sleep(){
    if(sleeping)return;
    sleeping=true;wakingUntil=0;afterWake=null;holdName='';clearTimeout(backTimer);cycling=false;
    applyPreset('잠');wake(4);clearInterval(zzzTimer);
    zzzTimer=setInterval(()=>{if(!sleeping)return;wake(3);burst('zzz');},2600);
  },
  wakeUp(){if(sleeping)startWake();},
  setLowPower(on){lowPower=!!on;gate.reset();},
  condition(){return cond;},
  setCondition(next){
    if(!COND[next])return;cond=next;sleeping=false;clearInterval(zzzTimer);clearInterval(condTimer);afterWake=null;wakingUntil=0;holdName='';clearTimeout(backTimer);
    for(const k in accs)accs[k].style.display=COND[next].acc.includes(k)?'':'none';
    parts.cheeks.g.style.opacity=next==='ok'?'':next==='low'?'.35':'.15';
    svg.style.filter=next==='down'?'saturate(.4) brightness(.97)':next==='sick'?'saturate(.8)':'';
    lieT=next==='down'?-78:0;
    applyPreset(restName());wake(3);
    const loop={low:['sweat',4200],sick:['sweat',3000],down:['cloud',2600],hospital:['zzz',3200]}[next];
    if(loop)condTimer=setInterval(()=>{wake(3);burst(loop[0]);},loop[1]);
  },
  isSleeping(){return sleeping;},
  // 화면 좌표 위치에 하트 하나를 띄운다(도구가 지나간 자리 표시).
  heartAt(clientX,clientY){
    const m=svg.getScreenCTM();if(!m)return;const p=new DOMPoint(clientX,clientY).matrixTransform(m.inverse());
    if(fx.children.length>40)fx.firstChild.remove();
    const g=el('g',{},fx);const inner=el('g',{transform:'scale(0.55)'},g);
    el('path',{d:'M0 22 C -18 8 -22 0 -22 -6 C -22 -14 -15 -18 -9 -18 C -4 -18 -1 -15 0 -11 C 1 -15 4 -18 9 -18 C 15 -18 22 -14 22 -6 C 22 0 18 8 0 22Z',fill:'#FF8FA3',stroke:OUT,'stroke-width':5},inner);
    g.dataset.anim=JSON.stringify({born:performance.now()/1000,life:1.1,rise:45,dx:(Math.random()-0.5)*24,sx:p.x-chaseC[0],sy:p.y-chaseC[1]});wake(1.5);
  },
  foam(){addFoam();foamAt=performance.now()/1000;wake(9);},
  // 화면 좌표(클라이언트)의 포인터를 향해 최대 maxPx만큼 다가간다. 인자를 비우면 제자리로 돌아온다.
  chase(clientX,clientY,maxPx=36){
    if(clientX!=null&&busy())return;
    if(clientX==null){chaseT=[0,0];wake(1.5);return;}
    const unit=svg.getBoundingClientRect().width/1250||0.35;
    const b=parts.body.g.getBoundingClientRect();
    const bx=b.left+b.width/2-chaseC[0]*unit, by=b.top+b.height/2-chaseC[1]*unit;
    const lim=maxPx/unit;
    const ux=Math.max(-lim,Math.min(lim,(clientX-bx)/unit)), uy=Math.max(-lim*0.3,Math.min(lim*0.3,(clientY-by)/unit*0.3));
    chaseT=[ux,uy];wake(1.5);
  },
  // 몸통 영역(화면 좌표). 도구 동작이 인정되는 곳을 판정할 때 쓴다.
  // 포인터 이동마다 레이아웃을 다시 읽지 않도록 프레임 안에서는 한 번만 잰다.
  bodyRect(){if(rectAt<0||!rectCache){rectCache=parts.body.g.getBoundingClientRect();rectAt=1;}return rectCache;},
  // 입 주변 영역(화면 좌표). 입 모양 그룹의 중심에 몸통 크기에 비례한 여유를 둔 사각형이다.
  mouthRect(){const b=parts.body.g.getBoundingClientRect(),m=parts.mouth.g.getBoundingClientRect();const w=Math.max(m.width*1.5,b.width*0.3),h=Math.max(m.height*2.2,b.height*0.24);const cx=m.left+m.width/2,cy=m.top+m.height/2;return {left:cx-w/2,top:cy-h/2,width:w,height:h};},
  destroy(){stopped=true;clearTimeout(backTimer);clearInterval(zzzTimer);clearInterval(condTimer);svg.remove();},
};
return api;

}
