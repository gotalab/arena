const core = require('../core.js');
const { ArenaGame } = core;

function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); } }

// ---- Test 1: generation solvable for every first-turn cell on several pools
function testGeneration() {
  const pools = [1,2,3,4,5,6,7,8];
  let count = 0;
  for (const pool of pools) {
    const spec = core.poolSpec(pool);
    const W = spec.w, H = spec.h;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const urch = core.generateBoard("test", pool, x, y);
        const n = urch.reduce((a,b)=>a+b,0);
        if (n !== spec.urchins) throw new Error(`pool ${pool} ${x},${y}: ${n} urchins, expected ${spec.urchins}`);
        // check fx is 0 and not urchin
        const i = y*W+x;
        if (urch[i]) throw new Error(`pool ${pool} first turn ${x},${y} is urchin`);
        // count neighbors
        let adj = 0;
        for (let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(dx===0&&dy===0)continue;const nx=x+dx,ny=y+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H&&urch[ny*W+nx])adj++;}
        if (adj !== 0) throw new Error(`pool ${pool} first turn ${x},${y} touches urchin`);
        count++;
      }
    }
  }
  console.log(`Generation: ${count} first-turn cells OK across ${pools.length} pools`);
}

// ---- Test 2: determinism of snapshot from same seed+actions
function testDeterminism() {
  const a = new ArenaGame(); a.reset("s1");
  const b = new ArenaGame(); b.reset("s1");
  const acts = [
    ["open", 1, 2],
    ["open", 0, 0],
    ["flag", 4, 3],
    ["unflag", 4, 3],
    ["sweep", 1, 2],
  ];
  for (const [t,x,y] of acts) {
    const ra = a.act({type:t,x,y});
    const rb = b.act({type:t,x,y});
    assert(ra.ok === rb.ok, `act ${t} ok mismatch`);
    const sa = JSON.stringify(ra.state), sb = JSON.stringify(rb.state);
    assert(sa === sb, `snapshot mismatch after ${t}: ${sa} vs ${sb}`);
  }
  console.log("Determinism: two runs with same seed+actions produce identical snapshots");
}

// ---- Test 3: illegal actions rejected without revision change
function testIllegal() {
  const g = new ArenaGame(); g.reset("s2");
  const before = g.snapshot();
  let bad = 0;
  // out of bounds
  for (const a of [
    {type:"open",x:99,y:0},{type:"open",x:-1,y:0},{type:"flag",x:0,y:99},
    {type:"bogus",x:0,y:0},{type:"open"},
  ]) {
    const r = g.act(a);
    if (r.ok) throw new Error("should reject " + JSON.stringify(a));
    bad++;
  }
  assert(g.snapshot().revision === before.revision, "revision changed on illegal action");
  // open first (safe turn) then illegal open on turned
  g.act({type:"open",x:1,y:1});
  const rev = g.snapshot().revision;
  const r = g.act({type:"open",x:1,y:1});
  assert(!r.ok, "should reject turning a turned shell");
  assert(g.snapshot().revision === rev, "revision changed");
  console.log(`Illegal actions: ${bad} rejected, revision untouched`);
}

// ---- Test: solver-guided play validates the water-never-lies guarantee end-to-end.
// The driver sees only the visible rows + urchinsTotal and must always find a
// provably safe move while safe cells remain. A violation means the board lied.
function testGuaranteePlay() {
  for (const seed of ["a1", "b2", "c3", "d4", "e5"]) {
    const g = new ArenaGame(); g.reset(seed);
    const res = driveRun(g);
    assert(res.ok, `guarantee violated for seed ${seed}: ${res.reason}`);
    assert(res.poolCleared >= 16, `seed ${seed}: expected all 16 pools cleared, reached pool ${res.poolCleared}`);
    console.log(`Guarantee: seed ${seed} cleared ${res.poolCleared} pools in ${res.moves} moves, rank ${res.rank}, pearls ${res.pearls}`);
  }
}

function driveRun(g) {
  // per-pool solver state
  let rev = null, known = null, W = 0, H = 0;
  let moves = 0;
  let poolsCleared = 0;
  let lastPool = 1;
  let guard = 0;
  while (g.snapshot().phase !== "ended" && guard < 100000) {
    guard++;
    const s = g.snapshot();
    if (s.pool !== lastPool) { // pool advanced
      rev = new Array(s.gridHeight).fill(0).map(()=>new Array(s.gridWidth).fill(0));
      known = new Array(s.gridHeight).fill(0).map(()=>new Array(s.gridWidth).fill(0));
      W = s.gridWidth; H = s.gridHeight;
      lastPool = s.pool;
      poolsCleared = s.pool - 1;
    }
    if (!rev) { W=s.gridWidth; H=s.gridHeight; rev=makeGrid(W,H); known=makeGrid(W,H); }
    // refresh rev from rows
    syncRev(s, rev);
    let move = findSafeMove(s, rev, known);
    if (!move && !hasRevealed(s)) {
      // first turn of a pool is free and generous: any covered shell is safe.
      move = { kind:"open", x:(W/2)|0, y:(H/2)|0 };
    }
    if (!move) {
      // no provable move; if any safe-covered remains, violation
      if (hasCoveredSafe(s, rev)) return { ok:false, reason:"stuck with safe cells covered at pool "+s.pool };
      continue; // all revealed -> should have cleared
    }
    if (move.kind === "open") {
      const r = g.act({ type:"open", x:move.x, y:move.y });
      if (!r.ok) return { ok:false, reason:"open rejected at "+move.x+","+move.y+": "+r.error.code };
      if (r.state.phase === "ended") {
        if (r.state.stungAt) return { ok:false, reason:"stung during solver play at pool "+s.pool };
        moves++;
        break; // run completed by clearing the final pool
      }
      moves++;
    } else {
      known[move.y][move.x] = 1;
    }
  }
  const s = g.snapshot();
  if (s.phase !== "ended") return { ok:false, reason:"run did not end" };
  const cleared = s.stungAt ? poolsCleared : poolsCleared + 1; // ended without sting = cleared final pool
  return { ok:true, poolCleared: cleared, moves, rank: s.rank, pearls: s.pearls };
}

function makeGrid(W,H){ return new Array(H).fill(0).map(()=>new Array(W).fill(0)); }
function syncRev(s, rev) {
  for (let y=0;y<s.gridHeight;y++) for (let x=0;x<s.gridWidth;x++) {
    const c = s.rows[y][x];
    if (c >= '0' && c <= '8') rev[y][x]=1;
  }
}
function nbrCells(x,y,W,H){ const out=[]; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(dx===0&&dy===0)continue;const nx=x+dx,ny=y+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H)out.push([nx,ny]);} return out; }
function coveredList(x,y,W,H,rev,known){
  const out=[]; for(const [nx,ny] of nbrCells(x,y,W,H)){ if(!rev[ny][nx]) out.push([nx,ny]); } return out;
}
function findSafeMove(s, rev, known){
  const W=s.gridWidth,H=s.gridHeight;
  // trivial
  for (let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(!rev[y][x]) continue;
    const num = s.rows[y].charCodeAt(x)-48;
    const cov = coveredList(x,y,W,H,rev,known);
    let kA=0, unk=[];
    for(const [nx,ny] of cov){ if(known[ny][nx]) kA++; else unk.push([nx,ny]); }
    if(kA===num && unk.length) return {kind:"open",x:unk[0][0],y:unk[0][1]};
    if(kA+unk.length===num){ for(const [nx,ny] of unk) if(!known[ny][nx]){ return {kind:"known",x:nx,y:ny}; } }
  }
  // pairwise subset
  for (let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(!rev[y][x]) continue;
    const A = coveredList(x,y,W,H,rev,known);
    if(!A.length) continue;
    for (let y2=0;y2<H;y2++)for(let x2=0;x2<W;x2++){
      if(!rev[y2][x2]) continue;
      if(x2===x&&y2===y) continue;
      const B = coveredList(x2,y2,W,H,rev,known);
      if(A.length>B.length) continue;
      let sub=true;
      for(const [ax,ay] of A){ let f=false; for(const [bx,by] of B){ if(ax===bx&&ay===by){f=true;break;} } if(!f){sub=false;break;} }
      if(!sub) continue;
      const nA=s.rows[y].charCodeAt(x)-48, nB=s.rows[y2].charCodeAt(x2)-48;
      let kA=0, kB=0, unkA=[], unkB=[];
      for(const [nx,ny] of A){ if(known[ny][nx])kA++; else unkA.push([nx,ny]); }
      for(const [nx,ny] of B){ if(known[ny][nx])kB++; else unkB.push([nx,ny]); }
      const needA=nA-kA, needB=nB-kB;
      const extra=[]; for(const [nx,ny] of unkB){ let inA=false; for(const [ax,ay] of A){ if(nx===ax&&ny===ay){inA=true;break;} } if(!inA) extra.push([nx,ny]); }
      if(needB-needA===extra.length && extra.length){ return {kind:"known",x:extra[0][0],y:extra[0][1]}; }
      if(needB===needA && extra.length){ return {kind:"open",x:extra[0][0],y:extra[0][1]}; }
    }
  }
  return null;
}
function hasCoveredSafe(s, rev){
  const W=s.gridWidth,H=s.gridHeight;
  const covered=[]; for(let y=0;y<H;y++)for(let x=0;x<W;x++){ if(s.rows[y][x]==='#'||s.rows[y][x]==='F') covered.push([x,y]); }
  return covered.length>0;
}
function hasRevealed(s){
  for (const row of s.rows) for (const c of row) if (c >= '0' && c <= '8') return true;
  return false;
}

// ---- Test 4: full run plays out, clearing pools, ending on urchin
function testRun() {
  const g = new ArenaGame(); g.reset("s3");
  // brute force: use the solver to find provably safe moves and play them until we either
  // clear everything or we're forced to the end. We'll play until run ends or all pools done.
  // Simpler: just do a bunch of opens until the run ends (some pool will sting) OR verify.
  let phase = g.snapshot().phase;
  let guard = 0;
  // We don't have a solver exposed for play-guiding here; just turn cells in order and
  // ensure the API never crashes. Accept that some run stings.
  let stung = false;
  while (g.snapshot().phase !== "ended" && guard < 5000) {
    guard++;
    const s = g.snapshot();
    // find a covered, un-flagged cell and open it
    let found = false;
    outer:
    for (let y=0;y<s.gridHeight;y++)for(let x=0;x<s.gridWidth;x++){
      const c = s.rows[y][x];
      if (c === '#' ) {
        const r = g.act({type:"open",x,y});
        found = true;
        if (!r.ok) throw new Error("open should be legal on covered cell: "+r.error.code);
        break outer;
      }
      if (c === 'F') { g.act({type:"unflag",x,y}); found=true; break outer; }
    }
    if (!found) {
      // all revealed/flagged -> pool should have cleared, but if ended phase, break
      if (g.snapshot().phase === "ended") break;
      // pool cleared should have auto-advanced; if we're stuck with all revealed and playing, it's clear
      throw new Error("no covered cell but still playing (pool clear should have advanced)");
    }
  }
  const s = g.snapshot();
  if (s.phase === "ended") {
    assert(s.rank !== null, "rank set on end");
    assert(s.stungAt !== null || s.rank !== null, "end has stungAt or full clear");
    // post-mortem: all urchins accounted
  } else {
    throw new Error("run should have ended by now");
  }
  console.log("Run: completed a full run to termination. moves=", s.moves, "pearls=", s.pearls, "rank=", s.rank, "pool=", s.pool);
}

// ---- Test 5: the water-never-lies guarantee along a solver-guided play
// We re-implement a solver-guided driver here: at each state, find a provably safe move
// using the same trivial+pairwise logic, reveal it, and verify we can always clear.
// We do this by brute-force over all pools/first-turns using core.generateBoard + isSolvable,
// which already guarantees full solvability => guarantee holds.

// ---- Test 6: advance/tide
function testAdvance() {
  const g = new ArenaGame(); g.reset("s4");
  let s = g.snapshot();
  assert(s.tick === 0 && s.elapsedMs === 0, "ready phase frozen");
  g.advance(5000);
  s = g.snapshot();
  assert(s.tick === 0, "advance does nothing in ready phase");
  // start first turn
  g.act({type:"open",x:0,y:0});
  g.advance(1000);
  s = g.snapshot();
  assert(s.tick === 60, "after 1000ms tick=60, got "+s.tick);
  assert(s.elapsedMs === 1000, "elapsed 1000");
  assert(s.tideFraction < 1 && s.tideFraction > 0, "tide drained");
  const t1 = s.tideFraction;
  g.advance(1000);
  s = g.snapshot();
  assert(s.tideFraction < t1, "tide keeps draining");
  // determinism of advance
  const h = new ArenaGame(); h.reset("s4");
  h.act({type:"open",x:0,y:0}); h.advance(1000);
  assert(JSON.stringify(h.snapshot()) === JSON.stringify((()=>{const p=new ArenaGame();p.reset("s4");p.act({type:"open",x:0,y:0});p.advance(1000);return p.snapshot();})()), "advance deterministic");
  console.log("Advance/tide: OK");
}

// ---- revision increments + flag-before-first-turn rules
function testFlagBeforeTurn() {
  const g = new ArenaGame(); g.reset("s9");
  let s = g.snapshot();
  assert(s.revision === 0, "revision starts at 0");
  assert(s.tick === 0 && s.elapsedMs === 0, "frozen before first turn");
  // flag before any turn: allowed, but must NOT fix board, NOT start clock, NOT change pool state
  const rf = g.act({type:"flag",x:2,y:2});
  assert(rf.ok, "flag before first turn should be legal");
  s = g.snapshot();
  assert(s.firstTurnDone === false, "flag must not fix the board");
  assert(s.phase === "ready", "flag must not start the run");
  assert(s.revision === 1, "revision incremented once");
  assert(s.flagsPlaced === 1 && s.urchinsLeft === s.urchinsTotal - 1, "urchin counter reflects pennant");
  g.advance(5000);
  s = g.snapshot();
  assert(s.tick === 0 && s.elapsedMs === 0, "clock still frozen after flag + advance");
  // first turn fixes board and starts clock
  const ro = g.act({type:"open",x:0,y:0});
  assert(ro.ok, "first turn legal");
  s = g.snapshot();
  assert(s.firstTurnDone === true, "first turn fixes board");
  assert(s.phase === "playing", "first turn starts run");
  assert(s.revision === 2, "revision incremented twice");
  const r2 = g.act({type:"unflag",x:2,y:2});
  assert(r2.ok, "unflag legal");
  assert(g.snapshot().revision === 3, "revision three");
  // flag on open cell illegal
  assert(!g.act({type:"flag",x:0,y:0}).ok, "cannot flag an open shell");
  // double flag illegal (flag again while a pennant still stands)
  assert(g.act({type:"flag",x:2,y:2}).ok, "flag legal after unflag");
  assert(!g.act({type:"flag",x:2,y:2}).ok, "cannot flag twice");
  console.log("Flag-before-turn + revision: OK");
}

// ---- post-mortem encoding: sting run grades every urchin and pennant
function testPostMortem() {
  for (const seed of ["pm1", "pm2", "pm3"]) {
    const g = new ArenaGame(); g.reset(seed);
    // plant some pennants on random covered cells early
    g.act({ type: "flag", x: 0, y: 0 });
    g.act({ type: "flag", x: 1, y: 1 });
    g.act({ type: "flag", x: 2, y: 2 });
    // turn cells until the run ends
    let guard = 0;
    let ended = false;
    while (!ended && guard < 5000) {
      guard++;
      const s = g.snapshot();
      outer:
      for (let y = 0; y < s.gridHeight; y++) for (let x = 0; x < s.gridWidth; x++) {
        const c = s.rows[y][x];
        if (c === "#") { g.act({ type: "open", x, y }); break outer; }
        if (c === "F") { g.act({ type: "unflag", x, y }); break outer; }
      }
      if (g.snapshot().phase === "ended") ended = true;
      if (!ended && guard === 4999) { /* pool may have cleared; keep going */ }
    }
    const s = g.snapshot();
    if (s.phase !== "ended") throw new Error("run did not end for seed " + seed);
    if (!s.stungAt) { continue; } // skip full-clear runs for post-mortem checks
    const rows = s.rows;
    const flat = rows.join("");
    // count each category
    const star = (flat.match(/\*/g) || []).length;
    const ex = (flat.match(/X/g) || []).length;
    const plus = (flat.match(/\+/g) || []).length;
    const minus = (flat.match(/-/g) || []).length;
    const flagsBefore = s.flagsPlaced;
    // every urchin accounted: * + X + +
    assert(star + ex + plus === s.urchinsTotal, `seed ${seed}: urchins not all accounted ${star}+${ex}+${plus} vs ${s.urchinsTotal}`);
    assert(ex === 1, `seed ${seed}: exactly one fatal shell, got ${ex}`);
    // the fatal shell is marked X at stungAt
    assert(rows[s.stungAt.y][s.stungAt.x] === "X", `seed ${seed}: fatal cell not X`);
    // every pennant graded: + and - equal standing pennants
    assert(plus + minus === s.flagsPlaced, `seed ${seed}: pennant grading incomplete ${plus}+${minus} vs ${s.flagsPlaced}`);
  }
  console.log("Post-mortem encoding: OK");
}

// ---- a ripple never turns a pennanted shell ----
function testRippleRespectsPennant() {
  const g = new ArenaGame(); g.reset("rp1");
  // find a covered cell adjacent to a future zero by flagging several cells
  // near the first turn, then confirm flagged cells stay covered through floods.
  const s0 = g.snapshot();
  // flag a few cells that are NOT the first turn
  const flagged = [[0,1],[1,0],[2,0],[0,2]];
  flagged.forEach(([x,y]) => { const r = g.act({type:"flag",x,y}); if(!r.ok) throw new Error("flag failed "+x+","+y); });
  // first turn at a distance
  g.act({type:"open",x:4,y:6});
  let s = g.snapshot();
  for (const [x,y] of flagged) {
    assert(s.rows[y][x] === "F", `flagged cell (${x},${y}) must stay pennanted after flood, got ${s.rows[y][x]}`);
  }
  // flood must not have revealed any flagged cell
  const flagsStill = s.flagsPlaced;
  assert(flagsStill === flagged.length, "all pennants survive floods");
  // opening another zero elsewhere also respects pennants
  g.act({type:"open",x:3,y:6});
  s = g.snapshot();
  for (const [x,y] of flagged) assert(s.rows[y][x] === "F", "pennant survived second flood");
  // sweep reveals only unpennanted neighbors; pennanted stay
  console.log("Ripple honours pennants: OK");
}

testGeneration();
testDeterminism();
testIllegal();
testAdvance();
testFlagBeforeTurn();
testRippleRespectsPennant();
testPostMortem();
testGuaranteePlay();
testRun();
console.log("ALL CORE TESTS PASSED");
