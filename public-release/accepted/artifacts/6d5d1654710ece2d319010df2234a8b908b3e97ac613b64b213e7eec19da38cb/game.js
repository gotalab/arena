(() => {
'use strict';
const RAW = {
'first-light':`#######\n#...o.#\n#.....#\n#..$..#\n#.@...#\n#.....#\n#######`,
'crossfeed':`########\n#..oo..#\n#......#\n#.$.$..#\n#...@..#\n#......#\n########`,
'black-start':`########\n#.o.o.o#\n#......#\n#.$.$$.#\n#...@..#\n#......#\n########`,
'split-bus':`########\n#.o..o.#\n#......#\n#..##..#\n#.$..$.#\n#...@..#\n#......#\n########`,
'relay-bend':`########\n#..o...#\n#....o.#\n#..#...#\n#.$.$..#\n#..@...#\n#......#\n########`,
'service-loop':`#########\n#..o.o..#\n#.......#\n#.#...#.#\n#.$.$...#\n#...@...#\n#.......#\n#########`,
'cold-iron':`#########\n#..o..o.#\n#o......#\n#...#...#\n#.$$.$..#\n#...@...#\n#.......#\n#########`,
'brownout':`#########\n#..ooo..#\n#.......#\n#..#.#..#\n#.$.$.$.#\n#...@...#\n#.......#\n#########`,
'dead-bus':`#########\n#..ooo..#\n#.#...#.#\n#.......#\n#.$$.$..#\n#....@..#\n#.......#\n#########`,
'copper-maze':`#########\n#o..o..o#\n#.......#\n#.#.#.#.#\n#.$.$.$.#\n#...@...#\n#.......#\n#########`,
'backfeed':`#########\n#o.o....#\n#...o...#\n#.#...#.#\n#.$.$.$.#\n#..@....#\n#.......#\n#########`,
'load-shed':`#########\n#..o.o..#\n#o......#\n#..##...#\n#.$.$.$.#\n#....@..#\n#.......#\n#########`,
'last-circuit':`##########\n#..o.oo..#\n#....o...#\n#..##....#\n#.$.$.$..#\n#...$@...#\n#........#\n##########`,
'switchyard':`#########\n#..oooo.#\n#.......#\n#.#.#...#\n#.$.$.$.#\n#..$@...#\n#.......#\n#########`,
'phase-lock':`#########\n#o.o.o..#\n#.......#\n#..###..#\n#.$...$.#\n#...$@..#\n#.......#\n#########`,
'auxiliary':`##########\n#..o.oo..#\n#o.......#\n#..#..#..#\n#.$.$.$..#\n#...$@...#\n#........#\n##########`,
'redline':`##########\n#o.o..o.o#\n#........#\n#.#....#.#\n#.$.$.$..#\n#...$@...#\n#........#\n##########`,
'island-mode':`##########\n#..oooo..#\n#........#\n#..#..#..#\n#.$.$.$..#\n#..$..@..#\n#........#\n##########`,
'cascade':`##########\n#o..oo..o#\n#........#\n#.#.##.#.#\n#.$.$.$..#\n#....$@..#\n#........#\n##########`,
'dawn-sequence':`##########\n#o..oo..o#\n#...##...#\n#........#\n#.$.$.$..#\n#...$@...#\n#........#\n##########`
};
const IDS=Object.keys(RAW), DIR={up:[-1,0],down:[1,0],left:[0,-1],right:[0,1]};
const pretty=id=>id.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ');
const sort=(a,b)=>a.row-b.row||a.col-b.col, same=(a,b)=>a.row===b.row&&a.col===b.col;
function parse(id){const rows=RAW[id].split('\n'), walls=[],goals=[],crates=[];let player;
 rows.forEach((line,row)=>[...line].forEach((ch,col)=>{const p={row,col};if(ch==='#')walls.push(p);if(ch==='o')goals.push(p);if(ch==='$')crates.push(p);if(ch==='@')player=p;}));
 return {width:rows[0].length,height:rows.length,walls,goals,crates,player};}
let prefs={sound:true,motion:!matchMedia('(prefers-reduced-motion: reduce)').matches}, save={completed:{},best:{},last:'first-light'};
try{const x=JSON.parse(localStorage.getItem('lumen-yard-save'));if(x){save={...save,...x};prefs={...prefs,...x.prefs};}}catch(_){}
let revision=0,attempt=1,seed=null,levelId=IDS.includes(save.last)?save.last:'first-light',board=parse(levelId),moves=0,pushes=0,phase='playing',outcome=null,history=[],started=false,facing='down',pulse=null;
const $=s=>document.querySelector(s), canvas=$('#board'),ctx=canvas.getContext('2d');let geom=null, audio=null;
function persist(){try{localStorage.setItem('lumen-yard-save',JSON.stringify({...save,prefs}));}catch(_){}}
function occupied(p,arr){return arr.some(x=>same(x,p));}
function canMove(direction){if(phase!=='playing'||!DIR[direction])return false;const [dr,dc]=DIR[direction],to={row:board.player.row+dr,col:board.player.col+dc};if(occupied(to,board.walls))return false;const ci=board.crates.findIndex(c=>same(c,to));if(ci<0)return true;const beyond={row:to.row+dr,col:to.col+dc};return !occupied(beyond,board.walls)&&!occupied(beyond,board.crates);}
function legalActions(){const a=[];if(phase==='playing')Object.keys(DIR).forEach(direction=>{if(canMove(direction))a.push({type:'move',direction});});if(history.length)a.push({type:'undo'});IDS.forEach(id=>a.push({type:'select_level',levelId:id}));return a;}
function state(){return {revision,attempt,phase,outcome,levelId,width:board.width,height:board.height,walls:board.walls.slice().sort(sort).map(x=>({...x})),goals:board.goals.slice().sort(sort).map(x=>({...x})),crates:board.crates.slice().sort(sort).map(x=>({...x})),player:{...board.player},poweredGoals:board.goals.filter(g=>occupied(g,board.crates)).length,moveCount:moves,pushCount:pushes,undoAvailable:history.length>0,legalActions:legalActions()};}
function err(code,message){const e=new Error(message);e.code=code;return e;}
function beginInput(){if(!started){started=true;$('#invitation').classList.add('gone');initAudio();}}
function initAudio(){if(audio)return;try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(_){}}
function tone(kind){if(!prefs.sound||!audio)return;audio.resume();const now=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);const data={step:[180,.035,.025,'sine'],push:[78,.12,.075,'triangle'],block:[105,.07,.04,'square'],undo:[260,.14,.04,'sine'],socket:[480,.18,.06,'sine'],surge:[120,.65,.09,'sawtooth']}[kind];if(!data)return;o.type=data[3];o.frequency.setValueAtTime(data[0],now);o.frequency.exponentialRampToValueAtTime(kind==='surge'?620:data[0]*.72,now+data[1]);g.gain.setValueAtTime(data[2],now);g.gain.exponentialRampToValueAtTime(.001,now+data[1]);o.start(now);o.stop(now+data[1]);}
function remember(){return {player:{...board.player},crates:board.crates.map(x=>({...x})),moves,pushes,phase,outcome,facing};}
function perform(action){
 if(!action||typeof action!=='object'||Array.isArray(action))throw err('BAD_ACTION','Action must be an object.');
 const keys=Object.keys(action).sort().join(',');
 if((action.type==='move'&&keys!=='direction,type')||(action.type==='undo'&&keys!=='type')||(action.type==='select_level'&&keys!=='levelId,type'))throw err('BAD_ACTION','Action has an invalid shape.');
 if(action.type==='move'){
  if(!DIR[action.direction])throw err('BAD_ACTION','Unknown direction.');if(phase==='complete')throw err('POST_COMPLETE','Movement is frozen after completion.');if(!canMove(action.direction))throw err('ILLEGAL_ACTION','That move is blocked.');
  history.push(remember());const [dr,dc]=DIR[action.direction],to={row:board.player.row+dr,col:board.player.col+dc},ci=board.crates.findIndex(c=>same(c,to));let seated=false;
  if(ci>=0){const was=occupied(board.crates[ci],board.goals);board.crates[ci]={row:to.row+dr,col:to.col+dc};pushes++;seated=!was&&occupied(board.crates[ci],board.goals);pulse={...board.crates[ci],kind:'push',at:performance.now()};}
  board.player=to;facing=action.direction;moves++;revision++;
  if(board.goals.every(g=>occupied(g,board.crates))){phase='complete';outcome='powered';save.completed[levelId]=true;save.best[levelId]=Math.min(save.best[levelId]||Infinity,moves);persist();tone('surge');}else tone(seated?'socket':ci>=0?'push':'step');
 } else if(action.type==='undo'){
  if(!history.length)throw err('ILLEGAL_ACTION','Nothing to undo.');const h=history.pop();board.player=h.player;board.crates=h.crates;moves=h.moves;pushes=h.pushes;phase=h.phase;outcome=h.outcome;facing=h.facing;revision++;pulse={...board.player,kind:'undo',at:performance.now()};tone('undo');
 } else if(action.type==='select_level'){
  if(!IDS.includes(action.levelId))throw err('UNKNOWN_LEVEL','Unknown board.');startLevel(action.levelId,true);
 } else throw err('BAD_ACTION','Unknown action type.');
 render();return state();
}
function startLevel(id,mutate=true){levelId=id;board=parse(id);moves=pushes=0;phase='playing';outcome=null;history=[];attempt++;if(mutate)revision++;save.last=id;persist();facing='down';pulse=null;}
function doRestart(){startLevel(levelId,true);render();return state();}
function publicAct(action){beginInput();return perform(action);}
window.__ARENA_GAME__={reset(s){seed=s;levelId='first-light';board=parse(levelId);moves=pushes=0;phase='playing';outcome=null;history=[];revision=0;attempt=1;facing='down';started=false;$('#invitation').classList.remove('gone');render();return state();},snapshot(){return state();},act:publicAct,restart(){beginInput();return doRestart();}};

function fit(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);}ctx.setTransform(d,0,0,d,0,0);const pad=8,tile=Math.min((r.width-pad*2)/board.width,(r.height-pad*2)/board.height);geom={tile,left:(r.width-board.width*tile)/2,top:(r.height-board.height*tile)/2,w:r.width,h:r.height};}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function draw(){fit();const {tile:t,left:L,top:T,w,h}=geom;ctx.clearRect(0,0,w,h);let grd=ctx.createRadialGradient(w*.48,h*.45,5,w*.5,h*.5,w*.65);grd.addColorStop(0,phase==='complete'?'#17433f':'#10282d');grd.addColorStop(1,'#050e12');ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);
 // floor plates and embedded copper traces
 for(let r=0;r<board.height;r++)for(let c=0;c<board.width;c++){if(occupied({row:r,col:c},board.walls))continue;const x=L+c*t,y=T+r*t;ctx.fillStyle=(r+c)%2?'#102428':'#11272b';ctx.fillRect(x+1,y+1,t-2,t-2);ctx.strokeStyle='#193236';ctx.lineWidth=1;ctx.strokeRect(x+2,y+2,t-4,t-4);ctx.strokeStyle=phase==='complete'?'#dba65b88':'#8f653538';ctx.lineWidth=Math.max(1,t*.035);ctx.beginPath();ctx.moveTo(x,y+t*.5);ctx.lineTo(x+t,y+t*.5);ctx.stroke();}
 // walls: insulated transformer blocks
 board.walls.forEach(p=>{const x=L+p.col*t,y=T+p.row*t;ctx.fillStyle='#172b30';rr(x+1,y+1,t-2,t-2,t*.12);ctx.fill();ctx.fillStyle='#223b40';rr(x+3,y+3,t-6,t*.27,t*.08);ctx.fill();ctx.strokeStyle='#345057';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#0a171b';ctx.fillRect(x+t*.18,y+t*.7,t*.64,Math.max(2,t*.07));});
 // sockets
 board.goals.forEach(p=>{const x=L+(p.col+.5)*t,y=T+(p.row+.5)*t,on=occupied(p,board.crates);ctx.save();if(on){ctx.shadowBlur=t*.45;ctx.shadowColor='#ffd273';}ctx.fillStyle=on?'#e0a956':'#0a1619';ctx.strokeStyle=on?'#ffe19b':'#b47445';ctx.lineWidth=Math.max(2,t*.07);ctx.beginPath();ctx.arc(x,y,t*.28,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle=on?'#fff0b0':'#75482d';ctx.lineWidth=1;for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*t*.12,y+Math.sin(a)*t*.12);ctx.lineTo(x+Math.cos(a)*t*.22,y+Math.sin(a)*t*.22);ctx.stroke();}ctx.restore();});
 // heavy glass relay cores
 board.crates.forEach(p=>{const x=L+p.col*t,y=T+p.row*t,on=occupied(p,board.goals);ctx.save();ctx.shadowColor=on?'#ffc866':'#000';ctx.shadowBlur=on?t*.35:t*.12;ctx.shadowOffsetY=t*.07;const m=t*.13;ctx.fillStyle='#263b3d';rr(x+m,y+m,t-2*m,t-2*m,t*.13);ctx.fill();ctx.strokeStyle=on?'#f2bd66':'#7d6048';ctx.lineWidth=Math.max(1.5,t*.045);ctx.stroke();ctx.fillStyle=on?'#ffd477':'#8c593c';rr(x+t*.3,y+t*.25,t*.4,t*.5,t*.08);ctx.fill();ctx.strokeStyle='#f4d09877';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#0b1719';ctx.beginPath();ctx.arc(x+t*.5,y+t*.5,t*.09,0,7);ctx.fill();ctx.fillStyle=on?'#fff4b1':'#b46f46';ctx.beginPath();ctx.arc(x+t*.5,y+t*.5,t*.045,0,7);ctx.fill();ctx.restore();});
 // robot character
 {const p=board.player,x=L+(p.col+.5)*t,y=T+(p.row+.5)*t+(prefs.motion&&phase==='playing'?Math.sin(performance.now()/420)*t*.015:0),ang={down:0,left:Math.PI/2,up:Math.PI,right:-Math.PI/2}[facing];ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.shadowColor='#54c9c3';ctx.shadowBlur=t*.14;ctx.fillStyle='#9ac5bd';rr(-t*.23,-t*.24,t*.46,t*.49,t*.14);ctx.fill();ctx.strokeStyle='#d5e6df';ctx.lineWidth=1.4;ctx.stroke();ctx.fillStyle='#17383a';rr(-t*.16,-t*.15,t*.32,t*.19,t*.06);ctx.fill();ctx.fillStyle='#86eee0';ctx.beginPath();ctx.arc(-t*.07,-t*.06,t*.035,0,7);ctx.arc(t*.07,-t*.06,t*.035,0,7);ctx.fill();ctx.fillStyle='#d98b50';ctx.fillRect(-t*.12,t*.2,t*.24,t*.08);ctx.strokeStyle='#789d96';ctx.beginPath();ctx.moveTo(-t*.18,t*.24);ctx.lineTo(-t*.29,t*.32);ctx.moveTo(t*.18,t*.24);ctx.lineTo(t*.29,t*.32);ctx.stroke();ctx.restore();}
 // ambient source lights
 ctx.fillStyle=phase==='complete'?'#ffe6a5':'#5bc5ba';ctx.globalAlpha=phase==='complete'?.9:.35+(prefs.motion?Math.sin(performance.now()/500)*.12:0);ctx.beginPath();ctx.arc(L+t*.5,T+(board.height-.5)*t,Math.max(2,t*.06),0,7);ctx.fill();ctx.globalAlpha=1;
}
function render(){draw();const idx=IDS.indexOf(levelId);$('#levelNo').textContent=String(idx+1).padStart(2,'0');$('#levelName').textContent=pretty(levelId);$('#chapter').textContent=idx<3?'OPENING CIRCUIT':idx<12?'NIGHT GRID':idx<19?'OUTER YARD':'FINAL FEED';$('#powered').textContent=`${board.goals.filter(g=>occupied(g,board.crates)).length} / ${board.goals.length}`;$('#moves').textContent=moves;$('#pushes').textContent=pushes;$('#best').textContent=save.best[levelId]??'—';$('#undoBtn').disabled=!history.length;
 const comp=$('#completion');comp.hidden=phase!=='complete';if(phase==='complete')showCompletion(); else $('#status').textContent=started?'Route the relays into the copper sockets.':'Current trembles at the source…';buildMap();}
function showCompletion(){const idx=IDS.indexOf(levelId),all=IDS.every(id=>save.completed[id]);$('#completeKicker').textContent=idx===2?'GRID RESTORED':all?'FINAL DAWN':'CIRCUIT ONLINE';$('#completeTitle').textContent=idx===2?'Grid Restored':all?'The Yard Wakes':'Relay Locked';let copy=idx===2?'The opening grid hums as one. The outer yard is waiting.':all?'Every circuit carries light. Greenhouse glass glows beyond the fence. Restored by Yard Crew 07.':idx===19?'Dawn Sequence is live. Return to the unfinished circuits to wake the whole yard.':'Current runs clean through this section of the yard.';$('#completeCopy').textContent=copy;$('#status').textContent='All sockets powered.';const sum=$('#summary');sum.hidden=!all;sum.innerHTML=all?`<div><strong>20 / 20</strong><small>RESTORED</small></div><div><strong>${IDS.reduce((n,id)=>n+(save.best[id]||0),0)}</strong><small>BEST MOVES</small></div>`:'';$('#nextBtn').textContent=all?'Replay Dawn':idx===19?'Open Board Map':'Continue';$('#finishMapBtn').hidden=!all;}
function buildMap(){const complete=IDS.filter(id=>save.completed[id]).length;$('#progressText').textContent=`${complete} / 20`;$('#levelGrid').innerHTML=IDS.map((id,i)=>`<button class="level-choice ${id===levelId?'current':''} ${save.completed[id]?'complete':''}" data-level="${id}"><span class="number">${String(i+1).padStart(2,'0')}</span><span><b>${pretty(id)}</b><small>${save.best[id]?`Best ${save.best[id]} moves`:'Not yet restored'}</small></span><span class="tick">${save.completed[id]?'✓':''}</span></button>`).join('');}
function human(action){beginInput();try{perform(action);}catch(e){if(e.code==='ILLEGAL_ACTION'||e.code==='POST_COMPLETE'){tone('block');$('#status').textContent=e.code==='POST_COMPLETE'?'Circuit complete — undo or choose a board.':'Blocked — the relay needs clear space.';$('#status').classList.add('bump');setTimeout(()=>$('#status').classList.remove('bump'),180);}}}

// Complete touch, mouse and keyboard paths
let down=null;canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);beginInput();});canvas.addEventListener('pointerup',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;down=null;if(Math.hypot(dx,dy)>24){human({type:'move',direction:Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up')});return;}if(!geom)return;const col=Math.floor((e.offsetX-geom.left)/geom.tile),row=Math.floor((e.offsetY-geom.top)/geom.tile),dr=row-board.player.row,dc=col-board.player.col;if(Math.abs(dr)+Math.abs(dc)===1)human({type:'move',direction:dr<0?'up':dr>0?'down':dc<0?'left':'right'});});
document.querySelectorAll('[data-dir]').forEach(b=>b.addEventListener('click',()=>human({type:'move',direction:b.dataset.dir})));$('#undoBtn').onclick=()=>human({type:'undo'});$('#restartBtn').onclick=()=>{beginInput();doRestart();};$('#replayBtn').onclick=()=>doRestart();$('#nextBtn').onclick=()=>{const i=IDS.indexOf(levelId),all=IDS.every(id=>save.completed[id]);if(all)doRestart();else if(i<IDS.length-1)human({type:'select_level',levelId:IDS[i+1]});else openDrawer($('#mapDrawer'));};$('#finishMapBtn').onclick=()=>openDrawer($('#mapDrawer'));
window.addEventListener('keydown',e=>{if($('.drawer.open')){if(e.key==='Escape')closeDrawers();return;}const k=e.key.toLowerCase(),d={arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',arrowright:'right',d:'right'}[k];if(d){e.preventDefault();human({type:'move',direction:d});}else if(k==='u'||e.key==='Backspace'){e.preventDefault();human({type:'undo'});}else if(k==='r'){doRestart();}});
function openDrawer(el){closeDrawers(false);$('#scrim').hidden=false;el.classList.add('open');el.setAttribute('aria-hidden','false');$(el=== $('#mapDrawer')?'#mapBtn':'#settingsBtn').setAttribute('aria-expanded','true');setTimeout(()=>el.querySelector('button').focus(),50);}
function closeDrawers(hide=true){document.querySelectorAll('.drawer').forEach(x=>{x.classList.remove('open');x.setAttribute('aria-hidden','true');});$('#mapBtn').setAttribute('aria-expanded','false');$('#settingsBtn').setAttribute('aria-expanded','false');if(hide)setTimeout(()=>$('#scrim').hidden=true,230);}
$('#mapBtn').onclick=()=>openDrawer($('#mapDrawer'));$('#settingsBtn').onclick=()=>openDrawer($('#settingsDrawer'));$('#scrim').onclick=()=>closeDrawers();document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>closeDrawers());$('#levelGrid').onclick=e=>{const b=e.target.closest('[data-level]');if(b){human({type:'select_level',levelId:b.dataset.level});closeDrawers();}};
$('#soundToggle').checked=prefs.sound;$('#motionToggle').checked=prefs.motion;document.body.classList.toggle('motion-off',!prefs.motion);$('#soundToggle').onchange=e=>{prefs.sound=e.target.checked;persist();if(prefs.sound){initAudio();tone('step');}};$('#motionToggle').onchange=e=>{prefs.motion=e.target.checked;document.body.classList.toggle('motion-off',!prefs.motion);persist();draw();};
window.addEventListener('resize',draw);
let lastAmbient=0;function ambientFrame(now){if(prefs.motion&&phase==='playing'&&now-lastAmbient>50){lastAmbient=now;draw();}requestAnimationFrame(ambientFrame);}requestAnimationFrame(ambientFrame);

// Standard gamepad supplement
let gpPrev={};function pollGamepad(){const gp=navigator.getGamepads?.()[0];if(gp){const pressed={up:gp.buttons[12]?.pressed||gp.axes[1]<-.55,down:gp.buttons[13]?.pressed||gp.axes[1]>.55,left:gp.buttons[14]?.pressed||gp.axes[0]<-.55,right:gp.buttons[15]?.pressed||gp.axes[0]>.55,a:gp.buttons[0]?.pressed,b:gp.buttons[1]?.pressed,start:gp.buttons[9]?.pressed};for(const k in pressed)if(pressed[k]&&!gpPrev[k]){const open=$('.drawer.open');if(DIR[k]&&open){const choices=[...open.querySelectorAll('button,input')],i=Math.max(0,choices.indexOf(document.activeElement)),step=(k==='left'||k==='up')?-1:1;choices[(i+step+choices.length)%choices.length]?.focus();}else if(DIR[k])human({type:'move',direction:k});else if(k==='b'){if(open)closeDrawers();if(history.length)human({type:'undo'});}else if(k==='a'&&document.activeElement?.click)document.activeElement.click();else if(k==='start')open?doRestart():openDrawer($('#mapDrawer'));}gpPrev=pressed;}requestAnimationFrame(pollGamepad);}pollGamepad();

// arena.game.v1 bridge
let activePort=null,session=null,generation=null,seen=new Set();const envelope=(requestId,accepted,error)=>({protocol:'arena.game.v1',type:'response',requestId,sessionId:session,generation,accepted,revision,state:state(),...(error?{error}:{})});
window.addEventListener('message',e=>{const m=e.data;if(e.source!==window.parent||!m||m.protocol!=='arena.game.v1'||m.type!=='connect'||typeof m.sessionId!=='string'||!Number.isInteger(m.generation)||e.ports.length!==1)return;if(activePort)activePort.close();activePort=e.ports[0];session=m.sessionId;generation=m.generation;seen=new Set();activePort.onmessage=ev=>{const q=ev.data;if(!q||q.protocol!=='arena.game.v1'||q.sessionId!==session||q.generation!==generation)return;const rid=q.requestId;let accepted=false,error=null;try{if(seen.has(rid))throw err('DUPLICATE_REQUEST','Request was already handled.');seen.add(rid);if(q.command==='observe'){accepted=true;}else if(q.command==='act'||q.command==='restart'){if(!Number.isInteger(q.expectedRevision)||q.expectedRevision!==revision)throw err('STALE_REVISION','Expected revision does not match.');if(q.command==='act')perform(q.action);else doRestart();accepted=true;}else throw err('BAD_COMMAND','Unknown command.');}catch(ex){error={code:ex.code||'BAD_REQUEST',message:ex.message||'Request rejected.'};}activePort.postMessage(envelope(rid,accepted,error));};activePort.start();activePort.postMessage({protocol:'arena.game.v1',type:'ready',sessionId:session,generation,accepted:true,revision,state:state()});});

render();
})();
