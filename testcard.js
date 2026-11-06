/* Test Card: guided data collection (evaluation/12).
 * For each scenario in scenarios.js: countdown, record the camera (video) and every analysed frame's body points
 * plus the counter's decisions, ask the tester what they actually did, and score pass / fail on the spot.
 * Progress is kept on the phone (IndexedDB), so a reload doesn't lose recorded scenarios. At the end the
 * tester saves ONE session file (.zip: session.json + video/ + frames/) and uploads it to the shared folder.
 * tools/import_testcard.py checks and imports these files. Nothing is sent anywhere by this page.
 */
(function () {
  "use strict";
  const TC = window.TESTCARD, O = window.ODAT;
  const $ = (id) => document.getElementById(id);
  const panel = $("tcPanel");
  const DEV = new URLSearchParams(location.search).has("dev");
  const SCHEMA = "odat-testcard/1", BUILD = "webapp-2026-11-06", COUNTDOWN_S = 10, MAX_REC_S = 150;
  const CONSENT = "I agree that video of me doing these exercises, and the body points measured from it, are saved " +
    "and shared with the ODAT team, only to test and improve the push-up counter.";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = () => new Date().toISOString();
  let session = null, rec = null, memStore = { kv: {}, blobs: {} }, idbOk = true, saved = null;

  // ---------- storage on the phone (IndexedDB; memory if blocked) ----------
  const dbp = new Promise((res) => {
    try {
      const r = indexedDB.open("odat-testcard", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { idbOk = false; res(null); };
    } catch (e) { idbOk = false; res(null); }
  });
  async function op(name, mode, act) {       // act(objectStore) -> IDBRequest; resolves with its result
    const db = await dbp;
    return new Promise((res, rej) => {
      const tx = db.transaction(name, mode), rq = act(tx.objectStore(name));
      tx.oncomplete = () => res(rq.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const put = async (name, key, val) => ((await dbp) ? op(name, "readwrite", (st) => st.put(val, key)) : (memStore[name][key] = val));
  const get = async (name, key) => ((await dbp) ? op(name, "readonly", (st) => st.get(key)) : memStore[name][key]);
  const clear = async (name) => ((await dbp) ? op(name, "readwrite", (st) => st.clear()) : (memStore[name] = {}));
  const saveSession = () => put("kv", "current", session);

  // ---------- helpers ----------
  const scen = (id) => TC.scenarios.find((s) => s.id === id);
  const rnd = (v, d) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  function pack(lms) {               // 33 landmarks -> flat [x, y, z, visibility] * 33, rounded
    if (!lms) return null;
    const out = [];
    for (const l of lms) out.push(rnd(l.x, 5), rnd(l.y, 5), rnd(l.z, 5), rnd(l.visibility, 3));
    return out;
  }
  function expectText(s) {
    if (s.expect === "all") return ["all", "All should count"];
    if (s.expect === "none") return ["none", "None should count"];
    return ["all", `Only the ${s.expect} full push-ups should count`];
  }
  function shouldCount(s, selfReport) { return s.expect === "none" ? 0 : selfReport; }
  function pickMime() {
    const c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
  }
  async function sha256(blob) {
    const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function fileName() {
    const d = new Date(session.created), p = (n) => String(n).padStart(2, "0");
    return `odat-testcard_${session.tester}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${session.session_id.slice(0, 8)}.zip`;
  }
  const doneCount = () => session.scenarios.filter((s) => s.status !== "todo").length;

  // ---------- views ----------
  async function viewIntro() {
    const old = await get("kv", "current").catch(() => null);
    const resumable = old && old.schema === SCHEMA && old.scenarios.some((s) => s.status !== "todo");
    const m = O.MODELS[O.S.model];
    panel.innerHTML = `
      <span class="step">Data collection</span>
      <h3>Test Card</h3>
      <p class="setup">${TC.scenarios.length} short scenarios, about 15–20 minutes. Each one: read the instruction, press Start,
        get into position during the 10-second countdown, do it, then tap Done. The phone records video and body points.</p>
      ${resumable ? `<p class="do">Unfinished session from ${esc(new Date(old.created).toLocaleString())} (${esc(old.tester)}):
        ${old.scenarios.filter((s) => s.status !== "todo").length} of ${old.scenarios.length} done.</p>
        <div class="bar"><button class="btn primary" id="tcResume">Resume it</button><button class="btn" id="tcDiscard">Discard it</button></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">` : ""}
      <div class="row"><label for="tcTester">Your tester ID (letters, numbers, dashes)</label>
        <input type="text" id="tcTester" placeholder="e.g. alex-01" autocomplete="off" maxlength="24"></div>
      <div class="row"><label class="switch" style="align-items:flex-start"><input type="checkbox" id="tcConsent" style="margin-top:4px"> <span>${esc(CONSENT)}</span></label></div>
      <p class="setup">Model: <b>${esc(m.label)}</b> · full push-up = elbows to ${esc(O.depthLimit())}° (change at the top before starting).
        ${idbOk ? "" : "<br><b>This browser blocks storage: don't reload during the session.</b>"}</p>
      ${DEV ? `<div class="row"><label for="tcDevVideo">Dev: use a video file as the camera</label><input type="file" id="tcDevVideo" accept="video/*"></div>` : ""}
      <div class="bar"><button class="btn primary" id="tcStart">Start Test Card</button></div>
      <p class="err" id="tcErr" hidden></p>`;
    if (resumable) {
      $("tcResume").onclick = async () => { session = old; await saveSession(); next(); };
      $("tcDiscard").onclick = async () => { await clear("kv"); await clear("blobs"); viewIntro(); };
    }
    if (DEV) $("tcDevVideo").onchange = (e) => devVideo(e.target.files[0]);
    $("tcStart").onclick = startSession;
  }

  async function startSession() {
    const tester = $("tcTester").value.trim().toLowerCase();
    const err = (m) => { $("tcErr").textContent = m; $("tcErr").hidden = false; };
    if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(tester)) return err("Enter a tester ID of 2–24 letters, numbers or dashes, e.g. alex-01.");
    if (!$("tcConsent").checked) return err("Tick the consent box to take part.");
    if (!window.MediaRecorder) return err("This browser can't record video. Use Chrome on Android or Safari on iPhone (iOS 14.3+).");
    await clear("blobs");
    session = {
      schema: SCHEMA, card: TC.VERSION, session_id: crypto.randomUUID(), tester, created: iso(),
      consent: { given: true, text: CONSENT, at: iso() },
      device: { ua: navigator.userAgent, platform: navigator.platform || "", screen: [screen.width, screen.height], dpr: window.devicePixelRatio || 1 },
      app: { build: BUILD, dev: DEV },
      scenarios: TC.scenarios.map((s) => ({ id: s.id, title: s.title, group: s.group, expect: s.expect, reason: s.reason || null,
        legs: s.legs || "in", target: s.target, optional: !!s.optional, status: "todo" })),
    };
    await saveSession();
    next();
  }

  function next() {
    const s = session.scenarios.find((x) => x.status === "todo");
    if (s) viewScenario(s); else viewSummary();
  }

  function viewScenario(sr) {
    const s = scen(sr.id), i = session.scenarios.indexOf(sr) + 1, [cls, txt] = expectText(s);
    panel.innerHTML = `
      <span class="step">Scenario ${i} of ${session.scenarios.length} · ${esc(s.group)}</span>
      <h3>${esc(s.title)}</h3>
      <p class="setup">${esc(s.setup)}</p>
      <p class="do">${esc(s.do)}</p>
      <span class="expect ${cls}">${esc(txt)}</span>
      <div class="bar" style="margin-top:12px">
        <button class="btn primary" id="tcGo">Start (${COUNTDOWN_S} s countdown)</button>
        <button class="btn" id="tcSkip">Skip</button>
      </div>
      <p class="setup" style="margin-top:10px">${doneCount()} done · <a href="#" id="tcFinish">finish early and save</a></p>
      <p class="err" id="tcErr" hidden></p>`;
    $("tcGo").onclick = () => record(sr);
    $("tcSkip").onclick = async () => { sr.status = "skipped"; sr.skipped_at = iso(); await saveSession(); next(); };
    $("tcFinish").onclick = (e) => { e.preventDefault(); viewSummary(); };
  }

  async function ensureCamera() {
    if (O.S.running && O.S.source === "camera") return;
    if (O.S.source === "file") $("srcCam").click();
    await O.startCamera();
    if (!O.S.running) throw new Error("The camera didn't start. Allow the camera and try again.");
    await new Promise((res) => { const f = () => { O.hooks.splice(O.hooks.indexOf(f), 1); res(); }; O.hooks.push(f); });
  }

  async function record(sr) {
    const s = scen(sr.id);
    try { await ensureCamera(); } catch (e) { $("tcErr").textContent = e.message; $("tcErr").hidden = false; return; }
    // countdown
    panel.innerHTML = `<span class="step">${esc(s.title)}</span><h3>Get into position</h3>
      <div class="big" id="tcCd">${COUNTDOWN_S}</div><p class="do">${esc(s.do)}</p>
      <div class="bar"><button class="btn" id="tcCancel">Cancel</button></div>`;
    let cancelled = false;
    $("tcCancel").onclick = () => { cancelled = true; };
    O.say("Get ready");
    for (let k = COUNTDOWN_S; k > 0; k--) {
      if (cancelled) return viewScenario(sr);
      $("tcCd").textContent = k;
      if (k <= 3) O.say(String(k));
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (cancelled) return viewScenario(sr);
    O.say("Go");
    // record
    const mime = pickMime();
    const recorder = new MediaRecorder(O.S.stream, Object.assign({ videoBitsPerSecond: 600000 }, mime ? { mimeType: mime } : {}));
    rec = { sr, recorder, chunks: [], frames: { t: [], world: [], image: [], size: null }, attempts: [], t0: performance.now(), started_at: iso() };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    O.resetCount();
    rec.offset = (rec.t0 - O.S.startT) / 1000;
    recorder.start(1000);
    panel.innerHTML = `<span class="step">Recording · ${esc(s.title)}</span>
      <div class="bar" style="justify-content:space-between;align-items:flex-end">
        <div><div class="step">Counted</div><div class="big" id="tcCount">0</div></div>
        <div style="text-align:right"><div class="step">Time</div><div class="big" id="tcTime">0:00</div></div></div>
      <p class="do">${esc(s.do)}</p>
      <div class="bar"><button class="btn primary" id="tcDone">Done</button><button class="btn" id="tcRedo">Start again</button></div>`;
    const timer = setInterval(() => {
      const sec = Math.floor((performance.now() - rec.t0) / 1000);
      $("tcTime").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (sec >= MAX_REC_S) finish();
    }, 500);
    let finished = false;
    const finish = async (redo) => {
      if (finished) return; finished = true;
      clearInterval(timer);
      const r = rec; rec = null;
      await new Promise((res) => { r.recorder.onstop = res; r.recorder.stop(); });
      if (redo) return record(sr);
      r.video = new Blob(r.chunks, { type: r.recorder.mimeType || mime || "video/webm" });
      r.duration = (performance.now() - r.t0) / 1000;
      viewReview(r);
    };
    $("tcDone").onclick = () => finish(false);
    $("tcRedo").onclick = () => finish(true);
  }

  function onFrame(h) {                    // every analysed frame (app.js hooks)
    if (!rec) return;
    const t = h.t - rec.offset;
    if (t < 0) return;
    const f = rec.frames;
    f.t.push(rnd(t, 3)); f.world.push(pack(h.world)); f.image.push(pack(h.image)); f.size = h.size;
    if (h.done) rec.attempts.push({ t: rnd(h.done.t - rec.offset, 3), counted: h.done.counted, reason: h.done.reason,
      depth: rnd(h.done.bottom, 1), top: rnd(h.done.top, 1), dur: rnd(h.done.dur, 2) });
    const c = $("tcCount"); if (c) c.textContent = String(O.S.counter.count);
  }
  O.hooks.push(onFrame);

  function viewReview(r) {
    const s = scen(r.sr.id), counted = r.attempts.filter((a) => a.counted).length;
    const q = s.expect === "none" ? "How many attempts did you do?" : s.expect === "all" ? "How many push-ups did you do?" : "How many FULL push-ups did you do?";
    const def = s.expect === "all" ? s.target : s.expect === "none" ? s.target : s.expect;
    const person = r.frames.image.filter(Boolean).length;
    panel.innerHTML = `<span class="step">${esc(s.title)} · check</span>
      <h3>The app counted ${counted}</h3>
      <p class="setup">${r.attempts.length} attempts seen, ${r.duration.toFixed(0)} s recorded, person found in ${person} of ${r.frames.t.length} frames.</p>
      <div class="row"><label for="tcSelf">${q}</label><input type="number" id="tcSelf" min="0" max="99" value="${def}"></div>
      <p class="do" id="tcVerdict"></p>
      <div class="row"><label for="tcComment">Anything odd? (optional)</label><textarea id="tcComment" placeholder="e.g. someone walked past, I lost count"></textarea></div>
      <div class="bar"><button class="btn primary" id="tcSave">Save and next</button><button class="btn" id="tcRedo2">Redo this one</button></div>`;
    const verdict = () => {
      const n = Number($("tcSelf").value), want = shouldCount(s, n), ok = counted === want;
      $("tcVerdict").innerHTML = `Should count ${want}: <span class="pill ${ok ? "pass" : "fail"}">${ok ? "PASS" : "FAIL"}</span>`;
      return { n, ok };
    };
    $("tcSelf").oninput = verdict; verdict();
    $("tcRedo2").onclick = () => record(r.sr);
    $("tcSave").onclick = async () => {
      $("tcSave").disabled = true; $("tcSave").textContent = "Saving…";
      const { n, ok } = verdict(), sr = r.sr, ext = (r.video.type || "").includes("mp4") ? "mp4" : "webm";
      await put("blobs", `${session.session_id}/${sr.id}`, { video: r.video, frames: r.frames });
      Object.assign(sr, {
        status: "done", started_at: r.started_at, duration_s: rnd(r.duration, 2),
        model: O.S.model, approach: O.MODELS[O.S.model].approach, depth_limit: O.depthLimit(),
        video: { file: `video/${sr.id}.${ext}`, mime: r.video.type, bytes: r.video.size, sha256: await sha256(r.video) },
        frames: { file: `frames/${sr.id}.json`, n: r.frames.t.length, person: person, size: r.frames.size },
        counted, attempts: r.attempts, self_report: n, should_count: shouldCount(s, n), pass: ok,
        comment: $("tcComment").value.trim().slice(0, 500),
      });
      await saveSession();
      next();
    };
  }

  function viewSummary() {
    const rows = session.scenarios.map((sr) => {
      const res = sr.status === "done" ? `<span class="pill ${sr.pass ? "pass" : "fail"}">${sr.pass ? "pass" : "fail"}</span>` : `<span class="pill skip">${sr.status === "skipped" ? "skipped" : "not done"}</span>`;
      return `<tr><td>${esc(sr.title)}</td><td>${sr.status === "done" ? sr.should_count : "–"}</td><td>${sr.status === "done" ? sr.counted : "–"}</td><td>${res}</td></tr>`;
    }).join("");
    const done = session.scenarios.filter((s) => s.status === "done"), pass = done.filter((s) => s.pass).length;
    panel.innerHTML = `<span class="step">Test Card · ${esc(session.tester)}</span>
      <h3>${pass} of ${done.length} passed</h3>
      <div class="scroll"><table><thead><tr><th>Scenario</th><th>Should count</th><th>Counted</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="bar" style="margin-top:12px">
        <button class="btn primary" id="tcZip" ${done.length ? "" : "disabled"}>Save session file</button>
        ${session.scenarios.some((s) => s.status === "todo") ? '<button class="btn" id="tcBack">Back to scenarios</button>' : ""}
      </div>
      <div id="tcOut"></div>`;
    if ($("tcBack")) $("tcBack").onclick = next;
    $("tcZip").onclick = buildZip;
  }

  async function buildZip() {
    const out = $("tcOut");
    if (!window.JSZip) { out.innerHTML = '<p class="err">The zip library did not load. Check the connection and reload (your recordings are kept).</p>'; return; }
    $("tcZip").disabled = true;
    out.innerHTML = '<p class="setup" id="tcZipMsg">Packing…</p>';
    const zip = new JSZip(), meta = JSON.parse(JSON.stringify(session));
    meta.saved_at = iso();
    for (const sr of session.scenarios.filter((s) => s.status === "done")) {
      const b = await get("blobs", `${session.session_id}/${sr.id}`);
      if (!b) { sr.status = "lost"; continue; }
      zip.file(sr.video.file, b.video, { compression: "STORE" });
      zip.file(sr.frames.file, JSON.stringify(b.frames));
    }
    zip.file("session.json", JSON.stringify(meta, null, 1));
    zip.file("README.txt", "ODAT push-up Test Card session. Upload this file unchanged to " + TC.UPLOAD_NAME + ".\n" +
      "Contents: session.json (scenarios, counts, device, consent), video/ (one recording per scenario), frames/ (body points per frame).\n");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (m) => { const e = $("tcZipMsg"); if (e) e.textContent = `Packing… ${m.percent.toFixed(0)} %`; });
    const name = fileName(), file = new File([blob], name, { type: "application/zip" });
    saved = { name, blob, file };
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const link = TC.UPLOAD_URL ? `<a href="${esc(TC.UPLOAD_URL)}" target="_blank" rel="noopener">${esc(TC.UPLOAD_NAME)}</a>` : esc(TC.UPLOAD_NAME);
    out.innerHTML = `<p class="do">${esc(name)} · ${(blob.size / 1e6).toFixed(1)} MB</p>
      <div class="bar">${canShare ? '<button class="btn primary" id="tcShare">Share…</button>' : ""}<button class="btn" id="tcDl">Download</button></div>
      <p class="setup">Upload this file unchanged to ${link}. Don't rename it. Then you can start a new session.</p>
      <div class="bar"><button class="btn" id="tcNew">Start a new session</button></div>`;
    if (canShare) $("tcShare").onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
    $("tcDl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    $("tcNew").onclick = async () => { await clear("kv"); await clear("blobs"); session = null; viewIntro(); };
    if (DEV && location.hostname === "localhost") {
      fetch(`/_dev_upload?name=${encodeURIComponent(name)}`, { method: "POST", body: blob }).then((r) => { window.__devUpload = r.status; });
    }
  }

  async function devVideo(f) {
    if (!f) return;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(f);
    await v.play();
    window.__devVideo = v;
    O.setDevStream(v.captureStream ? v.captureStream() : v.mozCaptureStream());
  }

  // ---------- mode switch ----------
  for (const id of ["startBtn", "resetBtn", "sourceSeg"]) $(id).classList.add("free-only");
  function setMode(card) {
    if (rec) return;                         // never switch mid-recording
    document.body.classList.toggle("card", card);
    panel.hidden = !card;
    $("modeCard").setAttribute("aria-pressed", String(card)); $("modeFree").setAttribute("aria-pressed", String(!card));
    if (card) { if (O.S.source === "file") { O.stop(); $("srcCam").click(); } if (session) next(); else viewIntro(); }
  }
  $("modeCard").onclick = () => setMode(true);
  $("modeFree").onclick = () => setMode(false);
  window.TESTCARD_DEBUG = { get session() { return session; }, get saved() { return saved; } };
})();
