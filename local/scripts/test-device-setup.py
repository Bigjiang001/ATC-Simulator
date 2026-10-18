"""Device selection regression tests without requiring different physical GPUs."""
import subprocess
import unittest
from unittest.mock import patch
import ensure_cuda

class DeviceSetupTests(unittest.TestCase):
    def test_no_nvidia_uses_cpu_without_install(self):
        with patch.object(ensure_cuda.os, 'name', 'nt'), patch.object(ensure_cuda.shutil, 'which', return_value=None), patch.object(ensure_cuda.subprocess, 'run') as run:
            ensure_cuda.ensure_cuda('python')
            run.assert_not_called()

    def test_working_cuda_does_not_reinstall(self):
        result = subprocess.CompletedProcess([], 0, 'NVIDIA GPU', '')
        with patch.object(ensure_cuda.os, 'name', 'nt'), patch.object(ensure_cuda.shutil, 'which', return_value='nvidia-smi'), patch.object(ensure_cuda.subprocess, 'run', return_value=result) as run:
            ensure_cuda.ensure_cuda('python')
            self.assertEqual(run.call_count, 2)

    def test_failed_cuda_restores_cpu(self):
        ok = subprocess.CompletedProcess([], 0, 'NVIDIA GPU', '')
        failed = subprocess.CompletedProcess([], 1, '', 'unavailable')
        responses = [ok, failed, subprocess.CalledProcessError(1, 'pip'), ok, ok]
        with patch.object(ensure_cuda.os, 'name', 'nt'), patch.object(ensure_cuda.shutil, 'which', return_value='nvidia-smi'), patch.object(ensure_cuda.subprocess, 'run', side_effect=responses) as run:
            ensure_cuda.ensure_cuda('python')
            self.assertIn('torch==2.11.0+cpu', run.call_args_list[3].args[0])
            self.assertEqual(run.call_count, 5)

if __name__ == '__main__':
    unittest.main()
