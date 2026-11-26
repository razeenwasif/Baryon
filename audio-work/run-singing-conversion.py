"""Local Seed-VC singing experiment; leaves the installed Stella app unchanged."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / '.local-data/tools/seed-vc'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--steps', type=int, default=40)
    parser.add_argument('--guidance', type=float, default=1.0)
    parser.add_argument('--seed', type=int, default=1234)
    args = parser.parse_args()
    source, reference, output = (p.resolve() for p in (args.source, args.reference, args.output))
    if not source.is_file() or not reference.is_file():
        parser.error('Source and reference must be existing audio files.')
    if not 1 <= args.steps <= 100:
        parser.error('Steps must be between 1 and 100.')
    if not 0 <= args.guidance <= 2:
        parser.error('Guidance must be between 0 and 2.')
    output.mkdir(parents=True, exist_ok=True)
    # Keep model caches in the ignored experiment directory.
    os.environ.setdefault('HF_HOME', str(UPSTREAM / 'checkpoints/hf_home'))
    os.environ.setdefault('TORCH_HOME', str(UPSTREAM / 'checkpoints/torch'))
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    os.environ.setdefault('DO_NOT_TRACK', '1')
    os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
    os.chdir(UPSTREAM)
    sys.path.insert(0, str(UPSTREAM))
    import numpy as np
    import torch
    import inference

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(4)
    # Upstream RMVPE returns float64 arrays; MPS requires float32.
    original_loader = inference.load_models

    def load_models(config):
        bundle = list(original_loader(config))
        original_f0 = bundle[2]
        bundle[2] = lambda *a, **kw: np.asarray(original_f0(*a, **kw), dtype=np.float32)
        if inference.device.type == 'mps':
            # BigVGAN's long transposed convolutions exceed MPS's supported
            # dimensions on this Mac. Keep diffusion on GPU, synthesize on CPU.
            cpu_vocoder = bundle[3].to('cpu')
            chunk_number = 0

            def synthesize(mel):
                nonlocal chunk_number
                cpu_mel = mel.detach().float().cpu()
                torch.save(cpu_mel, output / f'mel-chunk-{chunk_number:03d}.pt')
                chunk_number += 1
                print(f'Synthesizing chunk {chunk_number} on CPU...', flush=True)
                return cpu_vocoder(cpu_mel).to(inference.device)

            bundle[3] = synthesize
            torch.mps.empty_cache()
        return tuple(bundle)

    inference.load_models = load_models
    config = argparse.Namespace(
        source=str(source), target=str(reference), output=str(output),
        diffusion_steps=args.steps, length_adjust=1.0, inference_cfg_rate=args.guidance,
        f0_condition=True, auto_f0_adjust=False, semi_tone_shift=0,
        checkpoint=None, config=None, fp16=False,
    )
    report = {
        'converter': 'Seed-VC 44.1 kHz singing model',
        'upstream_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'source': str(source), 'reference': str(reference),
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'reference_sha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
        'settings': vars(config), 'seed': args.seed, 'device': str(inference.device),
        'vocoder_device': 'cpu' if inference.device.type == 'mps' else str(inference.device),
        'status': 'running', 'listening_quality': 'Not evaluated',
    }
    report_path = output / 'conversion.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Starting singing conversion on {inference.device}; original pitch and timing retained as conditions.', flush=True)
    started = time.monotonic()
    try:
        inference.main(config)
        report['status'] = 'completed'
        report['outputs'] = [str(p) for p in output.glob('*.wav')]
    except Exception as exc:
        report['status'] = 'failed'
        report['error'] = str(exc)
        raise
    finally:
        report['elapsed_seconds'] = round(time.monotonic() - started, 2)
        report_path.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
