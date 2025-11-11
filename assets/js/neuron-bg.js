/* neuron-bg.js — radial dendrite style (very light grey, minimal)
   - few hubs (somas) with many long, thin tentacles
   - subtle mouse influence (gently bends branches)
   - respects prefers-reduced-motion (renders static if set)
*/
(() => {
  const ID = 'neuron-bg';
  const cvs = document.getElementById(ID);
  if (!cvs) return;
  const ctx = cvs.getContext('2d');

  // ---------- Config (可按需微调) ----------
  const CFG = {
    hubs: 1,                 // 中心“神经元”个数（1~3）
    somaRadius: [6, 12],     // 细胞体半径范围（px）
    branchesPerHub: [22, 36],// 每个中心的触突条数
    branchLength: [420, 820],// 触突长度（px）
    segment: 22,             // 每条触突分成多少段（越大越顺滑）
    lineWidth: 0.7,          // 线宽（px）
    lineColor: 'rgba(0,0,0,0.06)',  // 线条超浅灰（#eaeaea≈0,0,0,0.08）
    somaColor: 'rgba(120,120,120,0.18)', // 细胞体填充很淡
    somaEdge: 'rgba(120,120,120,0.25)',  // 细胞体描边更淡
    jitter: 0.85,            // 线条轻微抖动幅度（越大越灵动）
    drift: 0.0008,           // 全局缓慢漂移速度（影响“噪声”）
    bendTowardMouse: 0.12,   // 鼠标靠近时的轻微弯曲程度
    mouseInfluence: 220,     // 鼠标影响半径（px）
    fpsCap: 50               // 软帧率上限
  };

  // ---------- Helpers ----------
  const DPR = Math.min(devicePixelRatio || 1, 2);
  let W = 0, H = 0, hubs = [], t = Math.random() * 1000;
  const reduceMotion = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = 0;

  function rand(a, b){ return Math.random()*(b-a)+a; }
  function irand(a, b){ return Math.floor(rand(a, b+1)); }
  function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
  function setSize(){
    W = innerWidth; H = innerHeight;
    cvs.width = Math.floor(W*DPR);
    cvs.height = Math.floor(H*DPR);
    cvs.style.width = W+'px';
    cvs.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
    build();
    if (reduceMotion) drawStatic();
  }

  // 简易混合噪声（无需外部库）
  function noise(n, seed){
    return (
      Math.sin(n*1.7 + seed*0.7)*0.6 +
      Math.sin(n*0.57 + seed*1.9)*0.4 +
      Math.sin(n*2.3 + seed*0.13)*0.2
    );
  }

  // ---------- Model ----------
  class Branch {
    constructor(cx, cy, angle, len, seg, seed){
      this.cx = cx; this.cy = cy;
      this.angle = angle;
      this.len = len;
      this.seg = seg;
      this.seed = seed;
      // 预生成每段的“理想”半径（距离中心的长度）
      this.radii = Array.from({length: seg+1}, (_,i)=> i*(len/seg));
    }
    draw(mouse){
      const { lineWidth, lineColor, jitter, bendTowardMouse, mouseInfluence } = CFG;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = lineColor;
      ctx.beginPath();

      let prev = null;
      for(let i=0;i<=this.seg;i++){
        const baseR = this.radii[i];

        // 轻微噪声抖动 + 全局漂移
        const n = noise(t + i*0.18, this.seed) * jitter;
        let a = this.angle + n*0.03;

        // 鼠标靠近时，向鼠标方向微弯
        if (mouse.active) {
          const x0 = this.cx + Math.cos(this.angle)* (this.len*0.08); // 从靠近 soma 的方向看鼠标
          const y0 = this.cy + Math.sin(this.angle)* (this.len*0.08);
          const dx = mouse.x - x0, dy = mouse.y - y0;
          const dist = Math.hypot(dx,dy);
          if (dist < mouseInfluence){
            const targetAng = Math.atan2(dy, dx);
            const mix = (1 - dist/mouseInfluence) * bendTowardMouse;
            // 平滑插值角度
            const diff = Math.atan2(Math.sin(targetAng-a), Math.cos(targetAng-a));
            a += diff * mix;
          }
        }

        const r = baseR + n*2.4; // 半径也给一点噪声
        const x = this.cx + Math.cos(a)*r;
        const y = this.cy + Math.sin(a)*r;

        if (i===0) ctx.moveTo(x,y);
        else {
          // 用二次贝塞尔让线更柔和
          const mx = (prev.x + x)/2;
          const my = (prev.y + y)/2;
          ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        prev = {x,y};
      }
      ctx.stroke();
    }
  }

  class Hub {
    constructor(x,y,r){
      this.x=x; this.y=y; this.r=r;
      const nBranches = irand(CFG.branchesPerHub[0], CFG.branchesPerHub[1]);
      this.branches = [];
      const angle0 = rand(0, Math.PI*2);
      for(let i=0;i<nBranches;i++){
        const a = angle0 + (i/nBranches)*Math.PI*2 + rand(-0.06,0.06);
        const len = rand(CFG.branchLength[0], CFG.branchLength[1]);
        const seed = rand(0,1000);
        this.branches.push(new Branch(x,y,a,len,CFG.segment,seed));
      }
    }
    draw(mouse){
      // 先画线
      this.branches.forEach(b=>b.draw(mouse));
      // 再画 soma（超淡）
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
      ctx.fillStyle = CFG.somaColor;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = CFG.somaEdge;
      ctx.stroke();
    }
  }

  function build(){
    hubs = [];
    const pad = Math.min(W,H)*0.12;
    for(let i=0;i<CFG.hubs;i++){
      // 位置尽量在画面偏中央一些
      const x = clamp(rand(W*0.28, W*0.72), pad, W-pad);
      const y = clamp(rand(H*0.28, H*0.72), pad, H-pad);
      const r = rand(CFG.somaRadius[0], CFG.somaRadius[1]);
      hubs.push(new Hub(x,y,r));
    }
  }

  // ---------- Interaction & Loop ----------
  const mouse = { x:-9999, y:-9999, active:false };
  addEventListener('mousemove', e=>{ mouse.x=e.clientX; mouse.y=e.clientY; mouse.active=true; }, {passive:true});
  addEventListener('mouseleave', ()=>{ mouse.active=false; }, {passive:true});
  addEventListener('touchstart', e=>{
    if (e.touches && e.touches[0]){ mouse.x=e.touches[0].clientX; mouse.y=e.touches[0].clientY; mouse.active=true; }
  }, {passive:true});
  addEventListener('touchmove', e=>{
    if (e.touches && e.touches[0]){ mouse.x=e.touches[0].clientX; mouse.y=e.touches[0].clientY; }
  }, {passive:true});
  addEventListener('touchend', ()=>{ mouse.active=false; }, {passive:true});

  function drawStatic(){
    ctx.clearRect(0,0,W,H);
    hubs.forEach(h=>h.draw(mouse));
  }

  function frame(ts){
    const minDelta = 1000/CFG.fpsCap;
    if (ts - last < minDelta){ requestAnimationFrame(frame); return; }
    last = ts;

    t += CFG.drift;
    drawStatic();
    requestAnimationFrame(frame);
  }

  addEventListener('resize', ()=>{ clearTimeout(setSize._t); setSize._t = setTimeout(setSize, 150); });
  setSize();
  if (!reduceMotion) requestAnimationFrame(frame);
})();
