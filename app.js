/* ODAT push-up test app: MediaPipe Pose (legacy, as evaluated) + the tuned counter (counter.js), all on the device.
 * Frames are analysed at up to 15 per second, downscaled to 320 px on the long side, with MediaPipe's
 * clock advanced 33.3 ms per frame: the same input the counter was tuned and scored on (evaluation/10, 11).
 * Nothing leaves the device: no uploads, no analytics.
 */
(function () {
  "use strict";
  const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/";
  const FPS = 15, MAX_SIDE = 320, MP_TICK_MS = 1000 / 30;
  const MODELS = window.PUSHUP_MODELS;
  const $ = (id) => document.getElementById(id);
  const video = $("video"), overlay = $("overlay"), octx = overlay.getContext("2d");
  const work = document.createElement("canvas"), wctx = work.getContext("2d", { willReadFrequently: false });

  const S = { model: "full", source: "camera", facing: "user", running: false, pose: null, counter: null,
              tick: 0, frames: 0, stream: null, msHist: [], fpsHist: [], lastProc: 0, startT: 0, wake: null, loadToken: 0,
              depth: 100, devStream: null };
  const DEPTHS = [90, 100, 110, "tuned"];          // bottom elbow angle a rep must reach (Alex: adjustable, start 100)
  const hooks = [];                                // Test Card listens to every analysed frame

  // ---------- UI helpers ----------
  const fmt = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "–");
  function showErr(msg) { $("err").textContent = msg; $("err").hidden = !msg; }
  function setModelUI() {
    const m = MODELS[S.model];
    $("chipModel").textContent = m.label;
    $("mName").textContent = m.label;
    $("mSize").textContent = m.size_mb ? m.size_mb + " MB" : "–";
    $("mClean").textContent = m.heldout ? m.heldout.clean_recall + " %" : "–";
    $("mExtra").textContent = m.heldout ? String(m.heldout.clean_extra_per_50) : "–";
    $("mNote").textContent = m.note;
    for (const b of $("modelSeg").children) b.setAttribute("aria-pressed", String(b.dataset.key === S.model));
  }
  function buildModelSeg() {
    for (const key of Object.keys(MODELS)) {
      const b = document.createElement("button");
      b.textContent = MODELS[key].label; b.dataset.key = key;
      b.addEventListener("click", () => switchModel(key));
      $("modelSeg").appendChild(b);
    }
  }
  function say(text) {
    if (!$("speak").checked || !("speechSynthesis" in window)) return;
    try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) { /* optional */ }
  }
  function showLast(done) {
    const el = $("last");
    el.hidden = false;
    el.textContent = done.counted ? `Counted (${S.counter.count})` : `Not counted: ${done.reason}`;
    el.style.boxShadow = done.counted ? "inset 0 0 0 2px #3fbf93" : "inset 0 0 0 2px #ef7d5f";
  }
  function depthLimit() { return S.depth === "tuned" ? MODELS[S.model].params.max_bottom : S.depth; }
  function applyDepth() { if (S.counter) S.counter.P.max_bottom = depthLimit(); }
  function buildDepthSeg() {
    for (const d of DEPTHS) {
      const b = document.createElement("button");
      b.textContent = d === "tuned" ? "Tuned" : d + "°"; b.dataset.key = String(d);
      b.title = d === "tuned" ? "The setting tuned on the pilot data (" + MODELS[S.model].params.max_bottom + "°)" : "A rep must bend the elbows to " + d + "° or less";
      b.addEventListener("click", () => setDepth(d));
      $("depthSeg").appendChild(b);
    }
  }
  function setDepth(d) {
    S.depth = d; applyDepth();
    for (const b of $("depthSeg").children) b.setAttribute("aria-pressed", String(b.dataset.key === String(d)));
    try { localStorage.setItem("odat_depth", String(d)); } catch (e) { /* optional */ }
  }
  function addLog(done) {
    const log = $("log");
    if (log.dataset.empty !== "no") { log.innerHTML = ""; log.dataset.empty = "no"; }
    const li = document.createElement("li");
    const t = document.createElement("span"); t.textContent = fmt(done.t, 1) + " s";
    const r = document.createElement("span");
    const depth = isFinite(done.bottom) ? ` · ${Math.round(done.bottom)}°` : "";
    r.textContent = (done.counted ? `rep ${S.counter.count}` : `not counted: ${done.reason}`) + depth;
    r.className = done.counted ? "ok-t" : "no-t";
    li.append(t, r);
    log.prepend(li);
  }
  function resetCount() {
    if (S.counter) S.counter.reset();
    $("count").textContent = "0"; $("last").hidden = true;
    $("log").innerHTML = '<li><span>–</span><span>Attempts appear here: counted, or why not.</span></li>'; $("log").dataset.empty = "";
  }

  // ---------- model ----------
  async function loadModel(key) {
    const token = ++S.loadToken;
    if (S.pose) { try { await S.pose.close(); } catch (e) { /* already closed */ } S.pose = null; }
    const m = MODELS[key];
    const pose = new Pose({ locateFile: (f) => MP_CDN + f });
    pose.setOptions({ modelComplexity: m.complexity, smoothLandmarks: true, enableSegmentation: false,
                      minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
    pose.onResults((r) => { pose._last = r; });
    await pose.initialize();
    if (token !== S.loadToken) { pose.close(); return; }
    S.pose = pose; S.tick = 0;
    S.counter = new PushupCounter.Counter(m.params, FPS);
    applyDepth();
  }
  async function switchModel(key) {
    if (key === S.model && S.pose) return;
    const wasRunning = S.running;
    if (wasRunning) await stop();
    S.model = key; setModelUI(); resetCount();
    try { localStorage.setItem("odat_model", key); } catch (e) { /* optional */ }
    if (wasRunning) start();
  }
  async function infer(t) {
    const w = video.videoWidth, h = video.videoHeight, s = Math.min(1, MAX_SIDE / Math.max(w, h));
    const W = Math.max(1, Math.floor(w * s)), H = Math.max(1, Math.floor(h * s));
    if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
    wctx.drawImage(video, 0, 0, W, H);
    const t0 = performance.now();
    S.pose._last = null;
    await S.pose.send({ image: work }, ++S.tick * MP_TICK_MS);
    const ms = performance.now() - t0;
    const r = S.pose._last || {};
    const world = r.poseWorldLandmarks || null, image = r.poseLandmarks || null;
    const done = S.counter.push(t, world, image, [W, H]);
    S.frames++;
    S.msHist = S.msHist.concat(ms).slice(-30);
    render(image, done);
    for (const fn of hooks) fn({ t, world, image, size: [W, H], done, ms });
  }

  // ---------- drawing ----------
  const EDGES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  function render(image, done) {
    const live = S.counter.live;
    $("placeholder").hidden = true;
    const rect = overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(rect.width * dpr)) { overlay.width = Math.round(rect.width * dpr); overlay.height = Math.round(rect.height * dpr); }
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (image && $("skeleton").checked && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(overlay.width / vw, overlay.height / vh);
      const ox = (overlay.width - vw * s) / 2, oy = (overlay.height - vh * s) / 2;
      const P = (k) => [ox + image[k].x * vw * s, oy + image[k].y * vh * s];
      octx.lineWidth = 4 * dpr; octx.lineCap = "round";
      for (const [a, b] of EDGES) {
        octx.strokeStyle = a >= 23 ? (live.legs_ok ? "#3fbf93" : "#ef7d5f") : "#f4f7f5";
        const [x1, y1] = P(a), [x2, y2] = P(b);
        octx.beginPath(); octx.moveTo(x1, y1); octx.lineTo(x2, y2); octx.stroke();
      }
    }
    $("count").textContent = String(S.counter.count);
    $("chipLegs").textContent = image ? (live.legs_ok ? "Legs in frame" : "Legs not in frame") : "No person";
    $("chipLegs").className = "chip " + (image ? (live.legs_ok ? "ok" : "no") : "warn");
    $("rElbow").textContent = fmt(live.elbow_smooth) + "°";
    $("rPhase").textContent = live.phase === "down" ? "going down" : "up";
    $("rKnee").textContent = fmt(live.knee) + "°";
    $("rTrunk").textContent = fmt(live.trunk) + "°";
    const ms = S.msHist.slice().sort((a, b) => a - b)[S.msHist.length >> 1];
    $("rMs").textContent = fmt(ms) + " ms";
    $("rFrames").textContent = String(S.frames);
    if (done) {
      showLast(done); addLog(done);
      if (done.counted) { say(String(S.counter.count)); if (navigator.vibrate) navigator.vibrate(40); }
      else say("no, " + done.reason);
    }
  }
  function updateFps() {
    const now = performance.now();
    S.fpsHist = S.fpsHist.concat(now).filter((x) => now - x < 2000);
    $("chipFps").textContent = (S.fpsHist.length / 2).toFixed(0) + " fps";
    const slow = S.source === "camera" && S.fpsHist.length / 2 < 10 && S.frames > 30;
    $("chipFps").className = "chip " + (slow ? "warn" : "");
  }

  // ---------- camera ----------
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser can't open the camera here. Use https:// or localhost, in Chrome or Safari.");
    }
    S.stream = S.devStream || await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: S.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
    S.pose.reset();
    video.srcObject = S.stream; video.removeAttribute("src");
    await video.play();
    $("stage").classList.toggle("mirror", S.facing === "user" && !S.devStream);
    S.startT = performance.now(); S.lastProc = 0;
    cameraLoop();
  }
  async function cameraLoop() {
    while (S.running && S.source === "camera") {
      await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : requestAnimationFrame(() => r())));
      const now = performance.now();
      if (now - S.lastProc < 1000 / FPS - 3) continue;       // at most 15 analysed frames per second
      S.lastProc = now;
      try { await infer((now - S.startT) / 1000); updateFps(); } catch (e) { showErr("Pose model error: " + e.message); await stop(); }
    }
  }

  // ---------- video file ----------
  async function startFile(file) {
    S.pose.reset(); S.counter.reset(); S.frames = 0;      // fresh tracking and count for each video
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    $("stage").classList.remove("mirror");
    await new Promise((r, j) => { video.onloadedmetadata = r; video.onerror = () => j(new Error("This video can't be decoded by the browser.")); });
    $("progressWrap").hidden = false;
    const dur = video.duration;
    for (let i = 0; S.running && S.source === "file"; i++) {
      const t = i / FPS;
      if (t >= dur) break;
      await new Promise((r) => { video.onseeked = r; video.currentTime = Math.min(dur, t + 0.5 / FPS); });
      await infer(t);
      updateFps();
      $("progress").style.width = ((100 * t) / dur).toFixed(1) + "%";
    }
    if (S.running) { $("progress").style.width = "100%"; await stop(); }
  }

  // ---------- start / stop ----------
  async function start() {
    showErr("");
    if (S.source === "file") { $("fileInput").click(); return; }
    await begin(() => startCamera());
  }
  async function begin(run) {
    S.running = true; $("startBtn").textContent = "Stop"; $("placeholder").hidden = true;
    try {
      if (!S.pose || S.counter === null) { $("startBtn").disabled = true; $("startBtn").textContent = "Loading model…"; await loadModel(S.model); }
      $("startBtn").disabled = false; $("startBtn").textContent = "Stop";
      try { S.wake = await navigator.wakeLock.request("screen"); } catch (e) { S.wake = null; }
      await run();
    } catch (e) {
      $("startBtn").disabled = false;
      showErr(e.name === "NotAllowedError" ? "Camera permission was refused. Allow the camera for this page and press Start again." : e.message || String(e));
      await stop();
    }
  }
  async function stop() {
    S.running = false;
    $("startBtn").textContent = "Start"; $("startBtn").disabled = false;
    if (S.stream && S.stream !== S.devStream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null;
    if (S.wake) { try { await S.wake.release(); } catch (e) { /* ignore */ } S.wake = null; }
  }

  // ---------- results for Alex ----------
  function copyResults() {
    const c = S.counter;
    const out = { app: "ODAT push-up test", model: S.model, approach: MODELS[S.model].approach, depth: depthLimit(), source: S.source,
      device: navigator.userAgent, frames: S.frames, median_ms_per_frame: Math.round(S.msHist.slice().sort((a, b) => a - b)[S.msHist.length >> 1] || 0),
      count: c ? c.count : 0, attempts: c ? c.log.map((d) => ({ t: d.t, counted: d.counted, reason: d.reason, depth: Math.round(d.bottom) })) : [] };
    const text = JSON.stringify(out, null, 1);
    const done = () => { $("copied").hidden = false; setTimeout(() => ($("copied").hidden = true), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt("Copy:", text));
    else prompt("Copy:", text);
  }

  // ---------- wiring ----------
  $("startBtn").addEventListener("click", () => (S.running ? stop() : start()));
  $("resetBtn").addEventListener("click", resetCount);
  $("copyBtn").addEventListener("click", copyResults);
  $("flipBtn").addEventListener("click", async () => {
    S.facing = S.facing === "user" ? "environment" : "user";
    if (S.running && S.source === "camera") { await stop(); start(); }
  });
  $("srcCam").addEventListener("click", async () => {
    if (S.source === "camera") return;
    await stop(); S.source = "camera"; resetCount();
    $("srcCam").setAttribute("aria-pressed", "true"); $("srcFile").setAttribute("aria-pressed", "false");
    $("flipBtn").hidden = false; $("progressWrap").hidden = true; $("placeholder").hidden = false;
    $("placeholder").innerHTML = "Press Start and allow the camera.<br>Phone side-on, at floor level, whole body in the picture.";
  });
  $("srcFile").addEventListener("click", async () => {
    if (S.source === "file") return;
    await stop(); S.source = "file"; resetCount();
    $("srcFile").setAttribute("aria-pressed", "true"); $("srcCam").setAttribute("aria-pressed", "false");
    $("flipBtn").hidden = true; $("placeholder").hidden = false;
    $("placeholder").textContent = "Press Start and pick a video. It is analysed on this device at 15 frames per second; nothing is uploaded.";
  });
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    resetCount();
    begin(() => startFile(f));
  });

  try { const m = localStorage.getItem("odat_model"); if (m && MODELS[m]) S.model = m; } catch (e) { /* optional */ }
  try { const d = localStorage.getItem("odat_depth"); if (d) S.depth = d === "tuned" ? "tuned" : Number(d); } catch (e) { /* optional */ }
  if (!DEPTHS.includes(S.depth)) S.depth = 100;
  buildModelSeg(); setModelUI(); buildDepthSeg(); setDepth(S.depth);
  // Small API for the Test Card (testcard.js)
  window.ODAT = {
    S, MODELS, hooks, FPS, say, showErr, resetCount, depthLimit,
    startCamera: () => { showErr(""); S.source = "camera"; return begin(() => startCamera()); },
    stop: () => stop(),
    setDevStream: (stream) => { S.devStream = stream; },
  };
  $("version").textContent = "test build · runs on this device";
  if (typeof Pose === "undefined") showErr("The pose model library didn't load. Check the internet connection and reload.");
})();
