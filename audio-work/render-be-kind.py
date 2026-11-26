"""Short local humming experiment, based on the opening two bars of MN0210927.
No song recording, lyrics, or Spotify audio is used. Requires ffmpeg with rubberband.
Run from the project root after generating .local-data/audio/be-kind/raw-hum.mp3.
"""
from pathlib import Path
import array, json, math, statistics, subprocess, wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local-data/audio/be-kind'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
RATE = 24000

def ffmpeg(*args):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)

def read_wav(path):
    with wave.open(str(path), 'rb') as f:
        assert f.getnchannels() == 1 and f.getsampwidth() == 2
        return array.array('h', f.readframes(f.getnframes())), f.getframerate()

def write_wav(path, samples, rate=RATE):
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate)
        f.writeframes(array.array('h', (int(max(-32767, min(32767, x))) for x in samples)).tobytes())

def pitch(samples, rate):
    # Normalized autocorrelation of a short downsampled vocal frame.
    y = list(samples[::3]); sr = rate / 3
    mean = sum(y) / len(y); y = [x - mean for x in y]
    scores = {}
    for lag in range(int(sr / 450), int(sr / 100)):
        a, b = y[:-lag], y[lag:]
        energy = math.sqrt(sum(x*x for x in a) * sum(x*x for x in b))
        scores[lag] = sum(x*z for x,z in zip(a,b)) / max(energy, 1)
    peaks = [l for l in scores if l-1 in scores and l+1 in scores and scores[l] >= scores[l-1] and scores[l] > scores[l+1]]
    if not peaks: return 0, 0
    best = max(scores[l] for l in peaks)
    lag = min(l for l in peaks if scores[l] >= max(.80, best-.045)) if best >= .80 else max(peaks, key=scores.get)
    l, c, r = scores[lag-1], scores[lag], scores[lag+1]
    delta = .5 * (l-r) / (l-2*c+r) if l-2*c+r else 0
    return sr / (lag + delta), c

ffmpeg('-i', OUT/'raw-hum.mp3', '-ac', '1', '-ar', RATE, OUT/'raw-hum.wav')
samples, rate = read_wav(OUT/'raw-hum.wav')
frames = []
window, hop = int(.06*RATE), int(.03*RATE)
for start in range(0, len(samples)-window, hop):
    chunk = samples[start:start+window]
    rms = math.sqrt(sum(x*x for x in chunk)/len(chunk))/32768
    if rms < .015: continue
    hz, confidence = pitch(chunk, RATE)
    if confidence > .85: frames.append((start/RATE, hz, confidence, rms))
# Select a stable 120 ms stretch, avoiding breaths and consonants.
candidates=[]
for frame in frames:
    t=frame[0]
    nearby=[f for f in frames if t <= f[0] <= t+.12]
    if len(nearby)<4: continue
    hz=statistics.median(f[1] for f in nearby)
    deviation=statistics.pstdev(12*math.log2(f[1]/hz) for f in nearby)
    candidates.append((deviation, t, hz, statistics.mean(f[2] for f in nearby)))
if not candidates: raise RuntimeError('No stable voiced segment; generate another source hum.')
deviation, start, hz, confidence=min(candidates)
if deviation>.4: raise RuntimeError('Source hum varies too much for this fixed-pitch prototype.')
source_length=.12
segment=samples[round(start*RATE):round((start+source_length)*RATE)]
write_wav(OUT/'steady-hum.wav', segment)

# E-major vocal line; one quarter = 94 BPM. Durations in quarter-note beats.
# First bar: eighth rest, eighth, sixteenth, sixteenth, eighth, repeated.
# Second bar: eighth rest, eighth, four sixteenths, two eighths,
# two sixteenths and an eighth. Nonlexical hum throughout.
notes=[(None,.5),(56,.5),(56,.25),(54,.25),(54,.5),
       (None,.5),(56,.5),(56,.25),(54,.25),(54,.5),
       (None,.5),(54,.5),(56,.25),(54,.25),(56,.25),(54,.25),
       (56,.5),(56,.5),(56,.25),(54,.25),(56,.5)]
assert sum(d for _,d in notes)==8
beat=60/94
result=[0]*round(.12*RATE)
measurements=[]
cache={}
for midi, beats in notes:
    duration=beats*beat; count=round(duration*RATE)
    if midi is None:
        result.extend([0]*count); continue
    target=440*2**((midi-69)/12)
    key=(midi,beats)
    if key not in cache:
        p=OUT/f'note-{midi}-{beats}.wav'
        # Preserve vocal formants while changing pitch; gentle rearticulation.
        voiced=duration-.012
        ffmpeg('-i', OUT/'steady-hum.wav', '-af',
            f'rubberband=tempo={source_length/voiced}:pitch={target/hz}:formant=preserved:pitchq=quality,apad,atrim=duration={voiced}',
            '-ac', '1', '-ar', RATE, p)
        chunk,_=read_wav(p); chunk=list(chunk[:count])
        fade=min(round(.018*RATE),len(chunk)//4)
        for i in range(fade):
            gain=math.sin(math.pi*.5*i/fade)**2
            chunk[i]*=gain; chunk[-i-1]*=gain
        chunk += [0]*max(0,count-len(chunk))
        cache[key]=chunk
        mid=len(chunk)//2
        actual,conf=pitch(chunk[mid-window//2:mid+window//2],RATE)
        measurements.append({'midi':midi,'beats':beats,'target_hz':round(target,2),'measured_hz':round(actual,2),'cents_error':round(1200*math.log2(actual/target),1),'confidence':round(conf,3)})
    result.extend(cache[key])
result.extend([0]*round(.2*RATE))
peak=max(abs(x) for x in result)
result=[x/peak*32767*.32 for x in result]
write_wav(OUT/'be-kind-hum.wav',result)
ffmpeg('-i',OUT/'be-kind-hum.wav','-codec:a','libmp3lame','-q:a','2',OUT/'be-kind-hum.mp3')
report={'source':'https://www.musicnotes.com/sheetmusic/marshmello-halsey/be-kind/MN0210927',
        'excerpt':'Opening two bars, nonlexical vocal line','bpm':94,'duration_seconds':round(len(result)/RATE,3),
        'source_segment_seconds':round(start,3),'source_pitch_hz':round(hz,2),'source_pitch_deviation_semitones':round(deviation,3),
        'notes':measurements,'limitations':'Experimental fixed-sample pitch shifting, not a singing model; no perceptual validation yet.'}
(OUT/'analysis.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
