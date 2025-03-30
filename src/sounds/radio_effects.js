// 塔台无线电效果处理工具
class AirTrafficRadioEffects {
  constructor() {
    this.audioContext = null;
    this.initialized = false;
  }

  // 初始化音频上下文
  init() {
    if (this.initialized) return true;
    
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API is not supported in this browser');
        return false;
      }
      
      this.audioContext = new AudioContext();
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('Failed to initialize Audio Context:', e);
      return false;
    }
  }

  // 创建失真曲线
  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    
    for (let i = 0; i < n_samples; i++) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // 添加静电噪音
  addRadioNoise(duration = 500, volume = 0.05) {
    if (!this.initialized && !this.init()) {
      return null;
    }
    
    try {
      // 创建音频处理节点
      const bufferSize = 4096;
      let noiseProcessor;
      
      // 尝试使用不同的API方法创建处理器节点
      if (this.audioContext.createScriptProcessor) {
        noiseProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        // 生成静电噪音
        noiseProcessor.onaudioprocess = (e) => {
          const output = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            // 基础静电噪音
            output[i] = (Math.random() * 2 - 1) * volume;
            
            // 随机添加噼啪声和爆音
            if (Math.random() > 0.995) {
              output[i] = Math.random() > 0.5 ? volume * 2 : -volume * 2;
            }
          }
        };
      } else if (this.audioContext.createGain) {
        // 备用方案：使用增益节点和振荡器
        noiseProcessor = this.audioContext.createGain();
        noiseProcessor.gain.value = volume * 0.3;
        
        const noiseSource = this.audioContext.createBufferSource();
        const noiseBuffer = this.audioContext.createBuffer(1, 32768, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < 32768; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        noiseSource.connect(noiseProcessor);
        noiseSource.start();
        
        setTimeout(() => {
          noiseSource.stop();
        }, duration);
      } else {
        return null;
      }
      
      // 连接噪音到输出
      noiseProcessor.connect(this.audioContext.destination);
      
      // 设置定时器停止噪音
      setTimeout(() => {
        noiseProcessor.disconnect();
      }, duration);
      
      return noiseProcessor;
    } catch (e) {
      console.error('Failed to create radio noise:', e);
      return null;
    }
  }

  // 播放开始通信的哔声
  playBeep(frequency = 1000, duration = 200, volume = 0.1) {
    if (!this.initialized && !this.init()) {
      return null;
    }
    
    try {
      // 创建振荡器和增益节点
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      // 设置振荡器参数
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      
      // 连接节点
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // 设置音量和开始播放
      gainNode.gain.value = volume;
      oscillator.start();
      
      // 设置淡出效果
      setTimeout(() => {
        gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);
        
        // 停止振荡器
        setTimeout(() => {
          oscillator.stop();
        }, 100);
      }, duration - 100);
      
      return oscillator;
    } catch (e) {
      console.error('Failed to play beep:', e);
      return null;
    }
  }

  // 完整的无线电通信效果
  async applyRadioEffectToSpeech(text, options = {}) {
    if (!this.initialized && !this.init()) {
      // 回退到普通语音合成
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || "en-US";
      utterance.pitch = options.pitch || 1;
      utterance.rate = options.rate || 1;
      window.speechSynthesis.speak(utterance);
      return new Promise((resolve) => {
        utterance.onend = resolve;
      });
    }
    
    try {
      // 创建语音合成实例
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || "en-US";
      utterance.pitch = options.pitch || 1;
      utterance.rate = options.rate || 1;
      
      // 取消任何正在进行的语音
      window.speechSynthesis.cancel();
      
      return new Promise((resolve) => {
        // 添加初始静电噪音
        this.addRadioNoise(300, 0.03);
        
        // 播放语音
        setTimeout(() => {
          window.speechSynthesis.speak(utterance);
          
          // 语音结束后的效果
          utterance.onend = () => {
            // 添加结束静电噪音
            this.addRadioNoise(300, 0.03);
            setTimeout(resolve, 300);
          };
        }, 300);
      });
    } catch (e) {
      console.error('Failed to apply radio effect:', e);
      
      // 回退到普通语音合成
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || "en-US";
      utterance.pitch = options.pitch || 1;
      utterance.rate = options.rate || 1;
      window.speechSynthesis.speak(utterance);
      
      return Promise.resolve();
    }
  }
}

// 导出单例实例
export const radioEffects = new AirTrafficRadioEffects(); 