/* Dual-comb ranging page: hero sampling animation, ring cavity, scale-factor calculator.
   Illustrations only; widths and slips are exaggerated where the page says so. No dependencies. */
(function () {
  "use strict";

  // ---- Constants from the paper ------------------------------------------
  var F = 39.25e6;          // repetition rate, Hz
  var T = 1 / F;            // period, s (25.48 ns)
  var NU = 299702547;       // speed of light in air, m/s
  var DNU = 2.267e11;       // optical bandwidth, Hz (1.838 nm at 1559.5 nm)
  var FS = 40e6;            // oscilloscope sampling rate, S/s
  var LPF = 15e6;           // low-pass filter, Hz
  var SLIP_DFT = 513e-15;   // measured round-trip difference, s

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var css = getComputedStyle(document.documentElement);
  function v(name) { return css.getPropertyValue(name).trim(); }
  var C = {
    ink: v("--ink") || "#0e2233", soft: v("--ink-soft") || "#4c5d6d", rule: v("--rule") || "#cfd7df",
    fast: v("--fast") || "#d1432f", slow: v("--slow") || "#2a62c9", tar: v("--tar") || "#d1432f",
    er: v("--erbium") || "#e0a33a", warn: v("--warn") || "#b4380f", paper: "#ffffff"
  };
  var UI = '"Archivo", "Helvetica Neue", Arial, sans-serif';

  function fmt(x, d) { return x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function thin(n) { return Math.round(n).toLocaleString("en-GB").replace(/,/g, " "); }

  // Canvas helper: keeps the backing store matched to CSS size and DPR.
  function Stage(canvas, draw) {
    var self = this;
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.draw = draw; this.w = 0; this.h = 0;
    function fit() {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      self.w = r.width; self.h = r.height;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      self.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      self.draw();
    }
    this.fit = fit;
    if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas); else window.addEventListener("resize", fit);
    // the first fit happens when the observer fires, after the caller holds the stage
  }

  // Run an animation only while its element is on screen.
  function Loop(el, step) {
    var on = false, raf = 0, last = 0, self = this;
    this.paused = false;
    function frame(t) {
      var dt = last ? Math.min((t - last) / 1000, 0.05) : 0; last = t;
      step(dt);
      raf = requestAnimationFrame(frame);
    }
    function update() {
      var want = on && !self.paused && !reduce;
      if (want && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    this.update = update;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (e) { on = e[0].isIntersecting; update(); }, { rootMargin: "80px" }).observe(el);
    } else { on = true; update(); }
  }

  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = (o.weight || 500) + " " + (o.size || 12) + "px " + UI;
    ctx.fillStyle = o.color || C.soft; ctx.textAlign = o.align || "left"; ctx.textBaseline = o.base || "alphabetic";
    ctx.fillText(s, x, y);
  }
  function arrow(ctx, x1, y, x2, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    [[x1, 1], [x2, -1]].forEach(function (p) {
      var s = Math.sign(x2 - x1) * p[1];
      ctx.beginPath(); ctx.moveTo(p[0], y); ctx.lineTo(p[0] + 6 * s, y - 3.5); ctx.lineTo(p[0] + 6 * s, y + 3.5); ctx.closePath(); ctx.fill();
    });
  }

  // =========================================================================
  // 1. Hero: the local oscillator samples two echoes, the scope sees bursts
  // =========================================================================
  (function () {
    var canvas = document.getElementById("range"); if (!canvas) return;
    var DF = 1100;                    // Hz, for the readouts
    var U_REF = 0.27, U_TAR = 0.63;   // echo positions as fractions of T (illustrative)
    var W = 0.032;                    // drawn pulse half-width, fraction of T (real: ~6e-5)
    var CW = 0.0075;                  // drawn fringe period
    var PERIOD_S = 7.5;               // seconds of animation per interferogram period
    var x = 0, hold = 0;              // x: lab time in interferogram periods, 0..2
    var noise = []; for (var i = 0; i < 2400; i++) noise.push(Math.random() * 2 - 1);
    var roLab = document.getElementById("ro-lab"), roRt = document.getElementById("ro-rt"), roOff = document.getElementById("ro-off");

    function env(u) { return Math.exp(-(u * u) / (W * W)); }
    function burst(s) {   // detector signal at lab phase s (0..2)
      var f = s - Math.floor(s), out = 0, who = 0, best = 0;
      [[U_REF, 1.0], [U_TAR, 0.8]].forEach(function (e, k) {
        var d = f - e[0], a = e[1] * Math.exp(-(d * d) / (2 * W * W));   // cross-correlation is sqrt(2) wider
        out += a * Math.cos(2 * Math.PI * d / CW);
        if (a > best) { best = a; who = k; }
      });
      return { y: out, who: best > 0.04 ? who + 1 : 0 };
    }

    var stage = new Stage(canvas, draw);
    stage.fit();
    function draw() {
      if (!stage) return;
      var ctx = stage.ctx, w = stage.w, h = stage.h;
      ctx.clearRect(0, 0, w, h);
      var L = 14, R = w - 14, span = R - L;
      var narrow = w < 560;

      // ---- Lane A: optical delay inside one period -----------------------
      var yA = Math.round(h * 0.25), hA = h * 0.12;
      text(ctx, "Optical delay inside one period", L, 16, { weight: 650, color: C.ink, size: 12.5 });
      text(ctx, "T = 25.48 ns", R, 16, { align: "right" });
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, yA); ctx.lineTo(R, yA); ctx.stroke();
      // echoes, above the axis
      [[U_REF, 1.0, "Reference echo"], [U_TAR, 0.8, "Target echo"]].forEach(function (e) {
        ctx.beginPath();
        for (var px = 0; px <= span; px += 1) {
          var u = px / span, a = e[1] * env(u - e[0]);
          var y = yA - hA * a * (0.55 + 0.45 * Math.cos(2 * Math.PI * (u - e[0]) / CW));
          px ? ctx.lineTo(L + px, y) : ctx.moveTo(L + px, y);
        }
        ctx.strokeStyle = C.fast; ctx.lineWidth = 1.2; ctx.stroke();
        text(ctx, e[2], L + e[0] * span, yA - hA * e[1] - 6, { align: "center", color: C.fast, weight: 600, size: 11.5 });
      });
      // tau between the echoes
      var yT = yA + hA + 22;
      arrow(ctx, L + U_REF * span, yT + 8, L + U_TAR * span, C.ink);
      text(ctx, "τ", L + (U_REF + U_TAR) / 2 * span, yT + 4, { align: "center", color: C.ink, weight: 650, size: 13 });
      // LO pulse, below the axis
      var p = x - Math.floor(x);
      ctx.beginPath();
      for (var q = -3 * W; q <= 3 * W; q += 0.0008) {
        var u2 = p + q, y2 = yA + hA * 0.85 * env(q) * (0.55 + 0.45 * Math.cos(2 * Math.PI * q / CW));
        var X = L + (u2 - Math.floor(u2)) * span;
        q === -3 * W ? ctx.moveTo(X, y2) : ctx.lineTo(X, y2);
      }
      ctx.strokeStyle = C.slow; ctx.lineWidth = 1.2; ctx.stroke();
      text(ctx, narrow ? "LO" : "Local oscillator, slides ΔT per round trip →", Math.min(L + p * span + W * span + 6, R - (narrow ? 20 : 250)), yA + hA * 0.85 + 14, { color: C.slow, weight: 600, size: 11.5 });
      // overlap glow
      [[U_REF], [U_TAR]].forEach(function (e) {
        var o = Math.exp(-Math.pow((p - e[0]) / W, 2) / 2);
        if (o > 0.05) {
          ctx.fillStyle = "rgba(107,63,160," + (0.10 * o) + ")";
          ctx.fillRect(L + (e[0] - 2 * W) * span, yA - hA - 2, 4 * W * span, 2 * hA + 4);
        }
      });

      // ---- Lane B: the detector in lab time --------------------------------
      var top = h * 0.52, yB = h * 0.70, hB = h * 0.13;
      text(ctx, "Photodetector after the 15 MHz filter, in lab time", L, top, { weight: 650, color: C.ink, size: 12.5 });
      if (!narrow) text(ctx, "two interferogram periods, 2/Δf = 1.82 ms", R, top, { align: "right" });
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, yB); ctx.lineTo(R, yB); ctx.stroke();
      [0, 1, 2].forEach(function (k) {
        var X = L + k / 2 * span;
        ctx.beginPath(); ctx.moveTo(X, h - 22); ctx.lineTo(X, h - 17); ctx.stroke();
        text(ctx, k === 0 ? "0" : (k === 1 ? "1/Δf" : "2/Δf"), X, h - 4, { align: k === 0 ? "left" : (k === 2 ? "right" : "center") });
      });
      // trace up to x
      var n = Math.max(2, Math.floor(span * 1.5)), prev = null;
      for (var j = 0; j <= n; j++) {
        var s = 2 * j / n; if (s > x) break;
        var b = burst(s), X2 = L + s / 2 * span, Y2 = yB - hB * (b.y + 0.05 * noise[j % noise.length]);
        if (prev) {
          ctx.strokeStyle = b.who === 1 ? C.ink : (b.who === 2 ? C.tar : "#9aa7b3");
          ctx.lineWidth = b.who ? 1.1 : 0.8;
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(X2, Y2); ctx.stroke();
        }
        prev = [X2, Y2];
      }
      // cursor
      ctx.strokeStyle = C.slow; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(L + x / 2 * span, yB - hB - 4); ctx.lineTo(L + x / 2 * span, yB + hB + 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // delta t annotation once both bursts of a period are drawn
      [0, 1].forEach(function (k) {
        if (x > k + U_TAR + 2 * W) {
          var a1 = L + (k + U_REF) / 2 * span, a2 = L + (k + U_TAR) / 2 * span, ya = yB + hB + 14;
          arrow(ctx, a1, ya, a2, C.ink);
          text(ctx, k === 0 && !narrow ? "Δt = τ · f/Δf" : "Δt", (a1 + a2) / 2, ya + 16, { align: "center", color: C.ink, weight: 650, size: 12.5 });
        }
      });

      // readouts: real values for this lab time
      var tlab = x / DF;
      roLab.textContent = fmt(tlab * 1e3, 3) + " ms";
      roRt.textContent = thin(tlab * F);
      roOff.textContent = fmt(p * T * 1e9, 2) + " ns";
    }

    var loop = new Loop(canvas, function (dt) {
      if (x >= 2) { hold += dt; if (hold > 2.2) { x = 0; hold = 0; } }
      else x = Math.min(2, x + dt / PERIOD_S);
      draw();
    });
    var btn = document.getElementById("range-toggle");
    if (reduce) { x = 2; draw(); btn.textContent = "Play"; }
    btn.addEventListener("click", function () {
      if (reduce) { reduce = false; loop.paused = false; x = 0; btn.textContent = "Pause"; loop.update(); return; }
      loop.paused = !loop.paused; btn.textContent = loop.paused ? "Play" : "Pause"; loop.update();
    });
  })();

  // =========================================================================
  // 2. Ring cavity: two pulses, one gaining on the other
  // =========================================================================
  (function () {
    var canvas = document.getElementById("ring"); if (!canvas) return;
    var LAP_S = 1.6;          // seconds per drawn round trip
    var EPS = 1 / 20;         // drawn gain per lap
    var t = 0;
    var nEl = document.getElementById("ring-n"), leadEl = document.getElementById("ring-lead"), stEl = document.getElementById("ring-state");
    // component positions, as fractions of a turn clockwise from the top
    var parts = [
      { a: 0.00, name: "WDM", sub: "980 nm pump in" },
      { a: 0.09, b: 0.20, name: "Er³⁺ fiber", color: "er" },
      { a: 0.29, b: 0.40, name: "PM fiber", color: "pm" },
      { a: 0.47, name: "PC" },
      { a: 0.58, name: "CNT", sub: "saturable absorber" },
      { a: 0.70, name: "Isolator" },
      { a: 0.84, name: "Output coupler", sub: "to PC + PBS" }
    ];
    var stage = new Stage(canvas, draw);
    stage.fit();
    function pos(cx, cy, r, f) { var th = -Math.PI / 2 + 2 * Math.PI * f; return [cx + r * Math.cos(th), cy + r * Math.sin(th)]; }
    function draw() {
      if (!stage) return;
      var ctx = stage.ctx, w = stage.w, h = stage.h;
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2 + 4, r = Math.min(w * 0.30, h * 0.36);
      ctx.lineWidth = 3; ctx.strokeStyle = "#b9c4ce";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
      parts.forEach(function (p) {
        var mid = p.b ? (p.a + p.b) / 2 : p.a;
        if (p.b) {
          ctx.lineWidth = 7; ctx.strokeStyle = p.color === "er" ? C.er : "#16324f"; ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2 + 2 * Math.PI * p.a, -Math.PI / 2 + 2 * Math.PI * p.b); ctx.stroke();
          ctx.lineCap = "butt";
        } else {
          var q = pos(cx, cy, r, mid);
          ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.rect(q[0] - 6, q[1] - 6, 12, 12); ctx.fill(); ctx.stroke();
        }
        var lp = pos(cx, cy, r + 26, mid), right = lp[0] >= cx - 4;
        var al = Math.abs(lp[0] - cx) < 10 ? "center" : (right ? "left" : "right");
        text(ctx, p.name, lp[0], lp[1] - (p.sub ? 2 : -4), { align: al, color: C.ink, weight: 650, size: 12 });
        if (p.sub) text(ctx, p.sub, lp[0], lp[1] + 12, { align: al, size: 11 });
      });
      // pulses
      var lapR = t / LAP_S, lapB = lapR * (1 - EPS);
      [[lapB, C.slow, r - 7], [lapR, C.fast, r + 7]].forEach(function (pl) {
        for (var k = 0; k < 14; k++) {
          var q = pos(cx, cy, pl[2], pl[0] - k * 0.004);
          ctx.globalAlpha = 1 - k / 14; ctx.fillStyle = pl[1];
          ctx.beginPath(); ctx.arc(q[0], q[1], 4.6 - k * 0.22, 0, 2 * Math.PI); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      // centre labels
      text(ctx, "Fast axis", cx, cy - 8, { align: "center", color: C.fast, weight: 650, size: 12 });
      text(ctx, "Slow axis", cx, cy + 10, { align: "center", color: C.slow, weight: 650, size: 12 });

      var n = Math.floor(lapR), gap = lapR - lapB, frac = gap - Math.floor(gap);
      nEl.textContent = thin(n);
      leadEl.textContent = fmt(n * SLIP_DFT * 1e12, 2) + " ps";
      var near = Math.min(frac, 1 - frac) < 0.02 && gap > 0.5;
      stEl.innerHTML = near ? "<b>Pulses overlap: one interferogram</b>" : "&nbsp;";
    }
    new Loop(canvas, function (dt) { t += dt; if (t / LAP_S > 1000) t = 0; draw(); });
    if (reduce) { t = 6.3 * LAP_S; draw(); }
  })();

  // =========================================================================
  // 3. Scale-factor calculator
  // =========================================================================
  (function () {
    var iDf = document.getElementById("i-df"), iD = document.getElementById("i-d");
    if (!iDf) return;
    var oDf = document.getElementById("o-df"), oD = document.getElementById("o-d");
    var el = function (id) { return document.getElementById(id); };
    var LAB_MAX = 5e-3, REF0 = 0.6e-9;
    var ruler = new Stage(el("ruler"), drawRuler), bars = new Stage(el("bars"), drawBars);
    ruler.fit(); bars.fit();

    function state() { return { df: +iDf.value, d: +iD.value }; }

    function drawRuler() {
      if (!ruler) return;
      var s = state(), ctx = ruler.ctx, w = ruler.w, h = ruler.h;
      ctx.clearRect(0, 0, w, h);
      var L = 12, R = w - 12, span = R - L, y1 = 46, y2 = h - 50;
      var tau = 2 * s.d / NU, tRef = REF0, tTar = (REF0 + tau) % T;
      var labP = 1 / s.df, kx = labP / LAB_MAX;
      // fan
      ctx.fillStyle = "rgba(42,98,201,0.07)";
      ctx.beginPath(); ctx.moveTo(L, y1); ctx.lineTo(R, y1); ctx.lineTo(L + Math.min(kx, 1) * span, y2); ctx.lineTo(L, y2); ctx.closePath(); ctx.fill();
      // rulers
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(L, y1); ctx.lineTo(R, y1); ctx.moveTo(L, y2); ctx.lineTo(R, y2); ctx.stroke();
      ctx.lineWidth = 1;
      for (var ns = 0; ns <= 25; ns += 5) {
        var X = L + ns * 1e-9 / T * span;
        ctx.beginPath(); ctx.moveTo(X, y1); ctx.lineTo(X, y1 - 5); ctx.stroke();
        text(ctx, ns + (ns === 25 ? " ns" : ""), X, y1 - 9, { align: ns === 0 ? "left" : "center", size: 11 });
      }
      text(ctx, "Optical delay, one period T = 25.48 ns", L, 13, { weight: 650, color: C.ink, size: 12 });
      for (var ms = 0; ms <= 5; ms += 0.5) {
        var X3 = L + ms / 5 * span;
        ctx.beginPath(); ctx.moveTo(X3, y2); ctx.lineTo(X3, y2 + 5); ctx.stroke();
        if (ms % 1 === 0) text(ctx, ms + (ms === 5 ? " ms" : ""), X3, y2 + 17, { align: ms === 0 ? "left" : (ms === 5 ? "right" : "center"), size: 11 });
      }
      text(ctx, "Lab time on the oscilloscope", L, h - 6, { weight: 650, color: C.ink, size: 12 });
      // the stretched period
      var Xp = L + Math.min(kx, 1) * span;
      ctx.strokeStyle = C.slow; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(L, y2); ctx.lineTo(Xp, y2); ctx.stroke();
      text(ctx, "1/Δf = " + fmt(labP * 1e3, 2) + " ms", Math.min(Xp, R - 2), y2 - 8, { align: Xp > R - 90 ? "right" : "left", color: C.slow, weight: 650, size: 11.5 });
      // echoes and their images
      [[tRef, C.ink, "ref"], [tTar, C.tar, "target"]].forEach(function (e) {
        var a = L + e[0] / T * span, b = L + Math.min(e[0] / T * kx, 1) * span;
        ctx.strokeStyle = e[1]; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(a, y1 + 1); ctx.lineTo(b, y2 - 1); ctx.stroke();
        ctx.fillStyle = e[1];
        ctx.beginPath(); ctx.arc(a, y1, 3.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(b, y2, 3.5, 0, 7); ctx.fill();
        text(ctx, e[2], a + 5, y1 + 14, { color: e[1], weight: 600, size: 11 });
      });
    }

    function drawBars() {
      if (!bars) return;
      var s = state(), ctx = bars.ctx, w = bars.w, h = bars.h;
      ctx.clearRect(0, 0, w, h);
      var bw = DNU * s.df / F, items = [
        ["Interferogram bandwidth  Δν·Δf/f", bw, bw > F / 2 || bw > LPF ? C.warn : C.ink],
        ["Low-pass filter", LPF, "#9aa7b3"],
        ["Nyquist limit f/2", F / 2, "#9aa7b3"]
      ];
      var lab = Math.min(230, w * 0.42), L = lab + 8, R = w - 52, max = 30e6;
      items.forEach(function (it, k) {
        var y = 14 + k * 40;
        text(ctx, it[0], lab, y + 13, { align: "right", color: C.ink, weight: 600, size: 11.5 });
        ctx.fillStyle = it[2];
        ctx.fillRect(L, y, Math.min(it[1] / max, 1) * (R - L), 18);
        text(ctx, fmt(it[1] / 1e6, 1) + " MHz", L + Math.min(it[1] / max, 1) * (R - L) + 6, y + 13, { size: 11.5, color: C.ink });
      });
    }

    function update() {
      var s = state(), m = F / s.df, dT = s.df / (F * (F + s.df)), tau = 2 * s.d / NU, bw = DNU * s.df / F;
      oDf.textContent = thin(s.df) + " Hz"; oD.textContent = fmt(s.d, 2) + " m";
      el("t-m").textContent = thin(Math.round(m / 100) * 100) + "×";
      el("t-dT").textContent = fmt(dT * 1e15, 0) + " fs";
      el("t-dt").textContent = fmt(tau * m * 1e3, 3) + " ms";
      el("t-per").textContent = fmt(1e3 / s.df, 2) + " ms";
      el("t-samp").textContent = fmt(NU * (1 / FS) / m / 2 * 1e3, 3) + " mm";
      el("t-err").textContent = fmt(s.d / s.df * 1e3, 2) + " mm";
      var msg = "", bad = false;
      if (bw > F / 2) { msg = "Above " + fmt(F * F / (2 * DNU), 0) + " Hz the RF copy of the spectrum passes f/2 and aliases: the bursts no longer map one-to-one onto delay."; bad = true; }
      else if (bw > LPF) { msg = "The interferogram is now wider than the 15 MHz filter, which would cut part of it."; bad = true; }
      else msg = "One distance every " + fmt(1e3 / s.df, 2) + " ms. A 10 ms trace holds about " + Math.floor(10e-3 * s.df) + " pairs of bursts.";
      el("calc-check").textContent = msg; el("calc-check").className = "check" + (bad ? " bad" : "");
      el("t-m").parentNode.className = "stat key" + (bad ? " bad" : "");
      drawRuler(); drawBars();
    }
    iDf.addEventListener("input", update); iD.addEventListener("input", update);
    el("calc-reset").addEventListener("click", function () { iDf.value = 1100; iD.value = 1.2; update(); });
    update();
  })();

  // ---- BibTeX --------------------------------------------------------------
  var cb = document.getElementById("copy-bibtex");
  if (cb) cb.addEventListener("click", function () {
    var txt = document.querySelector("#bibtex code").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
      cb.textContent = "Copied"; setTimeout(function () { cb.textContent = "Copy BibTeX"; }, 1600);
    }, function () { cb.textContent = "Select the text above to copy"; });
  });
})();
