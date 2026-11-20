"""Regenerate the bundled detection prompts with the recovered local Piper voice."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
piper = root / '.tools/piper'
for key, text in {
    'missing': '暂未检测到人脸，试着把手机拿远一点。',
    'one-face': '目前只确认到一张脸，另一位稍转向镜头。',
    'manual-shot': '双人检测暂未成功，可直接按快门或用三秒倒计时。',
}.items():
    subprocess.run([
        str(piper / 'piper.exe'), '--model', str(piper / 'huayan.onnx'),
        '--output_file', str(root / 'web/audio' / (key + '.wav')),
    ], input=(text + '\n').encode('utf-8'), cwd=piper, check=True)
