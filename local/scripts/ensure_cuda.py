"""Ensure NVIDIA machines use a CUDA build, including existing CPU-only environments."""
import os
import shutil
import subprocess
import sys


def ensure_cuda(python=sys.executable):
    if os.name != 'nt':
        return
    if not shutil.which('nvidia-smi'):
        print('[DEVICE] No NVIDIA runtime detected; using CPU (Chinese TTS can be slow).', flush=True)
        return
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True)
    if gpu.returncode or not gpu.stdout.strip():
        return
    probe = 'import torch; assert torch.cuda.is_available(); x=torch.ones(8,device="cuda"); assert (x+x).sum().item()==16; print(torch.cuda.get_device_name(0))'
    result = subprocess.run([str(python), '-c', probe], capture_output=True, text=True)
    if result.returncode:
        print('[CUDA] NVIDIA GPU found; installing CUDA PyTorch (large first-time download).', flush=True)
        try:
            subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', 'torch==2.11.0', 'torchaudio==2.11.0', '--index-url', 'https://download.pytorch.org/whl/cu128'], check=True)
            subprocess.run([str(python), '-c', probe], check=True)
        except subprocess.CalledProcessError:
            print('[DEVICE] CUDA unavailable on this computer; restoring CPU runtime. Update NVIDIA drivers to enable GPU acceleration.', flush=True)
            subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', 'torch==2.11.0+cpu', 'torchaudio==2.11.0+cpu', '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
            subprocess.run([str(python), '-c', 'import torch, torchaudio; assert (torch.ones(8)+1).sum().item()==16'], check=True)
    else:
        print('[CUDA] ' + result.stdout.strip(), flush=True)


if __name__ == '__main__':
    ensure_cuda()
