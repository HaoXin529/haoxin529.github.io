<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Neuron Growth — layered, tapered, branching, collision-stop</title>
<style>
  html, body { margin:0; height:100%; background:#fafafa; overflow:hidden; }
  /* 关键：不要把 z-index 设成负数，避免被背景盖住 */
  canvas { position:fixed; inset:0; width:100%; height:100%; display:block; }
  /* 可选：把页面内容盖在画布之上时，可给内容容器设置 z-index:1; */
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
(() => {
  /** ---------- 基础与画布 ---------- */
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  /** ---------- 配置 ---------- */
  const CFG = {
    // 构图与生长
    hubs: 12,
    branchesPerHub: [10, 22],
    steps: [160, 320],
    stepLen: [4, 8],
    jitter: 0.22,
    steer: 0.09,
    growSpeed: [0.9, 1.6],   // 每帧基础“生长步数”（后续会依 delta 调整）
    splitAfter: [28, 48],
    splitProb: 0.006,
    // 观感
    fade: 0.14,              // 线条总体透明度（越小越淡）
    baseWidth: 2.2,          // 近体线粗（远端会渐细）
    vignette: 0.06,          // 背景晕影强度
    glow: 6,                 // 线条柔光
    // 位置
    margin: 24,
    somaRadius: [10, 26],
    somaAlpha: 0.18,
    // 碰撞
    collisionDist: 3.5
  };

  /** ---------- 空间哈希（提速碰撞检测） ---------- */
  const HASH = { cell: 6, map: new Map() };
  function hashKey(x, y){
    const cx = Math.floor(x / HASH.cell);
    const cy = Math.floor(y / HASH.cell);
    return cx + ',' + cy;
  }
  function hashInsert(x, y){
    const k = hashKey(x, y);
    let arr = HASH.map.get(k);
    if (!arr) { arr = []; HASH.map.set(k, arr); }
    arr.push({ x, y });
  }
  function hashNearby(x, y, fn){
    const cx = Math.floor(x / HASH.cell);
    const cy = Math.floor(y / HASH.cell);
    for (let i=-1;i<=1;i++) for (let j=-1;j<=1;j++){
      const k = (cx+i) + ',' + (cy+j);
      const arr = HASH.map.get(k);
      if (arr) for (const p of arr) fn(p);
    }
  }

  /** ---------- 工具 ---------- */
  const rand = (a,b)=>a + Math.random()*(b-a);
  const rint = (a,b)=>Math.floor(rand(a,b+1));
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

  /** ---------- 交互（轻微引导/视差） ---------- */
  const mouse = { x:-1, y:-1, down:false, nx:0, ny:0 }; // nx,ny ∈ [-0.5,0.5]
  window.addEventListener('mousemove', e=>{
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.nx = (mouse.x / W) - 0.5;
    mouse.ny = (mouse.y / H) - 0.5;
  }, {passive:true});
  window.addEventListener('mousedown', ()=> mouse.down = true, {passive:true});
  window.addEventListener('mouseup',   ()=> mouse.down = false, {passive:true});

  /** ---------- 尺寸 & 背景 ---------- */
  function fit(){
    W = window.innerWidth; H = window.innerHeight;
    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', ()=>{ clearTimeout(fit._t); fit._t = setTimeout(()=>{ fit(); resetScene(); }, 150); });

  function drawVignette(){
    const g = ctx.createRadialGradient(
      W/2, H/2, Math.min(W,H)*0.2,
      W/2, H/2, Math.hypot(W,H)*0.7
    );
    g.addColorStop(0, 'rgba(0,0,0,0.00)');
    g.addColorStop(1, `rgba(0,0,0,${CFG.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);
  }

  /** ---------- 结构 ---------- */
  let hubs = [], branches = [], animId = null, lastTs = 0;

  function placeHubs(){
    hubs = [];
    const n = CFG.hubs, minDist = 22;
    let tries = 0;
    while (hubs.length < n && tries < n * 600){
      // 偏中央放置，避免贴边
      const x = rand(CFG.margin, W - CFG.margin);
      const y = rand(CFG.margin, H - CFG.margin);
      let ok = true;
      for (const h of hubs){
        const dx = h.x - x, dy = h.y - y;
        if (dx*dx + dy*dy < minDist*minDist) { ok = false; break; }
      }
      if (ok) hubs.push({ x, y, r: rand(CFG.somaRadius[0], CFG.somaRadius[1]) });
      tries++;
    }
    while (hubs.length < n) {
      hubs.push({ x: rand(CFG.margin, W - CFG.margin), y: rand(CFG.margin, H - CFG.margin), r: rand(CFG.somaRadius[0], CFG.somaRadius[1]) });
    }
  }

  function makeBranch(hub, x, y, angle){
    return {
      hub, x, y, angle,
      stepsMax: rint(CFG.steps[0], CFG.steps[1]),
      stepLen: rand(CFG.stepLen[0], CFG.stepLen[1]),
      grown: 0,
      splitReadyAfter: rint(CFG.splitAfter[0], CFG.splitAfter[1]),
      alive: true
    };
  }

  function spawnBranches(){
    branches = [];
    for (const h of hubs){
      const n = rint(CFG.branchesPerHub[0], CFG.branchesPerHub[1]);
      const a0 = rand(0, Math.PI*2);
      for (let i=0;i<n;i++){
        const a = a0 + (i/n)*Math.PI*2 + rand(-0.18, 0.18);
        branches.push(makeBranch(h, h.x, h.y, a));
      }
    }
  }

  function drawSomas(){
    for (const h of hubs){
      // 视差
      const px = mouse.nx * 12;
      const py = mouse.ny * 12;

      ctx.beginPath();
      ctx.arc(h.x + px, h.y + py, h.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(120,120,120,${CFG.somaAlpha})`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(120,120,120,0.28)';
      ctx.stroke();

      // 记录占位（用中心点即可，简单近似）
      hashInsert(h.x, h.y);
    }
  }

  /** ---------- 碰撞 ---------- */
  function checkCollision(x, y){
    let hit = false;
    hashNearby(x, y, (p)=>{
      const dx = p.x - x, dy = p.y - y;
      if (dx*dx + dy*dy < CFG.collisionDist*CFG.collisionDist) hit = true;
    });
    return hit;
  }

  /** ---------- 生长一步 ---------- */
  function stepOne(b){
    if (!b.alive) return;

    const { hub } = b;

    // 朝径向微收拢（让触突有发散又被束缚的感觉）
    const rx = b.x - hub.x, ry = b.y - hub.y;
    const radial = Math.atan2(ry, rx);
    let diff = b.angle - radial;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    b.angle -= diff * CFG.steer;

    // 抖动
    b.angle += rand(-CFG.jitter, CFG.jitter);

    // 鼠标按住时，轻微朝鼠标方向生长
    if (mouse.down){
      const dx = mouse.x - b.x, dy = mouse.y - b.y;
      const ta = Math.atan2(dy, dx);
      let d2 = b.angle - ta;
      d2 = Math.atan2(Math.sin(d2), Math.cos(d2));
      b.angle -= d2 * 0.04;
    }

    const nx = b.x + Math.cos(b.angle) * b.stepLen;
    const ny = b.y + Math.sin(b.angle) * b.stepLen;

    // 碰撞 → 停止
    if (checkCollision(nx, ny)) { b.alive = false; return; }

    // 线宽渐细 & 渐变 + 柔光
    const t = Math.min(1, (b.grown + 1) / b.stepsMax);
    const w = CFG.baseWidth * (1 - 0.8 * t);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur  = CFG.glow;

    const grad = ctx.createLinearGradient(b.x, b.y, nx, ny);
    grad.addColorStop(0, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0.10)');

    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(nx, ny);
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.lineWidth = Math.max(0.35, w);
    ctx.strokeStyle = grad;
    ctx.stroke();
    ctx.restore();

    // 记录新点到哈希
    hashInsert(nx, ny);

    b.x = nx; b.y = ny; b.grown++;

    // 分叉
    if (b.grown > b.splitReadyAfter && Math.random() < CFG.splitProb){
      const da = rand(0.3, 0.6);
      branches.push(makeBranch(hub, b.x, b.y, b.angle + da));
      branches.push(makeBranch(hub, b.x, b.y, b.angle - da));
    }

    // 出界或完成 → 死亡
    if (b.grown >= b.stepsMax || nx < -20 || nx > W+20 || ny < -20 || ny > H+20) {
      b.alive = false;
    }
  }

  /** ---------- 动画主循环（限帧+自适应步数） ---------- */
  function tick(ts){
    const delta = ts ? Math.min(33, ts - lastTs) : 16; // 60fps 上限
    lastTs = ts || lastTs;

    // 根据 delta 调整本帧 grow 次数（稳帧）
    const base = Array.isArray(CFG.growSpeed) ? rand(CFG.growSpeed[0], CFG.growSpeed[1]) : CFG.growSpeed;
    const stepsThisFrame = Math.max(1, Math.floor(base * (delta / 16)));

    for (let s = 0; s < stepsThisFrame; s++){
      let anyAlive = false;
      for (const b of branches) if (b.alive) { stepOne(b); anyAlive = true; }
      if (!anyAlive) { cancelAnimationFrame(animId); animId = null; break; }
    }

    if (animId !== null) animId = requestAnimationFrame(tick);
  }

  /** ---------- 初始化/重置 ---------- */
  function resetScene(){
    if (animId){ cancelAnimationFrame(animId); animId = null; }
    ctx.clearRect(0,0,W,H);

    // 轻晕影（纵深感）
    drawVignette();

    HASH.map.clear();

    placeHubs();
    drawSomas();
    spawnBranches();

    lastTs = 0;
    animId = requestAnimationFrame(tick);
  }

  /** ---------- 事件 ---------- */
//  window.addEventListener('click', resetScene);

  /** ---------- 启动 ---------- */
  fit();
  resetScene();
})();
</script>
</body>
</html>
