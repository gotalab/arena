(() => {
  'use strict';

  // EMBER simulation units: a 360-wide flue, y increases upward. Snapshot numbers are rounded to 1e-3.
  const W = 360, H = 640, STEP = 1 / 60, MAX_STEPS = 5;
  const WALL_L = 34, WALL_R = 326, R = 11, CAP = 4;
  const GRAVITY = -630, MAX_PULL = 112, DEAD = 12, MIN_POWER = 290, MAX_POWER = 620;
  const LAUNCH_REACH = (MAX_POWER * MAX_POWER) / (-2 * GRAVITY); // 305 world units
  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  const shell = document.getElementById('shell'), ceremony = document.getElementById('ceremony');
  let dpr = 1, cw = 0, ch = 0, scale = 1;

  const input = { dragging:false, originX:0, originY:0, dx:0, dy:0, pointerId:null };
  let S, ledges = [], items = [], particles = [], motes = [], accumulator = 0, lastTime = performance.now();
  let audio = null, master = null, ambientStarted = false;

  function mulberry(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      S.rngState = seed >>> 0; return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rand;
  const rrange = (a,b) => a + (b-a)*rand();

  function reset(seed = 0xE6B37A) {
    seed = (Number(seed) >>> 0) || 0xE6B37A;
    const best = S ? S.sessionBest : 0;
    S = {
      phase:'ready', tick:0, elapsedMs:0, seed, rngState:seed, spawnIndex:0,
      difficulty:1, score:0, height:0, sessionBest:best, rank:null,
      x:180, y:57, vx:0, vy:0, anchored:true, anchorKind:'ledge', anchorId:0,
      jumpsLeft:CAP, launches:0, midairLaunches:0, landings:0, refunds:0, glimmersCollected:0,
      chainCount:0, chainBest:0, chainPotential:0, glimmerScore:0, chainScore:0,
      dampY:-28, dampSpeed:10.5, cameraY:320, maxGeneratedY:0,
      lastEvent:null, expression:'rest', expressionTimer:0, squash:0, shake:0, flash:0, deadTimer:0,
      tutorial:0
    };
    rand = mulberry(seed); ledges = []; items = []; particles = []; motes = [];
    accumulator = 0; lastTime = performance.now();
    for (let i=0;i<28;i++) motes.push({x:rrange(45,315), y:rrange(0,640), a:rrange(.05,.22), s:rrange(5,18)});
    ledges.push({id:0,x:180,y:46,halfWidth:64,active:true, side:0});
    generateTo(1600);
    clearInput(); ceremony.classList.add('hidden');
    updateScore(); render();
  }

  function generateTo(target) {
    let y = S.maxGeneratedY || 46, lastX = ledges.length ? ledges[ledges.length-1].x : 180;
    while (y < target) {
      const tier = Math.min(1, y/5000), gap = rrange(105 + tier*22, 170 + tier*35);
      y += Math.min(gap, LAUNCH_REACH*.72);
      const side = rand() < .72 ? (lastX > 180 ? -1 : 1) : (rand()<.5?-1:1);
      let x = side < 0 ? rrange(76,145) : rrange(215,284);
      if (rand()<.18) x = rrange(145,215);
      const halfWidth = rrange(27-tier*6, 46-tier*7);
      const ledge = {id:++S.spawnIndex,x,y,halfWidth,active:true,side}; ledges.push(ledge); lastX=x;
      // Prizes are authored relative to the safe rung: tempting center arcs and occasional moth staircases.
      if (rand() < .76) {
        const py = y + rrange(38,75), px = 180 + rrange(-48,48);
        items.push({id:++S.spawnIndex,type:'glimmer',x:px,y:py,baseX:px,phase:rrange(0,6.28),active:true,visualRadius:9,collisionRadius:8});
      }
      if (rand() < .83) {
        const py = y - rrange(30,70), px = (x+180)*.5 + rrange(-24,24);
        items.push({id:++S.spawnIndex,type:'moth',x:px,y:py,baseX:px,phase:rrange(0,6.28),active:true,visualRadius:13,collisionRadius:10});
        if (rand()<.2) {
          const px2 = 180 + rrange(-35,35), py2 = py+rrange(70,100);
          items.push({id:++S.spawnIndex,type:'moth',x:px2,y:py2,baseX:px2,phase:rrange(0,6.28),active:true,visualRadius:13,collisionRadius:10});
        }
      }
    }
    S.maxGeneratedY = y;
    ledges.sort((a,b)=>a.id-b.id); items.sort((a,b)=>a.id-b.id);
  }

  function event(kind) { S.lastEvent={kind,tick:S.tick}; }
  function clearInput() { Object.assign(input,{dragging:false,originX:0,originY:0,dx:0,dy:0,pointerId:null}); }

  function beginAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext||window.webkitAudioContext)(); master=audio.createGain(); master.gain.value=.15; master.connect(audio.destination); startAmbience(); } catch(e) {}
  }
  function tone(freq, dur=.12, type='sine', vol=.18, slide=1) {
    if (!audio || !master) return;
    const now=audio.currentTime, o=audio.createOscillator(), g=audio.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,now); o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*slide),now+dur);
    g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(vol,now+.012); g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    o.connect(g); g.connect(master); o.start(now); o.stop(now+dur+.02);
  }
  function noise(dur=.12, vol=.08) {
    if (!audio||!master) return; const n=Math.ceil(audio.sampleRate*dur), buf=audio.createBuffer(1,n,audio.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n); const src=audio.createBufferSource(),g=audio.createGain(); src.buffer=buf;g.gain.value=vol;src.connect(g);g.connect(master);src.start();
  }
  function startAmbience(){ if(ambientStarted||!audio)return; ambientStarted=true; tone(55,2.5,'sine',.018,.72); }
  function sound(kind, n=0) {
    if(kind==='launch'){tone(185,.17,'triangle',.16,1.75);noise(.07,.035)}
    else if(kind==='land'){tone(125,.18,'sine',.15,.62);tone(260,.1,'triangle',.07,1.1)}
    else if(kind==='moth'){tone(310+n*24,.19,'square',.1,1.9);noise(.09,.07)}
    else if(kind==='glimmer'){tone(660,.08,'sine',.11,1.22);setTimeout(()=>tone(880,.14,'sine',.08,1.08),45)}
    else if(kind==='bank'){tone(240,.12,'triangle',.12,1.4);setTimeout(()=>tone(360+n*18,.22,'sine',.11,1.25),60)}
    else if(kind==='death'){tone(150,.65,'sine',.15,.25);noise(.35,.06)}
  }

  function launch() {
    const dist=Math.hypot(input.dx,input.dy); if(dist<DEAD || S.jumpsLeft<=0 || S.phase==='gameover') return false;
    if(S.phase==='ready') S.phase='playing';
    const wasAir=!S.anchored, p=Math.min(1,(dist-DEAD)/(MAX_PULL-DEAD)), speed=MIN_POWER+(MAX_POWER-MIN_POWER)*p;
    // Opposite drag, converted from page-down coordinates to world-up coordinates.
    S.vx=(-input.dx/dist)*speed; S.vy=(input.dy/dist)*speed;
    S.anchored=false; S.anchorKind=null; S.anchorId=null; S.jumpsLeft--; S.launches++; event('launch');
    if(wasAir){S.midairLaunches++;S.chainCount++;S.chainPotential += 12*S.chainCount;event('chain');chainBurst(S.chainCount)}
    S.expression='flight';S.expressionTimer=.28;S.squash=-.22;sound('launch');return true;
  }

  function land(kind,id,x,y) {
    const ended=S.chainCount; S.anchored=true;S.anchorKind=kind;S.anchorId=id;S.x=x;S.y=y;S.vx=0;S.vy=0;S.jumpsLeft=CAP;S.landings++;event('land');
    if(ended>0){S.chainBest=Math.max(S.chainBest,ended);S.chainScore+=S.chainPotential;S.chainPotential=0;S.chainCount=0;event('chainBank');sound('bank',ended);burst(S.x,S.y,Math.min(28,8+ended*3),'#ffb86b')}
    else sound('land');
    S.expression=kind==='wall'?'cling':'rest';S.expressionTimer=.32;S.squash=.35;S.shake=Math.min(7,1.5+Math.abs(S.vy)/100);
  }

  function chainBurst(n){burst(S.x,S.y,Math.min(18,4+n*2),n>3?'#fff0ad':'#ff7f50');S.flash=Math.min(.3,.04*n);sound('moth',n)}
  function burst(x,y,count,color){for(let i=0;i<count;i++){const a=Math.random()*6.283,sp=40+Math.random()*130;particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.25+Math.random()*.4,max:.65,color,size:1.5+Math.random()*3})}}

  function update(dt) {
    if(S.phase==='ready'||S.phase==='gameover') { if(S.phase==='gameover'&&S.deadTimer>0)S.deadTimer-=dt; updateParticles(dt); return; }
    S.tick++;S.elapsedMs=S.tick*(1000/60);S.difficulty=1+S.height/2600;
    S.dampSpeed=10.5+Math.min(94,S.height/42)+Math.min(22,S.elapsedMs/1000*.3);
    S.dampY+=S.dampSpeed*dt; S.expressionTimer=Math.max(0,S.expressionTimer-dt);S.squash*=.85;S.shake*=.82;S.flash*=.82;
    for(const it of items) if(it.active&&it.type==='moth') it.x=it.baseX+Math.sin(S.tick*.025+it.phase)*15;
    if(S.anchored) {
      if(S.anchorKind==='wall'){S.y-=22*dt;S.expression='cling';}
      else S.expression='rest';
    } else {
      const oldX=S.x,oldY=S.y; S.vy+=GRAVITY*dt; S.x+=S.vx*dt;S.y+=S.vy*dt;
      if(S.jumpsLeft===0&&S.vy<0){S.expression='empty';}else if(S.expressionTimer<=0)S.expression='flight';
      // Wall catches.
      if(S.x-R<=WALL_L&&S.vx<0) land('wall',-1,WALL_L+R,S.y);
      else if(S.x+R>=WALL_R&&S.vx>0) land('wall',-2,WALL_R-R,S.y);
      else if(S.vy<=0) {
        for(const l of ledges){if(!l.active)continue;const top=l.y+5;if(oldY-R>=top&&S.y-R<=top&&Math.abs(S.x-l.x)<l.halfWidth+R*.35){land('ledge',l.id,S.x,top+R);break}}
      }
      if(!S.anchored) collideItems();
    }
    S.height=Math.max(S.height,S.y-57);if(S.maxGeneratedY<S.y+LAUNCH_REACH*2.6)generateTo(S.y+LAUNCH_REACH*3);
    const targetCam=Math.max(320,S.y+105);S.cameraY+=(targetCam-S.cameraY)*.08;
    updateScore();updateParticles(dt);
    if(S.dampY>=S.y-R*.25) die();
  }

  function collideItems(){
    for(const it of items){if(!it.active)continue;const rr=R+it.collisionRadius;if((S.x-it.x)**2+(S.y-it.y)**2>rr*rr)continue;it.active=false;
      if(it.type==='moth'){S.vy=Math.max(S.vy,255)+95;S.jumpsLeft=Math.min(CAP,S.jumpsLeft+1);S.refunds++;S.chainCount++;S.chainPotential+=12*S.chainCount;event('bounce');event('chain');S.expression='burst';S.expressionTimer=.22;S.shake=4;chainBurst(S.chainCount);}
      else {S.glimmersCollected++;const mult=1+Math.min(2,S.chainCount*.22);S.glimmerScore+=Math.round(85*mult);event('glimmer');sound('glimmer');burst(it.x,it.y,12,'#bafcff');S.flash=.12}
    }
  }
  function updateScore(){S.score=Math.max(0,Math.floor(S.height*1.35)+S.glimmerScore+S.chainScore);}
  function die(){if(S.phase==='gameover')return;S.phase='gameover';S.rank=grade(S.score);S.sessionBest=Math.max(S.sessionBest,S.score);S.expression='dead';S.deadTimer=.8;clearInput();sound('death');burst(S.x,S.y,30,'#69758f');setTimeout(showCeremony,650)}
  function grade(score){if(score>=6500)return'S';if(score>=4000)return'A';if(score>=2300)return'B';if(score>=1000)return'C';if(score>=400)return'D';return'E'}
  function showCeremony(){if(S.phase!=='gameover')return;document.getElementById('rank').textContent=S.rank;document.getElementById('final-score').textContent=S.score.toLocaleString();document.getElementById('best-score').textContent=S.sessionBest.toLocaleString();document.getElementById('best-chain').textContent='×'+S.chainBest;ceremony.classList.remove('hidden')}
  function updateParticles(dt){for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy-=180*dt;p.vx*=.985}particles=particles.filter(p=>p.life>0)}

  function resize(){const r=shell.getBoundingClientRect();dpr=Math.min(2,window.devicePixelRatio||1);cw=r.width;ch=r.height;canvas.width=Math.round(cw*dpr);canvas.height=Math.round(ch*dpr);scale=cw/W;ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0)}
  function sy(y){return H*.5-(y-S.cameraY)}
  function round(n){return Math.round(n*1000)/1000}

  function snapshot(){
    const lo=S.y-LAUNCH_REACH,hi=S.y+LAUNCH_REACH*2;
    return Object.freeze({phase:S.phase,tick:S.tick,elapsedMs:round(S.elapsedMs),seed:S.seed,rngState:S.rngState,spawnIndex:S.spawnIndex,
      input:{dragging:input.dragging,originX:round(input.originX),originY:round(input.originY),dx:round(input.dx),dy:round(input.dy)},difficulty:round(S.difficulty),score:S.score,height:round(S.height),sessionBest:S.sessionBest,rank:S.rank,
      x:round(S.x),y:round(S.y),vx:round(S.vx),vy:round(S.vy),playerRadius:R,anchored:S.anchored,anchorKind:S.anchorKind,
      jumpCapacity:CAP,jumpsLeft:S.jumpsLeft,launches:S.launches,midairLaunches:S.midairLaunches,landings:S.landings,refunds:S.refunds,glimmersCollected:S.glimmersCollected,
      chainCount:S.chainCount,chainBest:S.chainBest,dampY:round(S.dampY),dampSpeed:round(S.dampSpeed),wallLeftX:WALL_L,wallRightX:WALL_R,launchReach:round(LAUNCH_REACH),
      ledges:ledges.filter(e=>e.y>=lo&&e.y<=hi).map(e=>({id:e.id,position:{x:round(e.x),y:round(e.y)},halfWidth:round(e.halfWidth),active:e.active})),
      items:items.filter(e=>e.y>=lo&&e.y<=hi).map(e=>({id:e.id,type:e.type,position:{x:round(e.x),y:round(e.y)},active:e.active,visualRadius:e.visualRadius,collisionRadius:e.collisionRadius})),lastEvent:S.lastEvent?{...S.lastEvent}:null});
  }

  function pointerDown(e){e.preventDefault();beginAudio();if(audio?.state==='suspended')audio.resume();if(S.phase==='gameover'){if(!ceremony.classList.contains('hidden'))reset(S.seed);return}if(input.dragging)return;input.dragging=true;input.pointerId=e.pointerId;input.originX=e.clientX;input.originY=e.clientY;input.dx=0;input.dy=0;S.expression='aim';canvas.setPointerCapture?.(e.pointerId)}
  function pointerMove(e){if(!input.dragging||e.pointerId!==input.pointerId)return;e.preventDefault();input.dx=e.clientX-input.originX;input.dy=e.clientY-input.originY;const d=Math.hypot(input.dx,input.dy);if(d>MAX_PULL*scale){const k=MAX_PULL*scale/d;input.dx*=k;input.dy*=k}}
  function pointerUp(e){if(!input.dragging||e.pointerId!==input.pointerId)return;e.preventDefault();input.dx/=scale;input.dy/=scale;const launched=launch();if(!launched&&S.anchored)S.expression=S.anchorKind==='wall'?'cling':'rest';clearInput()}
  shell.addEventListener('pointerdown',pointerDown);shell.addEventListener('pointermove',pointerMove);shell.addEventListener('pointerup',pointerUp);shell.addEventListener('pointercancel',()=>clearInput());window.addEventListener('resize',resize);

  function loop(t){const delta=Math.min(.1,(t-lastTime)/1000);lastTime=t;accumulator+=delta;let n=0;while(accumulator>=STEP&&n++<MAX_STEPS){update(STEP);accumulator-=STEP}render();requestAnimationFrame(loop)}

  function render(){
    ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);ctx.clearRect(0,0,W,H);ctx.save();if(S.shake)ctx.translate(Math.sin(S.tick*8.17)*S.shake,Math.cos(S.tick*6.31)*S.shake);
    drawBackground();drawWorld();drawDamp();drawAim();drawSpark();drawParticles();drawHUD();ctx.restore();
  }
  function drawBackground(){
    const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,'#080918');g.addColorStop(.18,'#16162b');g.addColorStop(.5,'#0a1024');g.addColorStop(.82,'#17162b');g.addColorStop(1,'#070916');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=.6;for(let x=52;x<W;x+=64){ctx.fillStyle=x%128?'#26243a':'#11152b';ctx.fillRect(x,0,2,H)}ctx.globalAlpha=1;
    for(const m of motes){const y=(m.y+(S.cameraY*.12))%H;ctx.fillStyle=`rgba(255,198,115,${m.a})`;ctx.beginPath();ctx.arc(m.x,y,1.2,0,6.28);ctx.fill()}
    // masonry side walls
    for(const side of [0,1]){const x=side?WALL_R:0,w=side?W-WALL_R:WALL_L;ctx.fillStyle='#1d1c2a';ctx.fillRect(x,0,w,H);for(let y=-40-(S.cameraY%44);y<H+44;y+=44){ctx.strokeStyle='#343040';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y);ctx.stroke();const off=((Math.floor((y+S.cameraY)/44)&1)*13);ctx.beginPath();ctx.moveTo(x+off,y);ctx.lineTo(x+off,y+44);ctx.stroke()}}
    const lg=ctx.createLinearGradient(WALL_L,0,WALL_L+22,0);lg.addColorStop(0,'#0009');lg.addColorStop(1,'transparent');ctx.fillStyle=lg;ctx.fillRect(WALL_L,0,24,H);const rg=ctx.createLinearGradient(WALL_R-22,0,WALL_R,0);rg.addColorStop(0,'transparent');rg.addColorStop(1,'#0009');ctx.fillStyle=rg;ctx.fillRect(WALL_R-24,0,24,H);
  }
  function drawWorld(){
    for(const l of ledges){const y=sy(l.y);if(y<-30||y>H+30)continue;ctx.save();ctx.translate(l.x,y);const grd=ctx.createLinearGradient(0,-7,0,12);grd.addColorStop(0,'#6a5a5b');grd.addColorStop(.22,'#3a343f');grd.addColorStop(1,'#171724');ctx.fillStyle=grd;roundRect(-l.halfWidth,-6,l.halfWidth*2,16,5);ctx.fill();ctx.fillStyle='#a17861';ctx.globalAlpha=.45;ctx.fillRect(-l.halfWidth+5,-6,l.halfWidth*2-10,2);ctx.restore()}
    for(const it of items){if(!it.active)continue;const y=sy(it.y);if(y<-30||y>H+30)continue;if(it.type==='glimmer')drawGlimmer(it.x,y,it);else drawMoth(it.x,y,it)}
  }
  function drawGlimmer(x,y,it){const pulse=1+Math.sin(S.tick*.08+it.phase)*.12;ctx.save();ctx.translate(x,y);ctx.scale(pulse,pulse);ctx.shadowBlur=16;ctx.shadowColor='#7ee8ff';ctx.fillStyle='#c8fbff';ctx.rotate(Math.PI/4);roundRect(-5,-5,10,10,3);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#6acbde66';ctx.lineWidth=1;ctx.strokeRect(-9,-9,18,18);ctx.restore()}
  function drawMoth(x,y,it){const flap=Math.sin(S.tick*.22+it.phase);ctx.save();ctx.translate(x,y);ctx.shadowBlur=9;ctx.shadowColor='#bd6b55';ctx.fillStyle='#443041';ctx.beginPath();ctx.ellipse(-7,0,7+flap*2,4, -.35,0,6.28);ctx.ellipse(7,0,7+flap*2,4,.35,0,6.28);ctx.fill();ctx.fillStyle='#e28a68';ctx.beginPath();ctx.ellipse(0,1,3,6,0,0,6.28);ctx.fill();ctx.fillStyle='#ffd9a3';ctx.fillRect(-1.5,-3,1,1);ctx.fillRect(1,-3,1,1);ctx.restore()}
  function drawDamp(){const front=sy(S.dampY),t=S.tick*.05;const g=ctx.createLinearGradient(0,front-18,0,H);g.addColorStop(0,'rgba(91,127,151,0)');g.addColorStop(.08,'rgba(84,118,144,.8)');g.addColorStop(.35,'#344767e8');g.addColorStop(1,'#15233b');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(0,front);for(let x=0;x<=W;x+=9){const reach=Math.sin(x*.09+t)*6+Math.sin(x*.031-t*.7)*7+(Math.sin(x*.2+t*1.7)> .82?-8:0);ctx.lineTo(x,front+reach)}ctx.lineTo(W,H);ctx.closePath();ctx.fill();ctx.strokeStyle='#9bc9d188';ctx.lineWidth=2;ctx.stroke();for(let i=0;i<7;i++){const x=(i*71+t*22)%W,y=front+25+(i%3)*20;ctx.strokeStyle='#a8d3d122';ctx.beginPath();ctx.arc(x,y,12+i%2*5,0,Math.PI*1.35);ctx.stroke()}}
  function drawAim(){if(!input.dragging||S.phase==='gameover')return;const ox=(input.originX-shell.getBoundingClientRect().left)/scale,oy=(input.originY-shell.getBoundingClientRect().top)/scale;const dx=input.dx/scale,dy=input.dy/scale,d=Math.hypot(dx,dy);ctx.save();ctx.lineCap='round';ctx.strokeStyle='#ffb56d88';ctx.lineWidth=4;ctx.setLineDash([4,7]);ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+dx,oy+dy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffdb9e';ctx.beginPath();ctx.arc(ox+dx,oy+dy,5,0,6.28);ctx.fill();if(d>DEAD){const nx=-dx/d,ny=-dy/d,len=45+Math.min(65,d*.5);ctx.strokeStyle='#ffdfac';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(S.x,sy(S.y));ctx.lineTo(S.x+nx*len,sy(S.y)+ny*len);ctx.stroke();ctx.fillStyle='#ffdfac';ctx.beginPath();ctx.moveTo(S.x+nx*len,sy(S.y)+ny*len);ctx.lineTo(S.x+nx*len-ny*5-nx*8,sy(S.y)+ny*len+nx*5-ny*8);ctx.lineTo(S.x+nx*len+ny*5-nx*8,sy(S.y)+ny*len-nx*5-ny*8);ctx.fill()}ctx.restore()}
  function drawSpark(){
    const x=S.x,y=sy(S.y),speed=Math.hypot(S.vx,S.vy),ang=S.anchored?0:Math.atan2(-S.vy,S.vx)+Math.PI/2;let stretch=S.anchored?1:1+Math.min(.55,speed/850);if(S.expression==='aim')stretch=.82;
    ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.scale(1+S.squash,stretch-S.squash);ctx.shadowBlur=20+S.flash*80;ctx.shadowColor='#ff7a39';
    const flame=ctx.createRadialGradient(0,-3,2,0,1,16);flame.addColorStop(0,'#fffbd0');flame.addColorStop(.28,'#ffd15d');flame.addColorStop(.72,'#ff6537');flame.addColorStop(1,'#b5294000');ctx.fillStyle=flame;ctx.beginPath();ctx.moveTo(0,-18);ctx.bezierCurveTo(15,-6,15,10,0,14);ctx.bezierCurveTo(-15,10,-15,-6,0,-18);ctx.fill();ctx.shadowBlur=0;
    // face with stateful eyes and mouth
    ctx.rotate(-ang);ctx.fillStyle='#40202a';let eyeY=-2;
    if(S.expression==='dead'){ctx.strokeStyle='#33202c';ctx.lineWidth=1.7;for(const ex of[-4,4]){ctx.beginPath();ctx.moveTo(ex-2,eyeY-2);ctx.lineTo(ex+2,eyeY+2);ctx.moveTo(ex+2,eyeY-2);ctx.lineTo(ex-2,eyeY+2);ctx.stroke()}}
    else {let ew=S.expression==='empty'?2.5:1.7,eh=S.expression==='empty'?4.2:(S.expression==='flight'?3.2:2.4);for(const ex of[-4,4]){ctx.beginPath();ctx.ellipse(ex,eyeY,ew,eh,0,0,6.28);ctx.fill();if(S.expression==='burst'){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ex-.5,eyeY-.7,.7,0,6.28);ctx.fill();ctx.fillStyle='#40202a'}}}
    ctx.strokeStyle='#5b2630';ctx.lineWidth=1.5;ctx.beginPath();if(S.expression==='empty')ctx.arc(0,5,2.6,0,6.28);else if(S.expression==='flight'||S.expression==='burst')ctx.arc(0,3,4,.2,Math.PI-.2);else if(S.expression==='aim'){ctx.moveTo(-3,5);ctx.lineTo(3,5)}else ctx.arc(0,2,4,.25,Math.PI-.25);ctx.stroke();ctx.restore();
  }
  function drawParticles(){for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,sy(p.y),p.size,0,6.28);ctx.fill()}ctx.globalAlpha=1}
  function drawHUD(){
    ctx.save();ctx.fillStyle='#080a18bb';roundRect(12,12,116,48,18);ctx.fill();ctx.fillStyle='#858da9';ctx.font='800 9px system-ui';ctx.fillText('HEIGHT',25,29);ctx.fillStyle='#f7e9cf';ctx.font='800 20px system-ui';ctx.fillText(Math.floor(S.height)+'m',24,51);
    ctx.fillStyle='#080a18bb';roundRect(W-132,12,120,48,18);ctx.fill();ctx.fillStyle='#858da9';ctx.font='800 9px system-ui';ctx.fillText('SCORE',W-116,29);ctx.fillStyle='#f7e9cf';ctx.font='800 20px system-ui';ctx.fillText(S.score,W-116,51);
    // glow stock, readable as flame-shaped pips
    ctx.fillStyle='#0a0c1bbb';roundRect(12,H-58,142,44,20);ctx.fill();ctx.fillStyle='#8e94ad';ctx.font='800 9px system-ui';ctx.fillText('GLOW',25,H-32);for(let i=0;i<CAP;i++){const x=72+i*19,y=H-35;ctx.fillStyle=i<S.jumpsLeft?'#ffc85d':'#282b3e';ctx.shadowBlur=i<S.jumpsLeft?8:0;ctx.shadowColor='#ff7b3d';ctx.beginPath();ctx.moveTo(x,y-8);ctx.quadraticCurveTo(x+8,y,x,y+8);ctx.quadraticCurveTo(x-8,y,x,y-8);ctx.fill()}ctx.shadowBlur=0;
    if(S.chainCount>0){ctx.textAlign='center';ctx.fillStyle='#ffbe79';ctx.font=`900 ${Math.min(32,18+S.chainCount*2)}px system-ui`;ctx.fillText('AIR CHAIN ×'+S.chainCount,W/2,96);ctx.fillStyle='#ffe0b5';ctx.font='700 9px system-ui';ctx.fillText('LAND IT TO BANK',W/2,111)}
    if(S.phase==='ready'){ctx.textAlign='center';ctx.fillStyle='#f4e8d3';ctx.font='900 18px system-ui';ctx.fillText('PULL BACK',W/2,H-126);ctx.fillStyle='#9aa0b8';ctx.font='700 11px system-ui';ctx.fillText('release to send Ember flying',W/2,H-106);ctx.strokeStyle='#f3b66f88';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(W/2,H-90);ctx.lineTo(W/2,H-65);ctx.stroke();}
    else if(S.jumpsLeft===0&&!S.anchored){ctx.textAlign='center';ctx.fillStyle='#dbe6f4';ctx.font='900 13px system-ui';ctx.fillText('HOLD YOUR BREATH…',W/2,H-86)}ctx.restore();
  }
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));}

  window.__ARENA_GAME__={reset,snapshot};
  resize();reset();requestAnimationFrame(loop);
})();
