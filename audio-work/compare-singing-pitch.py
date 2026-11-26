"""Estimate source/output pitch differences; this is not a listening-quality score."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / '.local-data/tools/seed-vc'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--start', type=float, default=15.2)
    parser.add_argument('--end', type=float, default=15.6)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.start < 0 or args.end <= args.start:
        parser.error('Choose an increasing, nonnegative time interval.')
    import numpy as np
    import librosa
    import torch
    sys.path.insert(0, str(UPSTREAM))
    from modules.rmvpe import RMVPE
    torch.set_num_threads(4)
    checkpoint = next((UPSTREAM / 'checkpoints').rglob('rmvpe.pt'))
    estimator = RMVPE(str(checkpoint), is_half=False, device='cpu')
    tracks, inputs = {}, {}
    for name, path in [('source', args.source), ('baseline', args.baseline), ('candidate', args.candidate)]:
        audio, _ = librosa.load(path, sr=16000)
        tracks[name] = np.asarray(estimator.infer_from_audio(torch.from_numpy(audio), thred=.03))
        inputs[name] = {'file': str(path.resolve()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    source = tracks['source']
    report = {
        'estimator': 'RMVPE', 'frame_seconds': .01,
        'caveat': 'Pitch estimators can confuse harmonics; pronunciation and naturalness require listening.',
        'focus_seconds': [args.start, args.end], 'inputs': inputs,
        'tracks_hz': {k: v.tolist() for k, v in tracks.items()}, 'comparison': {},
    }
    for label in ['baseline', 'candidate']:
        n = min(len(source), len(tracks[label]))
        t = np.arange(n) * .01
        src, dst = source[:n], tracks[label][:n]
        for region, window in [('focus', (t >= args.start) & (t < args.end)), ('whole_clip', np.ones(n, dtype=bool))]:
            voiced = window & (src > 65) & (dst > 65)
            cents = 1200 * np.log2(dst[voiced] / src[voiced])
            report['comparison'][f'{label}_{region}'] = {
                'voiced_comparison_frames': int(voiced.sum()),
                'median_absolute_cents': float(np.median(np.abs(cents))) if len(cents) else None,
                'p90_absolute_cents': float(np.percentile(np.abs(cents), 90)) if len(cents) else None,
                'large_pitch_difference_frames': int((np.abs(cents) > 900).sum()),
            }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['comparison'], indent=2))


if __name__ == '__main__':
    main()
