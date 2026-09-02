(() => {
  'use strict';
  const STEP = 1000 / 60;
  const RANKS = ['DRIFTWOOD', 'SEA GLASS', 'MOON PEARL', 'TIDEKEEPER', 'DEEPSTAR'];
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), gameEl = $('game'), ceremony = $('ceremony');
  let s, mines = null, numbers = [], cells = [], accumulator = 0;
  let attemptCounter = 0, sessionBest = 0, eventSeq = 0, lastFrame = 0;
  let hold = null, toastTimer = 0, audio = null, soundOn = true, bridge = null, moodLock = false;

  function hash(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function specs(pool) {
    if (pool === 1) return [5, 6, 4];
    if (pool === 2) return [6, 7, 7];
    if (pool === 3) return [7, 8, 10];
    return [7, 9, Math.min(18, 11 + Math.floor((pool - 4) * 1.3))];
  }
  function tideTicks() { return Math.round((62 + s.gridWidth * s.gridHeight * 1.35 + s.pool * 2) * 60); }
  function tideFraction() {
    if (!s.firstTurnDone) return 1;
    return Math.max(0, 1 - (s.tick - s.poolStartTick) / tideTicks());
  }
  function setupPool() {
    const [w, h, m] = specs(s.pool);
    Object.assign(s, { gridWidth:w, gridHeight:h, urchinsTotal:m, flags:new Set(), opened:new Set(), firstTurnDone:false, stungAt:null, poolStartTick:s.tick });
    mines = null; numbers = new Array(w * h).fill(0); cells = [];
  }
  function newAttempt(seed) {
    attemptCounter++;
    s = { phase:'ready', tick:0, seed:String(seed == null ? 'shoal' : seed), attempt:attemptCounter, revision:0, pool:1, pearls:0, moves:0, rank:null, events:[], deepest:1, biggestRipple:0 };
    accumulator = 0; eventSeq = 0; moodLock = false; setupPool(); ceremony.hidden = true; gameEl.classList.remove('jolt');
    render(); return snapshot();
  }
  function idx(x,y){ return y * s.gridWidth + x; }
  function xy(i){ return {x:i % s.gridWidth, y:Math.floor(i / s.gridWidth)}; }
  function neighbors(i) {
    const p=xy(i), a=[];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if(dx||dy){const x=p.x+dx,y=p.y+dy;if(x>=0&&y>=0&&x<s.gridWidth&&y<s.gridHeight)a.push(idx(x,y));}
    return a;
  }
  function calcNumbers(set) {
    const out=[]; for(let i=0;i<s.gridWidth*s.gridHeight;i++) out[i]=neighbors(i).filter(n=>set.has(n)).length; return out;
  }
  function logicSolves(set, nums, first) {
    const open=new Set(), known=new Set();
    const flood = start => { const q=[start]; while(q.length){const i=q.shift();if(open.has(i)||set.has(i))continue;open.add(i);if(nums[i]===0)neighbors(i).forEach(n=>{if(!open.has(n)&&!set.has(n))q.push(n)});}};
    flood(first);
    const total=s.gridWidth*s.gridHeight, safeTotal=total-set.size;
    for(let guard=0;guard<total*8 && open.size<safeTotal;guard++){
      let changed=false, cons=[];
      open.forEach(i=>{const u=neighbors(i).filter(n=>!open.has(n)&&!known.has(n));const rem=nums[i]-neighbors(i).filter(n=>known.has(n)).length;if(u.length)cons.push({u:new Set(u),r:rem});});
      const unknown=[];for(let i=0;i<total;i++)if(!open.has(i)&&!known.has(i))unknown.push(i);
      const globalRem=set.size-known.size;
      if(globalRem===0) unknown.forEach(i=>{flood(i);changed=true});
      else if(globalRem===unknown.length) unknown.forEach(i=>{known.add(i);changed=true});
      for(const c of cons){if(c.r===0)c.u.forEach(i=>{flood(i);changed=true});else if(c.r===c.u.size)c.u.forEach(i=>{if(!known.has(i)){known.add(i);changed=true}});}
      if(!changed){
        outer:for(const a of cons)for(const b of cons){if(a===b||a.u.size>=b.u.size)continue;let sub=true;for(const v of a.u)if(!b.u.has(v)){sub=false;break}if(!sub)continue;const diff=[...b.u].filter(v=>!a.u.has(v)), r=b.r-a.r;if(r===0){diff.forEach(flood);changed=diff.length>0}else if(r===diff.length){diff.forEach(v=>known.add(v));changed=diff.length>0}if(changed)break outer;}
      }
      if(!changed) break;
    }
    return open.size===safeTotal;
  }
  function generate(first) {
    const total=s.gridWidth*s.gridHeight, forbidden=new Set([first,...neighbors(first)]), available=[];
    for(let i=0;i<total;i++)if(!forbidden.has(i))available.push(i);
    const base=hash(`${s.seed}|${s.pool}|${xy(first).x},${xy(first).y}`);
    for(let tries=0;tries<6000;tries++){
      const r=rng((base + Math.imul(tries,0x9e3779b1))>>>0), a=available.slice();
      for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
      const candidate=new Set(a.slice(0,s.urchinsTotal)), nums=calcNumbers(candidate);
      if(logicSolves(candidate,nums,first)){ mines=candidate;numbers=nums;return; }
    }
    // Extremely defensive fallback; deterministic retries above normally find a board in a few passes.
    mines=new Set(available.slice(0,s.urchinsTotal)); numbers=calcNumbers(mines);
  }
  function addEvent(kind, extra) {
    const e=Object.assign({seq:++eventSeq,kind,tick:s.tick},extra||{});s.events.push(e);if(s.events.length>250)s.events.shift();return e;
  }
  function revealSafe(start) {
    let count=0; const q=[start];
    while(q.length){const i=q.shift();if(s.opened.has(i)||s.flags.has(i)||mines.has(i))continue;s.opened.add(i);count++;if(numbers[i]===0)neighbors(i).forEach(n=>{if(!s.opened.has(n)&&!s.flags.has(n)&&!mines.has(n))q.push(n)});}
    s.pearls += count * Math.min(5, s.pool); s.biggestRipple=Math.max(s.biggestRipple,count); return count;
  }
  function endRun(fatal) {
    s.stungAt=xy(fatal);s.phase='ended';s.rank=rankFor(s.pearls);sessionBest=Math.max(sessionBest,s.pearls);addEvent('sting');addEvent('run_end');
    gameEl.classList.add('jolt');moodLock=true;setMood('stung');noise('sting');setTimeout(()=>{render();ceremony.hidden=false;noise('ceremony')},480);
  }
  function clearIfDone() {
    if(s.opened.size !== s.gridWidth*s.gridHeight-s.urchinsTotal)return false;
    const cleared=s.pool, tf=tideFraction(), bonus=Math.round((30+cleared*18)*cleared*tf);
    s.pearls+=bonus;addEvent('pool_clear',{pool:cleared});s.pool++;s.deepest=Math.max(s.deepest,s.pool);setupPool();specialMood('proud',850);toast(`POOL ${cleared} CLEAR  +${bonus}`);noise('clear');return true;
  }
  function legal(action) {
    if(!action||typeof action!=='object'||s.phase==='ended')return false;
    const {type,x,y}=action;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=s.gridWidth||y>=s.gridHeight)return false;
    const i=idx(x,y);
    if(type==='open')return !s.opened.has(i)&&!s.flags.has(i);
    if(type==='flag')return !s.opened.has(i)&&!s.flags.has(i);
    if(type==='unflag')return s.flags.has(i)&&!s.opened.has(i);
    if(type==='sweep'){if(!s.opened.has(i))return false;return neighbors(i).filter(n=>s.flags.has(n)).length===numbers[i];}
    return false;
  }
  function perform(action) {
    if(!legal(action))return false;
    unlockAudio();const i=idx(action.x,action.y);s.moves++;
    if(action.type==='flag'){s.flags.add(i);addEvent('flag');noise('flag');}
    else if(action.type==='unflag'){s.flags.delete(i);addEvent('unflag');noise('flag');}
    else if(action.type==='open'){
      if(!s.firstTurnDone){generate(i);s.firstTurnDone=true;s.poolStartTick=s.tick;if(s.phase==='ready')s.phase='playing';}
      if(mines.has(i)){addEvent('open',{opened:0});endRun(i);}
      else {const n=revealSafe(i);addEvent('open',{opened:n});noise(n>1?'ripple':'open',n);if(n>1)specialMood('delighted',550);clearIfDone();}
    } else {
      let opened=0,fatal=null;
      for(const n of neighbors(i)){if(s.opened.has(n)||s.flags.has(n))continue;if(mines.has(n)){fatal=n;break}opened+=revealSafe(n);}
      addEvent('sweep',{opened});noise('sweep',opened);if(fatal!==null)endRun(fatal);else clearIfDone();
    }
    s.revision++; render(); return true;
  }
  function rankFor(p){return RANKS[p>=2400?4:p>=1050?3:p>=430?2:p>=120?1:0]}
  function rowStrings() {
    const rows=[];
    for(let y=0;y<s.gridHeight;y++){let row='';for(let x=0;x<s.gridWidth;x++){const i=idx(x,y);if(s.phase==='ended'){
      if(s.stungAt&&i===idx(s.stungAt.x,s.stungAt.y))row+='X';else if(s.flags.has(i))row+=mines.has(i)?'+':'-';else if(mines.has(i))row+='*';else if(s.opened.has(i))row+=String(numbers[i]);else row+='#';
    }else if(s.flags.has(i))row+='F';else if(s.opened.has(i))row+=String(numbers[i]);else row+='#';}rows.push(row)}return rows;
  }
  function snapshot() {
    const ev=s.events.map(e=>Object.assign({},e));
    return {phase:s.phase,tick:s.tick,elapsedMs:s.tick*STEP,seed:s.seed,attempt:s.attempt,revision:s.revision,pool:s.pool,pearls:s.pearls,sessionBest,moves:s.moves,rank:s.rank,rankLadder:RANKS.slice(),gridWidth:s.gridWidth,gridHeight:s.gridHeight,urchinsTotal:s.urchinsTotal,flagsPlaced:s.flags.size,urchinsLeft:s.urchinsTotal-s.flags.size,tideFraction:tideFraction(),firstTurnDone:s.firstTurnDone,stungAt:s.stungAt?{...s.stungAt}:null,rows:rowStrings(),events:ev,lastEvent:ev.length?ev[ev.length-1]:null};
  }
  function visibleState(){const v=snapshot();delete v.events;delete v.lastEvent;return v}
  function advance(ms) {
    if(typeof ms!=='number'||!Number.isFinite(ms)||ms<0) return snapshot();
    if(s.phase==='playing'){accumulator+=ms;const steps=Math.floor((accumulator+1e-9)/STEP);if(steps){s.tick+=steps;accumulator-=steps*STEP;}renderHud();}
    return snapshot();
  }

  function render() {
    const rows=rowStrings();boardEl.style.aspectRatio=`${s.gridWidth}/${s.gridHeight}`;boardEl.style.gridTemplateColumns=`repeat(${s.gridWidth},1fr)`;boardEl.style.gridTemplateRows=`repeat(${s.gridHeight},1fr)`;
    boardEl.innerHTML='';
    rows.forEach((row,y)=>[...row].forEach((ch,x)=>{const b=document.createElement('button');b.className='cell';b.dataset.x=x;b.dataset.y=y;b.setAttribute('aria-label',cellLabel(ch,x,y));
      if(ch==='#')b.classList.add('covered');
      else if(ch==='F'){b.classList.add('covered','flagged');b.innerHTML='<i class="flagpole"></i>';}
      else if(/\d/.test(ch)){b.classList.add('open','n'+ch);b.textContent=ch;if(neighbors(idx(x,y)).filter(n=>s.flags.has(n)).length===+ch)b.classList.add('satisfied');}
      else if(ch==='X'||ch==='*'){b.classList.add('mine',ch==='X'?'fatal':'revealed');b.innerHTML='<i class="urchin"></i>';}
      else if(ch==='+'){b.classList.add('mine','correct');b.innerHTML='<i class="urchin"></i><i class="flagpole"></i>';}
      else if(ch==='-'){b.classList.add('covered','wrong');b.innerHTML='<i class="flagpole"></i>';}
      boardEl.appendChild(b);
    }));renderHud();
    if(s.phase==='ended'){ $('finalPearls').textContent=s.pearls;$('best').textContent=sessionBest;$('deepest').textContent=s.deepest;$('rank').textContent=s.rank;$('ladder').innerHTML=RANKS.map(r=>`<i class="${r===s.rank?'on':''}">${r}</i>`).join(''); }
  }
  function cellLabel(ch,x,y){if(ch==='#')return `Covered shell, column ${x+1}, row ${y+1}`;if(ch==='F')return 'Pennanted shell';if(/\d/.test(ch))return `${ch} neighboring urchins`;if(ch==='X')return 'Fatal urchin';if(ch==='-')return 'Wrong pennant';return 'Urchin';}
  function renderHud(){
    $('poolLabel').textContent=`POOL ${s.pool}`;$('pearls').textContent=s.pearls;$('left').textContent=s.urchinsTotal-s.flags.size;const t=tideFraction();$('tideFill').style.transform=`scaleX(${t})`;$('tideText').textContent=!s.firstTurnDone?'WAITING':t>0?`${Math.ceil(t*100)}%`:'LOW TIDE';updateMood();
    if(!s.firstTurnDone&&s.moves===0){$('hint').innerHTML='<b>Tap a shell</b><span>Your first ripple is safe</span>'}else if(s.flags.size===0&&s.moves<4){$('hint').innerHTML='<b>Hold to plant a pennant</b><span>Mark a certain urchin</span>'}else{$('hint').innerHTML='<b>Read the water</b><span>Tap a glowing number to sweep</span>'}
  }
  function setMood(m){$('moki').className='moki '+m}
  function specialMood(m,ms){moodLock=true;setMood(m);setTimeout(()=>{moodLock=false;updateMood()},ms)}
  function updateMood(){if(s.phase==='ended'||moodLock)return;const remain=s.gridWidth*s.gridHeight-s.urchinsTotal-s.opened.size;setMood(remain<=Math.max(3,s.urchinsTotal>>1)?'breath':'curious')}
  function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),1500)}

  function unlockAudio(){if(!soundOn)return;if(!audio)try{audio=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}if(audio&&audio.state==='suspended')audio.resume()}
  function tone(freq,dur,vol=.035,type='sine',delay=0){if(!audio||!soundOn)return;const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(audio.destination);o.start(t);o.stop(t+dur+.02)}
  function noise(kind,n=1){if(kind==='flag'){tone(520,.08,.04,'triangle');tone(790,.06,.025,'triangle',.05)}else if(kind==='open')tone(330,.12,.03,'sine');else if(kind==='ripple'){for(let i=0;i<Math.min(n,10);i++)tone(300+i*35,.15,.025,'sine',i*.035)}else if(kind==='sweep'){tone(250,.2,.04,'triangle');tone(650,.18,.03,'sine',.08)}else if(kind==='sting'){tone(120,.55,.07,'sawtooth');tone(78,.7,.05,'square',.08)}else if(kind==='clear'||kind==='ceremony'){[392,523,659,784].forEach((f,i)=>tone(f,.35,.035,'sine',i*.1))}}

  boardEl.addEventListener('pointerdown',e=>{const c=e.target.closest('.cell');if(!c||s.phase==='ended'||e.button!==0)return;e.preventDefault();unlockAudio();const i=idx(+c.dataset.x,+c.dataset.y);hold={c,id:e.pointerId,x:e.clientX,y:e.clientY,fired:false,t:null};if(!s.opened.has(i))hold.t=setTimeout(()=>{if(!hold)return;hold.fired=true;perform({type:s.flags.has(i)?'unflag':'flag',x:+c.dataset.x,y:+c.dataset.y});navigator.vibrate?.(18)},480);c.setPointerCapture?.(e.pointerId)});
  boardEl.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>14){clearTimeout(hold.t);hold=null}});
  boardEl.addEventListener('pointerup',e=>{if(!hold)return;clearTimeout(hold.t);const h=hold;hold=null;if(h.fired)return;const x=+h.c.dataset.x,y=+h.c.dataset.y,i=idx(x,y);perform({type:s.opened.has(i)?'sweep':'open',x,y})});
  boardEl.addEventListener('pointercancel',()=>{if(hold)clearTimeout(hold.t);hold=null});
  boardEl.addEventListener('contextmenu',e=>{e.preventDefault();const c=e.target.closest('.cell');if(!c)return;const x=+c.dataset.x,y=+c.dataset.y,i=idx(x,y);perform({type:s.flags.has(i)?'unflag':'flag',x,y})});
  $('sound').onclick=()=>{soundOn=!soundOn;$('sound').classList.toggle('muted',!soundOn);if(soundOn)unlockAudio()};
  ceremony.addEventListener('click',()=>newAttempt(s.seed));
  addEventListener('keydown',e=>{if(e.key.toLowerCase()==='r')newAttempt(s.seed)});

  function frame(t){if(lastFrame&&s.phase==='playing')advance(Math.min(100,t-lastFrame));lastFrame=t;requestAnimationFrame(frame)}
  requestAnimationFrame(frame);

  window.__ARENA_GAME__={reset:newAttempt,snapshot,act(action){perform(action);return snapshot()},restart(){return newAttempt(s.seed)},advance};

  addEventListener('message',e=>{
    const d=e.data;if(e.source!==parent||!d||d.protocol!=='arena.game.v1'||d.type!=='connect'||typeof d.sessionId!=='string'||!Number.isInteger(d.generation)||!e.ports||e.ports.length!==1)return;
    if(bridge&&bridge.port)bridge.port.close();bridge={port:e.ports[0],sessionId:d.sessionId,generation:d.generation};const b=bridge;
    const envelope=(type,extra)=>Object.assign({protocol:'arena.game.v1',type,sessionId:b.sessionId,generation:b.generation},extra);
    b.port.onmessage=ev=>{const q=ev.data;if(!q||q.protocol!=='arena.game.v1'||q.sessionId!==b.sessionId||q.generation!==b.generation)return;let accepted=true,error=null;
      if(!('requestId' in q)){return}
      if(q.command==='observe'){}
      else if(q.command==='act'||q.command==='restart'){
        if(!Number.isInteger(q.expectedRevision)||q.expectedRevision!==s.revision){accepted=false;error={code:'stale_revision',message:'Expected revision does not match'};}
        else if(q.command==='act'){if(!legal(q.action)){accepted=false;error={code:'illegal_action',message:'Action is not legal in the current state'};}else perform(q.action)}
        else newAttempt(s.seed);
      }else{accepted=false;error={code:'unknown_command',message:'Unknown command'};}
      const out=envelope('response',{requestId:q.requestId,accepted,revision:s.revision,state:visibleState()});if(error)out.error=error;b.port.postMessage(out);
    };b.port.start();b.port.postMessage(envelope('ready',{accepted:true,revision:s.revision,state:visibleState()}));
  });

  newAttempt('shoal');
})();
