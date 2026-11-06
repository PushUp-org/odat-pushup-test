/* Push-up counter: a line-by-line port of tools/counters.py (rules_v2 with the strict legs policy),
 * fed one MediaPipe Pose frame at a time. Runs in the browser (window.PushupCounter) and in Node
 * (require), where tools/check_webapp_counter.js checks it against the Python counter on every
 * cached clip (evaluation/11).
 *
 * Input per frame: time t (s), MediaPipe poseWorldLandmarks (33 x {x,y,z,visibility}, metres, y down)
 * and poseLandmarks (33 x {x,y,...}, normalised to the picture), or null when nobody was found.
 * Everything is causal: a decision at frame i only uses frames <= i.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PushupCounter = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MP_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const SIDES = { l: [5, 7, 9, 11, 13, 15], r: [6, 8, 10, 12, 14, 16] }; // shoulder elbow wrist hip knee ankle (COCO)
  const ARM_WINDOW = 150;           // frames: trailing window for the arm length (10 s at 15 fps)
  const INSIDE_MARGIN = 0.02;

  const DEFAULTS = {
    drop: 30, rise: 30, max_bottom: 135, knee_min: 150, body_min: 130, trunk_max: 45, vis: 0.5,
    leg_vis: 0.1, h_drop: 0.15, smooth: 5, max_gap_s: 1.0, legs_hidden: "reject",
    top_min: 0, end_min: 0, min_dur: 0, edge: -Infinity, knee2d_min: 0,
  };
  const MP_FEET = { l: [29, 31], r: [30, 32] };   // MediaPipe heel, toe

  const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
  const nz = (v, d) => (isNum(v) ? v : d);

  function ang(a, b, c) {           // angle at b, degrees (NaN if any point missing)
    const ba = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const dot = ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2];
    const n = Math.hypot(ba[0], ba[1], ba[2]) * Math.hypot(bc[0], bc[1], bc[2]) + 1e-8;
    const cos = Math.min(1, Math.max(-1, dot / n));
    return (Math.acos(cos) * 180) / Math.PI;
  }
  const edgeDist = (p) => Math.min(p[0], 1 - p[0], p[1], 1 - p[1]);   // NaN if missing
  const inside = (p) => p[0] >= -INSIDE_MARGIN && p[0] <= 1 + INSIDE_MARGIN && p[1] >= -INSIDE_MARGIN && p[1] <= 1 + INSIDE_MARGIN;

  function median(xs) {
    const v = xs.filter(isNum).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function nanMax(xs) { let m = NaN; for (const x of xs) if (isNum(x) && !(x <= m)) m = x; return m; }
  function nanMin(xs) { let m = NaN; for (const x of xs) if (isNum(x) && !(x >= m)) m = x; return m; }

  /** COCO-17 points from MediaPipe landmarks: pts [17][3] metres, vis [17], xy [17][2] normalised. */
  function toCoco(world, image) {
    const nan3 = [NaN, NaN, NaN], nan2 = [NaN, NaN];
    if (!world || !image) {
      return { pts: MP_TO_COCO.map(() => nan3), vis: MP_TO_COCO.map(() => NaN), xy: MP_TO_COCO.map(() => nan2),
               feet: { l: [nan2, nan2], r: [nan2, nan2] } };
    }
    const p2 = (k) => [image[k].x, image[k].y];
    return {
      pts: MP_TO_COCO.map((k) => [world[k].x, world[k].y, world[k].z]),
      vis: MP_TO_COCO.map((k) => nz(world[k].visibility, NaN)),
      xy: MP_TO_COCO.map(p2),
      feet: { l: MP_FEET.l.map(p2), r: MP_FEET.r.map(p2) },
    };
  }

  class Counter {
    /** params: tuned settings (results/<name>/params.json "params"); fps: nominal frame rate (15). */
    constructor(params, fps = 15) {
      this.P = Object.assign({}, DEFAULTS, params || {});
      if (this.P.edge === null || this.P.edge === undefined) this.P.edge = -Infinity;
      this.fps = fps;
      this.reset();
    }

    reset() {
      this.f = { elbow: [], knee: [], body: [], trunk: [], leg_vis: [], leg_edge: [], knee2d: [], height: [] };
      this.t = [];
      this.segs = [];
      this.state = "up"; this.top = -Infinity; this.bottom = Infinity; this.start = 0;
      this.lastSeen = -1e9; this.hist = [];
      this.count = 0;
      this.events = [];            // count times (s)
      this.log = [];               // every finished cycle: {t, counted, reason, ...}
      this.live = {};              // latest per-frame signals for the screen
    }

    /** Per-frame features: same maths as counters.pose_features (3D world points + image in-frame check). */
    _features(world, image, size) {
      const P = this.P, { pts, vis, xy, feet } = toCoco(world, image);
      const W = size ? size[0] : NaN, H = size ? size[1] : NaN;
      const px = (p) => [p[0] * W, p[1] * H, 0];
      const per = {};
      for (const s of ["l", "r"]) {
        const [sh, el, wr, hp, kn, an] = SIDES[s];
        const dy = Math.abs(pts[sh][1] - pts[hp][1]);
        const dh = Math.hypot(pts[sh][0] - pts[hp][0], pts[sh][2] - pts[hp][2]);
        let leg = nz(Math.min(vis[hp], vis[kn], vis[an]), 0);
        if (!(inside(xy[kn]) && inside(xy[an]))) leg = 0;
        per[s] = {
          elbow: ang(pts[sh], pts[el], pts[wr]), knee: ang(pts[hp], pts[kn], pts[an]),
          body: ang(pts[sh], pts[hp], pts[an]), trunk: (Math.atan2(dy, dh + 1e-8) * 180) / Math.PI,
          arm: nz(Math.min(vis[sh], vis[el], vis[wr]), 0), leg,
          edge: nz(Math.min(edgeDist(xy[kn]), edgeDist(xy[an]), edgeDist(feet[s][0]), edgeDist(feet[s][1])), -1),
          knee2d: ang(px(xy[hp]), px(xy[kn]), px(xy[an])),
          torso: nz(Math.min(vis[sh], vis[hp]), 0),
        };
      }
      const L = per.l, R = per.r;
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      this.segs.push(d(pts[5], pts[7]) + d(pts[7], pts[9]));
      let armLen = median(this.segs.slice(-ARM_WINDOW));
      if (!(isNum(armLen) && armLen > 0)) armLen = 1.0;
      const yl = pts[9][1], yr = pts[10][1];
      const lifted = Math.abs(yl - yr) > 0.25 * armLen;            // false when NaN
      const useL = lifted ? yl >= yr : L.arm >= R.arm;
      const both = L.arm >= P.vis && R.arm >= P.vis && !lifted;
      let elbow = both ? (L.elbow + R.elbow) / 2 : useL ? L.elbow : R.elbow;
      if (Math.max(L.arm, R.arm) < P.vis) elbow = NaN;
      let height = ((useL ? yl : yr) - (useL ? pts[5][1] : pts[6][1])) / armLen;
      if (Number.isNaN(elbow)) height = NaN;
      const legL = L.leg >= R.leg;
      let trunk = L.torso >= R.torso ? L.trunk : R.trunk;
      if (Math.max(L.torso, R.torso) < P.vis) trunk = NaN;
      return {
        elbow, knee: legL ? L.knee : R.knee, body: legL ? L.body : R.body, trunk,
        leg_vis: Math.max(L.leg, R.leg), leg_edge: legL ? L.edge : R.edge, knee2d: legL ? L.knee2d : R.knee2d, height,
      };
    }

    /** Why a finished cycle (frames a..b-1) is not a push-up, or null if it is (counters._gates_ok). */
    _rejectReason(a, b) {
      const P = this.P, f = this.f;
      const tr = f.trunk.slice(a, b);
      if (!tr.some(isNum) || median(tr) > P.trunk_max) return "not in plank";
      const hg = f.height.slice(a, b);
      if (P.h_drop > 0 && (!hg.some(isNum) || nanMax(hg) - nanMin(hg) < P.h_drop)) return "shoulders didn't go down";
      const legs = [];
      for (let i = a; i < b; i++) legs.push(f.leg_vis[i] >= P.leg_vis && f.leg_edge[i] >= P.edge);
      if (legs.filter(Boolean).length / legs.length < 0.5) return P.legs_hidden === "count" ? null : "legs not in frame";
      const kn = [], bd = [], k2 = [];
      for (let i = a; i < b; i++) if (legs[i - a]) { kn.push(f.knee[i]); bd.push(f.body[i]); k2.push(f.knee2d[i]); }
      if (P.knee2d_min > 0 && !(median(k2) >= P.knee2d_min)) return "knees bent";
      if (!(median(kn) >= P.knee_min)) return "knees bent";
      if (!(median(bd) >= P.body_min)) return "hips not in line";
      return null;
    }

    /** Add one frame. size = [width, height] of the analysed picture (for the on-picture knee angle).
     *  Returns the finished cycle {t, counted, reason} if one finished on this frame, else null. */
    push(t, world, image, size) {
      const P = this.P, i = this.t.length;
      const ft = this._features(world, image, size);
      for (const k in this.f) this.f[k].push(ft[k]);
      this.t.push(t);
      this.live = Object.assign({ t, phase: this.state }, ft, {
        legs_ok: ft.leg_vis >= P.leg_vis && ft.leg_edge >= P.edge,
      });
      let e = ft.elbow;
      if (!isNum(e)) {
        if (t - this.lastSeen > P.max_gap_s + 1e-9) { this.state = "up"; this.top = -Infinity; this.hist = []; }
        return null;
      }
      this.lastSeen = t;
      this.hist.push(e);
      if (this.hist.length > P.smooth) this.hist.shift();
      e = median(this.hist);
      this.live.elbow_smooth = e;
      let done = null;
      if (this.state === "up") {
        if (e > this.top) { this.top = e; this.start = i; }
        if (e <= this.top - P.drop && this.top >= P.top_min) { this.state = "down"; this.bottom = e; }
      } else {
        this.bottom = Math.min(this.bottom, e);
        if (e >= this.bottom + P.rise && e >= P.end_min) {
          const dur = t - this.t[this.start] + 1 / this.fps;
          let reason = null;
          if (!(this.bottom <= P.max_bottom)) reason = "not deep enough";
          else if (!(dur >= P.min_dur - 1e-9)) reason = "too quick";
          else reason = this._rejectReason(this.start, i + 1);
          done = { t: Math.round(t * 1000) / 1000, counted: !reason, reason, top: this.top, bottom: this.bottom, dur };
          if (!reason) { this.count += 1; this.events.push(done.t); }
          this.log.push(done);
          this.state = "up"; this.top = e; this.start = i;
        }
      }
      this.live.phase = this.state;
      return done;
    }
  }

  return { Counter, DEFAULTS, MP_TO_COCO };
});
