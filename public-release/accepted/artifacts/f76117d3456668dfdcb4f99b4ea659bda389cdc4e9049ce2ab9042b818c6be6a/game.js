(() => {
'use strict';
// EMBER uses world units and a fixed 1/60 second rules clock. Public numbers round to 0.001.
const canvas=document.querySelector('#game'), shell=document.querySelector('#shell'), ctx=canvas.getContext('2d');
const W=360, STEP=1/60, G=800, WALL_L=24, WALL_R=336, CAP=4, R=10, REACH=225;
let dpr=1, viewH=640, scale=1, acc=0, last=performance.now(), audio=null, master=null;
let S, ledges=[], items=[], particles=[];
const input={dragging:false,originX:0,originY:0,dx:0,dy:0,pointerId:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd3=n=>Math.round(n*1000)/1000;
function hashSeed(v){let h=2166136261>>>0; for(const c of String(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)} return h||0x9e3779b9}
function rand(){let x=S.rngState>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;S.rngState=x>>>0;return (S.rngState>>>0)/4294967296}
function resize(){const r=shell.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);viewH=W*r.height/r.width;scale=r.width/W}
addEventListener('resize',resize);resize();
function generateTo(y){
  while(S.genY<y){
    const difficulty=clamp(S.genY/3500,0,1);
    const gap=100+rand()*35+difficulty*18;
    const prev=ledges[ledges.length-1];
    let x=clamp(prev.position.x+(rand()-.5)*(150+difficulty*20),72,288);
    // alternate toward open lanes often enough to create readable routes
    if(S.spawnIndex%4===0)x=clamp(rand()<.5?82:278,Math.max(72,prev.position.x-90),Math.min(288,prev.position.x+90));
    const half=38-rand()*7-difficulty*5, py=S.genY+gap;
    ledges.push({id:S.spawnIndex++,position:{x, y:py},halfWidth:half,active:true});
    // A prize asks the player to cross beyond the direct perch line.
    const side=x<W/2?1:-1;
    if(rand()<.82){const gy=py+40+rand()*42;items.push({id:S.itemIndex++,type:'glimmer',baseX:clamp(x+side*(62+rand()*40),58,302),position:{x:0,y:gy},active:true,visualRadius:8,collisionRadius:7,phase:rand()*6.283});}
    if(rand()<.72){const my=py+60+rand()*70;items.push({id:S.itemIndex++,type:'moth',baseX:clamp(x+side*(35+rand()*75),55,305),position:{x:0,y:my},active:true,visualRadius:13,collisionRadius:10,phase:rand()*6.283});}
    // occasional airborne staircase, offset from the safe ledge line
    if(S.spawnIndex%6===0){for(let k=0;k<2;k++){const my=py+82+k*78;items.push({id:S.itemIndex++,type:'moth',baseX:clamp(180+side*(42-k*55),55,305),position:{x:0,y:my},active:true,visualRadius:13,collisionRadius:10,phase:rand()*6.283});}}
    S.genY=py;
  }
  // New entities receive their deterministic drift position immediately.
  for(const it of items)if(it.position.x===0)it.position.x=it.baseX+(it.type==='moth'?Math.sin(S.tick*.025+it.phase)*14:Math.sin(S.tick*.018+it.phase)*3);
  items.sort((a,b)=>a.id-b.id);
}
function reset(seed=1){
  const session=S?.sessionBest||0;
  ledges=[];items=[];particles=[];
  S={phase:'ready',tick:0,elapsedMs:0,seed,rngState:hashSeed(seed),spawnIndex:1,itemIndex:1,genY:34,
    x:180,y:45,vx:0,vy:0,anchored:true,anchorKind:'ledge',anchorId:0,
    jumpsLeft:CAP,launches:0,midairLaunches:0,landings:0,refunds:0,glimmersCollected:0,
    chainCount:0,chainBest:0,bonus:0,height:0,score:0,sessionBest:session,rank:null,
    dampY:-125,dampSpeed:10,cameraY:0,lastEvent:null,burstFlash:0,landFlash:0,deadAt:0};
  ledges.push({id:0,position:{x:180,y:34},halfWidth:86,active:true});generateTo(1200);
  clearInput();acc=0;document.querySelector('#a11y').textContent='Pull down and release to launch.';
}
function clearInput(){input.dragging=false;input.originX=input.originY=input.dx=input.dy=0;input.pointerId=null}
function event(kind){S.lastEvent={kind,tick:S.tick}}
function startAudio(){
  if(audio)return; try{audio=new (window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=.18;master.connect(audio.destination)}catch(e){}
}
function tone(freq,dur,type='sine',vol=.25,slide=1){if(!audio)return;const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*slide),t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur)}
function sound(kind,n=0){if(kind==='launch')tone(170,.16,'triangle',.28,1.9);if(kind==='land'){tone(110,.2,'sine',.35,.65);tone(330,.1,'triangle',.12,1.25)}if(kind==='moth'){tone(340+n*38,.22,'square',.18,2.1);tone(800,.08,'sine',.12,.7)}if(kind==='glimmer')tone(740,.18,'sine',.2,1.5);if(kind==='chain')tone(420+n*55,.14,'triangle',.18+Math.min(n,6)*.025,1.35);if(kind==='dead')tone(180,.8,'sine',.25,.28)}
function puff(x,y,color,count=8,power=70){for(let i=0;i<count;i++){const a=Math.PI*2*i/count+Math.random()*.4,sp=power*(.4+Math.random()*.8);particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.35+Math.random()*.35,max:.7,color,size:2+Math.random()*3})}}
function addChain(){S.chainCount++;event('chain');sound('chain',S.chainCount);puff(S.x,S.y,'#ffb43b',5+Math.min(12,S.chainCount*2),55+S.chainCount*8)}
function launch(dx,dy){
  if(S.jumpsLeft<=0)return;
  // Convert drag from CSS pixels to world units, while preserving direction.
  const wx=dx/scale,wy=dy/scale,mag=Math.hypot(wx,wy);if(mag<9)return;
  const wasAir=!S.anchored,p=clamp((mag-7)/82,.24,1),speed=250+360*p;
  S.vx=-wx/mag*speed;S.vy=wy/mag*speed;S.anchored=false;S.anchorKind=null;S.anchorId=null;
  S.jumpsLeft--;S.launches++;event('launch');sound('launch');puff(S.x,S.y,'#ffc44d',8,75);
  if(wasAir){S.midairLaunches++;addChain()}
  if(S.phase==='ready')S.phase='playing';
}
function land(kind,id=null){
  const ended=S.chainCount;S.anchored=true;S.anchorKind=kind;S.anchorId=id;S.vx=S.vy=0;S.jumpsLeft=CAP;S.landings++;event('land');sound('land');S.landFlash=1;puff(S.x,S.y,'#ffe5a3',12+(ended>2?8:0),90);
  if(ended){S.chainBest=Math.max(S.chainBest,ended);S.bonus+=ended*ended*28;S.chainCount=0;event('chainBank');tone(260+ended*30,.35,'triangle',.3,1.7)}
}
function gameover(){if(S.phase==='gameover')return;S.phase='gameover';S.rank=S.score<700?'CINDER':S.score<1800?'FLAME':S.score<3500?'BLAZE':S.score<6000?'INFERNO':'STARFIRE';S.sessionBest=Math.max(S.sessionBest,S.score);S.deadAt=performance.now();clearInput();sound('dead');puff(S.x,S.y,'#9fb4c2',25,65);document.querySelector('#a11y').textContent=`Run over. ${S.score} points, rank ${S.rank}. Tap to climb again.`}
function updateItems(){for(const it of items){it.position.x=it.baseX+(it.type==='moth'?Math.sin(S.tick*.025+it.phase)*14:Math.sin(S.tick*.018+it.phase)*3);if(!it.active)continue;const rr=R+it.collisionRadius;if((S.x-it.position.x)**2+(S.y-it.position.y)**2<rr*rr){it.active=false;if(it.type==='glimmer'){S.glimmersCollected++;S.bonus+=Math.round(120*(1+S.chainCount*.32));event('glimmer');sound('glimmer');puff(it.position.x,it.position.y,'#8df5e7',14,80)}else{S.vy=Math.max(S.vy,285);S.jumpsLeft=Math.min(CAP,S.jumpsLeft+1);S.refunds++;event('bounce');sound('moth',S.chainCount);S.burstFlash=1;puff(it.position.x,it.position.y,'#ff7a51',18,120);addChain()}}}}
function step(){
  if(S.phase!=='playing')return;S.tick++;S.elapsedMs=S.tick*1000/60;
  const dt=STEP;S.burstFlash=Math.max(0,S.burstFlash-dt*4);S.landFlash=Math.max(0,S.landFlash-dt*5);
  if(S.tick%240===0)tone(58+Math.min(35,S.height/100),1.1,'sine',.055,.72);
  const oldY=S.y;
  if(S.anchored){if(S.anchorKind==='ledge'){const l=ledges.find(v=>v.id===S.anchorId);if(l){S.x=l.position.x;S.y=l.position.y+R+1}}else{S.y-=19*dt}}
  else{S.vy-=G*dt;S.x+=S.vx*dt;S.y+=S.vy*dt;S.vx*=.998;
    if(S.x-R<=WALL_L&&S.vx<0){S.x=WALL_L+R;land('wall')}else if(S.x+R>=WALL_R&&S.vx>0){S.x=WALL_R-R;land('wall')}
    if(!S.anchored&&S.vy<=0){for(const l of ledges){const top=l.position.y;if(oldY-R>=top&&S.y-R<=top&&Math.abs(S.x-l.position.x)<=l.halfWidth+R*.35){S.y=top+R+1;land('ledge',l.id);break}}}}
  updateItems();
  S.height=Math.max(S.height,S.y-45);const difficulty=1+S.height/2400;S.dampSpeed=11+S.height/260;S.dampY+=S.dampSpeed*dt;S.score=Math.max(0,Math.floor(S.height*2+S.bonus));
  const target=Math.max(0,S.y-viewH*.40);S.cameraY+=(target-S.cameraY)*.075;generateTo(S.y+REACH*2.5);
  if(S.dampY>=S.y-R*.3)gameover();
}
function pointerDown(e){e.preventDefault();startAudio();if(audio?.state==='suspended')audio.resume();if(S.phase==='gameover'){reset(S.seed);return}if(input.dragging)return;input.dragging=true;input.pointerId=e.pointerId;input.originX=e.clientX;input.originY=e.clientY;input.dx=input.dy=0;canvas.setPointerCapture?.(e.pointerId)}
function pointerMove(e){if(!input.dragging||e.pointerId!==input.pointerId)return;e.preventDefault();input.dx=e.clientX-input.originX;input.dy=e.clientY-input.originY}
function pointerUp(e){if(!input.dragging||e.pointerId!==input.pointerId)return;e.preventDefault();const dx=input.dx,dy=input.dy;clearInput();launch(dx,dy)}
canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',()=>clearInput());canvas.addEventListener('contextmenu',e=>e.preventDefault());
function sy(y){return viewH-(y-S.cameraY)}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function text(str,x,y,size,align='left',color='#fff',weight=700){ctx.font=`${weight} ${size}px ui-rounded,system-ui,sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(str,x,y)}
function drawBackground(t){
  const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,'#080711');g.addColorStop(.13,'#211828');g.addColorStop(.3,'#11101d');g.addColorStop(.7,'#12111f');g.addColorStop(.87,'#241927');g.addColorStop(1,'#070710');ctx.fillStyle=g;ctx.fillRect(0,0,W,viewH);
  // deep brick courses and soot scratches
  ctx.globalAlpha=.16;ctx.strokeStyle='#8c5261';ctx.lineWidth=1;
  for(let y=((S.cameraY*.35)%42)-42;y<viewH;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();for(let x=((Math.floor(y/42)&1)?34:4);x<W;x+=68){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+42);ctx.stroke()}}
  ctx.globalAlpha=.22;for(let i=0;i<9;i++){const x=38+i*37+Math.sin(i*9)*8;ctx.fillStyle=i%2?'#2b1d31':'#0a0912';ctx.fillRect(x,0,2+((i*7)%4),viewH)}ctx.globalAlpha=1;
  // walls, with warm inner rims
  const lg=ctx.createLinearGradient(0,0,36,0);lg.addColorStop(0,'#03030a');lg.addColorStop(.65,'#18101b');lg.addColorStop(1,'#59323a');ctx.fillStyle=lg;ctx.fillRect(0,0,WALL_L,viewH);
  const rg=ctx.createLinearGradient(W,0,W-36,0);rg.addColorStop(0,'#03030a');rg.addColorStop(.65,'#18101b');rg.addColorStop(1,'#59323a');ctx.fillStyle=rg;ctx.fillRect(WALL_R,0,W-WALL_R,viewH);
  ctx.strokeStyle='#b26454';ctx.globalAlpha=.45;ctx.beginPath();ctx.moveTo(WALL_L+.5,0);ctx.lineTo(WALL_L+.5,viewH);ctx.moveTo(WALL_R-.5,0);ctx.lineTo(WALL_R-.5,viewH);ctx.stroke();ctx.globalAlpha=1;
}
function drawLedge(l){const y=sy(l.position.y);if(y<-30||y>viewH+25)return;const x=l.position.x-l.halfWidth,w=l.halfWidth*2;
  ctx.save();ctx.shadowColor='#000';ctx.shadowBlur=8;ctx.shadowOffsetY=5;ctx.fillStyle='#30212c';roundRect(x,y-4,w,13,5);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#7f4a48';roundRect(x+2,y-5,w-4,6,3);ctx.fill();ctx.fillStyle='#d07858';ctx.fillRect(x+8,y-5,w*.25,2);
  ctx.fillStyle='#19131e';ctx.beginPath();ctx.moveTo(x+8,y+8);ctx.lineTo(x+18,y+18);ctx.lineTo(x+25,y+8);ctx.moveTo(x+w-28,y+8);ctx.lineTo(x+w-18,y+16);ctx.lineTo(x+w-9,y+8);ctx.fill();ctx.restore()}
function drawGlimmer(it,t){const x=it.position.x,y=sy(it.position.y);if(y<-30||y>viewH+30)return;ctx.save();ctx.translate(x,y);ctx.rotate(t*.8+it.phase);ctx.shadowColor='#7fffea';ctx.shadowBlur=15;ctx.fillStyle='#b9fff0';ctx.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2?3:9;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r)}ctx.closePath();ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(-1,-6,2,12);ctx.restore()}
function drawMoth(it,t){const x=it.position.x,y=sy(it.position.y);if(y<-35||y>viewH+35)return;const flap=Math.sin(t*12+it.phase)*.55;ctx.save();ctx.translate(x,y);ctx.shadowColor='#e06445';ctx.shadowBlur=8;ctx.fillStyle='#6d3940';
  ctx.save();ctx.rotate(-.25-flap);ctx.beginPath();ctx.ellipse(-7,0,8,5,-.4,0,Math.PI*2);ctx.fill();ctx.restore();ctx.save();ctx.rotate(.25+flap);ctx.beginPath();ctx.ellipse(7,0,8,5,.4,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.fillStyle='#17111a';ctx.beginPath();ctx.ellipse(0,1,3.5,7,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d88660';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-1,-5);ctx.quadraticCurveTo(-5,-11,-8,-8);ctx.moveTo(1,-5);ctx.quadraticCurveTo(5,-11,8,-8);ctx.stroke();ctx.fillStyle='#ffb66c';ctx.fillRect(-1.5,-2,1,1);ctx.fillRect(.5,-2,1,1);ctx.restore()}
function drawDamp(t){const base=sy(S.dampY), breathe=Math.sin(t*2.1)*3;ctx.save();
  const grad=ctx.createLinearGradient(0,base-40,0,Math.max(base+120,viewH));grad.addColorStop(0,'rgba(143,190,197,0)');grad.addColorStop(.18,'rgba(93,139,151,.76)');grad.addColorStop(1,'#1d3b4b');ctx.fillStyle=grad;ctx.beginPath();ctx.moveTo(0,viewH);ctx.lineTo(0,base);
  for(let x=0;x<=W;x+=12){const reach=(Math.sin(x*.11+t*2.4)+Math.sin(x*.037-t*1.4))*7;ctx.lineTo(x,base+breathe-reach-(x%48===0?10:0))}ctx.lineTo(W,viewH);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(186,232,226,.55)';ctx.lineWidth=2;ctx.stroke();ctx.globalAlpha=.18;ctx.fillStyle='#d5ffff';for(let i=0;i<13;i++){const x=(i*71+t*13)%W,y=base+18+(i*31%95);ctx.beginPath();ctx.arc(x,y,2+(i%3),0,Math.PI*2);ctx.fill()}ctx.restore()}
function drawSpark(t){const x=S.x,y=sy(S.y);let angle=Math.atan2(-S.vy,S.vx),stretch=S.anchored?1:1+Math.min(.65,Math.hypot(S.vx,S.vy)/900);if(input.dragging)stretch=.82;ctx.save();ctx.translate(x,y);if(!S.anchored)ctx.rotate(angle);ctx.scale(stretch,1/stretch*.98);
  const flick=Math.sin(t*18)*1.3;ctx.shadowColor=S.phase==='gameover'?'#66828c':'#ff8a2a';ctx.shadowBlur=18+S.burstFlash*18;ctx.fillStyle=S.phase==='gameover'?'#566875':'#ff9e2f';ctx.beginPath();ctx.moveTo(-8,6);ctx.quadraticCurveTo(-11,-3,-4,-10-flick);ctx.quadraticCurveTo(0,-17-flick,4,-10);ctx.quadraticCurveTo(12,-3,8,7);ctx.quadraticCurveTo(0,13,-8,6);ctx.fill();ctx.fillStyle=S.phase==='gameover'?'#8a9ba4':'#ffe36a';ctx.beginPath();ctx.ellipse(0,2,6.5,8,0,0,Math.PI*2);ctx.fill();
  // expressions in local flight orientation
  ctx.shadowBlur=0;ctx.fillStyle='#291722';let ey=-1;
  if(S.phase==='gameover'){ctx.globalAlpha=.5;ctx.fillRect(-4,ey,3,1);ctx.fillRect(1,ey,3,1)}
  else if(!S.anchored&&S.jumpsLeft===0&&S.vy<0){ctx.fillStyle='#fff8d7';ctx.beginPath();ctx.arc(-3,ey,2.5,0,7);ctx.arc(3,ey,2.5,0,7);ctx.fill();ctx.fillStyle='#291722';ctx.beginPath();ctx.arc(-3,ey,1,0,7);ctx.arc(3,ey,1,0,7);ctx.fill();ctx.beginPath();ctx.arc(0,5,1.8,0,7);ctx.fill()}
  else if(input.dragging){ctx.fillRect(-5,ey,4,1.5);ctx.fillRect(1,ey,4,1.5);ctx.beginPath();ctx.arc(0,5,2,Math.PI,0);ctx.strokeStyle='#291722';ctx.stroke()}
  else if(S.anchorKind==='wall'){ctx.fillRect(-5,ey-1,3,1.5);ctx.fillRect(2,ey+1,3,1.5);ctx.fillRect(-2,5,4,1)}
  else if(!S.anchored){ctx.fillStyle='#fff8d7';ctx.beginPath();ctx.arc(-3,ey,2,0,7);ctx.arc(3,ey,2,0,7);ctx.fill();ctx.fillStyle='#291722';ctx.beginPath();ctx.arc(-3,ey,1,0,7);ctx.arc(3,ey,1,0,7);ctx.fill();ctx.beginPath();ctx.arc(0,4,3,0,Math.PI);ctx.strokeStyle='#291722';ctx.lineWidth=1.4;ctx.stroke()}
  else{const blink=Math.sin(t*.8)>0.985;ctx.fillRect(-5,ey,4,blink?1:2);ctx.fillRect(1,ey,4,blink?1:2);ctx.beginPath();ctx.arc(0,4,2.5,0,Math.PI);ctx.strokeStyle='#291722';ctx.stroke()}
  ctx.restore();
}
function drawAim(){if(!input.dragging)return;const ox=(input.originX-shell.getBoundingClientRect().left)/scale,oy=(input.originY-shell.getBoundingClientRect().top)/scale,dx=input.dx/scale,dy=input.dy/scale,mag=Math.hypot(dx,dy);ctx.save();ctx.lineCap='round';ctx.strokeStyle='rgba(255,213,108,.35)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+dx,oy+dy);ctx.stroke();ctx.fillStyle='#ffe584';ctx.beginPath();ctx.arc(ox,oy,5,0,7);ctx.fill();
  if(mag>9){const power=clamp((mag-7)/82,.24,1),len=42+power*55,a=Math.atan2(-dy,-dx),sx=S.x,yy=sy(S.y);ctx.strokeStyle='#ffd15c';ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(sx,yy);ctx.lineTo(sx+Math.cos(a)*len,yy+Math.sin(a)*len);ctx.stroke();ctx.setLineDash([]);const ex=sx+Math.cos(a)*len,ey=yy+Math.sin(a)*len;ctx.fillStyle='#ffd15c';ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-Math.cos(a-.55)*9,ey-Math.sin(a-.55)*9);ctx.lineTo(ex-Math.cos(a+.55)*9,ey-Math.sin(a+.55)*9);ctx.fill()}ctx.restore()}
function drawHUD(){ctx.save();ctx.fillStyle='rgba(8,7,16,.62)';roundRect(12,12,W-24,53,14);ctx.fill();text('EMBER',25,31,15,'left','#ffd76a',900);text(`${S.score}`,25,51,13,'left','#fff1d1',800);text(`${Math.floor(S.height)}m`,W/2,34,17,'center','#efe6e4',800);text('BEST '+S.sessionBest,W/2,53,9,'center','#9d929d',700);
  for(let i=0;i<CAP;i++){const x=W-29-i*19;ctx.globalAlpha=i<S.jumpsLeft?1:.18;ctx.shadowColor='#ff8f28';ctx.shadowBlur=i<S.jumpsLeft?8:0;ctx.fillStyle='#ffbd45';ctx.beginPath();ctx.moveTo(x,47);ctx.quadraticCurveTo(x-7,40,x,29);ctx.quadraticCurveTo(x+7,40,x,47);ctx.fill()}ctx.globalAlpha=1;ctx.shadowBlur=0;
  if(S.chainCount){ctx.fillStyle='rgba(71,30,38,.8)';roundRect(W/2-57,76,114,32,16);ctx.fill();text(`AIR CHAIN × ${S.chainCount}`,W/2,92,12,'center','#ffc25c',900)}ctx.restore()}
function drawOverlay(t){if(S.phase==='ready'){ctx.save();const y=sy(S.y)-67;ctx.globalAlpha=.82+.15*Math.sin(t*3);text('PULL  ·  RELEASE',W/2,y,12,'center','#ffe6ad',800);ctx.strokeStyle='#ffe6ad';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(W/2,y+17);ctx.lineTo(W/2,y+39);ctx.lineTo(W/2-5,y+32);ctx.moveTo(W/2,y+39);ctx.lineTo(W/2+5,y+32);ctx.stroke();ctx.restore()}
  if(S.phase==='gameover'){const p=clamp((performance.now()-S.deadAt)/500,0,1);ctx.save();ctx.globalAlpha=p;ctx.fillStyle='rgba(7,8,16,.88)';ctx.fillRect(0,0,W,viewH);const cy=viewH*.45;ctx.fillStyle='#201a29';roundRect(24,cy-150,W-48,300,24);ctx.fill();ctx.strokeStyle='#71434a';ctx.lineWidth=1;ctx.stroke();text('THE DAMP TOOK THE LIGHT',W/2,cy-117,11,'center','#9fbac0',900);text(S.rank,W/2,cy-76,25,'center','#ffc75c',900);text('SCORE',94,cy-28,9,'center','#8e8491');text(String(S.score),94,cy-6,23,'center','#fff2dc',900);text('SESSION BEST',266,cy-28,9,'center','#8e8491');text(String(S.sessionBest),266,cy-6,23,'center','#fff2dc',900);ctx.strokeStyle='#493443';ctx.beginPath();ctx.moveTo(55,cy+24);ctx.lineTo(305,cy+24);ctx.stroke();text('BEST AIR CHAIN',W/2,cy+48,9,'center','#a99ba5');text(`× ${S.chainBest}`,W/2,cy+72,22,'center','#ffad4f',900);text('TAP ANYWHERE TO GLOW AGAIN',W/2,cy+122,11,'center','#f5ddba',800);ctx.restore()}}
function render(now){const t=now/1000;ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);ctx.clearRect(0,0,W,viewH);drawBackground(t);for(const l of ledges)drawLedge(l);for(const it of items)if(it.active)(it.type==='moth'?drawMoth(it,t):drawGlimmer(it,t));drawDamp(t);
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=1/60;p.x+=p.vx/60;p.y+=p.vy/60;p.vy-=2;ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,sy(p.y),p.size,0,7);ctx.fill();if(p.life<=0)particles.splice(i,1)}ctx.globalAlpha=1;drawSpark(t);drawAim();drawHUD();drawOverlay(t)}
function frame(now){const delta=Math.min(.1,(now-last)/1000);last=now;if(S.phase==='playing'){acc+=delta;while(acc>=STEP){step();acc-=STEP}}render(now);requestAnimationFrame(frame)}
function snapshot(){
  const lo=S.y-REACH,hi=S.y+REACH*2;const pos=o=>({x:rnd3(o.x),y:rnd3(o.y)});
  return Object.freeze({phase:S.phase,tick:S.tick,elapsedMs:rnd3(S.elapsedMs),seed:S.seed,rngState:S.rngState>>>0,spawnIndex:S.spawnIndex,input:{dragging:input.dragging,originX:rnd3(input.originX),originY:rnd3(input.originY),dx:rnd3(input.dx),dy:rnd3(input.dy)},difficulty:rnd3(1+S.height/2400),score:S.score,height:rnd3(S.height),sessionBest:S.sessionBest,rank:S.rank,
    x:rnd3(S.x),y:rnd3(S.y),vx:rnd3(S.vx),vy:rnd3(S.vy),playerRadius:R,anchored:S.anchored,anchorKind:S.anchorKind,
    jumpCapacity:CAP,jumpsLeft:S.jumpsLeft,launches:S.launches,midairLaunches:S.midairLaunches,landings:S.landings,refunds:S.refunds,glimmersCollected:S.glimmersCollected,
    chainCount:S.chainCount,chainBest:S.chainBest,dampY:rnd3(S.dampY),dampSpeed:rnd3(S.dampSpeed),wallLeftX:WALL_L,wallRightX:WALL_R,launchReach:REACH,
    ledges:ledges.filter(l=>l.position.y>=lo&&l.position.y<=hi).map(l=>({id:l.id,position:pos(l.position),halfWidth:rnd3(l.halfWidth),active:l.active})),
    items:items.filter(it=>it.position.y>=lo&&it.position.y<=hi).map(it=>({id:it.id,type:it.type,position:pos(it.position),active:it.active,visualRadius:it.visualRadius,collisionRadius:it.collisionRadius})),lastEvent:S.lastEvent?{...S.lastEvent}:null});
}
window.__ARENA_GAME__={reset,snapshot};reset(1);requestAnimationFrame(frame);
})();
