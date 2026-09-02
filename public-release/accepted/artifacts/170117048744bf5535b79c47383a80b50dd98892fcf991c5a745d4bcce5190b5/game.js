(() => {
  'use strict';
  const engine = new ShoalEngine('shoal');
  const $ = id => document.getElementById(id);
  const board = $('board'), game = $('game'), ceremony = $('ceremony'), host = $('host');
  let lastRows = [], audio = null, holdTimer = null, held = null, suppressClick = false, realCarry = 0, lastFrame = performance.now();

  function visible(s) { const v = JSON.parse(JSON.stringify(s)); delete v.events; delete v.lastEvent; return v; }
  function tone(freq, dur, type, gain, delay) {
    if (!audio) return; const t = audio.currentTime + (delay || 0), o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 1.12, t + dur);
    g.gain.setValueAtTime(gain || .025, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  }
  function awaken() { if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); } if (audio && audio.state === 'suspended') audio.resume(); }
  function sounds(kind, opened) {
    if (kind === 'flag' || kind === 'unflag') tone(390, .08, 'triangle', .035);
    if (kind === 'open') { tone(240, .11, 'sine', .024); for (let i=1;i<Math.min(opened,8);i++) tone(270+i*32,.1,'sine',.018,i*.035); }
    if (kind === 'sweep') { for(let i=0;i<5;i++) tone(220+i*70,.15,'triangle',.02,i*.025); }
    if (kind === 'sting') { tone(110,.5,'sawtooth',.06); tone(70,.65,'square',.025,.05); }
    if (kind === 'pool_clear') { [330,440,550,740].forEach((f,i)=>tone(f,.3,'sine',.035,i*.09)); }
  }
  function cellMarkup(ch, i) {
    const n = /[0-8]/.test(ch), angle = ((i * 47) % 19) - 9;
    let cls = 'cell', inside = `<span class="shell" style="--turn:${angle}deg"></span><span class="flag-mark"></span>`;
    if (n) { cls += ` open n${ch}`; inside += `<span class="num">${ch==='0'?'·':ch}</span>`; }
    else if (ch === 'F') cls += ' flagged';
    else if (ch === '*' || ch === 'X' || ch === '+') { cls += ch==='X'?' fatal':ch==='+'?' rightflag':''; inside += '<span class="mine"></span>'; }
    else if (ch === '-') cls += ' wrongflag';
    const labels = {'#':'covered shell','F':'pennanted shell','*':'urchin','X':'fatal urchin','+':'correct pennant','-':'wrong pennant'};
    return `<button class="${cls}" role="gridcell" data-i="${i}" aria-label="${n?'open shell, '+ch+' nearby':labels[ch]}">${inside}</button>`;
  }
  function render(s, effect) {
    board.style.setProperty('--cols', s.gridWidth); board.style.setProperty('--ratio', s.gridWidth / s.gridHeight);
    const flat = s.rows.join('');
    if (flat !== lastRows.join('') || board.children.length !== flat.length) {
      board.innerHTML = Array.from(flat).map(cellMarkup).join(''); lastRows = s.rows.slice();
    }
    $('pool-label').textContent = `POOL ${s.pool}`; $('pearls').textContent = s.pearls; $('left').textContent = s.urchinsLeft;
    $('tide-fill').style.width = `${s.tideFraction * 100}%`; $('tide-text').textContent = s.tideFraction > .65 ? 'HIGH' : s.tideFraction > .25 ? 'FALLING' : 'LOW';
    const covered = flat.split('').filter(c=>c==='#'||c==='F').length;
    host.className = 'host' + (s.phase==='ended'?' stung':covered <= s.urchinsTotal+4?' worry':effect && effect.opened>4?' react':'');
    if (!s.firstTurnDone) $('hint').textContent = s.pool===1 && s.moves===0 ? 'Tap any shell. The first ripple is safe.' : 'A fresh pool. Choose your first shell.';
    else if (s.phase==='ended') $('hint').textContent = 'The pool shows where every belief stood.';
    else if (s.moves<2) $('hint').textContent = 'Hold a shell to plant a pennant.';
    else $('hint').textContent = 'Tap a satisfied number to sweep.';
    if (s.phase === 'ended') {
      $('rank').textContent=s.rank; $('final-pearls').textContent=s.pearls; $('best').textContent=s.sessionBest;
      $('ripple-stat').textContent=`${engine.biggestRipple} shells`; $('ladder').innerHTML=s.rankLadder.map((r,i)=>`<i class="${i<=s.rankLadder.indexOf(s.rank)?'on':''}" title="${r}"></i>`).join('');
      ceremony.hidden=false;
    } else ceremony.hidden=true;
    if (s.phase === 'ended' && s.stungAt) { game.classList.remove('shake'); void game.offsetWidth; game.classList.add('shake'); }
  }
  function move(action) {
    awaken(); const before=engine.snapshot(), result=engine.perform(action); if(!result.accepted) return result;
    const event=result.state.lastEvent, fresh=result.state.events.filter(e=>e.seq>(before.lastEvent?before.lastEvent.seq:0));
    render(result.state,event); fresh.forEach(e=>sounds(e.kind,e.opened||0)); return result;
  }
  function coords(el) { const i=Number(el.dataset.i), s=engine.snapshot(); return {x:i%s.gridWidth,y:(i/s.gridWidth)|0}; }
  board.addEventListener('pointerdown', e => {
    const cell=e.target.closest('.cell'); if(!cell||e.button>0)return; awaken(); held={cell,x:e.clientX,y:e.clientY};
    holdTimer=setTimeout(()=>{ if(!held)return; suppressClick=true; const p=coords(cell), ch=engine.snapshot().rows[p.y][p.x]; if(ch==='F')move({type:'unflag',...p}); else if(ch==='#')move({type:'flag',...p}); held=null; if(navigator.vibrate)navigator.vibrate(18); },480);
  });
  board.addEventListener('pointermove',e=>{if(held&&Math.hypot(e.clientX-held.x,e.clientY-held.y)>12){clearTimeout(holdTimer);held=null;}});
  function release(){clearTimeout(holdTimer);held=null} board.addEventListener('pointerup',release);board.addEventListener('pointercancel',release);board.addEventListener('pointerleave',release);
  board.addEventListener('click', e => {
    const cell=e.target.closest('.cell'); if(!cell)return; if(suppressClick){suppressClick=false;return} const p=coords(cell),ch=engine.snapshot().rows[p.y][p.x];
    if(/[0-8]/.test(ch))move({type:'sweep',...p}); else if(ch==='#')move({type:'open',...p});
  });
  board.addEventListener('contextmenu',e=>{e.preventDefault();const cell=e.target.closest('.cell');if(!cell)return;const p=coords(cell),ch=engine.snapshot().rows[p.y][p.x];if(ch==='F')move({type:'unflag',...p});else if(ch==='#')move({type:'flag',...p});});
  function restart(){awaken();lastRows=[];const s=engine.restart();render(s);tone(260,.18,'sine',.025);}
  $('restart').addEventListener('click',e=>{e.stopPropagation();restart()});ceremony.addEventListener('click',restart);
  addEventListener('keydown',e=>{if(e.key.toLowerCase()==='r')restart()});
  function loop(now){const delta=Math.min(100,now-lastFrame);lastFrame=now;if(engine.phase==='playing'){realCarry+=delta;const steps=Math.floor(realCarry/(1000/60));if(steps){engine.advance(steps*1000/60);realCarry-=steps*1000/60;const s=engine.snapshot();$('tide-fill').style.width=`${s.tideFraction*100}%`;$('tide-text').textContent=s.tideFraction>.65?'HIGH':s.tideFraction>.25?'FALLING':'LOW';}}requestAnimationFrame(loop)}

  const runtime={
    reset(seed){lastRows=[];const s=engine.reset(seed);render(s);return s}, snapshot(){return engine.snapshot()},
    act(action){return move(action).state}, restart(){restart();return engine.snapshot()},
    advance(ms){const s=engine.advance(ms);render(s);return s}
  };
  window.__ARENA_GAME__=runtime;

  let bound=null;
  addEventListener('message',e=>{
    const m=e.data;if(e.source!==parent||!m||m.protocol!=='arena.game.v1'||m.type!=='connect'||typeof m.sessionId!=='string'||!Number.isInteger(m.generation)||!e.ports||e.ports.length!==1)return;
    if(bound)bound.port.close(); const port=e.ports[0];bound={port,sessionId:m.sessionId,generation:m.generation};
    const envelope=(extra)=>Object.assign({protocol:'arena.game.v1',sessionId:m.sessionId,generation:m.generation,revision:engine.revision,state:visible(engine.snapshot())},extra);
    port.onmessage=ev=>{const q=ev.data;if(!q||q.protocol!=='arena.game.v1'||q.sessionId!==m.sessionId||q.generation!==m.generation)return;let accepted=false,error=null;
      if(!('requestId'in q)){return}
      if(q.command==='observe')accepted=true;
      else if(q.command==='act'||q.command==='restart'){
        if(!Number.isInteger(q.expectedRevision)||q.expectedRevision!==engine.revision)error={code:'stale_revision',message:'Expected revision does not match.'};
        else if(q.command==='restart'){runtime.restart();accepted=true;}
        else{const r=move(q.action);accepted=r.accepted;if(!accepted)error={code:r.error,message:'Action is not legal in the current state.'};}
      }else error={code:'unknown_command',message:'Unknown bridge command.'};
      port.postMessage(envelope({type:'response',requestId:q.requestId,accepted,...(error?{error}:{})}));
    };port.start();port.postMessage(envelope({type:'ready',accepted:true}));
  });
  render(engine.snapshot()); requestAnimationFrame(loop);
})();
