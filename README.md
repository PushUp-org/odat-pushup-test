# ODAT push-up counter: test build

A test page for the ODAT push-up counter. Open it on a phone, prop the phone side-on at floor level, and do push-ups.
It counts reps and says why an attempt didn't count (knees bent, not deep enough, legs not in frame, ...).

- **Runs entirely on the device.** The camera picture never leaves the phone: no uploads, no analytics.
- **Two pose models:** MediaPipe Pose *Full* (recommended) and *Lite* (for older phones), loaded from jsDelivr
  (`@mediapipe/pose@0.5.1675469404`, Apache 2.0).
- **Counting rules:** `counter.js`; tuned settings and measured accuracy: `models.js`.
- **Video file mode:** analyses a recorded video on the device at 15 frames per second, the rate the counter was tuned at.

Built from the evaluation workspace (private). Do not edit files here by hand; they are copied from there.
