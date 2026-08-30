(() => {
'use strict';
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const movePad = document.getElementById('movePad'), jumpPad = document.getElementById('jumpPad');
const W=390,H=700, GROUND=535, LOW=330, HIGH=205, STEP=1000/60;
const MR=24, BR=10, MACHINE_GROUND_Y=GROUND-24;
let S, accumulator=0, lastFrame=performance.now(), realVisual=0, audio=null;
let particles=[], shakes=0, flashes=[];
const held={left:false,right:false,padAxis:0};

function hashSeed(v){let s=String(v??'stomp');let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0||1}
function rand(){let x=S.rngState>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;S.rngState=x>>>0;return (S.rngState>>>0)/4294967296}
function rank(score){return score>=10000?'S':score>=6500?'A':score>=3500?'B':score>=1500?'C':score>=500?'D':'ROOKIE'}
function makeState(seed){const n=hashSeed(seed);return {
 phase:'ready',tick:0,elapsedMs:0,remainingMs:75000,seed:seed??'stomp',rngState:n,score:0,difficulty:0,
 machine:{x:195,y:MACHINE_GROUND_Y,vx:0,vy:0,radius:MR,grounded:true,jumpCount:0},
 ball:{x:195,y:MACHINE_GROUND_Y-MR-BR+1,vx:0,vy:0,radius:BR,active:true,lastBounceKind:null},
 input:{left:false,right:false,axis:0,jump:false}, counters:{topHits:0,airEnemiesDefeated:0,wrongSideHits:0,ballDrops:0,longestCleanSequence:0},
 enemies:[],events:[],eventSeq:0,nextId:1, openingLow:false,openingHigh:false,nextAirAt:1000,nextWalkerAt:18000,
 currentClean:0,firstDefeat:false, gameOverAt:0
}}
function reset(seed=S?.seed??'stomp'){S=makeState(seed);accumulator=0;particles=[];flashes=[];shakes=0;held.left=held.right=false;held.padAxis=0;movePad.classList.remove('active');jumpPad.classList.remove('active');return snapshot()}
function emit(kind, enemyId=null, amountMs=0, source='system', contact='body'){
 const e={sequence:++S.eventSeq,kind,tick:S.tick,enemyId,amountMs:Math.round(amountMs),source,contact};
 S.events.push(e);if(S.events.length>80)S.events.shift();return e;
}
function begin(){if(S.phase==='ready'){S.phase='running';S.ball.vy=-600;S.ball.vx=S.input.axis*110;S.ball.lastBounceKind='normal';emit('ball_bounce_normal',null,0,'machine','top');tone(230,.07,'square',.08)}}
function setInput(){S.input.left=held.left;S.input.right=held.right;S.input.axis=Math.max(-1,Math.min(1,(held.right?1:0)-(held.left?1:0)+held.padAxis))}
function queueJump(){if(S.phase==='ended'){reset(S.seed);return}begin();S.input.jump=true}
function eventPenalty(ms,kind,id,source,contact){S.remainingMs=Math.max(0,S.remainingMs-ms);emit(kind,id,-ms,source,contact);shakes=Math.max(shakes,kind==='ball_drop'?9:5);tone(85,.15,'sawtooth',.1)}
function difficulty(){const d=S.score>=7000?3:S.score>=3500?2:S.score>=1200?1:0;S.difficulty=Math.max(S.difficulty,d)}
function spawnAir(lane, forcedSlow=false){
 const type=(!forcedSlow&&S.firstDefeat&&S.difficulty>=1&&rand()<.3+.12*S.difficulty)?'fastFlyer':'slowFlyer';
 const dir=rand()<.5?1:-1, r=type==='slowFlyer'?25:21;
 S.enemies.push({id:S.nextId++,type,lane,x:dir>0?-r-3:W+r+3,y:lane==='low'?LOW:HIGH,vx:dir*(type==='slowFlyer'?25:42+S.difficulty*5),active:true,hitsTaken:0,hitsRequired:3,visualRadius:r,collisionRadius:r*.92,contact:false,deadAge:0,flash:0});
}
function spawnWalker(){const dir=rand()<.5?1:-1,r=16;S.enemies.push({id:S.nextId++,type:'walker',lane:'ground',x:dir>0?-20:W+20,y:GROUND-r,vx:dir*(31+S.difficulty*4),active:true,hitsTaken:0,hitsRequired:1,visualRadius:r,collisionRadius:15,contact:false,deadAge:0,flash:0})}
function addParticles(x,y,color,n,power=1){for(let i=0;i<n;i++){const a=(i/n)*Math.PI*2+rand()*.4,sp=(40+rand()*130)*power;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.35+rand()*.35,max:.7,color,size:2+rand()*3})}}
function bounce(kind){const b=S.ball,m=S.machine;b.y=m.y-MR-BR+1;b.vx=Math.max(-190,Math.min(190,b.vx*.45+m.vx*.48));if(kind==='power')b.vy=-735;else if(kind==='normal')b.vy=-600;else b.vy=-440;b.lastBounceKind=kind;emit('ball_bounce_'+kind,null,0,'machine','top');m.squash=.16;addParticles(b.x,b.y+8,kind==='power'?'#fff19a':'#76ecff',kind==='power'?10:5,.6);tone(kind==='power'?390:kind==='normal'?290:190,.07,'square',.07)}
function topHit(e){
 e.contact=true;e.hitsTaken++;e.flash=.2;S.counters.topHits++;S.currentClean++;S.counters.longestCleanSequence=Math.max(S.counters.longestCleanSequence,S.currentClean);
 const rewards=[1500,3000,7000], points=[100,250,750],i=e.hitsTaken-1;S.remainingMs+=rewards[i];S.score+=points[i];emit('top_hit',e.id,rewards[i],'ball','top');
 S.ball.y=e.y-e.collisionRadius-BR-1;S.ball.vy=-(430+e.hitsTaken*25);S.ball.vx+=e.vx*.25;shakes=3+e.hitsTaken;flashes.push({x:e.x,y:e.y,life:.18,color:'#fff39a'});addParticles(e.x,e.y-e.visualRadius,'#ffe777',6+e.hitsTaken*3,.7);tone(430+e.hitsTaken*120,.09,'triangle',.1);
 if(e.hitsTaken>=3){e.active=false;e.deadAge=0;S.score+=600;S.counters.airEnemiesDefeated++;S.firstDefeat=true;emit('enemy_defeated',e.id,0,'ball','top');addParticles(e.x,e.y,'#ff6fcf',28,1.2);flashes.push({x:e.x,y:e.y,life:.45,color:'#ff7ee7'});shakes=10;tone(760,.2,'square',.12)}
 difficulty();
}
function update(dt){
 if(S.phase!=='running')return;
 S.tick++;S.elapsedMs+=STEP;S.remainingMs-=STEP;difficulty();const m=S.machine,b=S.ball;
 const axis=S.input.axis,target=axis*245;m.vx+=(target-m.vx)*Math.min(1,dt*12);m.x+=m.vx*dt;m.x=Math.max(MR+7,Math.min(W-MR-7,m.x));
 if(S.input.jump&&m.grounded){m.grounded=false;m.vy=-330;m.jumpCount++;emit('machine_jump',null,0,'machine','body');tone(170,.05,'square',.06)}S.input.jump=false;
 if(!m.grounded){m.vy+=900*dt;m.y+=m.vy*dt;if(m.y>=MACHINE_GROUND_Y){m.y=MACHINE_GROUND_Y;m.vy=0;m.grounded=true;emit('machine_land',null,0,'machine','body');tone(110,.04,'square',.04)}}
 if(m.squash)m.squash=Math.max(0,m.squash-dt);
 const prevBallY=b.y;b.vy+=760*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
 if(b.x<BR+4){b.x=BR+4;b.vx=Math.abs(b.vx)*.78}else if(b.x>W-BR-4){b.x=W-BR-4;b.vx=-Math.abs(b.vx)*.78}
 // machine's authored top is a narrow, honest surface
 const top=m.y-MR+3;
 if(b.vy>0 && prevBallY+BR<=top+5 && b.y+BR>=top && Math.abs(b.x-m.x)<=MR*.9+BR*.35){bounce(m.vy< -25?'power':m.grounded?'normal':'weak')}
 // opening promise and bounded later patterns
 if(!S.openingLow&&S.elapsedMs>=1000){spawnAir('low',true);S.openingLow=true;S.nextAirAt=S.elapsedMs+5200}
 else if(!S.openingHigh&&S.elapsedMs>=6000){spawnAir('high',true);S.openingHigh=true;S.nextAirAt=S.elapsedMs+7000}
 else if(S.elapsedMs>=S.nextAirAt){const activeAir=S.enemies.filter(e=>e.active&&e.lane!=='ground').length;if(activeAir<(S.firstDefeat&&S.difficulty>=2?2:1)){spawnAir(rand()<.58?'low':'high',!S.firstDefeat);S.nextAirAt=S.elapsedMs+(S.firstDefeat?5000+rand()*3500:1800)}else S.nextAirAt+=1000}
 if(S.elapsedMs>=S.nextWalkerAt){if(S.enemies.filter(e=>e.active&&e.type==='walker').length===0)spawnWalker();S.nextWalkerAt=S.elapsedMs+13000+rand()*8000}
 for(const e of S.enemies){
   if(!e.active){e.deadAge+=dt;continue}e.x+=e.vx*dt;e.flash=Math.max(0,e.flash-dt);
   if(e.x < -e.visualRadius-35 || e.x > W+e.visualRadius+35){e.active=false;e.deadAge=0;if(e.lane!=='ground'&&!S.firstDefeat)S.nextAirAt=Math.min(S.nextAirAt,S.elapsedMs+1400);continue}
   if(e.type==='walker'){
     const dx=m.x-e.x,dy=m.y-e.y,rr=MR*.82+e.collisionRadius;
     if(dx*dx+dy*dy<rr*rr){if(!e.contact){if(m.vy>20&&m.y<e.y-8){e.active=false;e.deadAge=0;m.vy=-220;S.score+=80;emit('ground_stomp',e.id,0,'machine','top');addParticles(e.x,e.y,'#7fffe2',12,.7);tone(260,.08,'square',.07)}else eventPenalty(2200,'wrong_side_hit',e.id,'machine','body');e.contact=true}}else e.contact=false;
   }else{
     const dx=b.x-e.x,dy=b.y-e.y,rr=BR+e.collisionRadius, overlap=dx*dx+dy*dy<rr*rr;
     const eTop=e.y-e.collisionRadius;
     const valid=b.vy>0&&prevBallY+BR<=eTop+4&&b.y+BR>=eTop&&Math.abs(dx)<=e.collisionRadius*.84;
     if(valid&&!e.contact)topHit(e);else if(overlap&&!e.contact){e.contact=true;S.counters.wrongSideHits++;S.currentClean=0;eventPenalty(2500,'wrong_side_hit',e.id,'ball','non_top');b.vx+=(dx>=0?1:-1)*85;b.vy*=.55;e.flash=.2}else if(!overlap)e.contact=false;
   }
 }
 S.enemies=S.enemies.filter(e=>e.active||e.deadAge<1.15);
 if(b.y-BR>GROUND){S.counters.ballDrops++;S.currentClean=0;eventPenalty(5500,'ball_drop',null,'ball','body');b.x=m.x;b.y=m.y-MR-BR-72;b.vx=0;b.vy=20;b.lastBounceKind=null;flashes.push({x:m.x,y:GROUND-5,life:.35,color:'#ff557a'});addParticles(m.x,GROUND-3,'#ff4d77',15,.8)}
 for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=220*dt;p.life-=dt}particles=particles.filter(p=>p.life>0);for(const f of flashes)f.life-=dt;flashes=flashes.filter(f=>f.life>0);shakes=Math.max(0,shakes-dt*22);
 if(S.remainingMs<=0){S.remainingMs=0;S.phase='ended';S.gameOverAt=S.tick;tone(70,.4,'sawtooth',.1)}
}
function advance(ms){if(S.phase!=='running'||ms<=0)return snapshot();accumulator+=ms;while(accumulator+1e-7>=STEP&&S.phase==='running'){update(STEP/1000);accumulator-=STEP}return snapshot()}
function snapshot(){
 const enemies=S.enemies.slice().sort((a,b)=>a.id-b.id).map(e=>({id:e.id,type:e.type,lane:e.lane,x:+e.x.toFixed(3),y:+e.y.toFixed(3),vx:+e.vx.toFixed(3),active:e.active,hitsTaken:e.hitsTaken,hitsRequired:e.hitsRequired,visualRadius:e.visualRadius,collisionRadius:+e.collisionRadius.toFixed(3)}));
 const ent=o=>({x:+o.x.toFixed(3),y:+o.y.toFixed(3),vx:+o.vx.toFixed(3),vy:+o.vy.toFixed(3),radius:o.radius});
 return {phase:S.phase,tick:S.tick,elapsedMs:Math.round(S.elapsedMs),remainingMs:Math.max(0,Math.round(S.remainingMs)),seed:S.seed,rngState:S.rngState>>>0,score:S.score,difficulty:S.difficulty,rank:rank(S.score),input:{...S.input},groundY:GROUND,lowLaneY:LOW,highLaneY:HIGH,machineNormalApexY:450,machine:{...ent(S.machine),grounded:S.machine.grounded,jumpCount:S.machine.jumpCount},ball:{...ent(S.ball),active:S.ball.active,lastBounceKind:S.ball.lastBounceKind},topHits:S.counters.topHits,airEnemiesDefeated:S.counters.airEnemiesDefeated,wrongSideHits:S.counters.wrongSideHits,ballDrops:S.counters.ballDrops,longestCleanSequence:S.counters.longestCleanSequence,enemies,recentEvents:S.events.map(e=>({...e})),lastEvent:S.events.length?{...S.events[S.events.length-1]}:null}
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function text(t,x,y,size,color='#fff',align='center',weight=800){ctx.font=`${weight} ${size}px ui-rounded,system-ui,sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(t,x,y)}
function render(t){
 realVisual=t/1000;const panic=S.phase==='running'&&S.remainingMs<10000;let sx=shakes?(Math.sin(t*.13)*shakes):0,sy=shakes?(Math.cos(t*.17)*shakes*.45):0;ctx.save();ctx.translate(sx,sy);
 const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,panic?'#211126':'#11142f');bg.addColorStop(.62,'#0b1026');bg.addColorStop(1,'#070916');ctx.fillStyle=bg;ctx.fillRect(-12,-12,W+24,H+24);
 // distant kinetic stage
 ctx.globalAlpha=.15;ctx.strokeStyle='#8c73ff';ctx.lineWidth=1;for(let x=20;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,76);ctx.lineTo(x-70,GROUND);ctx.stroke()}ctx.globalAlpha=1;
 const glow=ctx.createRadialGradient(195,310,20,195,310,240);glow.addColorStop(0,'rgba(52,219,255,.09)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,70,W,470);
 // header
 text('STOMP',18,30,16,'#f5eeff','left',950);text(String(S.score).padStart(6,'0'),18,52,11,'#7da1c6','left',700);
 const sec=Math.ceil(S.remainingMs/1000), clockColor=panic?(Math.sin(t*.012)>0?'#ff5577':'#fff'):'#ffdf70';text(`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`,W-17,38,25,clockColor,'right',900);
 ctx.fillStyle='#27304b';rr(W-128,49,111,4,2);ctx.fill();ctx.fillStyle=panic?'#ff4b72':'#63e3ff';rr(W-128,49,111*Math.min(1,S.remainingMs/75000),4,2);ctx.fill();
 // lanes: top-lit, dangerous underside
 drawLane(HIGH,'HIGH ARC','#bd7aff',t);drawLane(LOW,'LOW ARC','#43dff5',t+900);
 // side columns and floor
 ctx.fillStyle='#181a36';ctx.fillRect(0,74,8,GROUND-74);ctx.fillRect(W-8,74,8,GROUND-74);ctx.fillStyle='#242444';ctx.fillRect(0,GROUND,W,7);ctx.fillStyle='#5dd8e8';ctx.fillRect(0,GROUND, W,2);
 for(let x=7;x<W;x+=28){ctx.fillStyle=(x/28%2|0)?'#151a30':'#11152a';ctx.beginPath();ctx.moveTo(x,GROUND+7);ctx.lineTo(x+20,GROUND+7);ctx.lineTo(x+8,575);ctx.lineTo(x-12,575);ctx.fill()}
 // enemies behind protagonists
 for(const e of S.enemies)drawEnemy(e,t);
 drawMachine(S.machine,t);drawBall(S.ball,t);
 // effects
 for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 for(const f of flashes){ctx.globalAlpha=Math.min(1,f.life*4);ctx.strokeStyle=f.color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(f.x,f.y,(.5-f.life)*75+15,0,Math.PI*2);ctx.stroke()}ctx.globalAlpha=1;
 if(S.phase==='ready'){const bob=Math.sin(realVisual*3)*2;text('MOVE OR JUMP TO WAKE THE STAGE',W/2,102+bob,10,'#c6b8dc','center',700)}
 if(S.phase==='ended')drawEnd();
 ctx.restore();
}
function drawLane(y,label,color,t){
 const pulse=.35+.18*Math.sin(t*.002);ctx.strokeStyle=color;ctx.globalAlpha=pulse;ctx.lineWidth=2;ctx.setLineDash([2,11]);ctx.beginPath();ctx.moveTo(11,y);ctx.lineTo(W-11,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=.75;text(label,15,y-10,8,color,'left',800);ctx.globalAlpha=1;
}
function drawEnemy(e,t){
 const dead=!e.active, fade=dead?Math.max(0,1-e.deadAge):1;ctx.save();ctx.globalAlpha=fade;ctx.translate(e.x,e.y);if(dead){ctx.rotate(e.deadAge*4);ctx.scale(1+e.deadAge,Math.max(.05,1-e.deadAge))}
 if(e.type==='walker'){
   const step=Math.sin(t*.012+e.id)*3;ctx.fillStyle='#3a234c';rr(-15,-11,30,22,8);ctx.fill();ctx.fillStyle='#f05f9d';ctx.fillRect(-11,-11,22,5);ctx.fillStyle='#ffdc67';ctx.fillRect(e.vx>0?5:-9,-3,4,4);ctx.strokeStyle='#71e5d4';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-8,10);ctx.lineTo(-10+step,17);ctx.moveTo(8,10);ctx.lineTo(10-step,17);ctx.stroke();
 }else{
   const r=e.visualRadius, wing=Math.sin(t*.014+e.id)*5;ctx.shadowBlur=e.flash?22:8;ctx.shadowColor=e.flash?'#fff':'#8e5cff';
   // underside is magenta teeth, top is gold armor
   ctx.fillStyle=e.type==='fastFlyer'?'#342853':'#29305b';ctx.beginPath();ctx.ellipse(0,0,r,r*.62,0,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#ffd867';ctx.beginPath();ctx.ellipse(0,-r*.43,r*.78,6,0,Math.PI,Math.PI*2);ctx.fill();
   ctx.fillStyle='#fd5e9e';for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(i*7-3,r*.35);ctx.lineTo(i*7+1,r*.68);ctx.lineTo(i*7+5,r*.35);ctx.fill()}
   ctx.fillStyle='#a97cff';ctx.beginPath();ctx.moveTo(-r*.7,-2);ctx.lineTo(-r-10,-9-wing);ctx.lineTo(-r*.85,8);ctx.moveTo(r*.7,-2);ctx.lineTo(r+10,-9+wing);ctx.lineTo(r*.85,8);ctx.fill();
   for(let i=0;i<3;i++){ctx.fillStyle=i<e.hitsTaken?'#ff668f':'#10152e';ctx.beginPath();ctx.arc(-8+i*8,1,2.7,0,Math.PI*2);ctx.fill()}
   ctx.fillStyle='#fff';ctx.fillRect(e.vx>0?8:-12,-7,4,4);ctx.shadowBlur=0;
 }
 ctx.restore();
}
function drawMachine(m,t){
 ctx.save();ctx.translate(m.x,m.y);const idle=S.phase==='ready'?Math.sin(realVisual*3.2)*1.5:0,sq=m.squash?1+m.squash*1.2:1;ctx.scale(sq,1/sq);ctx.translate(0,idle);
 // treads
 ctx.fillStyle='#11162b';rr(-27,11,54,17,8);ctx.fill();ctx.strokeStyle='#52658a';ctx.lineWidth=2;ctx.stroke();for(let x=-17;x<=17;x+=17){ctx.fillStyle='#263555';ctx.beginPath();ctx.arc(x,19,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#67d9e9';ctx.stroke()}
 // warm little machine body
 const body=ctx.createLinearGradient(0,-25,0,15);body.addColorStop(0,'#f6b64e');body.addColorStop(1,'#cc5260');ctx.fillStyle=body;rr(-22,-24,44,40,12);ctx.fill();ctx.strokeStyle='#ffdc7d';ctx.lineWidth=2;ctx.stroke();
 // unmistakable top plate
 ctx.fillStyle='#d8fbff';rr(-23,-27,46,7,3);ctx.fill();ctx.shadowColor='#68eaff';ctx.shadowBlur=10;ctx.fillRect(-16,-28,32,3);ctx.shadowBlur=0;
 // eyes follow ball
 const look=Math.max(-2,Math.min(2,(S.ball.x-m.x)/35));ctx.fillStyle='#302442';rr(-13,-13,26,14,6);ctx.fill();ctx.fillStyle='#9ffaff';ctx.beginPath();ctx.arc(-6+look,-7,3,0,Math.PI*2);ctx.arc(6+look,-7,3,0,Math.PI*2);ctx.fill();
 if(S.phase==='ended'){ctx.strokeStyle='#a84d63';ctx.beginPath();ctx.moveTo(-7,4);ctx.quadraticCurveTo(0,-1,7,4);ctx.stroke()}else{ctx.strokeStyle='#fff0a3';ctx.beginPath();ctx.arc(0,1,6,.15,Math.PI-.15);ctx.stroke()}
 ctx.restore();
}
function drawBall(b,t){
 let y=b.y;if(S.phase==='ready')y+=Math.sin(realVisual*3.2)*1.5;const speed=Math.abs(b.vy),stretch=S.phase==='running'?Math.min(.22,speed/2500):.04*Math.sin(realVisual*4);ctx.save();ctx.translate(b.x,y);ctx.scale(1-stretch*.35,1+stretch);
 const g=ctx.createRadialGradient(-3,-4,1,0,0,BR+5);g.addColorStop(0,'#fff');g.addColorStop(.25,'#fff6a5');g.addColorStop(.65,'#ffb43d');g.addColorStop(1,'#ff5c82');ctx.fillStyle=g;ctx.shadowColor='#ffd85e';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(0,0,BR,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#50204d';ctx.beginPath();ctx.arc(-3,-1,1.2,0,Math.PI*2);ctx.arc(3,-1,1.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawEnd(){
 ctx.fillStyle='rgba(5,6,17,.82)';ctx.fillRect(0,70,W,505);ctx.fillStyle='rgba(24,24,55,.96)';rr(34,112,W-68,374,25);ctx.fill();ctx.strokeStyle='#8c73ff';ctx.lineWidth=1.5;ctx.stroke();
 text(rank(S.score),W/2,193,62,'#ffdc6e','center',950);text('RUN COMPLETE',W/2,220,10,'#9b8ec1','center',800);text(S.score.toLocaleString(),W/2,273,34,'#fff','center',900);text('SCORE',W/2,293,9,'#7284a9');
 const bestKey='stomp_best';let stored=0;try{stored=Number(localStorage.getItem(bestKey)||0)}catch{}const best=Math.max(S.score,stored);try{localStorage.setItem(bestKey,best)}catch{}
 const rows=[['SESSION BEST',best.toLocaleString()],['TARGETS BURST',S.counters.airEnemiesDefeated],['LONGEST PURSUIT',S.counters.longestCleanSequence]];rows.forEach((r,i)=>{text(r[0],67,333+i*34,10,'#8692b0','left');text(String(r[1]),323,333+i*34,14,'#dffaff','right')});
 text('TAP JUMP TO RUN IT BACK',W/2,455,10,'#ffe58a','center',850);
}
function tone(freq,dur,type='sine',vol=.05){
 try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(45,freq*.7),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+dur)}catch{}
}
let movePointer=null,moveOrigin=0;
movePad.addEventListener('pointerdown',e=>{e.preventDefault();movePointer=e.pointerId;moveOrigin=e.clientX;movePad.setPointerCapture(e.pointerId);movePad.classList.add('active')});
movePad.addEventListener('pointermove',e=>{if(e.pointerId!==movePointer)return;const a=Math.max(-1,Math.min(1,(e.clientX-moveOrigin)/55));held.padAxis=Math.abs(a)<.08?0:a;setInput();if(Math.abs(a)>=.08)begin()});
function releaseMove(e){if(e.pointerId!==movePointer)return;movePointer=null;held.padAxis=0;setInput();movePad.classList.remove('active')}
movePad.addEventListener('pointerup',releaseMove);movePad.addEventListener('pointercancel',releaseMove);
jumpPad.addEventListener('pointerdown',e=>{e.preventDefault();jumpPad.classList.add('active');queueJump()});
for(const k of ['pointerup','pointercancel','pointerleave'])jumpPad.addEventListener(k,()=>jumpPad.classList.remove('active'));
window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Space','KeyR'].includes(e.code))e.preventDefault();if(e.code==='KeyR'){reset(S.seed);return}if(e.code==='ArrowLeft'){held.left=true;setInput();begin()}if(e.code==='ArrowRight'){held.right=true;setInput();begin()}if(e.code==='Space'&&!e.repeat)queueJump()},{passive:false});
window.addEventListener('keyup',e=>{if(e.code==='ArrowLeft')held.left=false;if(e.code==='ArrowRight')held.right=false;setInput()});
window.addEventListener('blur',()=>{held.left=held.right=false;held.padAxis=0;setInput()});
function frame(now){const delta=Math.min(100,now-lastFrame);lastFrame=now;if(S.phase==='running')advance(delta);render(now);requestAnimationFrame(frame)}
reset('stomp');window.__ARENA_GAME__={reset,snapshot,advance};requestAnimationFrame(frame);
})();
