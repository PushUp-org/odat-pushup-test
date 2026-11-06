/* The Test Card: guided scenarios for collecting labelled push-up data (evaluation/12).
 * Edit freely, but give a new scenario a new id and bump VERSION, so old and new sessions can be told apart.
 *   expect: "all"  every rep the tester does should count        -> pass if counted == reps the tester reports
 *           "none" nothing should count                          -> pass if counted == 0
 *           number exactly this many should count (mixed sets)  -> pass if counted == number
 *   reason: label for the attempts that should NOT count (label spec reasons: shallow, no_lockout, knees_down,
 *           not_in_plank, other); legs: "cut" when the feet are meant to be out of the picture.
 *   optional: true -> the tester may skip it without it counting as missing.
 */
window.TESTCARD = {
  VERSION: "tc1",
  // Where testers upload their session file (Alex: paste the shared Drive folder or Google Form link here).
  UPLOAD_URL: "",
  UPLOAD_NAME: "the ODAT Test Card folder",
  scenarios: [
    { id: "S01", group: "Baseline", title: "Normal push-ups", setup: "Phone side-on, at floor level, about 2 m away. Whole body in the picture.",
      do: "10 push-ups at your normal pace.", target: 10, expect: "all" },
    { id: "S02", group: "Baseline", title: "Slow push-ups", setup: "Same position.",
      do: "6 slow push-ups: about 3 seconds down, 1 second up.", target: 6, expect: "all" },
    { id: "S03", group: "Baseline", title: "Fast push-ups", setup: "Same position.",
      do: "10 push-ups as fast as you can, still going all the way down.", target: 10, expect: "all" },
    { id: "S04", group: "Baseline", title: "Chest to the floor", setup: "Same position.",
      do: "6 push-ups going all the way down until your chest nearly touches the floor.", target: 6, expect: "all" },

    { id: "S05", group: "Not full push-ups", title: "Half push-ups", setup: "Same position.",
      do: "6 push-ups stopping halfway down.", target: 6, expect: "none", reason: "shallow" },
    { id: "S06", group: "Not full push-ups", title: "Small dips", setup: "Same position.",
      do: "6 small dips, only bending the elbows a little.", target: 6, expect: "none", reason: "shallow" },
    { id: "S07", group: "Not full push-ups", title: "No lockout", setup: "Same position.",
      do: "6 push-ups without straightening your arms at the top.", target: 6, expect: "none", reason: "no_lockout" },
    { id: "S08", group: "Not full push-ups", title: "Knee push-ups", setup: "Same position.",
      do: "6 push-ups on your knees.", target: 6, expect: "none", reason: "knees_down" },
    { id: "S09", group: "Not full push-ups", title: "Hips sagging", setup: "Same position.",
      do: "6 push-ups letting your hips sag towards the floor.", target: 6, expect: "none", reason: "other" },
    { id: "S10", group: "Not full push-ups", title: "Hips high", setup: "Same position.",
      do: "6 push-ups with your hips up high (body like an upside-down V).", target: 6, expect: "none", reason: "other" },

    { id: "S11", group: "Camera", title: "Diagonal camera", setup: "Move the phone about 45° round towards your head, still at floor level.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S12", group: "Camera", title: "Front camera", setup: "Phone in front of you, facing your head, about 2 m away.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S13", group: "Camera", title: "Phone far away", setup: "Side-on, about 4 m away.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S14", group: "Camera", title: "Phone raised", setup: "Side-on, phone on a chair or low table.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S15", group: "Camera", title: "Feet out of the picture", setup: "Side-on, move closer until your feet are outside the picture.",
      do: "6 normal push-ups. (They should NOT count: the legs must be in frame.)", target: 6, expect: "none", reason: "other", legs: "cut" },

    { id: "S16", group: "Conditions", title: "Dim light", setup: "Side-on. Turn most lights off; you should still be visible.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S17", group: "Conditions", title: "Light behind you", setup: "Side-on, with a window or lamp behind you, facing the camera.",
      do: "8 normal push-ups.", target: 8, expect: "all" },
    { id: "S18", group: "Conditions", title: "Different clothes", setup: "Side-on, in baggy or dark clothes.",
      do: "8 normal push-ups.", target: 8, expect: "all", optional: true },

    { id: "S19", group: "Not push-ups", title: "Plank hold", setup: "Side-on, normal position.",
      do: "Hold a plank for 20 seconds, then rest on the floor.", target: 0, expect: "none", reason: "other" },
    { id: "S20", group: "Not push-ups", title: "Getting ready", setup: "Side-on, normal position.",
      do: "Get down into position, adjust, look at the phone, then stand up. No push-ups.", target: 0, expect: "none", reason: "other" },
    { id: "S21", group: "Mixed", title: "Mixed set", setup: "Side-on, normal position.",
      do: "In one go: 5 full push-ups, then 3 half push-ups, then 2 knee push-ups.", target: 10, expect: 5 },
  ],
};
