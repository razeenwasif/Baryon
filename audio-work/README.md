# Song humming experiment

## Original-song singing conversion

The user supplied an original song in `/Users/razeenwasif/Music/video.mp4` and
authorized the 0:30–0:50 excerpt to be processed in Fish Audio. Local audio and
experiment reports are kept in the ignored `.local-data/audio/original-song/`.
The first general voice-conversion preview was rejected by the user for
unnatural sound and pronunciation. A second Fish test used isolated vocals.
Both web tests selected the user's own "Mavuika" entry, which was subsequently
found to differ from Stella's configured Fish voice ID. They should not be
treated as verified tests of that exact configured voice.

The next experiment uses the dedicated 44.1 kHz singing model from
[Seed-VC](https://github.com/Plachtaa/seed-vc), commit
`51383efd921027683c89e5348211d93ff12ac2a8`. Its upstream repository is archived.
Code and weights remain under `.local-data/tools/seed-vc/`, with a separate
Python 3.11 environment at `.local-data/tools/seed-vc-venv/`.
Install the inference dependencies from `requirements-singing.txt` into that
environment. The local fully resolved dependency list is saved alongside it.

`stella-exact-voice-reference.wav` is a newly generated neutral speaking sample
from the exact voice ID in Stella's settings, verified in Fish's voice-details
link. This is a reference-conditioned experiment, not training or fine-tuning.
The source is the original isolated vocal performance, not a Fish-converted
recording. Neither file is uploaded by the local Seed-VC runner.

```sh
.local-data/tools/seed-vc-venv/bin/python audio-work/run-singing-conversion.py \
  --source .local-data/audio/original-song/original-isolated-vocals.wav \
  --reference .local-data/audio/original-song/stella-exact-voice-reference.wav \
  --output .local-data/audio/original-song/seed-vc --steps 40
```

The wrapper enables F0 conditioning, disables automatic pitch adjustment,
uses zero semitone shift and unchanged duration, and converts RMVPE's pitch
arrays to float32 for MPS compatibility. On MPS, BigVGAN synthesis runs on CPU
because its long transposed convolutions hit a GPU dimension limit on this Mac.
Intermediate mel chunks are saved locally before synthesis. The first GPU-only
attempt failed at that synthesis stage; it did not produce a usable preview.
The wrapper records the source/reference hashes,
upstream revision, backend, settings, elapsed time and success/failure. These
settings guide melody and timing; they do not guarantee perfect pronunciation
or naturalness. Listen to the result before considering app integration.

The first completed local run used 40 steps with GPU diffusion and CPU waveform
synthesis, taking about 282 seconds including model loading. Its 44.1 kHz mono
output is 19.992 seconds against a 20.000-second source. The finite-sample and
duration checks pass; this is not a listening-quality assessment. The MP3
audition file is `stella-seed-singing-preview.mp3`, with gain 0.85 for playback
headroom. The installed Stella app and its speech provider are unchanged.

User listening feedback preferred this Seed-VC preview substantially over the
earlier conversions ("10x better"), while noting some remaining robotic parts.
It is the preferred experimental baseline, recorded with its file hash in
`preferred-singing-baseline.json`. This does not imply approval of every phrase
or completion of automatic singing integration. Further comparisons should
retain this baseline and target the specific sections the user identifies.

A focused follow-up interpreted the user's timestamp as 0:15 in the preview.
It changed only `--guidance` from 0.7 to 1.0, retaining 40 steps, seed 1234,
and the full source and exact voice reference. The completed candidate is in
`seed-vc-focus-guidance-1/`. Level-matched listening clips cover 12–18 seconds;
the reported moment is about three seconds into each clip.
`compare-singing-pitch.py` compares local RMVPE estimates against the source.
Within 15.2–15.6 seconds, frames with an estimated error above 900 cents fell
from 15 to 12, but the octave-sized discrepancy remains. Pitch tracking can
confuse harmonics and is not a naturalness assessment. The preferred baseline
was preserved for comparison. The user subsequently accepted the revised take
despite minor remaining artifacts. `stella-accepted-singing-preview.mp3` and its
WAV are the accepted 20-second excerpt; `preferred-singing-baseline.json` records
its hashes and settings. The runner now defaults to guidance 1.0 with 40 steps
and seed 1234 for future conversions. Earlier outputs are retained. This accepts
the singing sound. Desktop playback is now connected through the Music panel,
floating Sing button, and direct “sing my song” requests. The accepted MP3 is
installed in the companion data directory as `singing/accepted-song.mp3`; it is
not bundled or committed. New conversions and full-song generation remain
separate from this saved-clip playback feature.

## Earlier short humming experiment

`render-be-kind.py` renders a short, wordless version of the opening two bars of
*Be Kind* (Marshmello & Halsey) from a newly generated sample of Stella's configured
Fish voice. The notes and rhythm were transcribed from the publicly displayed first-page
preview of [Musicnotes MN0210927](https://www.musicnotes.com/sheetmusic/marshmello-halsey/be-kind/MN0210927),
in E major at 94 BPM. This experiment contains no lyrics or source song recording.

The local Fish sample and rendered preview are in the ignored directory
`.local-data/audio/be-kind/`. Credentials are read through Electron safeStorage for
sample generation and are never written into this folder or the renderer.

Run `python3 audio-work/render-be-kind.py` after preparing `raw-hum.mp3` there.
The script selects a stable voiced segment, estimates its fundamental frequency,
uses FFmpeg's Rubber Band filter with formant preservation to render each note,
and applies fades and a conservative peak level. It writes `be-kind-hum.mp3`, a WAV,
and `analysis.json`. Requires `/opt/homebrew/bin/ffmpeg` with Rubber Band support.

The generated preview is approximately 5.43 seconds. Measured note centers were
within 6 cents of their intended pitches on the first successful render. This is
a technical pitch check, not a listening-quality or transcription-accuracy guarantee.
A fixed short sample may sound repetitive or processed. User listening feedback is
needed before adding this to Stella's app. The experiment does not change installed
Stella or enable automatic humming.
