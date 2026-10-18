"""Reproducible local CUDA TTS stage benchmark; does not change the running server."""
import os
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
import sys, json, time, contextlib, io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import torch
import numpy as np
from qwen_tts import Qwen3TTSModel
from qwen_audio import apply_speech_tempo
root=Path(__file__).resolve().parent.parent
config=json.loads((root/'.atc_qwen_runtime.json').read_text())
model=Qwen3TTSModel.from_pretrained(str(root/config['model_dir']),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
print('CONFIG',json.dumps({'torch':torch.__version__,'threads':torch.get_num_threads(),'interop':torch.get_num_interop_threads(),'device':str(next(model.model.parameters()).device),'attention':model.model.config._attn_implementation,'talker_attention':model.model.talker.config._attn_implementation,'predictor_attention':model.model.talker.code_predictor.config._attn_implementation}),flush=True)
timings={}
def wrap(obj,name,label):
 old=getattr(obj,name)
 def timed(*args,**kwargs):
  torch.cuda.synchronize(); t=time.perf_counter(); result=old(*args,**kwargs); torch.cuda.synchronize(); timings[label]=time.perf_counter()-t; return result
 setattr(obj,name,timed)
wrap(model.model,'generate','autoregressive_s')
wrap(model.model.speech_tokenizer,'decode','decode_s')
import argparse
parser=argparse.ArgumentParser(); parser.add_argument('--repeat',action='store_true'); args=parser.parse_args()
if args.repeat:
 torch.set_num_threads(4)
 with torch.inference_mode(): model.generate_custom_voice(text='收到，东方航空五两幺三。',language='Chinese',speaker='Vivian',max_new_tokens=1024)
for threads in ([4,16,4,16] if args.repeat else [torch.get_num_threads(),1,4]):
 torch.set_num_threads(threads)
 for text in (['东方航空五两幺三，下降六百米。'] if args.repeat else ['东方航空五两幺三，下降六百米。','东方航空五两幺三，右转航向零九零，下降到九百米，可以盲降跑道零九左。']):
  torch.manual_seed(42); torch.cuda.synchronize(); t=time.perf_counter()
  with torch.inference_mode(): wavs,sr=model.generate_custom_voice(text=text,language='Chinese',speaker='Vivian',max_new_tokens=1024)
  torch.cuda.synchronize(); generation=time.perf_counter()-t
  t=time.perf_counter(); audio=apply_speech_tempo(np.asarray(wavs[0]),sr,1.2); tempo=time.perf_counter()-t
  print('RESULT',json.dumps(dict(threads=threads,chars=len(text),generation_s=round(generation,3),tempo_s=round(tempo,3),audio_s=round(len(audio)/sr,3),**timings)),flush=True)
