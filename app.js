(function(){
"use strict";
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const lerp = (a,b,t) => a+(b-a)*t;

/* ============================================================
   狀態
   ============================================================ */
const S = {
  productH:170, cameraH:145, horizonY:0.42,
  baseX:0.52, baseY:0.86,
  sizeAdjust:1, flip:false, keystone:0,
  rotate:0, depth:78, fov:75, sideShade:0.42,
  roomAngle:0, vpMode:false,
  vpPts:[{x:0.05,y:0.97},{x:0.40,y:0.73},{x:0.96,y:0.93},{x:0.62,y:0.73}],
  contactOp:0.88, contactSpread:1,
  shadowDir:205, shadowLen:0.55, shadowSoft:14, shadowOp:0.48,
  refl:0.14,
  harm:0.55, tint:0.22, bright:0, warm:0, trim:1, grain:0.35,
  scene:'balcony', floor:1, lightPos:null, lightMode:false,
  compare:false
};
const DEFAULTS = JSON.parse(JSON.stringify(S));

let roomImg=null, prodImg=null;
let roomSmall=null, roomSmallData=null;   // 取樣用縮圖
let trimC=null, procC=null, sideC=null, lastBox=null;
let usingDemoRoom=true, usingDemoProd=true;

const view = $('view');
const vctx = view.getContext('2d');

/* ============================================================
   小工具
   ============================================================ */
function cvs(w,h){ const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h)); return c; }
const _pool=[];
function pad(i,w,h){
  w=Math.max(1,Math.round(w)); h=Math.max(1,Math.round(h));
  let c=_pool[i];
  if(!c){ c=_pool[i]=cvs(w,h); return c; }
  if(c.width!==w||c.height!==h){ c.width=w; c.height=h; }
  else c.getContext('2d').clearRect(0,0,w,h);
  const x=c.getContext('2d');
  x.globalCompositeOperation='source-over'; x.globalAlpha=1; x.filter='none';
  return c;
}
const COARSE = (()=>{ try{ return matchMedia('(pointer:coarse)').matches; }catch(_){ return false; } })();
const HIT = COARSE ? 2.2 : 1;      // 觸控時放大命中範圍
const blurOK = (()=>{ const c=cvs(2,2).getContext('2d'); c.filter='blur(1px)'; return c.filter!=='none'; })();
function setBlur(ctx,px){ ctx.filter = (blurOK && px>0.2) ? 'blur('+px.toFixed(2)+'px)' : 'none'; }

const noiseTile = (function(){
  const n=cvs(192,192), c=n.getContext('2d'), d=c.createImageData(192,192);
  for(let i=0;i<d.data.length;i+=4){
    const v=128+(Math.random()-0.5)*96;
    d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255;
  }
  c.putImageData(d,0,0); return n;
})();

/* ============================================================
   示範素材 — 讓工具一打開就是可操作狀態
   ============================================================ */
function demoRoom(){
  const W=820,H=1150,c=cvs(W,H),x=c.getContext('2d');
  const floorY=H*0.665;
  // 牆：深色長條磚
  const wg=x.createLinearGradient(0,0,W,floorY);
  wg.addColorStop(0,'#33373b'); wg.addColorStop(.62,'#43484d'); wg.addColorStop(1,'#565b60');
  x.fillStyle=wg; x.fillRect(0,0,W,floorY);
  x.strokeStyle='rgba(20,22,25,.55)'; x.lineWidth=2;
  for(let y=14;y<floorY;y+=26){ x.beginPath(); x.moveTo(0,y); x.lineTo(W,y); x.stroke(); }
  x.lineWidth=1.4;
  for(let r=0,y=14;y<floorY;y+=26,r++){
    for(let px=(r%2?0:46);px<W;px+=92){ x.beginPath(); x.moveTo(px,y); x.lineTo(px,y+26); x.stroke(); }
  }
  // 窗
  x.fillStyle='#22262a'; x.fillRect(46,H*0.20,300,H*0.20);
  x.fillStyle='#b9ad97'; x.fillRect(58,H*0.21,276,H*0.18);
  x.fillStyle='#22262a'; x.fillRect(188,H*0.20,12,H*0.20);
  // 地板：透視地磚
  const fg=x.createLinearGradient(0,floorY,W*0.8,H);
  fg.addColorStop(0,'#8b8b86'); fg.addColorStop(.5,'#a3a29c'); fg.addColorStop(1,'#c2c0b8');
  x.fillStyle=fg; x.fillRect(0,floorY,W,H-floorY);
  x.strokeStyle='rgba(90,90,86,.5)'; x.lineWidth=1.6;
  const vpX=W*0.46, vpY=H*0.40;
  for(let i=-7;i<=14;i++){ const fx=i*130; x.beginPath(); x.moveTo(vpX,vpY); x.lineTo(fx,H); x.stroke(); }
  for(let d=1;d<=9;d++){ const y=floorY+(H-floorY)*Math.pow(d/9,1.9); x.beginPath(); x.moveTo(0,y); x.lineTo(W,y); x.stroke(); }
  // 右側光斑
  const sp=x.createRadialGradient(W*0.78,H*0.93,10,W*0.78,H*0.93,W*0.55);
  sp.addColorStop(0,'rgba(255,252,240,.30)'); sp.addColorStop(1,'rgba(255,252,240,0)');
  x.fillStyle=sp; x.fillRect(0,floorY,W,H-floorY);
  // 顆粒
  const nd=x.getImageData(0,0,W,H);
  for(let i=0;i<nd.data.length;i+=4){
    const n=(Math.random()-0.5)*13;
    nd.data[i]+=n; nd.data[i+1]+=n; nd.data[i+2]+=n;
  }
  x.putImageData(nd,0,0);
  return c;
}
function demoProduct(){
  const W=520,H=1470,c=cvs(W,H),x=c.getContext('2d');
  const r=16;
  function rr(a,b,w,h,rad){ x.beginPath(); x.moveTo(a+rad,b); x.arcTo(a+w,b,a+w,b+h,rad); x.arcTo(a+w,b+h,a,b+h,rad); x.arcTo(a,b+h,a,b,rad); x.arcTo(a,b,a+w,b,rad); x.closePath(); }
  const g=x.createLinearGradient(0,0,W,0);
  g.addColorStop(0,'#3c4045'); g.addColorStop(.42,'#5a5f65'); g.addColorStop(.72,'#6a7076'); g.addColorStop(1,'#42464b');
  rr(0,0,W,H,r); x.fillStyle=g; x.fill();
  // 上下門圈
  [0.255,0.735].forEach((cy,i)=>{
    const R=W*0.30, px=W*0.53, py=H*cy;
    const rg=x.createRadialGradient(px-R*0.3,py-R*0.35,R*0.1,px,py,R);
    rg.addColorStop(0,'#2a2d31'); rg.addColorStop(.75,'#17191c'); rg.addColorStop(1,'#101214');
    x.beginPath(); x.arc(px,py,R,0,7); x.fillStyle=rg; x.fill();
    const ig=x.createRadialGradient(px-R*0.25,py-R*0.3,R*0.05,px,py,R*0.72);
    ig.addColorStop(0,'#5d646b'); ig.addColorStop(.6,'#2e3237'); ig.addColorStop(1,'#1b1e21');
    x.beginPath(); x.arc(px,py,R*0.72,0,7); x.fillStyle=ig; x.fill();
    x.beginPath(); x.arc(px,py,R*0.44,0,7); x.fillStyle=i?'#23262a':'#1e2125'; x.fill();
    x.strokeStyle='rgba(255,255,255,.14)'; x.lineWidth=3;
    x.beginPath(); x.arc(px,py,R*0.86,Math.PI*1.05,Math.PI*1.75); x.stroke();
  });
  // 控制面板帶
  x.fillStyle='#16181b'; x.fillRect(0,H*0.475,W,H*0.055);
  x.fillStyle='rgba(215,220,226,.55)';
  for(let i=0;i<5;i++) x.fillRect(W*(0.22+i*0.12),H*0.498,16,4);
  // 左側面板線條
  x.strokeStyle='rgba(255,255,255,.07)'; x.lineWidth=5;
  for(let i=0;i<3;i++){
    const px=W*(0.09+i*0.085);
    x.beginPath(); x.moveTo(px,H*0.06); x.lineTo(px,H*0.44); x.stroke();
    x.beginPath(); x.moveTo(px,H*0.55); x.lineTo(px,H*0.94); x.stroke();
  }
  // 頂部高光
  x.fillStyle='rgba(255,255,255,.10)'; rr(0,0,W,10,4); x.fill();
  return c;
}

/* ============================================================
   影像處理管線：原圖 →[邊緣修整]→ trimC →[色調]→ procC → silC / reflC
   ============================================================ */
function rebuildTrim(){
  if(!prodImg) return;
  const w=prodImg.width, h=prodImg.height;
  trimC=cvs(w,h);
  const c=trimC.getContext('2d');
  c.drawImage(prodImg,0,0);
  const r=S.trim|0;
  if(r>0){
    const d=c.getImageData(0,0,w,h), a=d.data;
    // 可分離最小值濾波（腐蝕 alpha）→ 去除去背殘留的外框像素
    const tmp=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++){
      const o=y*w;
      for(let x2=0;x2<w;x2++){
        let m=255;
        for(let k=-r;k<=r;k++){
          const xx=x2+k; if(xx<0||xx>=w){ m=0; break; }
          const v=a[(o+xx)*4+3]; if(v<m) m=v;
        }
        tmp[o+x2]=m;
      }
    }
    for(let x2=0;x2<w;x2++){
      for(let y=0;y<h;y++){
        let m=255;
        for(let k=-r;k<=r;k++){
          const yy=y+k; if(yy<0||yy>=h){ m=0; break; }
          const v=tmp[yy*w+x2]; if(v<m) m=v;
        }
        a[(y*w+x2)*4+3]=m;
      }
    }
    c.putImageData(d,0,0);
  }
  autoCrop();
}

/* 去背圖常帶透明邊界。不裁掉的話「圖高＝商品高」的前提不成立，
   比例會整個算錯，側面取樣也會取到空白。 */
function autoCrop(){
  const w=trimC.width, h=trimC.height;
  const a=trimC.getContext('2d').getImageData(0,0,w,h).data;
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++){
    const o=y*w;
    for(let x=0;x<w;x++){
      if(a[(o+x)*4+3]>8){
        if(x<x0)x0=x; if(x>x1)x1=x;
        if(y<y0)y0=y; if(y>y1)y1=y;
      }
    }
  }
  if(x1<x0||y1<y0) return;
  if(x0===0&&y0===0&&x1===w-1&&y1===h-1) return;
  const cw=x1-x0+1, ch=y1-y0+1;
  const c=cvs(cw,ch);
  c.getContext('2d').drawImage(trimC,x0,y0,cw,ch,0,0,cw,ch);
  trimC=c;
}

function regionStats(){
  // 取樣商品即將落點周圍的環境色，而非整張照片 —— 暗角裡的商品該偏暗
  if(!roomSmallData) return null;
  const {data,w,h}=roomSmallData;
  const g=geom(1);
  const cx=(S.baseX)*w, cy=(S.baseY-((g.drawH/g.H)*0.5))*h;
  const rad=Math.max(6, Math.round(w*0.34));
  const x0=clamp(Math.round(cx-rad),0,w-1), x1=clamp(Math.round(cx+rad),0,w-1);
  const y0=clamp(Math.round(cy-rad),0,h-1), y1=clamp(Math.round(cy+rad),0,h-1);
  let n=0, s=[0,0,0], q=[0,0,0];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const i=(y*w+x)*4;
    for(let c=0;c<3;c++){ const v=data[i+c]; s[c]+=v; q[c]+=v*v; }
    n++;
  }
  if(!n) return null;
  const mean=s.map(v=>v/n);
  const std=q.map((v,c)=>Math.sqrt(Math.max(1,v/n-mean[c]*mean[c])));
  let ys=0,yq=0;
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const i=(y*w+x)*4;
    const Y=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
    ys+=Y; yq+=Y*Y;
  }
  const my=ys/n;
  return {mean,std,my,sy:Math.sqrt(Math.max(1,yq/n-my*my))};
}

function rebuildProc(){
  if(!trimC) return;
  const w=trimC.width, h=trimC.height;
  procC=cvs(w,h);
  const c=procC.getContext('2d');
  c.drawImage(trimC,0,0);

  const d=c.getImageData(0,0,w,h), a=d.data;
  /* 曝光與色度必須分開處理。
     舊版把商品的「每個通道平均」整個搬向環境色，結果銀色機身在暖色木地板旁
     會被染成米黃。現在改成：亮度（曝光/黑階/對比）完整匹配，色偏則只做
     小幅度且有上限的位移，中性色永遠保持中性。 */
  let n=0, sy=0, qy=0, sc=[0,0,0];
  for(let i=0;i<a.length;i+=4){
    if(a[i+3]<140) continue;
    const Y=0.299*a[i]+0.587*a[i+1]+0.114*a[i+2];
    sy+=Y; qy+=Y*Y;
    sc[0]+=a[i]; sc[1]+=a[i+1]; sc[2]+=a[i+2];
    n++;
  }
  const room=regionStats();
  let gY=1, offY=0, cast=[0,0,0];
  if(n>0 && room){
    const my=sy/n, stdy=Math.sqrt(Math.max(1,qy/n-my*my));
    const pm=sc.map(v=>v/n);
    if(S.harm>0){
      gY=lerp(1, clamp(room.sy/stdy,0.78,1.28), S.harm*0.5);
      offY=lerp(my, room.my, S.harm*0.6) - my*gY;
    }
    if(S.tint>0){
      // 色偏＝各通道相對自身亮度的偏移量；只搬「偏移量的差」，並且上限 ±14
      const CAP=14;
      for(let k=0;k<3;k++){
        const roomCast=room.mean[k]-room.my, prodCast=pm[k]-my;
        cast[k]=clamp((roomCast-prodCast)*S.tint, -CAP, CAP);
      }
    }
  }
  const b=S.bright, wm=S.warm;
  const add=[b+wm*0.75+cast[0], b+cast[1], b-wm*0.85+cast[2]];
  if(gY!==1 || offY!==0 || add[0]||add[1]||add[2]){
    for(let i=0;i<a.length;i+=4){
      if(a[i+3]===0) continue;
      a[i]  =clamp(a[i]  *gY+offY+add[0],0,255);
      a[i+1]=clamp(a[i+1]*gY+offY+add[1],0,255);
      a[i+2]=clamp(a[i+2]*gY+offY+add[2],0,255);
    }
    c.putImageData(d,0,0);
  }

  buildSide();
  buildTopTint();
}

/* 頂面色：商品低於相機高度時看得到頂面，取頂端像素的平均色來填 */
let topTint='#8a8f94';
function buildTopTint(){
  const w=procC.width, h=procC.height;
  const band=Math.max(1,Math.round(h*0.04));
  const d=procC.getContext('2d').getImageData(0,0,w,band).data;
  let n=0,r=0,g=0,b=0;
  for(let i=0;i<d.length;i+=4){ if(d[i+3]<140) continue; r+=d[i];g+=d[i+1];b+=d[i+2];n++; }
  topTint = n ? 'rgb('+Math.round(r/n)+','+Math.round(g/n)+','+Math.round(b/n)+')' : '#8a8f94';
}

/* 側面材質：從去背圖靠邊緣的像素欄擠出。
   這樣側面自動帶有商品的真實顏色，以及上下緣的輪廓收邊（圓角、底座）。 */
function buildSide(){
  if(!procC) return;
  const ph=procC.height, sw=112;
  const inset=Math.max(1,Math.round(procC.width*0.05));
  sideC=[0,1].map(right=>{
    const c=cvs(sw,ph), x=c.getContext('2d');
    x.imageSmoothingEnabled=true;
    x.drawImage(procC, right?procC.width-inset-2:inset, 0, 2, ph, 0, 0, sw, ph);
    const a0=0.06+S.sideShade*0.42, a1=Math.min(0.93,a0+0.24);
    x.globalCompositeOperation='source-atop';
    const gr=x.createLinearGradient(0,0,sw,0);
    gr.addColorStop(0,'rgba(0,0,0,'+a0.toFixed(3)+')');
    gr.addColorStop(1,'rgba(0,0,0,'+a1.toFixed(3)+')');
    x.fillStyle=gr; x.fillRect(0,0,sw,ph);
    x.globalCompositeOperation='source-over';
    return c;
  });
}

/* ============================================================
   幾何：單視圖測量學
   立於地面的物體，其畫面高度 = (底部y − 視平線y) × 實際高 / 相機高
   ============================================================ */
function geom(k){
  const W=roomImg.width*k, H=roomImg.height*k;
  const horizonY=S.horizonY*H;
  const baseY=S.baseY*H, baseX=S.baseX*W;
  const denom=Math.max(baseY-horizonY, H*0.015);
  const pxPerCm=denom/S.cameraH;
  const drawH=denom*(S.productH/S.cameraH)*S.sizeAdjust;
  const ar=trimC ? trimC.width/trimC.height : 0.4;
  return {W,H,k,horizonY,baseX,baseY,drawH,drawW:drawH*ar,pxPerCm,ar};
}

/* ============================================================
   消失點：兩條沿地面的平行線，交點同時給出
   （a）正確的視平線高度  （b）房間深度軸的方向 → 轉向基準
   ============================================================ */
function vpPoint(g){
  const P=S.vpPts.map(p=>({x:p.x*g.W,y:p.y*g.H}));
  const r1={x:P[1].x-P[0].x,y:P[1].y-P[0].y};
  const r2={x:P[3].x-P[2].x,y:P[3].y-P[2].y};
  const den=r1.x*r2.y-r1.y*r2.x;
  if(Math.abs(den)<1e-4) return null;
  const t=((P[2].x-P[0].x)*r2.y-(P[2].y-P[0].y)*r2.x)/den;
  const v={x:P[0].x+r1.x*t, y:P[0].y+r1.y*t};
  if(!isFinite(v.x)||!isFinite(v.y)||Math.abs(v.x)>g.W*14||Math.abs(v.y)>g.H*14) return null;
  return v;
}
function focal(g){ return (Math.max(g.W,g.H)/2)/Math.tan(S.fov*Math.PI/360); }

function applyVP(){
  const g=geom(1), v=vpPoint(g);
  if(!v){ flash('兩條線幾乎平行，交點算不出來。請讓兩條線各自貼合地面上不同方向的邊（例如左邊牆腳線與右邊女兒牆底線）。'); return; }
  S.horizonY=clamp(v.y/g.H,0.02,0.96);
  S.baseY=Math.max(S.baseY,S.horizonY+0.03);
  S.roomAngle=clamp(Math.atan2(v.x-g.W/2, focal(g))*180/Math.PI,-75,75);
  S.vpMode=false;
  $('btn-vp').classList.remove('on');
  syncUI(); rebuildProc(); paint();
  flash('已套用：視平線 '+Math.round(S.horizonY*100)+'%，牆面基準 '+S.roomAngle.toFixed(1)+'°。轉向滑桿現在是相對牆面的偏移量。');
}
let flashT=0;
function flash(msg,actLabel,act){
  const el=$('flash');
  el.textContent='';
  const t=document.createElement('span'); t.textContent=msg; el.appendChild(t);
  if(actLabel && act){
    const b=document.createElement('button');
    b.type='button'; b.className='btn sm'; b.textContent=actLabel;
    b.addEventListener('click',()=>{ el.hidden=true; act(); });
    el.appendChild(b);
  }
  el.hidden=false;
  clearTimeout(flashT);
  flashT=setTimeout(()=>{el.hidden=true;}, actLabel?14000:7000);
}

/* ============================================================
   繪製
   ============================================================ */
/* 有指定光源位置就從位置推方向，否則用進階裡的角度 */
function effShadowDir(g){
  if(!S.lightPos) return S.shadowDir;
  return Math.atan2(g.baseY-S.lightPos.y*g.H, g.baseX-S.lightPos.x*g.W)*180/Math.PI;
}
function drawShape(ctx,src,cx,by,w,h,keystone,flip){
  ctx.save();
  if(flip){ ctx.translate(cx,0); ctx.scale(-1,1); ctx.translate(-cx,0); }
  if(Math.abs(keystone)<0.004){
    ctx.drawImage(src,cx-w/2,by-h,w,h);
  }else{
    const N=170, sh=src.height/N, dh=h/N;
    for(let i=0;i<N;i++){
      const t=(i+0.5)/N;                   // 0=頂 1=底
      const ww=w*(1-keystone*(1-t));
      ctx.drawImage(src, 0, i*sh, src.width, sh+0.6, cx-ww/2, by-h+i*dh, ww, dh+0.7);
    }
  }
  ctx.restore();
}

/* ============================================================
   轉向：把商品當成長方體投影
   物體繞垂直軸旋轉、相機無翻滾時，垂直線在畫面上仍是垂直線，
   所以「垂直條帶」渲染是精確投影，不是近似。
   前面用去背圖，側面用擠出的邊緣材質。
   ============================================================ */
function proj(g){
  const long=Math.max(g.W,g.H);
  const f=(long/2)/Math.tan(S.fov*Math.PI/360);   // 焦距（px）
  const cy=g.horizonY, cx=g.W/2, Hc=S.cameraH;
  const z0=f/g.pxPerCm;                           // 商品底部到相機的距離（cm）
  const X0=(g.baseX-cx)*z0/f;
  const sc=S.sizeAdjust;
  return {f,cx,cy,Hc,z0,X0,
          Ho:S.productH*sc, Wo:S.productH*g.ar*sc, Do:Math.max(1,S.depth)*sc,
          th:(S.roomAngle+S.rotate)*Math.PI/180, z:z0};
}
/* s = 沿商品寬度(cm，0為中心)  t = 沿商品深度(cm，0為正面)  h = 離地高度(cm) */
function P(pr,s,t,h){
  const si=Math.sin(pr.th), co=Math.cos(pr.th);
  const z=Math.max(12, pr.z0 - s*si + t*co);
  const X=pr.X0 + s*co + t*si;
  return { x:pr.cx + pr.f*X/z, y:pr.cy + pr.f*(pr.Hc-h)/z };
}

function buildBox(g){
  const pr=proj(g);
  const sgn=pr.th>=0?1:-1, sE=sgn*pr.Wo/2, rot=Math.abs(pr.th)>0.003;
  const pts=[P(pr,-pr.Wo/2,0,0),P(pr,-pr.Wo/2,0,pr.Ho),
             P(pr, pr.Wo/2,0,0),P(pr, pr.Wo/2,0,pr.Ho)];
  if(rot) pts.push(P(pr,sE,pr.Do,0),P(pr,sE,pr.Do,pr.Ho));
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const p of pts){
    if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x;
    if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y;
  }
  x0=Math.floor(x0-2); y0=Math.floor(y0-2);
  const bw=Math.ceil(x1-x0+2), bh=Math.ceil(y1-y0+2);
  if(!(bw>2&&bh>2)||bw>9000||bh>9000) return null;

  const c=cvs(bw,bh), x=c.getContext('2d');
  x.imageSmoothingEnabled=true;
  const N=Math.max(90,Math.min(420,Math.round(bw*1.5)));

  // 頂面：只有商品比相機矮時才看得到
  if(rot && pr.Ho < pr.Hc-1){
    const q=[P(pr,-pr.Wo/2,0,pr.Ho), P(pr,pr.Wo/2,0,pr.Ho),
             P(pr, pr.Wo/2,pr.Do,pr.Ho), P(pr,-pr.Wo/2,pr.Do,pr.Ho)];
    x.beginPath();
    x.moveTo(q[0].x-x0,q[0].y-y0);
    for(let i=1;i<4;i++) x.lineTo(q[i].x-x0,q[i].y-y0);
    x.closePath();
    const gt=x.createLinearGradient(0,q[0].y-y0,0,q[2].y-y0);
    gt.addColorStop(0,topTint); gt.addColorStop(1,topTint);
    x.fillStyle=gt; x.globalAlpha=1; x.fill();
    // 頂面朝上迎光，往深處略暗
    const sh=x.createLinearGradient(0,q[0].y-y0,0,q[2].y-y0);
    sh.addColorStop(0,'rgba(255,255,255,0.10)');
    sh.addColorStop(1,'rgba(0,0,0,'+(0.10+S.sideShade*0.22).toFixed(3)+')');
    x.fillStyle=sh; x.fill();
  }

  // 側面：在共用邊上位於前面板之後，先畫
  if(rot && sideC){
    const tex=sideC[sgn>0?1:0], tw=tex.width;
    for(let i=0;i<N;i++){
      const ta=i/N, tb=(i+1)/N, tm=(i+0.5)/N;
      const xa=P(pr,sE,pr.Do*ta,0).x, xb=P(pr,sE,pr.Do*tb,0).x;
      const dw=Math.abs(xb-xa); if(dw<0.02) continue;
      const lo=P(pr,sE,pr.Do*tm,0).y, hi=P(pr,sE,pr.Do*tm,pr.Ho).y;
      x.drawImage(tex, ta*tw, 0, tw/N, tex.height,
                  Math.min(xa,xb)-x0, hi-y0, dw+0.8, lo-hi);
    }
  }
  // 前面板
  const src=procC, sw=src.width;
  for(let i=0;i<N;i++){
    const ua=i/N, ub=(i+1)/N, um=(i+0.5)/N;
    const xa=P(pr,-pr.Wo/2+pr.Wo*ua,0,0).x, xb=P(pr,-pr.Wo/2+pr.Wo*ub,0,0).x;
    const dw=Math.abs(xb-xa); if(dw<0.02) continue;
    const sm=-pr.Wo/2+pr.Wo*um;
    const lo=P(pr,sm,0,0).y, hi=P(pr,sm,0,pr.Ho).y;
    x.drawImage(src, (S.flip?1-ub:ua)*sw, 0, sw/N, src.height,
                Math.min(xa,xb)-x0, hi-y0, dw+0.8, lo-hi);
  }
  return {c,x0,y0,w:bw,h:bh};
}

function render(ctx,k,track){
  const g=geom(k);
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,g.W,g.H);
  ctx.globalCompositeOperation='source-over';
  ctx.globalAlpha=1; ctx.filter='none';
  ctx.drawImage(roomImg,0,0,g.W,g.H);
  if(S.compare || S.vpMode || !procC) return g;

  const box=buildBox(g);
  if(track) lastBox=box;
  if(!box) return g;
  const bw=box.w, bh=box.h, cx=box.x0+bw/2, bot=box.y0+bh;

  // 黑色剪影（陰影用）—— 轉向後剪影是整個長方體，不再只是正面
  const sil=pad(1,bw,bh), sc=sil.getContext('2d');
  sc.drawImage(box.c,0,0);
  sc.globalCompositeOperation='source-in';
  sc.fillStyle='#000'; sc.fillRect(0,0,bw,bh);
  sc.globalCompositeOperation='source-over';

  // — 地板倒影 —
  if(S.refl>0.005){
    const rf=pad(2,bw,bh), rc=rf.getContext('2d');
    rc.save(); rc.translate(0,bh); rc.scale(1,-1); rc.drawImage(box.c,0,0); rc.restore();
    rc.globalCompositeOperation='destination-out';
    const gr=rc.createLinearGradient(0,0,0,bh);
    gr.addColorStop(0,'rgba(0,0,0,0.30)');
    gr.addColorStop(0.45,'rgba(0,0,0,0.92)');
    gr.addColorStop(1,'rgba(0,0,0,1)');
    rc.fillStyle=gr; rc.fillRect(0,0,bw,bh);
    rc.globalCompositeOperation='source-over';
    ctx.save();
    ctx.globalAlpha=S.refl;
    setBlur(ctx, bh*0.0022);
    ctx.drawImage(rf, box.x0, bot, bw, bh*0.42);
    ctx.restore();
  }

  // — 投射陰影：把剪影投影到地面（傾斜＋壓縮） —
  if(S.shadowOp>0.005 && S.shadowLen>0.005){
    const a=effShadowDir(g)*Math.PI/180;
    const sx=Math.cos(a)*S.shadowLen;
    const sy=Math.sin(a)*S.shadowLen*0.5;
    ctx.save();
    ctx.globalAlpha=S.shadowOp;
    setBlur(ctx, S.shadowSoft*(bh/900)*2.2);
    // x' = x − sx·(y−by)   y' = by + sy·(by−y)
    ctx.transform(1, 0, -sx, -sy, sx*bot, bot*(1+sy));
    drawShape(ctx,sil,cx,bot,bw,bh,S.keystone,false);
    ctx.restore();
  }

  // — 接觸陰影：壓扁的足跡，兩層（外散＋核心） —
  if(S.contactOp>0.005){
    const w=bw*S.contactSpread;
    // 轉向後底面往深處延伸，足跡要跟著加高才蓋得住
    const d=1+Math.abs(Math.sin((S.roomAngle+S.rotate)*Math.PI/180))*0.9;
    ctx.save();
    ctx.globalAlpha=S.contactOp*0.55;
    setBlur(ctx, bh*0.020);
    ctx.drawImage(sil, cx-w*0.55, bot-bh*0.070*d, w*1.10, bh*0.085*d);
    ctx.globalAlpha=Math.min(1,S.contactOp*1.06);
    setBlur(ctx, bh*0.006);
    ctx.drawImage(sil, cx-w*0.5, bot-bh*0.024*d, w, bh*0.030*d);
    ctx.restore();
  }

  // — 商品 —
  ctx.save();
  ctx.filter='none'; ctx.globalAlpha=1;
  drawShape(ctx,box.c,cx,bot,bw,bh,S.keystone,false);
  ctx.restore();

  // — 雜訊匹配（只疊在商品上） —
  if(S.grain>0.005 && bw>3 && bh>3){
    const t=pad(3,Math.min(3000,bw),Math.min(3000,bh)), tc=t.getContext('2d');
    tc.fillStyle=tc.createPattern(noiseTile,'repeat');
    tc.fillRect(0,0,t.width,t.height);
    tc.globalCompositeOperation='destination-in';
    tc.drawImage(box.c,0,0,t.width,t.height);
    tc.globalCompositeOperation='source-over';
    ctx.save();
    ctx.globalAlpha=S.grain*0.42;
    ctx.globalCompositeOperation='overlay';
    ctx.drawImage(t, box.x0, box.y0, bw, bh);
    ctx.restore();
  }
  ctx.globalCompositeOperation='source-over';
  return g;
}

function drawGuides(ctx,g){
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.filter='none'; ctx.globalAlpha=1;

  if(S.vpMode){
    const P=S.vpPts.map(p=>({x:p.x*g.W,y:p.y*g.H})), v=vpPoint(g);
    const thin=Math.max(1.2,g.H*0.0022), thick=Math.max(3,g.H*0.005);
    [[0,1,'rgba(255,196,60,.95)'],[2,3,'rgba(90,200,150,.95)']].forEach(([i,j,col])=>{
      ctx.strokeStyle=col;
      if(v){ ctx.setLineDash([g.W*0.01,g.W*0.008]); ctx.lineWidth=thin;
        ctx.beginPath(); ctx.moveTo(P[j].x,P[j].y); ctx.lineTo(v.x,v.y); ctx.stroke();
        ctx.setLineDash([]); }
      ctx.lineWidth=thick;
      ctx.beginPath(); ctx.moveTo(P[i].x,P[i].y); ctx.lineTo(P[j].x,P[j].y); ctx.stroke();
    });
    const r=Math.max(7,g.H*0.012);
    P.forEach((p,n)=>{
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,7);
      ctx.fillStyle=n<2?'rgba(255,196,60,1)':'rgba(90,200,150,1)';
      ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.65)'; ctx.lineWidth=2.5; ctx.stroke();
    });
    if(v){
      ctx.setLineDash([g.W*0.014,g.W*0.01]);
      ctx.strokeStyle='rgba(212,17,74,.8)'; ctx.lineWidth=thin;
      ctx.beginPath(); ctx.moveTo(0,v.y); ctx.lineTo(g.W,v.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(v.x,v.y,r*1.35,0,7);
      ctx.fillStyle='rgba(212,17,74,1)'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if(S.lightPos){
    const lx=S.lightPos.x*g.W, ly=S.lightPos.y*g.H;
    const r=Math.max(7,g.H*0.011);
    ctx.save();
    ctx.setLineDash([g.W*0.009,g.W*0.009]);
    ctx.strokeStyle='rgba(255,206,84,.75)';
    ctx.lineWidth=Math.max(1.2,g.H*0.002);
    ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(g.baseX,g.baseY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle='rgba(255,206,84,.95)'; ctx.lineWidth=Math.max(2,g.H*0.0028);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      ctx.beginPath();
      ctx.moveTo(lx+Math.cos(a)*r*1.45, ly+Math.sin(a)*r*1.45);
      ctx.lineTo(lx+Math.cos(a)*r*2.15, ly+Math.sin(a)*r*2.15);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(lx,ly,r,0,7);
    ctx.fillStyle='rgba(255,206,84,1)'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  }

  const y=g.horizonY;
  ctx.strokeStyle='rgba(212,17,74,.85)'; ctx.lineWidth=Math.max(1,g.H*0.0016);
  ctx.setLineDash([g.W*0.016,g.W*0.012]);
  ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(g.W,y); ctx.stroke();
  ctx.setLineDash([]);
  const pad=g.W*0.014, fs=Math.max(11,g.H*0.016);
  ctx.font='600 '+fs+'px "IBM Plex Mono",monospace';
  const label='視平線 · 相機高 '+S.cameraH+'cm';
  const tw=ctx.measureText(label).width;
  ctx.fillStyle='rgba(212,17,74,.92)';
  ctx.fillRect(pad,y-fs*1.5,tw+pad*1.2,fs*1.55);
  ctx.fillStyle='#fff'; ctx.textBaseline='middle';
  ctx.fillText(label,pad+pad*0.6,y-fs*0.72);
  ctx.restore();
}

/* ============================================================
   預覽輸出
   ============================================================ */
let raf=0;
function paint(){
  if(raf) return;
  raf=requestAnimationFrame(()=>{
    raf=0;
    if(!roomImg) return;
    const k=Math.min(1, 1400/Math.max(roomImg.width,roomImg.height));
    const W=Math.round(roomImg.width*k), H=Math.round(roomImg.height*k);
    if(view.width!==W||view.height!==H){ view.width=W; view.height=H; }
    const g=render(vctx,k,true);
    if(!S.compare) drawGuides(vctx,g);
    updateStatus(g);
  });
}

function updateStatus(g){
  $('s-dim').textContent = Math.round(S.productH*g.ar)+' × '+Math.round(S.depth)+' × '+Math.round(S.productH)+' cm';
  $('s-scale').textContent = (g.pxPerCm/g.k).toFixed(2)+' px / cm';
  $('s-px').textContent = Math.round(g.drawH/g.k)+' px（'+Math.round(g.drawH/g.H*100)+'% 畫面高）';
  const dev=Math.round((S.sizeAdjust-1)*100);
  const el=$('s-dev');
  el.textContent = dev===0 ? '符合真實比例' : (dev>0?'+':'')+dev+'%';
  el.className = Math.abs(dev)>8 ? 'warn' : '';
  if(S.lightPos) $('v-shadowdir').textContent=Math.round((effShadowDir(g)+360)%360)+'°';
  const rm=$('s-room');
  rm.textContent = Math.abs(S.roomAngle)>0.05 ? S.roomAngle.toFixed(1)+'°' : '未校正';
  rm.className = Math.abs(S.roomAngle)>0.05 ? '' : 'warn';
}

/* ============================================================
   互動
   ============================================================ */
let drag=null;
function viewPos(e){
  const r=view.getBoundingClientRect();
  return { x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height };
}
view.addEventListener('pointerdown',e=>{
  if(!roomImg||!prodImg) return;
  const p=viewPos(e);
  if(S.lightMode){
    S.lightPos={x:clamp(p.x,-0.6,1.6), y:clamp(p.y,-0.6,1.6)};
    setLightMode(false); lightLabel();
    flash('光源已設定，陰影方向已更新。不滿意就再點一次。');
    e.preventDefault();
    return;
  }
  if(S.vpMode){
    let best=-1, bd=1e9;
    S.vpPts.forEach((q,i)=>{
      const d=Math.hypot((q.x-p.x)*view.width,(q.y-p.y)*view.height);
      if(d<bd){ bd=d; best=i; }
    });
    if(bd < Math.max(26,view.height*0.03)*HIT) drag={type:'vp', idx:best};
    if(drag){ view.setPointerCapture(e.pointerId); view.classList.add('dragging'); e.preventDefault(); }
    return;
  }
  if(Math.abs(p.y-S.horizonY) < 0.018*HIT){
    drag={type:'horizon'};
  }else if(lastBox && view.width>1){
    const x0=lastBox.x0/view.width, x1=(lastBox.x0+lastBox.w)/view.width;
    const y0=lastBox.y0/view.height, y1=(lastBox.y0+lastBox.h)/view.height;
    if(p.x>x0-0.02*HIT && p.x<x1+0.02*HIT && p.y>y0-0.01*HIT && p.y<y1+0.03*HIT){
      drag={type:'prod', dx:p.x-S.baseX, dy:p.y-S.baseY};
    }
  }
  if(drag){ view.setPointerCapture(e.pointerId); view.classList.add('dragging'); e.preventDefault(); }
});
view.addEventListener('pointermove',e=>{
  if(!drag) return;
  const p=viewPos(e);
  if(drag.type==='vp'){
    S.vpPts[drag.idx]={x:clamp(p.x,-0.3,1.3), y:clamp(p.y,-0.3,1.3)};
    paint(); return;
  }
  if(drag.type==='horizon'){
    S.horizonY=clamp(p.y,0.02,0.96);
    $('c-horizon').value=(S.horizonY*100).toFixed(1);
    $('v-horizon').textContent=Math.round(S.horizonY*100)+'%';
  }else{
    S.baseX=clamp(p.x-drag.dx,-0.1,1.1);
    S.baseY=clamp(p.y-drag.dy, S.horizonY+0.012, 1.25);
  }
  paint();
});
function endDrag(e){
  if(!drag) return;
  drag=null; view.classList.remove('dragging');
  try{ view.releasePointerCapture(e.pointerId); }catch(_){}
  if(S.harm>0){ rebuildProc(); paint(); }   // 落點改變 → 重新取樣環境色
}
view.addEventListener('pointerup',endDrag);
view.addEventListener('pointercancel',endDrag);

view.tabIndex=0;
view.addEventListener('keydown',e=>{
  const step=e.shiftKey?0.02:0.004;
  const map={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
  if(!map[e.key]) return;
  e.preventDefault();
  S.baseX=clamp(S.baseX+map[e.key][0],-0.1,1.1);
  S.baseY=clamp(S.baseY+map[e.key][1],S.horizonY+0.012,1.25);
  paint();
});

/* ============================================================
   控制項接線
   ============================================================ */
const BIND=[
  ['c-camh','v-camh', v=>{S.cameraH=v;}, v=>v+' cm', 'proc'],
  ['c-horizon','v-horizon', v=>{S.horizonY=v/100;}, v=>Math.round(v)+'%', 'proc'],
  ['c-size','v-size', v=>{S.sizeAdjust=v/100;}, v=>Math.round(v)+'%', 'proc'],
  ['c-keystone','v-keystone', v=>{S.keystone=v/100;}, v=>v.toFixed(1), ''],
  ['c-rotate','v-rotate', v=>{S.rotate=v;}, rotLabel, ''],
  ['c-sideshade','v-sideshade', v=>{S.sideShade=v/100;}, fmtPct2, 'side'],
  ['c-fov','v-fov', v=>{S.fov=v;}, v=>Math.round(v)+'°', ''],
  ['c-contactop','v-contactop', v=>{S.contactOp=v/100;}, fmtPct2, ''],
  ['c-contactspread','v-contactspread', v=>{S.contactSpread=v/100;}, fmtPct2, ''],
  ['c-shadowdir','v-shadowdir', v=>{S.shadowDir=v;}, v=>Math.round(v)+'°', ''],
  ['c-shadowlen','v-shadowlen', v=>{S.shadowLen=v/100;}, fmtPct2, ''],
  ['c-shadowsoft','v-shadowsoft', v=>{S.shadowSoft=v;}, v=>v.toFixed(1), ''],
  ['c-shadowop','v-shadowop', v=>{S.shadowOp=v/100;}, fmtPct2, ''],
  ['c-refl','v-refl', v=>{S.refl=v/100;}, fmtPct2, ''],
  ['c-harm','v-harm', v=>{S.harm=v/100;}, fmtPct2, 'proc'],
  ['c-tint','v-tint', v=>{S.tint=v/100;}, fmtPct2, 'proc'],
  ['c-bright','v-bright', v=>{S.bright=v;}, v=>(v>0?'+':'')+v, 'proc'],
  ['c-warm','v-warm', v=>{S.warm=v;}, v=>(v>0?'+':'')+v, 'proc'],
  ['c-trim','v-trim', v=>{S.trim=v;}, v=>v+' px', 'trim'],
  ['c-grain','v-grain', v=>{S.grain=v/100;}, fmtPct2, '']
];
function fmtPct2(v){ return Math.round(v)+'%'; }
function rotLabel(v){
  const tot=S.roomAngle+v;
  return (v>0?'+':'')+v.toFixed(0)+'°'+(Math.abs(S.roomAngle)>0.05?' → '+tot.toFixed(0)+'°':'');
}

let procTimer=0;
function scheduleProc(kind){
  clearTimeout(procTimer);
  procTimer=setTimeout(()=>{
    if(kind==='side'){ buildSide(); paint(); return; }
    if(kind==='trim') rebuildTrim();
    rebuildProc(); paint();
  }, kind==='trim'?140:70);
}
BIND.forEach(([id,out,set,fmt,kind])=>{
  const el=$(id);
  el.addEventListener('input',()=>{
    const v=parseFloat(el.value);
    set(v);
    $(out).textContent=fmt(v);
    if(kind) scheduleProc(kind);
    paint();
  });
});

$('p-height').addEventListener('input',e=>{
  const v=parseFloat(e.target.value);
  if(isFinite(v)&&v>0){ S.productH=v; paint(); }
});
$('p-depth').addEventListener('input',e=>{
  const v=parseFloat(e.target.value);
  if(isFinite(v)&&v>0){ S.depth=v; paint(); }
});
$('p-preset').addEventListener('change',e=>{
  if(!e.target.value) return;
  const parts=e.target.value.split(',');
  S.productH=parseFloat(parts[0]); S.depth=parseFloat(parts[1]);
  $('p-height').value=S.productH; $('p-depth').value=S.depth;
  paint();
});
$('btn-vp').addEventListener('click',e=>{
  S.vpMode=!S.vpMode;
  e.currentTarget.classList.toggle('on',S.vpMode);
  e.currentTarget.textContent=S.vpMode?'取消消失點校正':'用消失點自動校正';
  $('btn-vp-apply').hidden=!S.vpMode;
  if(S.vpMode) flash('把黃色那條線拉到貼合地面的一條邊（例如左邊牆腳線），綠色那條拉到另一個方向的地面邊（例如右邊女兒牆底線）。兩條線都要沿著地面，而且方向不同。對好後按「套用消失點」。');
  paint();
});
$('btn-vp-apply').addEventListener('click',applyVP);
document.querySelectorAll('[data-camh]').forEach(b=>b.addEventListener('click',()=>{
  S.cameraH=parseFloat(b.dataset.camh);
  $('c-camh').value=S.cameraH; $('v-camh').textContent=S.cameraH+' cm';
  syncCamPresets(); rebuildProc(); paint();
}));
$('c-camh').addEventListener('input',syncCamPresets);
document.querySelectorAll('[data-fov]').forEach(b=>b.addEventListener('click',()=>{
  S.fov=parseFloat(b.dataset.fov);
  $('c-fov').value=S.fov; $('v-fov').textContent=S.fov+'°';
  setFovSource('來源：手動設定',false);
  paint();
}));
$('c-fov').addEventListener('input',()=>setFovSource('來源：手動設定',false));
$('btn-flip').addEventListener('click',e=>{
  S.flip=!S.flip;
  e.currentTarget.classList.toggle('on',S.flip);
  paint();
});

const cmp=$('btn-compare');
function setCmp(on){ S.compare=on; cmp.classList.toggle('on',on); paint(); }
['pointerdown'].forEach(t=>cmp.addEventListener(t,()=>setCmp(true)));
['pointerup','pointerleave','pointercancel'].forEach(t=>cmp.addEventListener(t,()=>setCmp(false)));
cmp.addEventListener('keydown',e=>{ if(e.key===' '||e.key==='Enter'){e.preventDefault();setCmp(!S.compare);} });

/* 場景預設：一個按鈕決定 8 個數值。使用者只需要回答「當時的光線像哪一種」。 */
const SCENES={
  balcony:{shadowLen:0.55,shadowSoft:14,shadowOp:0.48,contactOp:0.88,contactSpread:1.00,harm:0.55,tint:0.22,grain:0.35},
  indoor: {shadowLen:0.35,shadowSoft:30,shadowOp:0.26,contactOp:0.80,contactSpread:1.05,harm:0.60,tint:0.28,grain:0.40},
  cloudy: {shadowLen:0.22,shadowSoft:40,shadowOp:0.18,contactOp:0.70,contactSpread:1.10,harm:0.55,tint:0.25,grain:0.40},
  sun:    {shadowLen:1.00,shadowSoft:6, shadowOp:0.55,contactOp:0.92,contactSpread:0.95,harm:0.50,tint:0.18,grain:0.28}
};
const FLOORS=[0.03,0.14,0.30];   // 霧面 / 一般 / 亮面

function markChips(){
  document.querySelectorAll('[data-scene]').forEach(b=>b.classList.toggle('on',b.dataset.scene===S.scene));
  document.querySelectorAll('[data-floor]').forEach(b=>b.classList.toggle('on',+b.dataset.floor===S.floor));
}
function applyScene(name){
  if(!SCENES[name]) return;
  S.scene=name; Object.assign(S,SCENES[name]);
  markChips(); syncUI(); rebuildProc(); paint();
}
document.querySelectorAll('[data-scene]').forEach(b=>
  b.addEventListener('click',()=>applyScene(b.dataset.scene)));
document.querySelectorAll('[data-floor]').forEach(b=>b.addEventListener('click',()=>{
  S.floor=+b.dataset.floor; S.refl=FLOORS[S.floor];
  markChips(); syncUI(); paint();
}));

/* 光源位置：存的是位置不是角度，所以商品移動時陰影方向會自己跟著轉 */
function lightLabel(){
  const el=$('light-src');
  const on=!!S.lightPos;
  el.textContent = on
    ? '已設定光源位置。移動商品時，陰影方向會自動跟著調整。'
    : '尚未設定，使用預設方向。點一下照片裡的窗戶或燈，陰影就會往反方向倒。';
  el.style.color = on ? 'var(--ok)' : 'var(--ink-faint)';
}
function autoLight(){
  if(!roomSmallData) return null;
  const {data,w,h}=roomSmallData, n=w*h, L=new Float32Array(n);
  for(let i=0;i<n;i++){
    const j=i*4;
    L[i]=0.299*data[j]+0.587*data[j+1]+0.114*data[j+2];
  }
  const thr=Float32Array.from(L).sort()[Math.floor(n*0.88)];   // 最亮的 12%
  let sx=0,sy=0,c=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++)
    if(L[y*w+x]>=thr){ sx+=x; sy+=y; c++; }
  return c ? {x:sx/c/w, y:sy/c/h} : null;
}
function setLightMode(on){
  S.lightMode=on;
  const b=$('btn-light');
  b.classList.toggle('on',on);
  b.textContent = on ? '點選中… Esc 取消' : '在照片上點光源';
  paint();
}
$('btn-light').addEventListener('click',()=>{
  setLightMode(!S.lightMode);
  if(S.lightMode) flash('在照片上點一下光源的位置 — 窗戶、燈具、或畫面裡最亮的地方。陰影會自動倒向反方向。');
});
$('btn-light-auto').addEventListener('click',()=>{
  const p=autoLight();
  if(!p){ flash('偵測不到光源，請用「在照片上點光源」手動指定。'); return; }
  S.lightPos=p; lightLabel(); paint();
  flash('已自動偵測：取照片最亮區域的重心當光源。位置不對的話改用手動點選。');
});

/* 進階 */
$('btn-adv').addEventListener('click',e=>{
  const a=$('adv'); a.hidden=!a.hidden;
  e.currentTarget.classList.toggle('on',!a.hidden);
  e.currentTarget.textContent = a.hidden ? '進階調整' : '收起進階調整';
});
$('btn-reset-adv').addEventListener('click',()=>{
  applyScene(S.scene);
  flash('已回到「'+$('[data-scene="'+S.scene+'"]').textContent+'」的預設值。');
});
// 手動動了這兩項就脫離預設，晶片取消高亮，才不會誤導
$('c-shadowdir').addEventListener('input',()=>{ S.lightPos=null; lightLabel(); });
$('c-refl').addEventListener('input',()=>{ S.floor=-1; markChips(); });

function syncCamPresets(){
  document.querySelectorAll('[data-camh]').forEach(b=>
    b.classList.toggle('on', parseFloat(b.dataset.camh)===S.cameraH));
}
function syncUI(){
  const set=(id,val,out,fmt)=>{ $(id).value=val; $(out).textContent=fmt; };
  $('p-height').value=S.productH;
  $('p-depth').value=S.depth;
  $('btn-flip').classList.toggle('on',S.flip);
  set('c-camh',S.cameraH,'v-camh',S.cameraH+' cm');
  syncCamPresets();
  set('c-horizon',(S.horizonY*100).toFixed(1),'v-horizon',Math.round(S.horizonY*100)+'%');
  set('c-size',Math.round(S.sizeAdjust*100),'v-size',Math.round(S.sizeAdjust*100)+'%');
  set('c-keystone',(S.keystone*100).toFixed(1),'v-keystone',(S.keystone*100).toFixed(1));
  set('c-rotate',S.rotate,'v-rotate',rotLabel(S.rotate));
  set('c-sideshade',Math.round(S.sideShade*100),'v-sideshade',Math.round(S.sideShade*100)+'%');
  set('c-fov',S.fov,'v-fov',Math.round(S.fov)+'°');
  set('c-contactop',Math.round(S.contactOp*100),'v-contactop',Math.round(S.contactOp*100)+'%');
  set('c-contactspread',Math.round(S.contactSpread*100),'v-contactspread',Math.round(S.contactSpread*100)+'%');
  set('c-shadowdir',S.shadowDir,'v-shadowdir',Math.round(S.shadowDir)+'°');
  set('c-shadowlen',Math.round(S.shadowLen*100),'v-shadowlen',Math.round(S.shadowLen*100)+'%');
  set('c-shadowsoft',S.shadowSoft,'v-shadowsoft',S.shadowSoft.toFixed(1));
  set('c-shadowop',Math.round(S.shadowOp*100),'v-shadowop',Math.round(S.shadowOp*100)+'%');
  set('c-refl',Math.round(S.refl*100),'v-refl',Math.round(S.refl*100)+'%');
  set('c-harm',Math.round(S.harm*100),'v-harm',Math.round(S.harm*100)+'%');
  set('c-tint',Math.round(S.tint*100),'v-tint',Math.round(S.tint*100)+'%');
  set('c-bright',S.bright,'v-bright',(S.bright>0?'+':'')+S.bright);
  set('c-warm',S.warm,'v-warm',(S.warm>0?'+':'')+S.warm);
  set('c-grain',Math.round(S.grain*100),'v-grain',Math.round(S.grain*100)+'%');
}

/* ============================================================
   EXIF：直接從照片讀鏡頭資訊，省掉手動選鏡頭這個出錯點
   ============================================================ */
function readIFD(dv,base,pos,le,want,out){
  if(pos<0||pos+2>dv.byteLength) return;
  const n=dv.getUint16(pos,le);
  for(let i=0;i<n;i++){
    const e=pos+2+i*12;
    if(e+12>dv.byteLength) return;
    const key=want[dv.getUint16(e,le)];
    if(!key) continue;
    const type=dv.getUint16(e+2,le), cnt=dv.getUint32(e+4,le);
    const sz={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8}[type]||1;
    const total=sz*cnt;
    const vo = total<=4 ? e+8 : base+dv.getUint32(e+8,le);
    if(vo<0||vo+Math.min(total,4)>dv.byteLength) continue;
    if(type===3) out[key]=dv.getUint16(vo,le);
    else if(type===4) out[key]=dv.getUint32(vo,le);
    else if(type===5){
      if(vo+8>dv.byteLength) continue;
      const den=dv.getUint32(vo+4,le);
      out[key]= den ? dv.getUint32(vo,le)/den : 0;
    }
    else if(type===2){
      let t='';
      for(let j=0;j<cnt-1 && vo+j<dv.byteLength;j++){
        const c=dv.getUint8(vo+j); if(!c) break; t+=String.fromCharCode(c);
      }
      out[key]=t.trim();
    }
  }
}
function readExif(buf){
  try{
    const dv=new DataView(buf);
    if(dv.byteLength<12 || dv.getUint16(0)!==0xFFD8) return null;   // 不是 JPEG
    let off=2, base=-1;
    while(off+4<=dv.byteLength){
      if(dv.getUint8(off)!==0xFF) break;
      const m=dv.getUint8(off+1);
      if(m===0xD8||m===0x01||(m>=0xD0&&m<=0xD7)){ off+=2; continue; }
      if(m===0xDA||m===0xD9) break;
      const len=dv.getUint16(off+2);
      if(len<2) break;
      if(m===0xE1 && off+10<=dv.byteLength){
        let sig=''; for(let i=0;i<6;i++) sig+=String.fromCharCode(dv.getUint8(off+4+i));
        if(sig==='Exif\u0000\u0000'){ base=off+10; break; }
      }
      off+=2+len;
    }
    if(base<0 || base+8>dv.byteLength) return null;
    const bo=dv.getUint16(base);
    const le = bo===0x4949 ? true : bo===0x4D4D ? false : null;
    if(le===null || dv.getUint16(base+2,le)!==0x2A) return null;
    const out={};
    readIFD(dv,base,base+dv.getUint32(base+4,le),le,{0x0110:'model',0x8769:'ptr'},out);
    if(out.ptr) readIFD(dv,base,base+out.ptr,le,{0xA405:'f35',0x920A:'focal',0xA434:'lens'},out);
    return out;
  }catch(_){ return null; }
}
/* 等效焦距 → 本工具用的「長邊視角」。
   先由 35mm 片幅對角線（21.635mm）算出對角視角，再依照片實際長寬比換算，
   這樣 4:3 與 16:9 都準確。 */
function fovFrom35(f35,W,H){
  if(!(f35>3 && f35<400) || !(W>0&&H>0)) return null;
  const diagFov=2*Math.atan(21.635/f35);
  const fPx=(Math.hypot(W,H)/2)/Math.tan(diagFov/2);
  return 2*Math.atan((Math.max(W,H)/2)/fPx)*180/Math.PI;
}
function setFovSource(txt,auto){
  const el=$('fov-src');
  el.textContent=txt;
  el.style.color = auto ? 'var(--ok)' : 'var(--ink-faint)';
}

/* ============================================================
   檔案載入
   ============================================================ */
function readFile(file){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(file);
    const im=new Image();
    im.onload=()=>{ res(im); };
    im.onerror=()=>{ URL.revokeObjectURL(url);
      rej(new Error(/\.hei[cf]$/i.test(file.name||'')
        ? 'HEIC 格式瀏覽器無法直接開啟。請到 iPhone 設定 → 相機 → 格式，改成「最相容」重拍，或先把檔案轉成 JPEG。'
        : '無法讀取此影像，請確認檔案格式（建議 JPEG 或 PNG）。')); };
    im.src=url;
  });
}
function buildRoomSmall(){
  const sw=220, sh=Math.max(1,Math.round(roomImg.height/roomImg.width*sw));
  roomSmall=cvs(sw,sh);
  const c=roomSmall.getContext('2d');
  c.drawImage(roomImg,0,0,sw,sh);
  const d=c.getImageData(0,0,sw,sh);
  roomSmallData={data:d.data,w:sw,h:sh};
}
async function loadRoom(file){
  let ex=null;
  try{ ex=readExif(await file.slice(0,512*1024).arrayBuffer()); }catch(_){}
  const im=await readFile(file);
  roomImg=im; usingDemoRoom=false;
  $('nameRoom').textContent=file.name;
  applyExif(ex, im.naturalWidth||im.width, im.naturalHeight||im.height);
  buildRoomSmall(); rebuildProc(); refreshBadge(); paint();
}

function applyExif(ex,W,H){
  const fov = ex && ex.f35 ? fovFrom35(ex.f35,W,H) : null;
  if(fov){
    S.fov=clamp(Math.round(fov),20,110);
    $('c-fov').value=S.fov; $('v-fov').textContent=S.fov+'°';
    const who=[ex.model,ex.lens].filter(Boolean).join(' · ');
    setFovSource('來源：EXIF · 等效 '+Math.round(ex.f35)+'mm'+(who?'（'+who+'）':''),true);
    flash('已從照片讀取鏡頭資訊：等效 '+Math.round(ex.f35)+'mm → 視角 '+S.fov+'°'+(who?'（'+who+'）':'')+'。');
    return;
  }
  S.fov=DEFAULTS.fov;                       // 不要沿用上一張照片的鏡頭
  $('c-fov').value=S.fov; $('v-fov').textContent=S.fov+'°';
  setFovSource('來源：手動設定 — 照片沒有鏡頭資訊，已回到預設 '+S.fov+'°',false);
  const via = ex && (ex.model||ex.focal) ? '' : '（用 LINE、微信之類傳過的照片，EXIF 通常會被移除；請用 AirDrop 或雲端硬碟傳原檔）';
  flash('這張照片讀不到鏡頭資訊，請自己選鏡頭：0.5× 按「手機超廣角」，1× 按「手機主鏡」。'+via);
}
async function loadProd(file){
  const im=await readFile(file);
  prodImg=im; usingDemoProd=false;
  $('nameProd').textContent=file.name;
  rebuildTrim(); rebuildProc(); refreshBadge(); paint();
}
function refreshBadge(){
  const b=$('demoBadge');
  b.hidden = !usingDemoRoom && !usingDemoProd;
  if(usingDemoRoom&&usingDemoProd) b.textContent='示範素材';
  else if(usingDemoRoom) b.textContent='示範場景 · 請上傳客戶照片';
  else if(usingDemoProd) b.textContent='示範商品 · 請上傳去背圖';
}
function wireDrop(wrapId,inputId,handler){
  const wrap=$(wrapId), input=$(inputId);
  input.addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    if(f) handler(f).catch(err=>flash(err.message));
  });
  ['dragenter','dragover'].forEach(t=>wrap.addEventListener(t,e=>{e.preventDefault();wrap.classList.add('over');}));
  ['dragleave','drop'].forEach(t=>wrap.addEventListener(t,e=>{e.preventDefault();wrap.classList.remove('over');}));
  wrap.addEventListener('drop',e=>{
    const f=e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f) handler(f).catch(err=>flash(err.message));
  });
}
wireDrop('dropRoom','f-room',loadRoom);
wireDrop('dropProd','f-prod',loadProd);

/* ============================================================
   輸出
   ============================================================ */
const inFrame = (()=>{ try{ return window.self!==window.top; }catch(_){ return true; } })();
/* 一鍵重設：所有調整回到預設，保留已載入的照片與 EXIF 讀到的鏡頭視角。
   不做確認對話框 —— 直接重設，並在訊息列提供「復原」。 */
function syncAll(){
  syncUI(); syncCamPresets(); markChips(); lightLabel();
  setFovSource($('fov-src').textContent, false);
  rebuildTrim(); rebuildProc(); paint();
}
function exitModes(){
  if(S.lightMode) setLightMode(false);
  S.vpMode=false; S.compare=false;
  $('btn-vp').classList.remove('on');
  $('btn-vp').textContent='用消失點自動校正';
  $('btn-vp-apply').hidden=true;
  $('btn-compare').classList.remove('on');
}
$('btn-reset').addEventListener('click',()=>{
  const before=JSON.parse(JSON.stringify(S));
  const fov=S.fov, fovSrc=$('fov-src').textContent, fovAuto=/EXIF/.test(fovSrc);
  Object.assign(S, JSON.parse(JSON.stringify(DEFAULTS)));
  S.fov=fov;                                   // 鏡頭視角來自照片本身，不是使用者的調整
  exitModes();
  syncAll();
  setFovSource(fovSrc, fovAuto);
  flash('已重設所有調整。照片與鏡頭視角保留。', '復原', ()=>{
    Object.assign(S, before);
    exitModes(); syncAll(); setFovSource(fovSrc, fovAuto);
    flash('已復原到重設前的設定。');
  });
});

$('btn-export').addEventListener('click',()=>{
  if(!roomImg||!prodImg) return;
  const out=cvs(roomImg.width,roomImg.height);
  const oc=out.getContext('2d');
  const wasCompare=S.compare; S.compare=false;
  render(oc,1,false);
  S.compare=wasCompare;
  const url=out.toDataURL('image/png');
  $('sheet-img').src=url;
  setupShare(out);
  $('sheet-msg').innerHTML = inFrame
    ? '在圖片上<b>按右鍵 → 另存圖片</b>（手機請長按）即可儲存原始解析度的合成圖。'
    : '合成圖已產生（'+roomImg.width+'×'+roomImg.height+'）。可直接下載，或在圖片上按右鍵另存。';
  const dl=$('btn-dl');
  dl.hidden=inFrame;
  dl.onclick=()=>{
    const a=document.createElement('a');
    a.href=url; a.download='lg-visualizer-'+Date.now()+'.png';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('sheet').hidden=false;
});
/* 手機上「長按另存」很笨拙。系統分享選單可以直接存到相簿、傳 LINE 給客戶，
   而且圖片仍然沒有離開裝置 —— 是使用者自己決定要分享給誰。 */
function setupShare(canvas){
  const btn=$('btn-share');
  btn.hidden=true;
  if(!(navigator.canShare && navigator.share)) return;
  btn.hidden=false;
  btn.onclick=async ()=>{
    btn.disabled=true;
    try{
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const file=new File([blob],'LG-空間預覽-'+Date.now()+'.png',{type:'image/png'});
      if(!navigator.canShare({files:[file]})){ flash('這個瀏覽器不支援分享圖片，請長按圖片另存。'); return; }
      await navigator.share({files:[file], title:'空間合成圖'});
    }catch(err){
      if(err && err.name!=='AbortError') flash('分享未完成，可以改用長按圖片另存。');
    }finally{ btn.disabled=false; }
  };
}

$('btn-close').addEventListener('click',()=>{ $('sheet').hidden=true; $('sheet-img').removeAttribute('src'); });
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  $('sheet').hidden=true;
  if(S.lightMode) setLightMode(false);
  if(S.vpMode){ S.vpMode=false; $('btn-vp').classList.remove('on');
    $('btn-vp').textContent='用消失點自動校正'; $('btn-vp-apply').hidden=true; paint(); }
});

/* ============================================================
   啟動：載入示範素材，工具一開就是可操作狀態
   ============================================================ */
roomImg=demoRoom();
prodImg=demoProduct();
buildRoomSmall();
rebuildTrim();
rebuildProc();
refreshBadge();
syncUI();
syncCamPresets();
markChips();
lightLabel();
paint();
window.addEventListener('resize',paint);

/* 離線可用：客戶家裡、地下室、電梯間收訊差時工具照樣能跑。
   失敗時要留下原因 —— 靜默吞掉錯誤等於讓問題無法診斷。 */
window.__sw='未嘗試';
if('serviceWorker' in navigator && (location.protocol==='https:' || ['localhost','127.0.0.1'].includes(location.hostname))){
  window.__sw='註冊中…';
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').then(
      r=>{ window.__sw='已註冊 ✓ scope: '+r.scope; },
      e=>{ window.__sw='註冊失敗 ✗ '+(e&&e.message); console.warn('[SW] 註冊失敗：',e); }
    );
  });
}
})();
