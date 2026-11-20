# Verification

Run from the repository root. `npm test` covers guide geometry, voice timing,
missing-face recovery, duplication, timestamp and VLM callback guards.

`test:ui` checks 175 compact-panel layouts at multiple viewport sizes and shutter
sides. `test:features` checks UI-to-speech and UI-to-capture behavior with a fake
camera; face observations and native VLM responses are deliberately injected.

`test:detector` and `test:live-detector` use the actual bundled MediaPipe model.
Fixtures are generated reference images, not a representative real-camera test
set. The live probe checks 900 landscape observations, 10 empty frames, and 10
portrait observations. It rejects false pairs in the covered-head cases and
stale tracks on blank input. A fixture's maximum face count does not establish
that every frame was correct, nor does it measure real-world accuracy.

The 2.3 final live run found both faces in 13/30 normal-light fixture sequences
and 17/30 dim sequences. All four frontal/near-frontal fixture groups passed at
all three sizes. All 30 covered-head sequences stayed below two detections;
empty-frame and portrait checks passed. Strong profiles and kissing remain
known limitations. Desktop inference timings do not predict Android latency.

Actual Android cameras, display cutouts, physical volume keys and native VLM
performance require device testing. Browser key tests only verify that the web
UI does not consume the events; native source is also checked for overrides.
