(() => {
  'use strict';
  const RAW = {
    'first-light':['#######','#...o.#','#.....#','#..$..#','#.@...#','#.....#','#######'],
    'crossfeed':['########','#..oo..#','#......#','#.$.$..#','#...@..#','#......#','########'],
    'black-start':['########','#.o.o.o#','#......#','#.$.$$.#','#...@..#','#......#','########'],
    'split-bus':['########','#.o..o.#','#......#','#..##..#','#.$..$.#','#...@..#','#......#','########'],
    'relay-bend':['########','#..o...#','#....o.#','#..#...#','#.$.$..#','#..@...#','#......#','########'],
    'service-loop':['#########','#..o.o..#','#.......#','#.#...#.#','#.$.$...#','#...@...#','#.......#','#########'],
    'cold-iron':['#########','#..o..o.#','#o......#','#...#...#','#.$$.$..#','#...@...#','#.......#','#########'],
    'brownout':['#########','#..ooo..#','#.......#','#..#.#..#','#.$.$.$.#','#...@...#','#.......#','#########'],
    'dead-bus':['#########','#..ooo..#','#.#...#.#','#.......#','#.$$.$..#','#....@..#','#.......#','#########'],
    'copper-maze':['#########','#o..o..o#','#.......#','#.#.#.#.#','#.$.$.$.#','#...@...#','#.......#','#########'],
    'backfeed':['#########','#o.o....#','#...o...#','#.#...#.#','#.$.$.$.#','#..@....#','#.......#','#########'],
    'load-shed':['#########','#..o.o..#','#o......#','#..##...#','#.$.$.$.#','#....@..#','#.......#','#########'],
    'last-circuit':['##########','#..o.oo..#','#....o...#','#..##....#','#.$.$.$..#','#...$@...#','#........#','##########'],
    'switchyard':['#########','#..oooo.#','#.......#','#.#.#...#','#.$.$.$.#','#..$@...#','#.......#','#########'],
    'phase-lock':['#########','#o.o.o..#','#.......#','#..###..#','#.$...$.#','#...$@..#','#.......#','#########'],
    'auxiliary':['##########','#..o.oo..#','#o.......#','#..#..#..#','#.$.$.$..#','#...$@...#','#........#','##########'],
    'redline':['##########','#o.o..o.o#','#........#','#.#....#.#','#.$.$.$..#','#...$@...#','#........#','##########'],
    'island-mode':['##########','#..oooo..#','#........#','#..#..#..#','#.$.$.$..#','#..$..@..#','#........#','##########'],
    'cascade':['##########','#o..oo..o#','#........#','#.#.##.#.#','#.$.$.$..#','#....$@..#','#........#','##########'],
    'dawn-sequence':['##########','#o..oo..o#','#...##...#','#........#','#.$.$.$..#','#...$@...#','#........#','##########']
  };
  const IDS = Object.keys(RAW);
  const DIRS = {up:[-1,0],down:[1,0],left:[0,-1],right:[0,1]};
  const DIR_ANGLE = {up:'180deg',right:'-90deg',down:'0deg',left:'90deg'};
  const $ = id => document.getElementById(id);
  const boardEl=$('board'), frame=$('boardFrame');
  const posKey=(r,c)=>`${r},${c}`;
  const sorted=a=>a.map(p=>({row:p.row,col:p.col})).sort((x,y)=>x.row-y.row||x.col-y.col);
  const title=id=>id.split('-').map(x=>x[0].toUpperCase()+x.slice(1)).join(' ');

  function parse(id){
    const rows=RAW[id], walls=[],goals=[],crates=[]; let player;
    rows.forEach((row,r)=>[...row].forEach((ch,c)=>{ const p={row:r,col:c}; if(ch==='#')walls.push(p); if(ch==='o')goals.push(p); if(ch==='$')crates.push(p); if(ch==='@')player=p; }));
    return {width:rows[0].length,height:rows.length,walls,goals,crates,player};
  }
  const LEVELS=Object.fromEntries(IDS.map(id=>[id,parse(id)]));
  let save={completed:{},bests:{},last:'first-light',sound:true,motion:!matchMedia('(prefers-reduced-motion: reduce)').matches};
  try { save={...save,...JSON.parse(localStorage.getItem('lumen-yard-save-v1')||'{}')}; } catch(_){}
  if(!IDS.includes(save.last)) save.last='first-light';
  let S, history=[], seed=null, revision=0, attempt=0, lastDir='down', started=false, toastTimer, completeTimer, audioCtx=null;
  function persist(){ try{localStorage.setItem('lumen-yard-save-v1',JSON.stringify(save));}catch(_){} }
  function begin(id,{rev=true}={}){
    const L=LEVELS[id]; if(rev)revision++; attempt++; history=[];
    S={levelId:id,width:L.width,height:L.height,walls:sorted(L.walls),goals:sorted(L.goals),crates:sorted(L.crates),player:{...L.player},moveCount:0,pushCount:0,phase:'playing',outcome:null};
    save.last=id; persist(); render(); return snapshot();
  }
  function occupied(p,list){return list.some(x=>x.row===p.row&&x.col===p.col);}
  function canMove(direction){
    if(S.phase!=='playing'||!DIRS[direction])return false; const [dr,dc]=DIRS[direction], n={row:S.player.row+dr,col:S.player.col+dc};
    if(occupied(n,S.walls))return false; if(occupied(n,S.crates)){const b={row:n.row+dr,col:n.col+dc};return !occupied(b,S.walls)&&!occupied(b,S.crates);} return true;
  }
  function legalActions(){
    const a=[]; if(S.phase==='playing')Object.keys(DIRS).forEach(direction=>{if(canMove(direction))a.push({type:'move',direction});});
    if(history.length)a.push({type:'undo'});
    IDS.forEach(levelId=>{if(levelId!==S.levelId)a.push({type:'select_level',levelId});}); return a;
  }
  function snapshot(){
    const poweredGoals=S.goals.filter(g=>occupied(g,S.crates)).length;
    return {revision,attempt,phase:S.phase,outcome:S.outcome,levelId:S.levelId,width:S.width,height:S.height,walls:sorted(S.walls),goals:sorted(S.goals),crates:sorted(S.crates),player:{...S.player},poweredGoals,moveCount:S.moveCount,pushCount:S.pushCount,undoAvailable:history.length>0,legalActions:legalActions()};
  }
  function fail(code,message){const e=new Error(message);e.code=code;throw e;}
  function taskAct(action, human=false){
    if(!action||typeof action!=='object'||Array.isArray(action))fail('invalid_action','Action must be an object.');
    if(action.type==='move'){
      if(!DIRS[action.direction]||Object.keys(action).some(k=>!['type','direction'].includes(k)))fail('invalid_action','Unknown move direction or fields.');
      if(S.phase==='complete')fail('phase_complete','Movement is frozen after completion.');
      if(!canMove(action.direction)){if(human)refuse();fail('illegal_action','That direction is blocked.');}
      const before={player:{...S.player},crates:sorted(S.crates),moveCount:S.moveCount,pushCount:S.pushCount,phase:S.phase,outcome:S.outcome}; history.push(before);
      const [dr,dc]=DIRS[action.direction],n={row:S.player.row+dr,col:S.player.col+dc}; const ci=S.crates.findIndex(c=>c.row===n.row&&c.col===n.col); let pushed=false, socket=false;
      if(ci>=0){const dest={row:n.row+dr,col:n.col+dc};S.crates[ci]=dest;pushed=true;socket=occupied(dest,S.goals);S.pushCount++;}
      S.player=n;S.moveCount++;lastDir=action.direction;
      const done=S.goals.every(g=>occupied(g,S.crates));if(done){S.phase='complete';S.outcome='powered';}
      revision++; render({pushed, socket, complete:done}); sound(done?'complete':socket?'socket':pushed?'push':'step'); if(done)complete(); return snapshot();
    }
    if(action.type==='undo'){
      if(Object.keys(action).length!==1)fail('invalid_action','Undo has no extra fields.'); if(!history.length)fail('illegal_action','Nothing to undo.');
      const h=history.pop();Object.assign(S,{player:h.player,crates:h.crates,moveCount:h.moveCount,pushCount:h.pushCount,phase:h.phase,outcome:h.outcome});revision++;closeCompletion();render({undo:true});sound('undo');return snapshot();
    }
    if(action.type==='select_level'){
      if(Object.keys(action).some(k=>!['type','levelId'].includes(k))||!IDS.includes(action.levelId))fail('unknown_level','Unknown board.');
      if(action.levelId===S.levelId)fail('duplicate_action','That board is already active.'); closeCompletion();sound('select');return begin(action.levelId);
    }
    fail('invalid_action','Unknown action type.');
  }
  function publicAct(action){return taskAct(action,false);}
  function restart(){closeCompletion();revision++;attempt++;const L=LEVELS[S.levelId];history=[];Object.assign(S,{crates:sorted(L.crates),player:{...L.player},moveCount:0,pushCount:0,phase:'playing',outcome:null});render();sound('restart');return snapshot();}
  function reset(newSeed){seed=newSeed;revision++;attempt++;history=[];const L=LEVELS['first-light'];S={levelId:'first-light',width:L.width,height:L.height,walls:sorted(L.walls),goals:sorted(L.goals),crates:sorted(L.crates),player:{...L.player},moveCount:0,pushCount:0,phase:'playing',outcome:null};closeCompletion();render();return snapshot();}

  function render(effect={}){
    const snap=snapshot();boardEl.style.setProperty('--w',S.width);boardEl.style.setProperty('--h',S.height);boardEl.className=`board w${S.width} ${S.phase}${effect.pushed?' pushing':''}${effect.undo?' rewinding':''}`;boardEl.innerHTML='';
    const wallSet=new Set(S.walls.map(p=>posKey(p.row,p.col))), goalSet=new Set(S.goals.map(p=>posKey(p.row,p.col))), crateSet=new Set(S.crates.map(p=>posKey(p.row,p.col)));
    for(let r=0;r<S.height;r++)for(let c=0;c<S.width;c++){
      const k=posKey(r,c),tile=document.createElement('div');tile.className='tile '+(wallSet.has(k)?'wall':'floor');tile.setAttribute('role','gridcell');tile.dataset.row=r;tile.dataset.col=c;
      if(goalSet.has(k))tile.classList.add('goal');if(goalSet.has(k)&&crateSet.has(k))tile.classList.add('powered','crate-powered');
      if(crateSet.has(k)){const cr=document.createElement('div');cr.className='crate';cr.setAttribute('aria-label',goalSet.has(k)?'Powered relay core':'Relay core');tile.append(cr);}
      if(S.player.row===r&&S.player.col===c){const bot=document.createElement('div');bot.className='robot';bot.style.setProperty('--dir',DIR_ANGLE[lastDir]);bot.setAttribute('aria-label','Pip, maintenance robot');bot.innerHTML='<i class="robot-antenna"></i><i class="robot-head"></i><i class="robot-body"></i>';tile.append(bot);}
      boardEl.append(tile);
    }
    $('levelName').textContent=title(S.levelId);$('levelIndex').textContent=`Circuit ${String(IDS.indexOf(S.levelId)+1).padStart(2,'0')} / 20`;
    $('chapterLabel').textContent=IDS.indexOf(S.levelId)<3?'OPENING RESTORATION':IDS.indexOf(S.levelId)===19?'FINAL DAWN':'NORTH YARD CIRCUIT';
    $('powerCount').textContent=`${snap.poweredGoals} / ${S.goals.length}`;$('moves').textContent=S.moveCount;$('pushes').textContent=S.pushCount;$('best').textContent=save.bests[S.levelId]??'—';$('undoBtn').disabled=!history.length;
    $('statusLine').textContent=S.phase==='complete'?'Current hum: steady':snap.poweredGoals?'Current hum: rising':'Current hum: faint';frame.classList.toggle('surging',!!effect.complete);
    if(effect.pushed)boardEl.classList.add('pushing'); requestAnimationFrame(()=>requestAnimationFrame(()=>{window.dispatchEvent(new CustomEvent('arena-rendered'));}));
  }
  function refuse(){boardEl.classList.remove('blocked');void boardEl.offsetWidth;boardEl.classList.add('blocked');sound('block');notice('Relay path blocked');}
  function notice(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),1000);}
  function dismissInvitation(){if(!started){started=true;$('invitation').classList.add('hidden');setTimeout(()=>$('invitation').hidden=true,350);ensureAudio();}}
  function complete(){
    const prev=save.bests[S.levelId];if(prev==null||S.moveCount<prev)save.bests[S.levelId]=S.moveCount;save.completed[S.levelId]=true;persist();renderMap();$('best').textContent=save.bests[S.levelId];
    const idx=IDS.indexOf(S.levelId),all=IDS.every(id=>save.completed[id]);$('summary').hidden=true;$('nextBtn').hidden=false;$('completeMapBtn').hidden=false;
    if(all&&S.levelId==='dawn-sequence'){
      const total=IDS.reduce((n,id)=>n+(save.bests[id]||0),0);$('completeKicker').textContent='FINAL DAWN';$('completeTitle').textContent='THE YARD AWAKES';$('completeCopy').textContent='Greenhouse glass catches the morning. Every circuit is singing.';$('summary').hidden=false;$('summary').innerHTML=`<strong>20 / 20 restored</strong><br>${total} total best moves<br><small>Built with care by Pip & the night-shift yard crew.</small>`;$('nextBtn').hidden=true;
    } else if(idx===2){$('completeKicker').textContent='CHAPTER COMPLETE';$('completeTitle').textContent='GRID RESTORED';$('completeCopy').textContent='The opening bus comes alive. Beyond the gate, a larger yard is waiting.';$('nextBtn').textContent='Continue';}
    else if(idx===19){$('completeKicker').textContent='CIRCUIT ONLINE';$('completeTitle').textContent='Dawn Needs You';$('completeCopy').textContent='This circuit glows, but unfinished lines still darken the wider yard.';$('nextBtn').hidden=true;}
    else {$('completeKicker').textContent='CIRCUIT ONLINE';$('completeTitle').textContent='Power Restored';$('completeCopy').textContent='The relay bank settles into a warm, steady hum.';$('nextBtn').textContent='Next Circuit';if(idx===IDS.length-1)$('nextBtn').hidden=true;}
    completeTimer=setTimeout(()=>{if(S.phase==='complete'&&!$('completeDialog').open)$('completeDialog').showModal();},save.motion?650:100);
  }
  function closeCompletion(){clearTimeout(completeTimer);if($('completeDialog').open)$('completeDialog').close();frame.classList.remove('surging');}
  function renderMap(){
    const count=IDS.filter(id=>save.completed[id]).length;$('campaignProgress').textContent=`${count} of 20 circuits restored`;
    $('levelGrid').innerHTML=IDS.map((id,i)=>`<button class="level-card ${id===S.levelId?'current':''} ${save.completed[id]?'complete':''}" data-level="${id}" type="button"><span class="level-num">${String(i+1).padStart(2,'0')}</span><span><strong>${title(id)}</strong><small>${save.bests[id]!=null?`Best · ${save.bests[id]} moves`:'Awaiting restoration'}</small></span><span class="level-check" aria-label="${save.completed[id]?'Restored':''}">${save.completed[id]?'✓':id===S.levelId?'●':''}</span></button>`).join('');
  }
  function openDialog(d){renderMap();if(!d.open)d.showModal();}
  function human(action){dismissInvitation();try{taskAct(action,true);}catch(e){if(e.code!=='illegal_action')notice(e.message);}}

  function ensureAudio(){if(!save.sound)return;try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(_){}}
  function sound(kind){if(!save.sound||!started)return;ensureAudio();if(!audioCtx)return;const now=audioCtx.currentTime, recipes={step:[[130,.035,.035]],push:[[70,.09,.1],[105,.08,.11]],block:[[52,.04,.07]],undo:[[240,.04,.04],[170,.04,.1]],socket:[[220,.04,.03],[440,.12,.08]],complete:[[110,.15,.02],[220,.18,.12],[330,.25,.25],[550,.35,.4]],restart:[[180,.04,.02],[100,.08,.07]],select:[[260,.05,.02]]};
    (recipes[kind]||[]).forEach(([f,d,delay])=>{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=kind==='push'||kind==='block'?'square':'sine';o.frequency.setValueAtTime(f,now+delay);g.gain.setValueAtTime(.0001,now+delay);g.gain.exponentialRampToValueAtTime(kind==='complete'?.08:.035,now+delay+.008);g.gain.exponentialRampToValueAtTime(.0001,now+delay+d);o.connect(g).connect(audioCtx.destination);o.start(now+delay);o.stop(now+delay+d+.02);});
  }

  let suppressClickUntil=0;
  boardEl.addEventListener('click',e=>{if(Date.now()<suppressClickUntil)return;const tile=e.target.closest('.tile');if(!tile)return;const dr=+tile.dataset.row-S.player.row,dc=+tile.dataset.col-S.player.col;if(Math.abs(dr)+Math.abs(dc)!==1){notice('Tap a tile beside Pip');return;}human({type:'move',direction:dr<0?'up':dr>0?'down':dc<0?'left':'right'});});
  let touch=null;frame.addEventListener('pointerdown',e=>{touch={x:e.clientX,y:e.clientY};});frame.addEventListener('pointerup',e=>{if(!touch)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;suppressClickUntil=Date.now()+350;human({type:'move',direction:Math.abs(dx)>Math.abs(dy)?dx<0?'left':'right':dy<0?'up':'down'});});
  addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;const map={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};if(map[e.key]){e.preventDefault();human({type:'move',direction:map[e.key]});}else if(['u','U','Backspace'].includes(e.key)){e.preventDefault();human({type:'undo'});}else if(['r','R'].includes(e.key)){dismissInvitation();restart();}});
  $('undoBtn').onclick=()=>human({type:'undo'});$('restartBtn').onclick=()=>{dismissInvitation();restart();};$('boardsBtn').onclick=$('mapBtn').onclick=()=>openDialog($('mapDialog'));$('settingsBtn').onclick=()=>openDialog($('settingsDialog'));
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('levelGrid').onclick=e=>{const b=e.target.closest('[data-level]');if(!b)return;$('mapDialog').close();if(b.dataset.level===S.levelId){restart();}else human({type:'select_level',levelId:b.dataset.level});};
  $('completionUndoBtn').onclick=()=>human({type:'undo'});$('replayBtn').onclick=()=>{closeCompletion();restart();};$('nextBtn').onclick=()=>{const i=IDS.indexOf(S.levelId);if(i<IDS.length-1){closeCompletion();taskAct({type:'select_level',levelId:IDS[i+1]},true);}};$('completeMapBtn').onclick=()=>{closeCompletion();openDialog($('mapDialog'));};
  $('soundToggle').checked=save.sound;$('motionToggle').checked=save.motion;document.body.classList.toggle('motion-off',!save.motion);$('soundToggle').onchange=e=>{save.sound=e.target.checked;persist();if(save.sound){started=true;ensureAudio();sound('select');}};$('motionToggle').onchange=e=>{save.motion=e.target.checked;document.body.classList.toggle('motion-off',!save.motion);persist();};

  // Standard gamepad: edge-triggered D-pad/stick, A, B, Start.
  let prevPad=[];function gamepads(){const p=navigator.getGamepads?.()[0];if(p){const pressed=p.buttons.map(b=>b.pressed),ax=p.axes;const edges=i=>pressed[i]&&!prevPad[i];let d=null;if(edges(12)||ax[1]<-.65)d='up';else if(edges(13)||ax[1]>.65)d='down';else if(edges(14)||ax[0]<-.65)d='left';else if(edges(15)||ax[0]>.65)d='right';const axisWas=prevPad.axis||[0,0];if(d&&((Math.abs(axisWas[0])<.65&&Math.abs(axisWas[1])<.65)||[12,13,14,15].some(edges)))human({type:'move',direction:d});if(edges(1))human({type:'undo'});if(edges(9)){if(S.moveCount)restart();else openDialog($('mapDialog'));}if(edges(0)&&document.activeElement instanceof HTMLButtonElement)document.activeElement.click();pressed.axis=[...ax];prevPad=pressed;}requestAnimationFrame(gamepads);}requestAnimationFrame(gamepads);

  // Arena parent bridge. Each accepted connection supersedes the previous port.
  let bridge=null;
  addEventListener('message',e=>{
    const m=e.data;if(parent===window||e.source!==parent||!m||m.protocol!=='arena.game.v1'||m.type!=='connect'||typeof m.sessionId!=='string'||!Number.isInteger(m.generation)||e.ports.length!==1)return;
    if(bridge?.port)bridge.port.close();const port=e.ports[0],ctx={port,sessionId:m.sessionId,generation:m.generation,seen:new Set()};bridge=ctx;
    const send=(type,data={})=>port.postMessage({protocol:'arena.game.v1',type,sessionId:ctx.sessionId,generation:ctx.generation,...data});
    port.onmessage=ev=>{
      const q=ev.data;if(!q||q.protocol!=='arena.game.v1'||q.sessionId!==ctx.sessionId||q.generation!==ctx.generation||q.type!=='request')return;
      const base={requestId:q.requestId};
      if(ctx.seen.has(q.requestId)){send('response',{...base,accepted:false,revision,state:snapshot(),error:{code:'duplicate_request',message:'Request ID already used.'}});return;}ctx.seen.add(q.requestId);
      try{
        if(!['observe','act','restart'].includes(q.command))fail('unknown_command','Unknown command.');
        if(q.command==='observe'){send('response',{...base,accepted:true,revision,state:snapshot()});return;}
        if(!Number.isInteger(q.expectedRevision)||q.expectedRevision!==revision)fail('stale_revision','Expected revision does not match.');
        let state;if(q.command==='act')state=taskAct(q.action,false);else state=restart();
        requestAnimationFrame(()=>send('response',{...base,accepted:true,revision:state.revision,state}));
      }catch(err){send('response',{...base,accepted:false,revision,state:snapshot(),error:{code:err.code||'request_failed',message:err.message||'Request failed.'}});}
    };port.start();send('ready',{accepted:true,revision,state:snapshot()});
  });
  window.__ARENA_GAME__=Object.freeze({reset,snapshot,act:publicAct,restart});
  begin(save.last,{rev:false});renderMap();
})();
