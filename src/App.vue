<template>
  <div id="app" tabindex="0" :class="{ 'touch-ui': isTouchDevice }">
    <div class="controls-container">
      <div class="sector-title">
        <span class="scope-name">{{ airport.name }}</span>
        <span class="scope-subtitle">{{ airport.subtitle }}</span>
      </div>
      <!-- 游戏控制按钮 -->
      <div class="game-controls">
        <div class="transport-controls" role="group" aria-label="Game controls">
          <button class="start-control" @click="startGame" :disabled="gameStatus === 'running'">Start</button>
          <button class="pause-control" @click="pauseGame" :disabled="gameStatus !== 'running'">Pause</button>
          <button class="end-control" @click="endGame" :disabled="gameStatus === 'ended'">End</button>
        </div>
        <button
          class="settings-toggle"
          type="button"
          title="Simulation settings"
          aria-label="Simulation settings"
          :aria-expanded="settingsOpen"
          @click.stop="toggleSettings"
        >
          <span class="settings-icon" aria-hidden="true">&#9881;</span>
          <span class="settings-label">Settings</span>
        </button>
      </div>

      <div v-if="settingsOpen" class="settings-panel" role="dialog" aria-label="Simulation settings" @click.stop>
        <div class="settings-heading">
          <span>Simulation settings</span>
          <button type="button" class="settings-close" aria-label="Close settings" title="Close settings" @click="closeSettings">&times;</button>
        </div>
        <div class="settings-grid">
          <label class="difficulty-select">
            <span>Difficulty</span>
            <select v-model="difficulty" :disabled="gameStatus === 'running'">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
              <option value="expert">Expert</option>
            </select>
          </label>

          <label class="airport-select">
            <span>Radar sector</span>
            <select v-model="selectedAirportId" :disabled="gameStatus === 'running'" @change="changeAirport">
              <option v-for="option in airports" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
          </label>

          <div class="speed-control">
            <span>Simulation speed</span>
            <div class="speed-segments" role="group" aria-label="Simulation speed">
              <button @click="setSpeedLevel(0.5)" :class="{ active: speedLevel === 0.5 }">0.5x</button>
              <button @click="setSpeedLevel(1)" :class="{ active: speedLevel === 1 }">1x</button>
              <button @click="setSpeedLevel(1.5)" :class="{ active: speedLevel === 1.5 }">1.5x</button>
              <button @click="setSpeedLevel(2)" :class="{ active: speedLevel === 2 }">2x</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="radar-container">
      <!-- 雷达屏幕 -->
    <canvas
      ref="radarCanvas"
      data-testid="radar-canvas"
      :data-airport-id="airport.id"
      :data-game-status="gameStatus"
      :data-score="score"
      :data-last-touchdown-altitude="lastTouchdownAltitude ?? ''"
      :data-game-over="isGameOver"
      :data-game-over-reason="gameOverReason"
      :data-repeat-approach-preserved="repeatApproachPreserved ?? ''"
      :data-aircraft-state="aircraftTestState"
      :data-incoming-state="incomingTestState"
      :data-speech-voice="preferredSpeechVoiceName"
      :data-touch-ui="isTouchDevice"
      width="1800"
        height="1200"
      @mousedown="startDrag"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @pointerdown="startPointerDrag"
      @pointermove="movePointerDrag"
      @pointerup="endPointerDrag"
      @pointercancel="cancelPointerDrag"
    ></canvas>

      <!-- 通话记录窗口 - 修改为可滚动，最新消息在顶部 -->
      <div class="comm-container">
        <div ref="communicationLog" class="communication-log">
          <div v-for="(message, index) in allCommunicationLog" :key="index" class="log-entry">
            {{ message }}
          </div>
        </div>

        <!-- 添加语音通话按钮 -->
        <div class="voice-command-container">
          <div class="voice-panel">
            <div class="voice-status">{{ displayVoiceStatusText }}</div>
            <div v-if="voiceCommandText" class="recognized-text">{{ voiceCommandText }}</div>
          </div>
          <button
            @mousedown="startVoiceCommand"
            @mouseup="stopVoiceCommand"
            @mouseleave="stopVoiceCommand"
            @pointerdown="startTalkPointer"
            @pointerup="endTalkPointer"
            @pointercancel="endTalkPointer"
            :class="{ 'active': isRecording }"
            class="voice-command-button"
          >
            Talk
      </button>
          <div v-if="isRecording" class="recording-indicator">Recording...</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
  background:
    radial-gradient(circle at 50% 45%, rgba(27, 109, 97, 0.2), transparent 36%),
    linear-gradient(135deg, #020607 0%, #071113 45%, #030708 100%);
  color: #8fffe6;
  font-family: "SFMono-Regular", "Cascadia Mono", "Roboto Mono", monospace;
}
#app {
  position: relative;
  min-height: 100vh;
  padding:
    max(14px, env(safe-area-inset-top))
    max(14px, env(safe-area-inset-right))
    max(14px, env(safe-area-inset-bottom))
    max(14px, env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
}
.controls-container {
  position: relative;
  width: 100%;
  max-width: 1800px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: rgba(3, 22, 24, 0.82);
  border: 1px solid rgba(0, 255, 204, 0.38);
  box-shadow: 0 0 24px rgba(0, 255, 204, 0.08), inset 0 0 28px rgba(0, 255, 204, 0.05);
  box-sizing: border-box;
}
.sector-title {
  display: flex;
  flex-direction: column;
  flex: 1 1 300px;
  min-width: 240px;
  text-transform: uppercase;
}
.scope-name {
  color: #e7fff8;
  font-size: 18px;
  font-weight: 700;
}
.scope-subtitle {
  color: rgba(143, 255, 230, 0.64);
  font-size: 12px;
  letter-spacing: 0;
}
.radar-container {
  position: relative;
  width: 100%;
  max-width: 1800px;
}
canvas {
  border: 1px solid rgba(0, 255, 204, 0.56);
  background: #061212;
  box-shadow:
    0 0 0 1px rgba(188, 255, 238, 0.08),
    0 20px 80px rgba(0, 0, 0, 0.45),
    inset 0 0 80px rgba(0, 255, 204, 0.06);
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 3 / 2;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.command-box {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  background-color: #001010;
  color: #00ffcc;
  padding: 10px 20px;
  font-size: 18px;
  border: 1px solid #00ffcc;
  border-radius: 8px;
  z-index: 10;
}
.speed-control {
  color: #8fffe6;
  z-index: 10;
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 6px;
}
.speed-control span {
  margin-right: 4px;
}
.speed-segments {
  display: grid;
  grid-template-columns: repeat(4, 48px);
  border: 1px solid rgba(0, 255, 204, 0.45);
  border-radius: 3px;
  overflow: hidden;
}
.speed-control button {
  margin: 0;
  background: rgba(0, 32, 34, 0.9);
  border: 0;
  border-right: 1px solid rgba(0, 255, 204, 0.28);
  color: #8fffe6;
  padding: 5px 6px;
  cursor: pointer;
  width: 48px;
}
.speed-control button:last-child {
  border-right: 0;
}
.speed-control button.active {
  background-color: #8fffe6;
  color: #031112;
}
/* 游戏控制按钮样式 */
.game-controls {
  z-index: 10;
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
}
.transport-controls {
  display: contents;
}
.game-controls button {
  background: linear-gradient(180deg, rgba(13, 48, 49, 0.95), rgba(2, 19, 21, 0.95));
  border: 1px solid rgba(0, 255, 204, 0.48);
  color: #d9fff7;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 3px;
  text-transform: uppercase;
}
.game-controls button.start-control:not(:disabled) {
  border-color: rgba(89, 255, 190, 0.72);
}
.game-controls button.pause-control:not(:disabled) {
  border-color: rgba(255, 208, 92, 0.72);
  color: #fff0bd;
}
.game-controls button.end-control:not(:disabled) {
  border-color: rgba(255, 115, 115, 0.68);
  color: #ffd2d2;
}
.settings-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 44px;
}
.settings-icon {
  font-size: 19px;
  line-height: 1;
}
.settings-panel {
  position: absolute;
  z-index: 80;
  top: calc(100% + 7px);
  right: 12px;
  width: min(540px, calc(100% - 24px));
  padding: 11px;
  border: 1px solid rgba(0, 255, 204, 0.58);
  border-radius: 4px;
  background: rgba(2, 18, 20, 0.97);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.58), inset 0 0 30px rgba(0, 255, 204, 0.04);
  box-sizing: border-box;
}
.settings-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  margin-bottom: 9px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(143, 255, 230, 0.18);
  color: #e7fff8;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
.settings-close {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8fffe6;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.settings-grid {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(250px, 1.2fr);
  gap: 10px;
}
.settings-panel .difficulty-select,
.settings-panel .airport-select,
.settings-panel .speed-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 5px;
  min-width: 0;
  color: rgba(143, 255, 230, 0.76);
  font-size: 11px;
  text-transform: uppercase;
}
.settings-panel .difficulty-select select,
.settings-panel .airport-select select {
  width: 100%;
  max-width: none;
  min-width: 0;
}
.settings-panel .speed-control {
  grid-column: 1 / -1;
}
.settings-panel .speed-control > span {
  margin: 0;
}
.settings-panel .speed-segments {
  width: 100%;
  max-width: none;
  grid-template-columns: repeat(4, minmax(44px, 1fr));
}
.settings-panel .speed-control button {
  width: auto;
  min-height: 36px;
}

button,
select {
  touch-action: manipulation;
}

#app.touch-ui .game-controls button,
#app.touch-ui .difficulty-select select,
#app.touch-ui .airport-select select,
#app.touch-ui .speed-control button,
#app.touch-ui .voice-command-button {
  min-height: 44px;
}
.game-controls button:hover {
  background-color: rgba(0, 255, 204, 0.18);
  box-shadow: 0 0 16px rgba(0, 255, 204, 0.16);
}
.game-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 添加难度选择下拉菜单样式 */
.difficulty-select, .language-select, .airport-select {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #8fffe6;
}

.difficulty-select select, .language-select select, .airport-select select {
  background-color: #031719;
  color: #d9fff7;
  border: 1px solid rgba(0, 255, 204, 0.5);
  border-radius: 3px;
  padding: 5px;
  cursor: pointer;
  max-width: 260px;
}

.difficulty-select select:disabled, .language-select select:disabled, .airport-select select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.difficulty-select select option, .language-select select option, .airport-select select option {
  background-color: #001010;
  color: #00ffcc;
}

/* 将语言选择器放在难度选择器右侧 */
.language-select {
  margin-left: 15px;
}

/* 修改通话记录窗口样式，支持滚动，最新消息在顶部 */
.comm-container {
  position: relative;
  width: 100%;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
}

.communication-log {
  position: relative;
  width: 100%; /* 恢复原来的窗口大小 */
  background-color: rgba(2, 17, 19, 0.88);
  border: 1px solid rgba(0, 255, 204, 0.42);
  border-radius: 4px;
  padding: 10px;
  color: #bfffee;
  max-height: 120px;
  overflow-y: auto;
  z-index: 20;
  box-sizing: border-box;
  display: flex;
  flex-direction: column; /* 最新消息显示在顶部 */
  align-items: flex-start; /* 让内容左对齐 */
}

.log-entry {
  margin: 5px 0;
  line-height: 1.5;
  min-height: 1.5em;
  width: 100%; /* 确保条目占满整行 */
  text-align: left; /* 确保文本左对齐 */
}

/* 添加语音通话按钮样式 */
.voice-command-container {
  position: absolute;
  bottom: 10px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 30;
}

.voice-command-button {
  background-color: #062c2d;
  border: 2px solid rgba(0, 255, 204, 0.75);
  color: #e7fff8;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: bold;
  width: 66px;
  height: 40px;
  border-radius: 3px;
  cursor: pointer;
  outline: none;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-command-button:hover {
  background-color: #075254;
}

.voice-command-button.active {
  background-color: #ff4747;
  border-color: #ffb1b1;
  color: #fff;
  transform: scale(1.1);
}

.recording-indicator {
  color: #ff3333;
  font-weight: bold;
  animation: blink 1s infinite;
  position: absolute;
  top: -20px;
  right: 0;
}

.recognized-text {
  color: #e7fff8;
  max-width: 300px; /* 增加最大宽度，防止文本显示不完整 */
  white-space: normal; /* 允许文本换行 */
  overflow: visible; /* 不裁剪溢出的内容 */
  text-overflow: initial; /* 不使用省略号 */
  text-align: left; /* 文本左对齐 */
  word-wrap: break-word; /* 允许长单词换行 */
}

.voice-panel {
  min-width: 260px;
  max-width: 380px;
  padding: 8px 10px;
  background: rgba(0, 10, 12, 0.84);
  border: 1px solid rgba(0, 255, 204, 0.35);
  border-radius: 4px;
  box-sizing: border-box;
}

.voice-status {
  color: rgba(143, 255, 230, 0.68);
  font-size: 11px;
  text-transform: uppercase;
  margin-bottom: 3px;
}

@keyframes blink {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}

/* 添加滚动条样式 */
.communication-log::-webkit-scrollbar {
  width: 8px;
}
.communication-log::-webkit-scrollbar-track {
  background: rgba(0, 16, 16, 0.5);
}
.communication-log::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 204, 0.5);
  border-radius: 4px;
}
.communication-log::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 255, 204, 0.7);
}

.keyboard-hint {
  position: absolute;
  bottom: -20px;
  right: 0;
  font-size: 12px;
  color: #00ffcc;
  opacity: 0.7;
}

@media (max-width: 980px) {
  #app {
    padding:
      max(8px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
  }

  .controls-container {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto;
    align-items: stretch;
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px;
  }

  .sector-title {
    align-self: center;
    min-width: 0;
  }

  .game-controls {
    width: auto;
    gap: 8px;
  }

  .speed-control {
    flex-wrap: wrap;
    width: 100%;
    justify-content: space-between;
  }

  .game-controls button,
  .difficulty-select select,
  .airport-select select,
  .speed-control button,
  .voice-command-button {
    min-height: 42px;
  }

  .speed-segments {
    flex: 1 1 220px;
    grid-template-columns: repeat(4, minmax(44px, 1fr));
    max-width: 320px;
  }

  .speed-control button {
    width: auto;
  }

  .voice-command-container {
    position: relative;
    right: auto;
    bottom: auto;
    margin-top: 10px;
    justify-content: flex-end;
  }
}

@media (max-width: 600px) {
  #app {
    padding:
      max(4px, env(safe-area-inset-top))
      max(4px, env(safe-area-inset-right))
      max(4px, env(safe-area-inset-bottom))
      max(4px, env(safe-area-inset-left));
  }

  .controls-container {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 7px;
  }

  .scope-name {
    overflow: hidden;
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .scope-subtitle {
    display: none;
  }

  .game-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 46px;
    gap: 7px;
  }

  .transport-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid rgba(0, 255, 204, 0.44);
    border-radius: 4px;
    background: rgba(0, 255, 204, 0.24);
  }

  .transport-controls .start-control,
  .transport-controls .pause-control,
  .transport-controls .end-control {
    width: 100%;
    min-width: 48px;
    padding: 6px 4px;
    border: 0;
    border-radius: 0;
    min-width: 0;
  }

  .settings-toggle {
    width: 46px;
    padding: 0;
  }

  .settings-label {
    display: none;
  }

  .settings-panel {
    top: calc(100% + 5px);
    right: 7px;
    width: calc(100% - 14px);
    padding: 9px;
  }

  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 9px;
  }

  .settings-panel .speed-control {
    grid-column: auto;
  }

  .game-controls > .difficulty-select,
  .game-controls > .airport-select {
    min-width: 0;
    min-height: 48px;
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 8px;
    padding: 4px 5px 4px 10px;
    border: 1px solid rgba(143, 255, 230, 0.2);
    border-radius: 4px;
    background: rgba(2, 27, 29, 0.72);
    box-sizing: border-box;
  }

  .difficulty-select select,
  .airport-select select {
    flex: 1;
    min-width: 0;
    max-width: none;
  }

  .speed-control {
    align-items: stretch;
    gap: 7px;
    padding-top: 2px;
  }

  .speed-control > span {
    width: 100%;
    color: rgba(143, 255, 230, 0.7);
    font-size: 11px;
    text-transform: uppercase;
  }

  .speed-segments {
    width: 100%;
    max-width: none;
  }

  .communication-log {
    max-height: 88px;
    padding: 7px;
    font-size: 11px;
  }

  .voice-command-container {
    width: 100%;
    gap: 6px;
  }

  .voice-panel {
    flex: 1;
    min-width: 0;
    max-width: none;
  }
}

@media (max-width: 420px) {
  .scope-name {
    font-size: 11px;
  }

  .game-controls {
    grid-template-columns: minmax(0, 1fr) 44px;
    gap: 4px;
  }

  .transport-controls .start-control,
  .transport-controls .pause-control,
  .transport-controls .end-control {
    min-width: 44px;
    font-size: 11px;
  }

  .settings-toggle {
    width: 44px;
  }
}

@media (max-width: 980px) and (orientation: landscape) and (max-height: 600px) {
  .controls-container {
    display: grid;
    grid-template-columns: minmax(150px, 0.7fr) minmax(0, 2fr);
  }

  .sector-title {
    align-self: center;
  }

  .game-controls {
    display: flex;
    flex-wrap: wrap;
  }

  .game-controls button,
  .difficulty-select select,
  .airport-select select,
  .speed-control button {
    min-height: 36px;
  }

  .speed-control {
    grid-column: 1 / -1;
  }

  .comm-container {
    margin-top: 6px;
  }
}

@media (pointer: coarse) {
  .game-controls button,
  .difficulty-select select,
  .airport-select select,
  .speed-control button,
  .voice-command-button {
    min-height: 44px;
  }
}

@media (min-width: 601px) and (max-width: 1180px) {
  #app.touch-ui .controls-container {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto;
    align-items: center;
    gap: 8px;
  }

  #app.touch-ui .sector-title,
  #app.touch-ui .speed-control {
    width: 100%;
    min-width: 0;
  }

  #app.touch-ui .game-controls {
    width: auto;
    min-width: 0;
  }

  #app.touch-ui .game-controls {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) auto;
    gap: 8px;
  }

  #app.touch-ui .transport-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid rgba(0, 255, 204, 0.44);
    border-radius: 4px;
    background: rgba(0, 255, 204, 0.24);
  }

  #app.touch-ui .transport-controls button {
    width: 100%;
    min-width: 0;
    border: 0;
    border-radius: 0;
  }

  #app.touch-ui .game-controls button,
  #app.touch-ui .difficulty-select select,
  #app.touch-ui .airport-select select,
  #app.touch-ui .speed-control button,
  #app.touch-ui .voice-command-button {
    min-height: 44px;
  }

  #app.touch-ui .difficulty-select,
  #app.touch-ui .airport-select {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 7px;
    padding-left: 9px;
    border: 1px solid rgba(143, 255, 230, 0.2);
    border-radius: 4px;
    background: rgba(2, 27, 29, 0.72);
  }

  #app.touch-ui .difficulty-select select,
  #app.touch-ui .airport-select select {
    flex: 1;
    min-width: 0;
    max-width: none;
  }

  #app.touch-ui .speed-control {
    justify-content: flex-start;
  }
}
</style>
<script>
import airplaneImg from './assets/airplane.png';
import { generateRandomFlightNumber } from './utils/flightUtils';
import {
  buildSmoothApproachTrajectory,
  canRotateForTakeoff,
  getFinalApproachDistance,
  getGroundWaitTimeout,
  getAircraftStatusTag,
  getCoarsePointerHitRadius,
  getApproachPoseAtDistance,
  getLandingRollTargetDistance,
  getMovementDistance,
  getNextAltitude,
  getNextValue,
  getRequiredVerticalRate,
  getScaledCanvasPoint,
  getRunwayTravelProgress,
  getTurnStep,
  isAircraftConflict,
  isPointInPolygon,
  shouldRemoveLandedAircraft,
  updateLandingRollProgress,
  vectorToHeading,
} from './utils/gameRules.js';
import { extractAltitude, extractBeaconId, extractHeading, extractProcedureId, extractRunwayId, extractSpeed, normalizeVoiceCommand } from './utils/voiceCommandParser.js';
import { selectOriginalYoungSpeechVoice, selectPreferredSpeechVoice } from './utils/speechVoice.js';
import { radioEffects } from './sounds/radio_effects.js';
import { AIRPORTS, DEFAULT_AIRPORT } from './data/airports.js';

// Adding constant for English mode
const isEnglish = true; // English is now the only supported language

let flightCounter = 1000;

export default {
  data() {
    return {
      ctx: null,
      airplaneImage: null,
      airplanes: [],
      selectedPlane: null,
      dragging: false,
      activePointerId: null,
      activeTalkPointerId: null,
      isTouchDevice: import.meta.env.DEV && new URLSearchParams(window.location.search).has('touch'),
      dragLine: null,
      speedLevel: 1, // 标准速度
      settingsOpen: false,
      dragFollowing: null,
      communicationLog: ['', '', '', ''],
      allCommunicationLog: ['', '', '', ''],
      gameStatus: 'start',
      testScenario: import.meta.env.DEV ? (new URLSearchParams(window.location.search).get('test') || '') : '',
      testMode: import.meta.env.DEV && new URLSearchParams(window.location.search).has('test'),
      repeatApproachPreserved: null,
      testAircraftSpawned: false,
      gameLoopId: null,
      lastRenderTime: 0,
      spawnApproachInterval: null,
      spawnDepartureInterval: null,
      score: 0,
      lastTouchdownAltitude: null,
      takeoffSpeed: 0.2, // 起飞速度，与进场飞机保持一致
      airports: AIRPORTS,
      selectedAirportId: DEFAULT_AIRPORT.id,
      airport: DEFAULT_AIRPORT,
      runways: DEFAULT_AIRPORT.runways,
      navBeacons: DEFAULT_AIRPORT.navBeacons,
      restrictedAreas: DEFAULT_AIRPORT.restrictedAreas,
      departureProcedures: DEFAULT_AIRPORT.departureProcedures,
      sweepAngle: 0,
      // 添加难度设置
      difficulty: 'intermediate', // 默认为中级难度
      // 不同难度对应的飞机生成时间间隔(毫秒)
      difficultySettings: {
        beginner: {
          baseSpawnInterval: 20000,         // 基础生成间隔：20秒
          busySpawnInterval: 15000,         // 繁忙时期生成间隔：15秒
          calmSpawnInterval: 25000,         // 平静时期生成间隔：25秒
          busyPhaseProbability: 0.15,       // 繁忙阶段出现概率：15%
          calmPhaseDuration: 60000,         // 平静阶段持续时间：60秒
        },
        intermediate: {
          baseSpawnInterval: 15000,         // 基础生成间隔：15秒
          busySpawnInterval: 10000,         // 繁忙时期生成间隔：10秒
          calmSpawnInterval: 20000,         // 平静时期生成间隔：20秒
          busyPhaseProbability: 0.25,       // 繁忙阶段出现概率：25%
          calmPhaseDuration: 45000,         // 平静阶段持续时间：45秒
        },
        advanced: {
          baseSpawnInterval: 12000,         // 基础生成间隔：12秒
          busySpawnInterval: 8000,          // 繁忙时期生成间隔：8秒
          calmSpawnInterval: 18000,         // 平静时期生成间隔：18秒
          busyPhaseProbability: 0.35,       // 繁忙阶段出现概率：35%
          calmPhaseDuration: 30000,         // 平静阶段持续时间：30秒
        },
        expert: {
          baseSpawnInterval: 10000,         // 基础生成间隔：10秒
          busySpawnInterval: 6000,          // 繁忙时期生成间隔：6秒
          calmSpawnInterval: 15000,         // 平静时期生成间隔：15秒
          busyPhaseProbability: 0.45,       // 繁忙阶段出现概率：45%
          calmPhaseDuration: 20000,         // 平静阶段持续时间：20秒
        }
      },
      // 添加各难度级别的最大飞机数量限制
      maxAircraftCount: {
        beginner: 2,      // 初级最多2架飞机
        intermediate: 4,   // 中级最多4架飞机
        advanced: 7,      // 高级最多7架飞机
        expert: 12        // 专家最多12架飞机
      },
      // 游戏阶段相关变量
      gamePhase: 'normal',         // 游戏阶段：normal(正常), busy(繁忙), calm(平静)
      gamePhaseStartTime: 0,       // 当前阶段开始时间
      gamePhaseEndTime: 0,
      phaseChangeTimeout: null,    // 阶段变更的定时器
      currentSpawnInterval: null,  // 当前的飞机生成间隔
      dynamicMaxAircraftCount: 0,  // 动态调整的最大飞机数量
      gameProgressLevel: 0,        // 游戏进度等级（0-10，影响生成速度和最大飞机数）
      gameStartTime: 0,            // 游戏开始时间，用于计算游戏进度
      simulationElapsedMs: 0,
      pausedAt: 0,
      // 初级难度下，记录是否允许生成新飞机（只有当飞机消失后才允许）
      canSpawnNewAircraft: true,
      // 记录最后一次飞机生成的时间
      lastSpawnTime: 0,

      // 添加语音识别相关数据
      recognition: null,
      isRecording: false,
      voiceCommandText: '',
      pendingVoiceCommandText: '',
      lastVoiceCommandTime: 0,
      spacePressHandled: false, // 跟踪空格键是否已被处理

      shiftKeyPressed: false, // 跟踪左Shift键是否按下
      // 状态管理
      isLoading: true,
      nextLogId: 1,
      voiceRecognitionTimeout: null, // 用于防止重复启动语音识别
      voiceClearTimeout: null,
      voiceRestartTimeout: null,
      voiceCommitTimeout: null,
      voiceHasFinalResult: false,
      voiceStopRequested: false,
      voiceSessionId: 0,
      voiceStatusText: 'Hold left Shift to transmit',
      speechRequestId: 0,
      preferredSpeechVoiceName: '',
      lastVoiceCommandProcessTime: 0, // 用于命令频率限制
      continuousMode: false, // Store whether we're in continuous mode
      gameProgressInterval: null, // 游戏进度更新定时器
      incomingAircraft: [], // 即将出现的飞机数组

      // 游戏结束相关
      isGameOver: false, // 游戏是否已结束
      gameOverReason: '', // 游戏结束原因
      gameOverMessage: '', // 游戏结束详细信息
      problemAircraft: [], // 出问题的飞机（碰撞、飞出边界等）
      blinkTimer: null, // 用于控制飞机闪烁
      isBlinking: false, // 当前是否在闪烁状态
      groundWaitingStartTimes: {}, // 记录飞机开始在地面等待的时间，格式: {planeId: timestamp}
      safetyDistance: 50, // 飞机安全距离，小于此距离视为碰撞
      hardCollisionDistance: 22,
      hardCollisionVerticalDistance: 200,
      verticalSafetyDistance: 1000,
      altitudeChangeRate: 900, // feet per minute
      takeoffAltitudeChangeRate: 1500, // feet per minute
      approachAltitudeChangeRate: 1000, // feet per minute
      finalApproachAltitudeChangeRate: 800, // feet per minute
      touchdownCaptureDistance: 20,
      takeoffRotationSpeed: 140,
      takeoffMinimumRunwayProgress: 0.52,
      departureTurnAltitude: 400,
      missedApproachAltitude: 3000,
      groundDelayWarningRatio: 0.6,
      radarBounds: { // 雷达边界，超出此范围视为飞出雷达范围
        minX: -50,
        maxX: 1850,
        minY: -50,
        maxY: 1250
      },
    };
  },
  computed: {
    // 根据当前难度获取对应的时间间隔设置
    currentDifficultySettings() {
      return this.difficultySettings[this.difficulty];
    },
    // 获取当前难度下的最大飞机数量
    currentMaxAircraftCount() {
      return this.maxAircraftCount[this.difficulty];
    },
    currentGroundWaitTimeout() {
      return getGroundWaitTimeout(this.difficulty);
    },
    // 计算当前进场和起飞飞机的数量
    currentApproachCount() {
      return this.airplanes.filter(p => p.state === "APPROACH" || p.state === "FINAL_APPROACH").length;
    },
    currentDepartureCount() {
      return this.airplanes.filter(p => p.state === "READY_FOR_TAKEOFF" || p.state === "TAKEOFF").length;
    },
    // 计算当前屏幕上的总飞机数量
    currentAircraftCount() {
      return this.airplanes.length;
    },
    displayVoiceStatusText() {
      if (!this.isTouchDevice) return this.voiceStatusText;
      if (this.voiceStatusText === 'Hold left Shift to transmit') return 'Hold Talk to transmit';
      if (this.voiceStatusText === 'Release Shift to send') return 'Release Talk to send';
      return this.voiceStatusText;
    },
    aircraftTestState() {
      return JSON.stringify(this.airplanes.map(plane => ({
        id: plane.id,
        x: Math.round(plane.x * 10) / 10,
        y: Math.round(plane.y * 10) / 10,
        heading: Math.round(plane.heading),
        targetHeading: Math.round(plane.targetHeading),
        altitude: Math.round(plane.altitude || 0),
        airspeed: Math.round(plane.indicatedSpeed || 0),
        assignedSpeed: plane.assignedSpeed || null,
        speed: Math.round((plane.speed || 0) * 1000) / 1000,
        state: plane.state,
        flightType: plane.flightType || null,
        runway: plane.runway || plane.landingRunway || null,
        runwayProgress: Math.round((plane.takeoffRunwayProgress || 0) * 1000) / 1000,
        airborne: Boolean(plane.airborne),
        missedApproach: Boolean(plane.missedApproachActive),
        approachPhase: plane.approachPath?.phase || null,
        approachProgress: Math.round((plane.approachPath?.progressT || 0) * 1000) / 1000,
        approachPathType: plane.approachPath?.trajectory?.pathType || null,
        targetAltitude: Math.round(plane.targetAltitude || 0),
      })));
    },
    incomingTestState() {
      return JSON.stringify(this.incomingAircraft.map(plane => ({
        id: plane.id,
        countdown: Math.round((plane.countdownRemaining ?? plane.countdown ?? 0) * 100) / 100,
      })));
    },
  },
  mounted() {
    this.isTouchDevice = this.isTouchDevice ||
      window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    if (import.meta.env.DEV) {
      window.__ATC_DEBUG_APP__ = this;
    }

    const canvas = this.$refs.radarCanvas;
    this.ctx = canvas.getContext("2d");
    this.airplaneImage = new Image();
    this.airplaneImage.src = airplaneImg;
    this.airplaneImage.onload = () => {
      this.renderLoop();
    };

    // 初始化语音识别
    this.initSpeechRecognition();
    this.ensurePreferredSpeechVoice();

    window.addEventListener('keydown', this.handleGlobalKeyDown);
    window.addEventListener('keyup', this.handleGlobalKeyUp);
    document.addEventListener('click', this.closeSettings);
    this.$el.focus();
  },

  beforeUnmount() {
    if (import.meta.env.DEV && window.__ATC_DEBUG_APP__ === this) {
      delete window.__ATC_DEBUG_APP__;
    }

    window.removeEventListener('keydown', this.handleGlobalKeyDown);
    window.removeEventListener('keyup', this.handleGlobalKeyUp);
    document.removeEventListener('click', this.closeSettings);
    this.stopVoiceCommand();
    this.cleanupSpeechRecognition();
    this.disposeSpeechVoiceLoader();
    if (this.voiceClearTimeout) {
      clearTimeout(this.voiceClearTimeout);
    }
    if (this.voiceRestartTimeout) {
      clearTimeout(this.voiceRestartTimeout);
    }
  },

  methods: {
    toggleSettings() {
      this.settingsOpen = !this.settingsOpen;
    },

    closeSettings() {
      this.settingsOpen = false;
    },

    // 根据ID查找飞机
    getPlaneById(planeId) {
      return this.airplanes.find(p => p.id === planeId);
    },

    selectPlane(plane) {
      this.airplanes.forEach(p => {
        p.selected = false;
      });
      this.selectedPlane = plane;
      if (plane) {
        plane.selected = true;
      }
    },

    applyAirport(airport) {
      this.airport = airport;
      this.runways = airport.runways;
      this.navBeacons = airport.navBeacons;
      this.restrictedAreas = airport.restrictedAreas;
      this.departureProcedures = airport.departureProcedures;
      this.radarBounds = {
        minX: -50,
        maxX: airport.canvas.width + 50,
        minY: -50,
        maxY: airport.canvas.height + 50,
      };
      this.airplanes = [];
      this.incomingAircraft = [];
      this.selectedPlane = null;
      this.dragging = false;
      this.dragFollowing = null;
      this.dragLine = null;
      this.groundWaitingStartTimes = {};
      this.problemAircraft = [];
      this.isGameOver = false;
      this.gameOverReason = '';
      this.gameOverMessage = '';
      this.sweepAngle = 0;
      this.testAircraftSpawned = false;
      this.lastTouchdownAltitude = null;
      this.repeatApproachPreserved = null;
    },

    changeAirport() {
      if (this.gameStatus === 'running') return;
      const airport = this.airports.find(item => item.id === this.selectedAirportId) || DEFAULT_AIRPORT;
      this.applyAirport(airport);
      this.gameStatus = 'start';
      this.communicationLog = ['', '', '', ''];
      this.allCommunicationLog = ['', '', '', ''];
      this.addToCommunicationLog(`Radar sector changed: ${airport.name}`);
    },

    startGame() {
      this.unlockAudioForPlayback();

      // 如果游戏当前是暂停状态，则继续游戏而不是重新开始
      if (this.gameStatus === 'paused') {
        this.pausedAt = 0;
        this.lastUpdateTime = Date.now();
        // 恢复游戏状态
        this.gameStatus = 'running';
        this.addToCommunicationLog("Game resumed");

        this.scheduleTrafficSpawnTimer();

        return; // 提前返回，不执行重置游戏的代码
      }

      // 以下是原有的重新开始游戏的代码
      // 重置游戏状态
      this.score = 0;
      this.gameStatus = 'running';

      // 清空通信日志
      this.communicationLog = ['', '', '', ''];
      this.allCommunicationLog = ['', '', '', ''];
      this.nextLogId = 1;

      // 清空飞机
      this.airplanes = [];
      this.incomingAircraft = [];
      this.groundWaitingStartTimes = {};
      this.pausedAt = 0;

      // 设置游戏更新循环
      this.lastUpdateTime = Date.now();

      // renderLoop is the single simulation clock. A second interval here made
      // aircraft movement and landing behavior depend on device frame rate.

      // 初始化动态难度系统
      this.gamePhase = 'normal';
      this.gamePhaseStartTime = 0;
      this.gamePhaseEndTime = 0;
      this.gameStartTime = Date.now();
      this.simulationElapsedMs = 0;
      this.gameProgressLevel = 0;

      // 设置初始的动态最大飞机数量
      this.dynamicMaxAircraftCount = this.maxAircraftCount[this.difficulty];

      // 获取当前难度的基础生成间隔
      const currentSettings = this.difficultySettings[this.difficulty];
      this.currentSpawnInterval = currentSettings.baseSpawnInterval;

      // 清除任何现有的阶段变更定时器
      if (this.phaseChangeTimeout) {
        clearTimeout(this.phaseChangeTimeout);
      }

      this.testAircraftSpawned = false;
      this.lastTouchdownAltitude = null;
      if (this.testScenario === 'collision') {
        this.setupCollisionTestScenario();
      } else if (this.testScenario === 'runway-collision') {
        this.setupRunwayCollisionTestScenario();
      } else if (this.testScenario === 'voice') {
        this.setupVoiceTestScenario();
      } else if (this.testScenario === 'speed') {
        this.setupSpeedTestScenario();
      } else if (this.testScenario === 'takeoff') {
        this.setupTakeoffTestScenario();
      } else if (this.testScenario === 'altitude') {
        this.setupAltitudeTestScenario();
      } else if (this.testScenario === 'approach-turn') {
        this.setupApproachTurnTestScenario();
      } else if (this.testScenario === 'runway-occupied') {
        this.setupRunwayOccupancyTestScenario();
      } else if (this.testScenario === 'landing-occupied') {
        this.setupLandingOccupancyTestScenario();
      } else if (this.testScenario === 'repeat-landing') {
        this.setupRepeatedLandingClearanceTestScenario();
      } else if (this.testScenario === 'manual-handoff') {
        this.setupManualHandoffTestScenario();
      } else {
        this.spawnApproach();
      }

      // 清除任何现有的生成定时器
      if (this.spawnApproachInterval) {
        clearInterval(this.spawnApproachInterval);
      }

      this.scheduleTrafficSpawnTimer();

      // 初始通信提示
      this.addToCommunicationLog(`Game started. Difficulty: ${this.getDifficultyText()}`);

      // 初始化等待起飞队列
      this.updateTakeoffQueue();
    },

    pauseGame() {
      if (this.gameStatus === 'running') {
        this.gameStatus = 'paused';
        this.pausedAt = Date.now();
        this.addToCommunicationLog("Game paused");

        clearInterval(this.spawnApproachInterval);
        clearInterval(this.spawnDepartureInterval);

        clearInterval(this.gameProgressInterval);
      }
    },

    endGame() {
      this.gameStatus = 'ended';
      this.addToCommunicationLog("Game ended");

      // 停止所有语音播报
      window.speechSynthesis.cancel();

      // 清除所有定时器
      clearInterval(this.spawnApproachInterval);
      clearInterval(this.spawnDepartureInterval);
      clearInterval(this.gameProgressInterval);

      if (this.phaseChangeTimeout) {
        clearTimeout(this.phaseChangeTimeout);
        this.phaseChangeTimeout = null;
      }

      // 重置游戏阶段状态
      this.gamePhase = 'normal';
      this.gamePhaseEndTime = 0;
      this.gameProgressLevel = 0;
      this.simulationElapsedMs = 0;
      this.pausedAt = 0;

      this.airplanes = [];
      this.incomingAircraft = [];
    },

    restartGame() {
      this.endGame();

      this.airplanes = [];
      this.selectedPlane = null;
      this.dragging = false;
      this.dragLine = null;

      // 重置通信日志，恢复为4个空行
      this.communicationLog = ['', '', '', ''];
      this.allCommunicationLog = ['', '', '', '']; // 重置为4个空行

      // 重置得分和飞机生成状态
      this.score = 0;
      this.canSpawnNewAircraft = true;

      this.gameStatus = 'stopped';
      this.addToCommunicationLog(this.isEnglish
        ? "Game reset, please click \"Start\" button to begin"
        : "Game reset, please click \"Start\" button to begin");
    },

    renderLoop(timestamp = performance.now()) {
      const realDt = this.lastRenderTime
        ? Math.min((timestamp - this.lastRenderTime) / 1000, 0.1)
        : 1 / 60;
      this.lastRenderTime = timestamp;
      const simulationDt = Math.min(realDt * this.speedLevel, 0.1);
      this.drawRadar();

      if (this.gameStatus === 'running') {
        this.advanceSimulationClock(simulationDt);
        this.updateIncomingAircraft(simulationDt);
        this.updateFlights(simulationDt);
        this.radarSweep(simulationDt);
      }

      requestAnimationFrame(this.renderLoop);
    },

    numberToWords(num) {
      // 航空术语中的特殊数字发音
      const map = ["zero", "one", "two", "tree", "four", "five", "six", "seven", "eight", "niner"];
      return num.toString().split("").map(n => map[+n]).join(" ");
    },

    // 将航向数值转换为航空术语
    formatHeadingForVoice(heading) {
      // 确保航向是3位数
      const headingStr = heading.toString().padStart(3, "0");
      return this.numberToWords(headingStr);
    },

    // 将普通数字转换为中文陆空通话数字读法
    convertToChineseAviationNumber(number) {
      const aviationDigits = {
        '0': '洞',
        '1': '幺',
        '2': '两',
        '3': '三',
        '4': '四',
        '5': '五',
        '6': '六',
        '7': '拐',
        '8': '八',
        '9': '九'
      };

      // 将数字转为字符串并处理每一位
      return String(number).split('').map(digit => aviationDigits[digit] || digit).join('');
    },

    ensurePreferredSpeechVoice() {
      if (!window.speechSynthesis) return Promise.resolve(null);

      const loadedVoices = window.speechSynthesis.getVoices();
      const originalYoungVoice = selectOriginalYoungSpeechVoice(loadedVoices);
      if (originalYoungVoice) {
        this._preferredSpeechVoice = originalYoungVoice;
        this.preferredSpeechVoiceName = originalYoungVoice.name;
        return Promise.resolve(originalYoungVoice);
      }

      if (this.isTouchDevice && loadedVoices.length) {
        const mobileVoice = selectPreferredSpeechVoice(loadedVoices);
        this._preferredSpeechVoice = mobileVoice;
        this.preferredSpeechVoiceName = mobileVoice?.name || '';
        return Promise.resolve(mobileVoice);
      }

      if (this._speechVoicePromise) return this._speechVoicePromise;

      this._speechVoicePromise = new Promise(resolve => {
        let attempts = 0;
        const finish = voice => {
          if (this._speechVoiceTimer) {
            clearInterval(this._speechVoiceTimer);
            this._speechVoiceTimer = null;
          }
          if (this._speechVoicesChangedHandler) {
            window.speechSynthesis.removeEventListener('voiceschanged', this._speechVoicesChangedHandler);
            this._speechVoicesChangedHandler = null;
          }
          this._preferredSpeechVoice = voice;
          this.preferredSpeechVoiceName = voice?.name || '';
          this._speechVoicePromise = null;
          resolve(voice);
        };

        const checkVoices = () => {
          attempts += 1;
          const voices = window.speechSynthesis.getVoices();
          const youngVoice = selectOriginalYoungSpeechVoice(voices);
          if (youngVoice) {
            finish(youngVoice);
          } else if (this.isTouchDevice && voices.length) {
            finish(selectPreferredSpeechVoice(voices));
          } else if (attempts >= 30) {
            finish(selectPreferredSpeechVoice(voices));
          }
        };

        this._speechVoicesChangedHandler = checkVoices;
        window.speechSynthesis.addEventListener('voiceschanged', checkVoices);
        this._speechVoiceTimer = setInterval(checkVoices, 100);
        checkVoices();
      });

      return this._speechVoicePromise;
    },

    disposeSpeechVoiceLoader() {
      this.speechRequestId += 1;
      if (this._speechVoiceTimer) {
        clearInterval(this._speechVoiceTimer);
        this._speechVoiceTimer = null;
      }
      if (this._speechVoicesChangedHandler && window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', this._speechVoicesChangedHandler);
        this._speechVoicesChangedHandler = null;
      }
    },

    playPreparedSpeech(voiceCommand, requestId) {
      const playWithVoice = voice => {
        if (requestId !== this.speechRequestId) return Promise.resolve();
        return radioEffects.applyRadioEffectToSpeech(voiceCommand, {
          lang: "en-US",
          pitch: 1,
          rate: 1,
          voice,
          immediate: this.isTouchDevice,
        });
      };

      if (this.isTouchDevice) {
        const voices = window.speechSynthesis?.getVoices?.() || [];
        const voice = this._preferredSpeechVoice || selectPreferredSpeechVoice(voices);
        if (voice) {
          this._preferredSpeechVoice = voice;
          this.preferredSpeechVoiceName = voice.name || '';
        }
        this.preferredSpeechVoiceName = 'Samantha Local ATC';
        return radioEffects.playLocalSpeech(voiceCommand).catch(localError => {
          console.error("Local mobile speech playback failed:", localError);
          return playWithVoice(voice).catch(error => {
            console.error("Mobile system speech playback failed:", error);
            if (requestId !== this.speechRequestId) return;
            const fallbackUtterance = new SpeechSynthesisUtterance(voiceCommand);
            fallbackUtterance.lang = "en-US";
            fallbackUtterance.pitch = 1;
            fallbackUtterance.rate = 1;
            fallbackUtterance.volume = 1;
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(fallbackUtterance);
          });
        });
      }

      this.ensurePreferredSpeechVoice().then(voice => {
        if (requestId !== this.speechRequestId) return;

        return playWithVoice(voice).catch(error => {
          if (requestId !== this.speechRequestId) return;
          console.error("Radio effect failed, falling back to regular speech:", error);
          const utterance = new SpeechSynthesisUtterance(voiceCommand);
          utterance.lang = "en-US";
          utterance.pitch = 1;
          utterance.rate = 1;
          if (voice) utterance.voice = voice;
          window.speechSynthesis.speak(utterance);
        });
      }).catch(error => {
        console.error("Failed to prepare speech voice:", error);
      });
    },

    unlockAudioForPlayback() {
      radioEffects.unlock();
      if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
      this.ensurePreferredSpeechVoice();
    },

    // 语音合成 - 支持多语言
    speak(text, addToLog = true) {
      // 如果没有文本，不进行处理
      if (!text) return;
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        if (addToLog) this.addToCommunicationLog(text);
        return;
      }

      // Desktop voices tolerate an eager cancel; mobile Safari is more reliable
      // when the first utterance stays in the same user-interaction call stack.
      if (!this.isTouchDevice) window.speechSynthesis.cancel();

      // 删除不必要的扰人信息，例如标点符号、多余空格等
      let voiceCommand = text
        .replace(/\([^)]*\)/g, '') // 删除括号内内容 (例如 "to NAV1 (bravo 280)")
        .replace(/[.,?!;:]/g, '') // 删除标点符号
        .replace(/\s+/g, ' ') // 多个空格替换为单个空格
        .trim(); // 清理首尾空格

      // 1. 处理航班号 - 使用航空通话标准格式 (B6978 => "Bravo six nine seven eight")
      voiceCommand = voiceCommand.replace(/\b(B)(\d{4})\b/g, (match, letter, numbers) => {
        // 转换B为Bravo
        const prefix = "Bravo";
        // 单独读出各个数字
        const digits = this.numberToWords(numbers);
        return `${prefix} ${digits}`;
      });

      // 2. 处理航向值 (例如: "heading 270" => "heading two seven zero")
      voiceCommand = voiceCommand.replace(/(heading|head)\s+(\d+)/gi, (match, p1, p2) => {
        const headingWords = this.numberToWords(p2);
        return `${p1} ${headingWords}`;
      });

      // 3. 处理跑道号
      if (voiceCommand.includes('runway')) {
        // 提取跑道号
        const runwayMatch = voiceCommand.match(/runway\s+(\w+)/);
        if (runwayMatch && runwayMatch[1]) {
          const runway = runwayMatch[1];
          let runwayWords = "";

          // 处理跑道号的特殊情况 (36L, 36R, 18L, 18R等)
          for (let i = 0; i < runway.length; i++) {
            const char = runway[i];
            if (char >= '0' && char <= '9') {
              runwayWords += this.numberToWords(char) + " ";
            } else if (char === 'L') {
              runwayWords += "left ";
            } else if (char === 'R') {
              runwayWords += "right ";
            } else {
              runwayWords += char + " ";
            }
          }

          // 替换跑道号为正确的读法
          voiceCommand = voiceCommand.replace(/runway\s+\w+/, `runway ${runwayWords.trim()}`);
        }
      }

      console.log(`Speech: ${voiceCommand}`);

      this.speechRequestId += 1;
      this.playPreparedSpeech(voiceCommand, this.speechRequestId);

      if (addToLog) {
        this.addToCommunicationLog(text);
      }
    },

    addToCommunicationLog(message) {
      // Create log entry
      const logEntry = message;

      // Add to main communication log
      this.communicationLog.unshift(logEntry);

      // Also update the allCommunicationLog for display
      this.allCommunicationLog = [...this.communicationLog];

      // Limit log entries to prevent overflow
      if (this.communicationLog.length > 20) {
        this.communicationLog = this.communicationLog.slice(0, 20);
        this.allCommunicationLog = [...this.communicationLog];
      }
    },

    spawnApproach() {
      if (this.gameStatus !== 'running') return;
      if (this.testMode && this.testAircraftSpawned) return;

      // 检查是否已达到当前难度的最大飞机数量限制
      if (this.airplanes.length + this.incomingAircraft.length >= this.dynamicMaxAircraftCount) {
        console.log(`已达到${this.difficulty}难度下的最大飞机数量限制: ${this.dynamicMaxAircraftCount}`);
        return;
      }

      // 使用B航空+6901-6999之间的随机数字
      const id = this.generateUniqueFlightId();

      // 定义雷达屏幕的绝对边缘位置
      const { width, height } = this.airport.canvas;
      // Local regression mode uses a stable entry so every airport can be
      // exercised without random traffic masking landing-rule failures.
      const entry = this.testMode
        ? { x: 100, y: this.airport.center.y, position: "left" }
        : this.getSafeApproachEntry(width, height);

      // 计算朝向屏幕中心的航向
      const dx = this.airport.center.x - entry.x;
      const dy = this.airport.center.y - entry.y;
      const angle = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);
      const initialAltitude = this.testMode ? 4000 : (Math.floor(Math.random() * 6) + 4) * 1000;

      // 创建新飞机对象
      const plane = {
        id,
        flightType: "ARRIVAL",
        x: entry.x,
        y: entry.y,
        heading: angle,
        targetHeading: angle,
        altitude: initialAltitude,
        targetAltitude: initialAltitude,
        verticalSpeed: 0,
        indicatedSpeed: 220,
        speed: 0.2,
        state: "APPROACH",
        selected: false,
        countdown: 5, // 初始倒计时5秒
        visible: false, // 初始状态为不可见
        position: entry.position, // 记录边缘位置
        fromDirection: entry.position // 记录飞机来自的方向
      };
      if (this.testMode) this.testAircraftSpawned = true;

      // 添加到即将出现的飞机数组
      this.incomingAircraft.push(plane);

      // 添加倒计时通知
      this.addToCommunicationLog(`${id} approaching in 5 seconds`);

      plane.countdownRemaining = 5;
    },

    getSafeApproachEntry(width, height) {
      const createCandidate = () => {
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) return { x: 0, y: Math.random() * height, position: "left" };
        if (edge === 1) return { x: width, y: Math.random() * height, position: "right" };
        if (edge === 2) return { x: Math.random() * width, y: 0, position: "top" };
        return { x: Math.random() * width, y: height, position: "bottom" };
      };

      let fallback = createCandidate();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const candidate = createCandidate();
        fallback = candidate;
        if (this.isApproachEntryPathClear(candidate)) return candidate;
      }
      return fallback;
    },

    isApproachEntryPathClear(entry) {
      const activeAreas = this.restrictedAreas.filter(area => area.active && area.points?.length >= 3);
      if (!activeAreas.length) return true;

      const dx = this.airport.center.x - entry.x;
      const dy = this.airport.center.y - entry.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const protectedEntryDistance = Math.min(320, distance);
      for (let sampleDistance = 0; sampleDistance <= protectedEntryDistance; sampleDistance += 20) {
        const x = entry.x + dx / distance * sampleDistance;
        const y = entry.y + dy / distance * sampleDistance;
        if (activeAreas.some(area => this.isPointInPolygon(x, y, area.points))) return false;
      }
      return true;
    },

    updateIncomingAircraft(dt) {
      if (this.gameStatus !== 'running' || !this.incomingAircraft.length) return;

      const activated = [];
      for (const plane of this.incomingAircraft) {
        plane.countdownRemaining = Math.max(0, (plane.countdownRemaining ?? 5) - dt);
        plane.countdown = Math.max(0, Math.ceil(plane.countdownRemaining));
        if (plane.countdownRemaining > 0 || this.airplanes.length >= this.dynamicMaxAircraftCount) continue;

        plane.visible = true;
        delete plane.countdownRemaining;
        this.airplanes.push(plane);
        activated.push(plane);
        this.lastSpawnTime = Date.now();
        this.addToCommunicationLog(`${plane.id} approaching`);
      }

      if (activated.length) {
        this.incomingAircraft = this.incomingAircraft.filter(plane => !activated.includes(plane));
      }
    },

    generateUniqueFlightId() {
      const activeIds = new Set([
        ...this.airplanes.map(plane => plane.id),
        ...this.incomingAircraft.map(plane => plane.id),
      ]);
      for (let attempt = 0; attempt < 100; attempt++) {
        const id = `B${generateRandomFlightNumber()}`;
        if (!activeIds.has(id)) return id;
      }
      for (let number = 1011; number <= 9998; number++) {
        const id = `B${number}`;
        if (!activeIds.has(id)) return id;
      }
      throw new Error('No flight identifiers available');
    },

    spawnDeparture() {
      if (this.gameStatus !== 'running') return;
      if (this.testMode && this.testAircraftSpawned) return;

      // 检查是否已达到当前难度的最大飞机数量限制
      if (this.airplanes.length + this.incomingAircraft.length >= this.dynamicMaxAircraftCount) {
        console.log(`已达到${this.difficulty}难度下的最大飞机数量限制: ${this.dynamicMaxAircraftCount}`);
        return;
      }

      // 使用B航空+6901-6999之间的随机数字
      const id = this.generateUniqueFlightId();

      // 计算新飞机在队列中的位置
      const waitingCount = this.airplanes.filter(p => p.state === "READY_FOR_TAKEOFF").length;

      const queue = this.airport.departureQueue || { x: this.airport.center.x, y: this.airport.center.y, spacingX: 0, spacingY: 50 };

      // 计算当前飞机的位置
      const plane = {
        id,
        flightType: "DEPARTURE",
        x: queue.x + waitingCount * (queue.spacingX || 0),
        y: queue.y + waitingCount * (queue.spacingY || 50), // 新飞机放在队列末尾
        heading: 0,
        targetHeading: 0,
        altitude: 0,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 0,
        speed: 0,
        state: "READY_FOR_TAKEOFF",
        selected: false,
        queuePosition: waitingCount // 记录在队列中的位置
      };
      if (this.testMode) this.testAircraftSpawned = true;

      this.airplanes.push(plane);
      this.addToCommunicationLog(`${id} ready for takeoff`);

      // 记录生成时间
      this.lastSpawnTime = Date.now();
    },

    setupCollisionTestScenario() {
      const common = {
        flightType: "ARRIVAL",
        x: this.airport.center.x + 260,
        y: this.airport.center.y,
        heading: 90,
        targetHeading: 90,
        altitude: 5000,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 0,
        speed: 0,
        state: "FLYING",
        selected: false,
        visible: true,
      };
      this.airplanes = [
        { ...common, id: "B9001" },
        { ...common, id: "B9002" },
      ];
      this.testAircraftSpawned = true;
    },

    setupRunwayCollisionTestScenario() {
      const runway = this.runways[0];
      const common = {
        x: runway.startX,
        y: runway.startY,
        heading: runway.heading,
        targetHeading: runway.heading,
        altitude: 0,
        targetAltitude: 0,
        verticalSpeed: 0,
        indicatedSpeed: 120,
        speed: 0,
        runway: runway.id,
        landingRunway: runway.id,
        selected: false,
        visible: true,
      };
      this.airplanes = [
        { ...common, id: "B9001", flightType: "DEPARTURE", state: "TAKEOFF" },
        { ...common, id: "B9002", flightType: "ARRIVAL", state: "LANDING" },
      ];
      this.testAircraftSpawned = true;
    },

    setupVoiceTestScenario() {
      this.airplanes = [{
        id: "B9001",
        flightType: "ARRIVAL",
        x: this.airport.center.x + 260,
        y: this.airport.center.y,
        heading: 90,
        targetHeading: 90,
        altitude: 5000,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 250,
        speed: 0.2,
        state: "FLYING",
        selected: false,
        visible: true,
      }];
      this.testAircraftSpawned = true;
    },

    setupSpeedTestScenario() {
      this.setupVoiceTestScenario();
      this.processVoiceCommand("bravo nine zero zero one reduce speed to one eight zero knots");
    },

    setupTakeoffTestScenario() {
      const runway = this.runways[0];
      const queue = this.airport.departureQueue;
      const plane = {
        id: "B9001",
        flightType: "DEPARTURE",
        x: queue.x,
        y: queue.y,
        heading: 0,
        targetHeading: 0,
        altitude: 0,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 0,
        speed: 0,
        state: "READY_FOR_TAKEOFF",
        queuePosition: 0,
        selected: false,
        visible: true,
      };
      this.airplanes = [plane];
      this.processTakeoffCommand(plane.id, `takeoff runway ${runway.id}`);
      this.testAircraftSpawned = true;
    },

    setupAltitudeTestScenario() {
      const runway = this.runways[0];
      const entrance = this.getRunwayEntrance(runway);
      const oppositeHeading = ((runway.heading + 180) % 360) * Math.PI / 180;
      const finalDistance = 220;
      const startX = entrance.x + Math.sin(oppositeHeading) * finalDistance;
      const startY = entrance.y - Math.cos(oppositeHeading) * finalDistance;
      this.airplanes = [{
        id: "B9001",
        flightType: "ARRIVAL",
        x: startX,
        y: startY,
        heading: runway.heading,
        targetHeading: runway.heading,
        altitude: 1200,
        targetAltitude: 1200,
        verticalSpeed: 0,
        indicatedSpeed: 200,
        speed: 0.2,
        state: "FINAL_APPROACH",
        landingRunway: runway.id,
        landingDirection: runway.heading,
        selected: false,
        visible: true,
        approachPath: {
          runwayX: entrance.x,
          runwayY: entrance.y,
          finalHeading: runway.heading,
          phase: "FINAL_APPROACH",
          initialDistanceToRunway: finalDistance,
          distanceToRunway: finalDistance,
          originalSpeed: 0.2,
          speedFactor: 1,
          startAltitude: 1200,
          finalGateAltitude: 1200,
          thresholdCrossingAltitude: 50,
          bezierPoints: {
            start: { x: startX, y: startY },
            cp1: { x: startX, y: startY },
            cp2: { x: startX, y: startY },
            preApproach: { x: startX, y: startY },
          },
        },
      }];
      this.testAircraftSpawned = true;
    },

    setupApproachTurnTestScenario() {
      const runway = this.runways[0];
      const entrance = this.getRunwayEntrance(runway);
      const finalVector = {
        x: Math.sin(runway.heading * Math.PI / 180),
        y: -Math.cos(runway.heading * Math.PI / 180),
      };
      const perpendicular = { x: finalVector.y, y: -finalVector.x };
      const finalGate = {
        x: entrance.x - finalVector.x * 220,
        y: entrance.y - finalVector.y * 220,
      };
      const plane = {
        id: "B9001",
        flightType: "ARRIVAL",
        x: finalGate.x + perpendicular.x * 240 - finalVector.x * 100,
        y: finalGate.y + perpendicular.y * 240 - finalVector.y * 100,
        heading: (runway.heading + 90) % 360,
        targetHeading: (runway.heading + 90) % 360,
        altitude: 3000,
        targetAltitude: 3000,
        verticalSpeed: 0,
        indicatedSpeed: 220,
        speed: 0.2,
        state: "FLYING",
        selected: false,
        visible: true,
      };
      this.airplanes = [plane];
      this.assignApproachPath(plane, runway, entrance);
      this.testAircraftSpawned = true;
    },

    setupRepeatedLandingClearanceTestScenario() {
      this.setupApproachTurnTestScenario();
      const plane = this.airplanes[0];
      const originalApproachPath = plane.approachPath;
      this.processLandingCommand(plane.id, `land runway ${plane.landingRunway}`);
      this.repeatApproachPreserved = plane.approachPath === originalApproachPath;
    },

    setupManualHandoffTestScenario() {
      const mxw = this.navBeacons.find(beacon => beacon.id === "MXW");
      if (!mxw) return;
      const plane = {
        id: "B9001",
        flightType: "DEPARTURE",
        x: mxw.x + 65,
        y: mxw.y,
        heading: 270,
        targetHeading: 270,
        altitude: 3000,
        targetAltitude: 3000,
        verticalSpeed: 0,
        indicatedSpeed: 220,
        speed: 0.2,
        state: "TAKEOFF",
        runway: "04",
        airborne: true,
        selected: false,
        visible: true,
      };
      this.airplanes = [plane];
      this.processDepartureProcedureCommand(plane.id, "04-MXW");
      this.testAircraftSpawned = true;
    },

    setupRunwayOccupancyTestScenario() {
      const runway = this.runways[0];
      const occupyingPlane = {
        id: "B9001",
        flightType: "DEPARTURE",
        x: runway.startX,
        y: runway.startY,
        heading: runway.heading,
        targetHeading: runway.heading,
        altitude: 0,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 80,
        speed: 0.04,
        state: "TAKEOFF",
        runway: runway.id,
        selected: false,
        visible: true,
      };
      const waitingPlane = {
        id: "B9002",
        flightType: "DEPARTURE",
        x: this.airport.departureQueue.x,
        y: this.airport.departureQueue.y,
        heading: 0,
        targetHeading: 0,
        altitude: 0,
        targetAltitude: 5000,
        verticalSpeed: 0,
        indicatedSpeed: 0,
        speed: 0,
        state: "READY_FOR_TAKEOFF",
        queuePosition: 0,
        selected: false,
        visible: true,
      };
      this.airplanes = [occupyingPlane, waitingPlane];
      this.processTakeoffCommand(waitingPlane.id, `takeoff runway ${runway.id}`);
      this.testAircraftSpawned = true;
    },

    setupLandingOccupancyTestScenario() {
      const runway = this.runways[0];
      const heading = runway.heading * Math.PI / 180;
      const arrival = {
        id: "B9002",
        flightType: "ARRIVAL",
        x: runway.startX - Math.sin(heading) * 80,
        y: runway.startY + Math.cos(heading) * 80,
        heading: runway.heading,
        targetHeading: runway.heading,
        altitude: 500,
        targetAltitude: 500,
        verticalSpeed: 0,
        indicatedSpeed: 150,
        speed: 0.12,
        state: "FINAL_APPROACH",
        landingRunway: runway.id,
        selected: false,
        visible: true,
      };
      const occupyingPlane = {
        id: "B9001",
        flightType: "ARRIVAL",
        x: runway.startX,
        y: runway.startY,
        heading: runway.heading,
        targetHeading: runway.heading,
        altitude: 0,
        targetAltitude: 0,
        verticalSpeed: 0,
        indicatedSpeed: 130,
        speed: 0.14,
        originalSpeed: 0.14,
        state: "LANDING",
        runway: runway.id,
        landingRunway: runway.id,
        landingDirection: runway.heading,
        selected: false,
        visible: true,
      };
      this.airplanes = [occupyingPlane, arrival];
      this.initializeLandingRoll(occupyingPlane);
      this.beginLandingRoll(arrival, runway.startX, runway.startY);
      this.testAircraftSpawned = true;
    },

    updateFlights(frameDt = null) {
      try {
        // 游戏暂停或已结束时不更新
        if (this.gameStatus !== 'running' || this.isGameOver) return;

        const now = Date.now();
        const dt = Number.isFinite(frameDt) && frameDt > 0
          ? Math.min(frameDt, 0.1)
          : Math.min((now - this.lastUpdateTime) / 1000, 0.1);
        this.lastUpdateTime = now;

        // 待移除的飞机
      const toRemove = [];

        // 添加碰撞检测
        this.checkCollisions();

        // 检查飞机是否飞出边界
        this.checkAircraftOutOfBounds();

        // 检查限制区/禁区侵入
        this.checkRestrictedAreaViolations();

        // 检查地面等待超时
        this.checkGroundDelays(dt);

        // 如果游戏已结束，不继续处理
        if (this.isGameOver) return;

        // 检查是否有飞机状态从READY_FOR_TAKEOFF变为了其他状态
        let queueChanged = false;

        // 遍历所有飞机，更新状态
      for (const plane of this.airplanes) {
          try {
            this.updateAircraftAltitude(plane, dt);

            if (plane.state !== "READY_FOR_TAKEOFF") {
              // 如果状态从READY_FOR_TAKEOFF变为其他状态，标记队列变化
              if (plane.groundWaitElapsedMs !== undefined) {
                delete plane.groundWaitElapsedMs;
                delete plane.groundDelayWarningIssued;
                if (plane.queuePosition !== undefined) {
                  queueChanged = true;
                  // 移除队列位置属性
                  delete plane.queuePosition;
                }
              }
            }

            // 处理进场过程中的飞机 - 优先使用特殊的更新函数
            // 检查是否有新命令标记，新命令优先，取消进场
            if (plane.newCommandIssued) {
              console.log(`${plane.id} 收到新命令，取消进场过程`);
              if (plane.state === "APPROACH" || plane.state === "FINAL_APPROACH" || plane.state === "LANDING" || plane.landingRunway) {
                this.initiateMissedApproach(plane, { log: false });
              } else {
                plane.state = "FLYING";
                plane.targetMotionSpeed = 0.2;
                plane.targetIndicatedSpeed = 250;
                plane._lastHeadingTime = 0;
                plane._headingStep = 0;
              }
              plane.newCommandIssued = false;

              console.debug(`已清除${plane.id}的进场路径，当前飞机状态: ${plane.state}，位置: (${Math.round(plane.x)},${Math.round(plane.y)})`);
            }

            this.updateAircraftSpeed(plane, dt);

            // 只有没有新命令时才继续进场过程
            if ((plane.state === "FINAL_APPROACH" || plane.state === "APPROACH") && plane.approachPath) {
              // 添加异常保护，防止出现无限循环或性能问题
              try {
                const updated = this.updateApproachFlight(plane, dt);
                if (updated) {
                  // 如果进场飞机已更新，跳过普通的更新流程
                  continue;
          } else {
                  // 如果更新失败，将飞机状态重置为正常飞行
                  console.log(`${plane.id} 进场更新失败，重置为正常飞行状态`);
                  plane.state = "APPROACH";
                  plane.approachPath = null;
                  plane.approachPathCreated = false;
                }
              } catch (approachError) {
                console.error(`${plane.id} 进场更新发生错误:`, approachError);
                // 出现错误时重置飞机状态
                plane.state = "APPROACH";
                plane.approachPath = null;
                plane.approachPathCreated = false;
              }
            }

            // 处理简化版的落地指令 - 直接飞向目标跑道
            if (plane.targetRunwayX !== undefined && plane.targetRunwayY !== undefined) {
              // 计算到跑道的距离
              const dx = plane.targetRunwayX - plane.x;
              const dy = plane.targetRunwayY - plane.y;
              const distToRunway = Math.sqrt(dx*dx + dy*dy);

              // 计算飞向跑道的航向
              let heading = Math.atan2(dx, -dy) * 180 / Math.PI;
              if (heading < 0) heading += 360;

              // 设置飞机航向朝向跑道
              plane.targetHeading = Math.round(heading);

              // 如果已经接近跑道入口，进入着陆阶段
              if (distToRunway < this.touchdownCaptureDistance) {
                const landingStarted = this.beginLandingRoll(plane, plane.targetRunwayX, plane.targetRunwayY);
                if (!landingStarted) continue;

                // 发出着陆确认
                const message = `${plane.id}, landing runway ${plane.landingRunway}`;
                this.addToCommunicationLog(message);

                console.log(`${plane.id} 到达跑道入口，开始着陆，着陆速度：${plane.originalSpeed.toFixed(2)}`);

                // 清除目标跑道数据，防止重复处理
                plane.targetRunwayX = undefined;
                plane.targetRunwayY = undefined;
                continue;
              }
            }

            // 更新飞机位置和航向
            // 只有飞行中和起飞中的飞机才会移动
            const movingStates = ["APPROACH", "FLYING", "TAKEOFF", "FINAL_APPROACH"];

            if (movingStates.includes(plane.state)) {
              const holdRunwayHeading = plane.state === "TAKEOFF" &&
                (!plane.airborne || (plane.altitude || 0) < this.departureTurnAltitude);

              if (holdRunwayHeading) {
                plane.heading = this.getRunwayHeading(plane.runway);
              } else {
                if (plane.targetBeaconId) {
                  this.updateDirectToBeaconHeading(plane);
                }

                this.updateAircraftHeading(plane, dt);
              }

              // 计算移动分量
              const headingRad = (plane.heading * Math.PI) / 180;
              const movementDistance = getMovementDistance(plane.speed, dt);
              const dx = Math.sin(headingRad) * movementDistance;
              const dy = -Math.cos(headingRad) * movementDistance;

              // 更新位置
              plane.x += dx;
              plane.y += dy;
            }

            // 处理着陆中的飞机
        if (plane.state === "LANDING") {
              // 检查是否有新命令
              if (plane.newCommandIssued) {
                console.log(`${plane.id} 在降落过程中收到新命令，中止降落`);
                this.initiateMissedApproach(plane, { log: true });
                plane.newCommandIssued = false;
                continue; // 跳过本次更新，由下一帧处理新指令
              }

              // 设置正确的着陆方向
              const heading = plane.landingDirection ?? this.getRunwayHeading(plane.landingRunway);
              plane.landingDirection = heading; // 确保设置了着陆方向
              const rad = (heading * Math.PI) / 180;

              // 如果没有设置原始速度，设置一个默认值
              if (plane.originalSpeed === undefined) {
                plane.originalSpeed = 0.14;
              }

              if (!plane.landingRollTargetDistance) {
                this.initializeLandingRoll(plane);
              }

              // 修正：确保航向角度与飞行方向一致 (0度是北)
              const movementDistance = getMovementDistance(plane.speed, dt);
              const dx = Math.sin(rad) * movementDistance;
              const dy = -Math.cos(rad) * movementDistance;  // 注意负号！确保0度是向上

              plane.x += dx;
              plane.y += dy;  // y增加表示向下移动

              const runwayProgress = updateLandingRollProgress(plane, Math.hypot(dx, dy));

              console.log(`${plane.id} landing progress: ${Math.round(runwayProgress * 100)}%, runway: ${plane.runway}, direction: ${plane.landingDirection}`);

              // 平滑减速曲线 - 起初缓慢减速，然后快速减速，最后缓慢滑行
              // 使用二次方程使减速更加自然
              const speedFactor = 1 - (runwayProgress * runwayProgress);
              plane.speed = plane.originalSpeed * speedFactor;
              const touchdownAirspeed = plane.touchdownAirspeed || 135;
              plane.indicatedSpeed = Math.max(45, Math.round(touchdownAirspeed * speedFactor));

              // 当飞机滑行到跑道的三分之二处时
              if (shouldRemoveLandedAircraft(runwayProgress)) {
                const logMessage = `${plane.id} has vacated runway ${plane.runway}`;
                this.addToCommunicationLog(logMessage);
                console.log(logMessage);

                // 增加得分 - 落地成功得2分
                this.score += 2;
                console.log(`${plane.id} 落地完成，得2分，当前总分: ${this.score}`);

                // 确保飞机被移除
            toRemove.push(plane);

                // 允许立即生成新飞机
                this.canSpawnNewAircraft = true;

                // 强制更新当前飞机数量的显示
                this.$forceUpdate();
                continue;
              }
        }

            // 处理起飞的飞机
        if (plane.state === "TAKEOFF") {
              plane.targetMotionSpeed = 0.22;
              plane.targetIndicatedSpeed = 220;

              // 检查飞机是否接近任何导航台
              for (const beacon of this.navBeacons) {
                const distToBeacon = Math.sqrt(
                  Math.pow(plane.x - beacon.x, 2) +
                  Math.pow(plane.y - beacon.y, 2)
                );

                // 如果飞机在导航台附近(40像素范围内)
                if (distToBeacon < 40) {
                  // 增加得分 - 起飞成功得1分
                  this.score += 1;
                  console.log(`${plane.id} 到达导航台${beacon.id}，得1分，当前总分: ${this.score}`);

                  this.speak(`${plane.id} has reached ${beacon.id}, exiting radar coverage`, true);
                  this.addToCommunicationLog(`${plane.id} has reached navigation beacon ${beacon.id}`);
                  toRemove.push(plane); // 飞机到达导航台后直接消失

                  // 允许立即生成新飞机，不仅限于初级难度
                  this.canSpawnNewAircraft = true;
                  break; // 找到一个导航台后不再继续检查
                }
              }

              // 检查飞机是否已离开雷达范围
              if (plane.x < this.radarBounds.minX ||
                  plane.x > this.radarBounds.maxX ||
                  plane.y < this.radarBounds.minY ||
                  plane.y > this.radarBounds.maxY) {
                this.addToCommunicationLog(`${plane.id} has exited radar coverage`);
            toRemove.push(plane);

                // 允许立即生成新飞机，不仅限于初级难度
                this.canSpawnNewAircraft = true;
          }
        }

            if (plane.flightType === "DEPARTURE" && plane.targetBeaconId && plane.state !== "TAKEOFF") {
              const beacon = this.navBeacons.find(item => item.id === plane.targetBeaconId);
              if (beacon) {
                const distToBeacon = Math.sqrt(
                  Math.pow(plane.x - beacon.x, 2) +
                  Math.pow(plane.y - beacon.y, 2)
                );

                if (distToBeacon < 40) {
                  this.score += 1;
                  this.speak(`${plane.id} direct ${beacon.id} complete, exiting radar coverage`, true);
                  toRemove.push(plane);
                  this.canSpawnNewAircraft = true;
                }
              }
            }

          } catch (planeError) {
            // 单个飞机更新出错，记录但继续处理其他飞机
            console.error(`更新飞机 ${plane.id} 时出错:`, planeError);
      }
      }
      // 移除待删除的飞机
      this.airplanes = this.airplanes.filter(p => !toRemove.includes(p));

      // 如果有飞机被移除，允许生成新飞机
      if (toRemove.length > 0) {
        console.log('飞机已消失，允许生成新飞机');
        // 触发生成新飞机的检查
        setTimeout(() => this.checkAndSpawnNewAircraft(), 1000 / this.speedLevel);
      }

      // 如果飞机队列发生变化，更新队列
      if (queueChanged) {
        this.updateTakeoffQueue();
      }

      // 更新飞机数量
      this.landingCount = this.currentLandingCount;
      this.departureCount = this.currentDepartureCount;
    } catch (error) {
      // 捕获整个更新循环中的任何错误
      console.error("更新飞机时发生严重错误:", error);
    }
    },

    // 新增方法 - 统一的航向更新逻辑
    updateAircraftSpeed(plane, dt) {
      if (!plane || plane.state === "READY_FOR_TAKEOFF" || plane.state === "LANDING" || plane.approachPath) return;

      const defaultMotionSpeed = plane.state === "TAKEOFF" ? 0.22 : 0.2;
      const defaultIndicatedSpeed = plane.state === "TAKEOFF"
        ? 220
        : (plane.state === "APPROACH" ? 220 : 250);
      const targetMotionSpeed = plane.targetMotionSpeed ?? defaultMotionSpeed;
      const targetIndicatedSpeed = plane.targetIndicatedSpeed ?? defaultIndicatedSpeed;

      plane.speed = getNextValue(plane.speed || 0, targetMotionSpeed, 0.05, dt);
      plane.indicatedSpeed = getNextValue(plane.indicatedSpeed || 0, targetIndicatedSpeed, 18, dt);
    },

    updateAircraftHeading(plane, dt) {
      // 使用整数值计算，确保精确性
      const currentHeading = Math.round(plane.heading) % 360;
      const targetHeading = Math.round(plane.targetHeading) % 360;

      // 如果目标航向和当前航向完全相同，不需要转向
      if (currentHeading === targetHeading) {
        plane.heading = targetHeading; // 确保精确匹配
        return;
      }

      // 计算角度差，确定转向方向
      const clockwiseDiff = (targetHeading - currentHeading + 360) % 360;
      const counterClockwiseDiff = (currentHeading - targetHeading + 360) % 360;

      // 计算相对于当前航向，需要调整的角度（取最小值）
      const headingDiff = Math.min(clockwiseDiff, counterClockwiseDiff);

      // 基础转向速率
      const baseTurnRate = 0.5;

      // 动态调整转向速率 - 角度差越大，转向速率越小，模拟实际飞机无法快速转向的特性
      // 计算转向速率系数：较小角度保持正常速率，角度较大时逐渐减小速率
      let turnRateMultiplier = 1.0;

      // 当角度差大于30度时开始减小转向速率
      if (headingDiff > 30) {
        // 角度越大，系数越小，但保持最小0.3倍速率
        turnRateMultiplier = Math.max(0.3, 1 - (headingDiff - 30) / 150);
      }

      // 应用系数计算实际转向速率
      const turnRate = getTurnStep(baseTurnRate * turnRateMultiplier, dt);

      // 确定转向方向
      let shouldTurnClockwise;

      // 如果有保存的转向方向（从指令中来），直接使用它
      if (plane.forcedTurnDirection) {
        shouldTurnClockwise = plane.forcedTurnDirection === 'right';
      }
      // 如果是接近180度的转弯，使用之前预先确定的方向
      else if (Math.abs(clockwiseDiff - counterClockwiseDiff) < 5 &&
              (clockwiseDiff > 175 || counterClockwiseDiff > 175)) {
        // 如果没有预先确定的方向，默认使用顺时针(右转)
        shouldTurnClockwise = plane.preferredTurnDirection === 'left' ? false : true;
      }
      // 标准情况 - 选择角度较小的路径
      else {
        shouldTurnClockwise = clockwiseDiff <= counterClockwiseDiff;
      }

      // 执行转向
      if (shouldTurnClockwise) {
        // 顺时针转向（右转）- 增加航向值
        if (clockwiseDiff <= turnRate) {
          // 已经很接近目标，直接设置为目标值
          plane.heading = targetHeading;
        } else {
          // 继续顺时针转向
          plane.heading = (plane.heading + turnRate) % 360;
        }
      } else {
        // 逆时针转向（左转）- 减少航向值
        if (counterClockwiseDiff <= turnRate) {
          // 已经很接近目标，直接设置为目标值
          plane.heading = targetHeading;
        } else {
          // 继续逆时针转向
          plane.heading = (plane.heading - turnRate + 360) % 360;
        }
      }

      // 记录当前转向方向用于持续转向的一致性
      plane.lastTurnDirection = shouldTurnClockwise ? 'right' : 'left';
    },

    updateAircraftAltitude(plane, dt) {
      if (plane.state === "READY_FOR_TAKEOFF") {
        plane.altitude = 0;
        plane.verticalSpeed = 0;
        return;
      }

      if (plane.state === "TAKEOFF") {
        const runway = this.runways.find(item => item.id === plane.runway);
        const strip = runway
          ? this.airport.physicalRunways.find(item => item.id === runway.strip)
          : null;
        const runwayProgress = Math.max(
          plane.takeoffRunwayProgress || 0,
          getRunwayTravelProgress(plane, runway, strip),
        );
        plane.takeoffRunwayProgress = runwayProgress;

        if (!plane.airborne && !canRotateForTakeoff(
          plane.indicatedSpeed,
          runwayProgress,
          this.takeoffRotationSpeed,
          this.takeoffMinimumRunwayProgress,
        )) {
          plane.altitude = 0;
          plane.verticalSpeed = 0;
          plane.airborne = false;
          return;
        }

        plane.airborne = true;
      }

      this.updateApproachAltitudeProfile(plane);

      if (plane.state === "LANDING") {
        plane.altitude = 0;
        plane.targetAltitude = 0;
        plane.verticalSpeed = 0;
        return;
      } else if (plane.state === "TAKEOFF" && (plane.targetAltitude === undefined || plane.targetAltitude === null)) {
        plane.targetAltitude = 5000;
      }

      const currentAltitude = plane.altitude || 0;
      const targetAltitude = plane.targetAltitude ?? currentAltitude;
      const diff = targetAltitude - currentAltitude;
      if (Math.abs(diff) < 10) {
        plane.altitude = targetAltitude;
        plane.verticalSpeed = 0;
        if (plane.missedApproachActive && targetAltitude >= this.missedApproachAltitude) {
          plane.missedApproachActive = false;
        }
        return;
      }

      const direction = Math.sign(diff);
      const rate = this.getAircraftAltitudeChangeRate(plane, currentAltitude, targetAltitude);
      plane.altitude = getNextAltitude(currentAltitude, targetAltitude, rate, dt);
      plane.verticalSpeed = direction * rate;
    },

    getAircraftAltitudeChangeRate(plane, currentAltitude, targetAltitude) {
      if (plane.missedApproachActive) {
        return this.takeoffAltitudeChangeRate;
      }

      if (plane.state === "TAKEOFF") {
        return this.takeoffAltitudeChangeRate;
      }

      if (plane.state === "FINAL_APPROACH") {
        if (plane.approachPath?.phase === "INITIAL") {
          return this.approachAltitudeChangeRate;
        }

        const threshold = this.getLandingThresholdForPlane(plane);
        const distanceToThreshold = threshold
          ? Math.hypot(threshold.x - plane.x, threshold.y - plane.y)
          : 0;
        const usableDescentDistance = Math.max(1, distanceToThreshold - this.touchdownCaptureDistance);
        return getRequiredVerticalRate(
          currentAltitude,
          50,
          usableDescentDistance,
          plane.speed || 0.12,
          this.finalApproachAltitudeChangeRate,
        );
      }

      if (plane.state === "APPROACH" && plane.landingRunway) {
        return this.approachAltitudeChangeRate;
      }

      if (plane.state === "LANDING") {
        return this.finalApproachAltitudeChangeRate;
      }

      if (targetAltitude < currentAltitude && plane.landingRunway) {
        return this.approachAltitudeChangeRate;
      }

      return this.altitudeChangeRate;
    },

    getMissedApproachAltitude(plane) {
      const currentAltitude = plane?.altitude || 0;
      const currentTarget = plane?.targetAltitude || 0;
      return Math.max(this.missedApproachAltitude, currentAltitude, currentTarget);
    },

    initiateMissedApproach(plane, options = {}) {
      if (!plane) return;

      const runwayHeading = plane.landingRunway ? this.getRunwayHeading(plane.landingRunway) : null;
      const climbAltitude = this.getMissedApproachAltitude(plane);

      plane.state = "FLYING";
      plane.approachPath = null;
      plane.approachPathCreated = false;
      plane.landingRunway = null;
      plane.targetRunwayX = undefined;
      plane.targetRunwayY = undefined;
      plane.runway = null;
      plane.landingStartTime = null;
      plane.landingDirection = null;
      plane.landingRollDistance = 0;
      plane.landingRollTargetDistance = undefined;
      plane.originalSpeed = undefined;
      plane.speed = Math.max(plane.speed || 0, 0.08);
      plane.targetMotionSpeed = 0.22;
      plane.targetIndicatedSpeed = 180;
      plane.assignedSpeed = null;
      plane.targetAltitude = climbAltitude;
      plane.missedApproachActive = true;
      plane.verticalSpeed = this.approachAltitudeChangeRate;
      plane._lastHeadingTime = 0;
      plane._headingStep = 0;

      if (runwayHeading !== null && options.preserveHeading !== true) {
        plane.targetHeading = runwayHeading;
        plane.heading = plane.heading ?? runwayHeading;
      }

      if (options.log !== false) {
        this.addToCommunicationLog(`${plane.id}, go around, climb ${climbAltitude}`);
      }
    },

    initializeLandingRoll(plane) {
      if (!plane) return;

      plane.landingRollDistance = 0;
      // Keep landing completion consistent across maps; this matches the original
      // Capital sector rollout feel instead of scaling by longer custom runways.
      plane.landingRollTargetDistance = getLandingRollTargetDistance();
    },

    beginLandingRoll(plane, runwayX, runwayY) {
      if (!plane) return false;

      const landingRunway = plane.landingRunway || plane.runway;
      const occupyingPlane = this.getRunwayOccupyingAircraft(landingRunway, plane);
      if (occupyingPlane) {
        this.initiateMissedApproach(plane, { log: false });
        const message = `${plane.id}, go around, runway occupied by ${occupyingPlane.id}`;
        this.speak(message);
        return false;
      }

      const maxLandingSpeed = 0.16;
      const minimumLandingSpeed = 0.1;
      const touchdownSpeed = Math.max(minimumLandingSpeed, plane.speed || minimumLandingSpeed);

      this.lastTouchdownAltitude = Math.round(plane.altitude || 0);
      plane.state = "LANDING";
      plane.x = runwayX;
      plane.y = runwayY;
      plane.runway = landingRunway;
      plane.altitude = 0;
      plane.targetAltitude = 0;
      plane.verticalSpeed = 0;
      plane.landingStartTime = Date.now();
      plane.originalSpeed = Math.min(touchdownSpeed, maxLandingSpeed);
      plane.speed = plane.originalSpeed;
      plane.touchdownAirspeed = Math.min(145, Math.max(125, plane.indicatedSpeed || 135));
      plane.indicatedSpeed = plane.touchdownAirspeed;
      plane.assignedSpeed = null;
      plane.landingDirection = this.getRunwayHeading(landingRunway);
      plane.missedApproachActive = false;
      this.initializeLandingRoll(plane);
      return true;
    },

    updateApproachAltitudeProfile(plane) {
      if (!plane?.landingRunway || !["APPROACH", "FINAL_APPROACH", "LANDING"].includes(plane.state)) {
        return;
      }

      if (plane.state === "LANDING") {
        plane.altitude = 0;
        plane.targetAltitude = 0;
        plane.verticalSpeed = 0;
        return;
      }

      const profileAltitude = this.calculateApproachProfileAltitude(plane);
      if (profileAltitude === null) return;

      plane.targetAltitude = profileAltitude;
    },

    calculateApproachProfileAltitude(plane) {
      const currentAltitude = plane.altitude ?? plane.targetAltitude ?? 3000;
      const path = plane.approachPath;

      if (plane.state === "APPROACH" || (plane.state === "FINAL_APPROACH" && path?.phase === "INITIAL")) {
        const startAltitude = path?.startAltitude ?? currentAltitude;
        const finalGateAltitude = path?.finalGateAltitude ?? 1200;
        const progress = Math.max(0, Math.min(1, path?.progressT ?? 0));
        return Math.max(finalGateAltitude, startAltitude - (startAltitude - finalGateAltitude) * progress);
      }

      if (plane.state === "FINAL_APPROACH") {
        const threshold = this.getLandingThresholdForPlane(plane);
        if (!threshold) return null;

        const distanceToThreshold = Math.hypot(threshold.x - plane.x, threshold.y - plane.y);
        const initialFinalDistance = Math.max(path?.initialDistanceToRunway || 0, 120);
        const usableInitialDistance = Math.max(1, initialFinalDistance - this.touchdownCaptureDistance);
        const usableDistance = Math.max(0, distanceToThreshold - this.touchdownCaptureDistance);
        const ratio = Math.max(0, Math.min(1, usableDistance / usableInitialDistance));
        const thresholdCrossingAltitude = 50;
        const finalGateAltitude = path?.finalGateAltitude ?? 1200;
        const altitude = thresholdCrossingAltitude + (finalGateAltitude - thresholdCrossingAltitude) * ratio;
        return Math.max(0, Math.round(altitude / 50) * 50);
      }

      return plane.state === "LANDING" ? 0 : null;
    },

    getLandingThresholdForPlane(plane) {
      if (plane?.approachPath?.runwayX !== undefined && plane?.approachPath?.runwayY !== undefined) {
        return { x: plane.approachPath.runwayX, y: plane.approachPath.runwayY };
      }

      if (plane?.targetRunwayX !== undefined && plane?.targetRunwayY !== undefined) {
        return { x: plane.targetRunwayX, y: plane.targetRunwayY };
      }

      const runway = this.runways.find(item => item.id === plane?.landingRunway || item.id === plane?.runway);
      return runway ? this.getRunwayEntrance(runway) : null;
    },

    updateDirectToBeaconHeading(plane) {
      const beacon = this.navBeacons.find(item => item.id === plane.targetBeaconId);
      if (!beacon) {
        plane.targetBeaconId = null;
        plane.targetBeaconX = undefined;
        plane.targetBeaconY = undefined;
        return;
      }
      plane.targetHeading = this.calculateBearing(plane.x, plane.y, beacon.x, beacon.y);
    },

    radarSweep(dt = 1 / 60) {
      this.sweepAngle = (this.sweepAngle + 36 * Math.min(Math.max(dt, 0), 0.1)) % 360;
    },

    drawRadarBackground(ctx) {
      const { width, height } = this.airport.canvas;
      const { x: centerX, y: centerY } = this.airport.center;

      const bg = ctx.createRadialGradient(centerX, centerY, 80, centerX, centerY, 980);
      bg.addColorStop(0, "#0b2423");
      bg.addColorStop(0.55, "#071717");
      bg.addColorStop(1, "#020607");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.strokeStyle = "rgba(143, 255, 230, 0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(0, 255, 204, 0.22)";
      ctx.fillStyle = "rgba(143, 255, 230, 0.62)";
      ctx.font = "12px monospace";
      for (let r = 200; r <= 1000; r += 200) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${r / 20}NM`, centerX + r + 8, centerY - 5);
      }

      ctx.strokeStyle = "rgba(0, 255, 204, 0.18)";
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = deg * Math.PI / 180;
        const inner = deg % 45 === 0 ? 20 : 120;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.sin(rad) * inner, centerY - Math.cos(rad) * inner);
        ctx.lineTo(centerX + Math.sin(rad) * 1040, centerY - Math.cos(rad) * 1040);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(143, 255, 230, 0.55)";
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height);
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      ctx.fillStyle = "rgba(231, 255, 248, 0.82)";
      ctx.font = "bold 13px monospace";
      ctx.fillText("N", centerX - 4, 22);
      ctx.fillText("S", centerX - 4, height - 12);
      ctx.fillText("W", 12, centerY + 4);
      ctx.fillText("E", width - 20, centerY + 4);

      const sweepRad = this.sweepAngle * Math.PI / 180;
      const sweepGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 1040);
      sweepGradient.addColorStop(0, "rgba(139, 255, 232, 0.34)");
      sweepGradient.addColorStop(1, "rgba(139, 255, 232, 0)");
      ctx.fillStyle = sweepGradient;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, 1040, sweepRad - 0.045, sweepRad + 0.045);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(180, 255, 240, 0.58)";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(sweepRad) * 1040, centerY + Math.sin(sweepRad) * 1040);
      ctx.stroke();
      ctx.restore();
    },

    drawRunways(ctx) {
      ctx.save();
      for (const runway of this.airport.physicalRunways) {
        const heading = runway.heading ?? 0;
        const rad = heading * Math.PI / 180;
        const axis = { x: Math.sin(rad), y: -Math.cos(rad) };
        const perp = { x: Math.cos(rad), y: Math.sin(rad) };
        const halfLength = runway.length / 2;
        const halfWidth = runway.width / 2;
        const corners = [
          {
            x: runway.x - axis.x * halfLength - perp.x * halfWidth,
            y: runway.y - axis.y * halfLength - perp.y * halfWidth,
          },
          {
            x: runway.x - axis.x * halfLength + perp.x * halfWidth,
            y: runway.y - axis.y * halfLength + perp.y * halfWidth,
          },
          {
            x: runway.x + axis.x * halfLength + perp.x * halfWidth,
            y: runway.y + axis.y * halfLength + perp.y * halfWidth,
          },
          {
            x: runway.x + axis.x * halfLength - perp.x * halfWidth,
            y: runway.y + axis.y * halfLength - perp.y * halfWidth,
          },
        ];

        ctx.fillStyle = "#2f3a3a";
        ctx.strokeStyle = "rgba(231, 255, 248, 0.62)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (const corner of corners.slice(1)) {
          ctx.lineTo(corner.x, corner.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "rgba(231, 255, 248, 0.55)";
        ctx.setLineDash([18, 14]);
        ctx.beginPath();
        ctx.moveTo(runway.x - axis.x * (halfLength - 20), runway.y - axis.y * (halfLength - 20));
        ctx.lineTo(runway.x + axis.x * (halfLength - 20), runway.y + axis.y * (halfLength - 20));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#f4fff9";
        ctx.font = "bold 16px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          runway.labels.end,
          runway.x - axis.x * (halfLength + 18),
          runway.y - axis.y * (halfLength + 18),
        );
        ctx.fillText(
          runway.labels.start,
          runway.x + axis.x * (halfLength + 26),
          runway.y + axis.y * (halfLength + 26),
        );
      }
      ctx.textAlign = "start";
      ctx.restore();
    },

    drawRestrictedAreas(ctx) {
      ctx.save();
      for (const area of this.restrictedAreas) {
        if (!area.points || area.points.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(area.points[0].x, area.points[0].y);
        for (const point of area.points.slice(1)) {
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.fillStyle = area.active ? "rgba(255, 76, 76, 0.08)" : "rgba(255, 184, 77, 0.06)";
        ctx.strokeStyle = area.active ? "rgba(255, 94, 94, 0.72)" : "rgba(255, 184, 77, 0.45)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        const labelPoint = area.points.reduce((acc, point) => ({
          x: acc.x + point.x / area.points.length,
          y: acc.y + point.y / area.points.length,
        }), { x: 0, y: 0 });
        ctx.fillStyle = area.active ? "#ff9b9b" : "#ffd699";
        ctx.font = "bold 13px monospace";
        ctx.textAlign = "center";
        ctx.fillText(area.id, labelPoint.x, labelPoint.y - 4);
        ctx.fillText(area.label, labelPoint.x, labelPoint.y + 14);
      }
      ctx.textAlign = "start";
      ctx.restore();
    },

    drawDepartureProcedures(ctx) {
      ctx.save();
      ctx.strokeStyle = "rgba(92, 185, 255, 0.42)";
      ctx.fillStyle = "rgba(92, 185, 255, 0.82)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]);
      for (const procedure of this.departureProcedures) {
        if (!procedure.points || procedure.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(procedure.points[0].x, procedure.points[0].y);
        for (const point of procedure.points.slice(1)) {
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();

        const lastPoint = procedure.points[procedure.points.length - 1];
        ctx.setLineDash([]);
        ctx.font = "12px monospace";
        if (procedure.chartLabel !== false) {
          ctx.fillText(procedure.chartLabel || `${procedure.id} SID`, lastPoint.x + 12, lastPoint.y - 10);
        }
        ctx.setLineDash([8, 10]);
      }
      ctx.setLineDash([]);
      ctx.restore();
    },

    drawRadar() {
      const ctx = this.ctx;
      const { width, height } = this.airport.canvas;
      ctx.clearRect(0, 0, width, height);
      this.drawRadarBackground(ctx);

      // 如果游戏已结束，降低雷达背景亮度
      if (this.isGameOver) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, width, height);
      }

      this.drawRestrictedAreas(ctx);
      this.drawDepartureProcedures(ctx);
      this.drawRunways(ctx);

      // 绘制导航台
      this.drawNavBeacons(ctx);

      // 显示游戏状态、难度和分数
      ctx.fillStyle = "#00ffcc";
      ctx.font = "bold 18px monospace";
      ctx.fillText(`Status: ${this.getGameStatusText()}`, 20, 30);
      ctx.fillText(`Difficulty: ${this.getDifficultyText()}`, 20, 60);
      ctx.fillText(`Score: ${this.score}`, 20, 90); // 移动得分显示到第三行

      // 新增：显示当前飞机数量信息
      if (this.gameStatus === 'running') {
        ctx.fillText(`Aircraft: ${this.currentAircraftCount}/${this.dynamicMaxAircraftCount}`, 20, 120);

        // 显示游戏阶段信息
        let phaseText = '';
        let phaseColor = '#00ffcc';

        switch(this.gamePhase) {
          case 'busy':
            phaseText = 'BUSY TRAFFIC';
            phaseColor = '#ff9900'; // 橙色表示繁忙
            break;
          case 'calm':
            phaseText = 'CALM TRAFFIC';
            phaseColor = '#00ff99'; // 绿色表示平静
            break;
          default:
            phaseText = 'NORMAL TRAFFIC';
        }

        // 使用相应颜色显示游戏阶段
        ctx.fillStyle = phaseColor;
        ctx.fillText(phaseText, 20, 150);
        ctx.fillStyle = '#00ffcc'; // 恢复默认颜色

        // 显示游戏进度信息
        if (this.gameProgressLevel > 0) {
          ctx.fillText(`Progress Level: ${this.gameProgressLevel}`, 20, 180);
        }
      }

      // 绘制飞机
      for (const plane of this.airplanes) {
        ctx.save();

        // 检查是否是问题飞机（触发游戏结束的飞机）
        const isProblemAircraft = this.problemAircraft.includes(plane) || this.problemAircraft.includes(plane.id);

        // 如果是问题飞机且正在闪烁，设置红色
        if (isProblemAircraft && this.isBlinking) {
          ctx.fillStyle = "#FF0000";
          ctx.globalAlpha = 0.8; // 设置透明度
        } else if (this.isGameOver && !isProblemAircraft) {
          // 游戏结束时，非问题飞机变暗
          ctx.globalAlpha = 0.5;
        }

        ctx.translate(plane.x, plane.y);

        const heading = plane.heading;
        // 修正飞机旋转角度，确保和航向一致
        // Canvas中0度是向右的，要转换为0度朝上，需要减去90度
        const rotationAngle = ((heading - 90) + 360) % 360;

        ctx.rotate((rotationAngle * Math.PI) / 180);
        ctx.drawImage(this.airplaneImage, -20, -20, 40, 40);
        ctx.restore();

        // 设置飞机ID文本颜色
        if (isProblemAircraft && this.isBlinking) {
          ctx.fillStyle = "#FF0000"; // 问题飞机ID也为红色
        } else {
        ctx.fillStyle = plane.selected ? "#00ffcc" : "#ffffff";
        }

        ctx.font = "14px monospace";
        const currentHdg = Math.round(plane.heading) % 360;
        const altitudeHundreds = Math.round((plane.altitude || 0) / 100).toString().padStart(3, "0");
        const verticalTrend = plane.verticalSpeed > 50 ? "↑" : plane.verticalSpeed < -50 ? "↓" : " ";
        const airspeed = Math.max(0, Math.round(plane.indicatedSpeed || 0)).toString().padStart(3, "0");

        const labelX = plane.x + 25;
        ctx.fillText(plane.id, labelX, plane.y);
        const statusTag = getAircraftStatusTag(plane);
        if (statusTag) {
          const callsignWidth = ctx.measureText(plane.id).width;
          ctx.fillStyle = isProblemAircraft && this.isBlinking ? "#FF0000" : statusTag.color;
          ctx.font = "bold 12px monospace";
          ctx.fillText(statusTag.text, labelX + callsignWidth + 8, plane.y);
        }
        ctx.fillStyle = "#00ffcc";
        ctx.font = "12px monospace";
        ctx.fillText(`A${altitudeHundreds}${verticalTrend} S${airspeed} H${currentHdg.toString().padStart(3, "0")}`, labelX, plane.y + 18);
      }

      // 绘制拖拽线和转弯轨迹
      if (this.dragLine) {
        const startX = this.dragLine.x1;
        const startY = this.dragLine.y1;
        const endX = this.dragLine.x2;
        const endY = this.dragLine.y2;

        // 如果正在拖拽中，绘制黄色箭头
        if (this.dragLine.dragging) {
          // 拖拽中 - 绘制黄色直线和箭头（管制指令）
          ctx.strokeStyle = "#ffff00"; // 黄色表示指令
          ctx.lineWidth = 3; // 增加线宽使其更明显
          ctx.setLineDash([]);

          // 绘制直线
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          // 绘制箭头
          const headlen = 15; // 箭头长度
          const angle = Math.atan2(endY - startY, endX - startX);

          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headlen * Math.cos(angle - Math.PI / 6),
            endY - headlen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            endX - headlen * Math.cos(angle + Math.PI / 6),
            endY - headlen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = "#ffff00";
          ctx.fill();

          // 特殊处理：如果拖到了跑道入口，显示进场信息
          if (this.dragLine.isNearRunwayEntrance) {
            const runwayInfo = this.dragLine.runwayInfo;
            ctx.fillStyle = "#ffff00";
            ctx.font = "bold 14px monospace";
            ctx.textAlign = "center";
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2 - 20;
            ctx.fillText(`→ APPR RWY ${runwayInfo.id}`, midX, midY);
            ctx.textAlign = "start";
          }
          // 否则显示正常的航向信息
          else if (!this.dragLine.isDirectFlight) {
            // 与onDrag方法使用相同的航向计算逻辑
            const dx = endX - startX;
            const dy = endY - startY;
            const lineAngle = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);

            ctx.fillStyle = "#ffff00";
            ctx.font = "bold 14px monospace";
            ctx.textAlign = "center";
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2 - 20;
            ctx.fillText(`→ HDG ${lineAngle}°`, midX, midY);
            ctx.textAlign = "start";
          }
        } else if (this.dragLine.landingApproach) {
          // 绘制进场轨迹
        ctx.strokeStyle = "#00ffcc";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);

          // 开始从当前位置到跑道入口
          const entranceX = this.dragLine.runwayEntrance.x;
          const entranceY = this.dragLine.runwayEntrance.y;
          const finalHeading = this.dragLine.finalHeading;

          // 获取当前航向
          const currentHeading = Math.round(this.dragLine.startHeading) % 360;

          // 计算需要进行的转弯
          const clockwiseDiff = (finalHeading - currentHeading + 360) % 360;
          const counterClockwiseDiff = (currentHeading - finalHeading + 360) % 360;
          const shouldTurnClockwise = clockwiseDiff <= counterClockwiseDiff;
          const turnDir = shouldTurnClockwise ? "right" : "left";

          // 绘制从当前位置到跑道入口的弧线轨迹
          this.drawApproachPath(
            ctx,
            startX,
            startY,
            entranceX,
            entranceY,
            currentHeading,
            finalHeading,
            shouldTurnClockwise,
            this.dragLine.finalApproachDistance || 220,
          );

          // 显示进场信息
          ctx.setLineDash([]);
          ctx.fillStyle = "#00ffcc";
          ctx.font = "12px monospace";
          ctx.textAlign = "center";

          // 在入口位置显示跑道信息
          ctx.fillText(
            `APPR RWY ${this.dragLine.runwayInfo.id}`,
            entranceX,
            entranceY - 25
          );

          // 在中途显示转弯方向
          const midX = (startX + entranceX) / 2;
          const midY = (startY + entranceY) / 2;
          ctx.fillText(
            `${turnDir} to ${finalHeading}°`,
            midX,
            midY - 15
          );

          ctx.textAlign = "start";
        } else {
          // 拖拽结束后 - 绘制蓝色虚线轨迹（预计飞行路径）
          ctx.strokeStyle = "#00ffcc";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);

          // 获取航向角度（0-360度，0度为北方）
          const startHeading = Math.round(this.dragLine.startHeading) % 360;
          const targetHeading = Math.round(this.dragLine.targetHeading) % 360;

          // 检查是否为直线飞行
          if (this.dragLine.isDirectFlight) {
            // 直线飞行 - 简单绘制一条直线
        ctx.beginPath();
            ctx.moveTo(startX, startY);

            // 根据目标航向计算终点 - 修正用航空角度(0为北)来计算
            const rad = (targetHeading * Math.PI) / 180;
            const lineLength = 400; // 直线长度
            // 正确计算：0度是北方，所以需要用sine计算x方向，negative cosine计算y方向
            const endX = startX + Math.sin(rad) * lineLength;
            const endY = startY - Math.cos(rad) * lineLength;

            ctx.lineTo(endX, endY);
        ctx.stroke();

            // 在终点显示航向文本
        ctx.setLineDash([]);
            ctx.fillStyle = "#00ffcc";
            ctx.font = "12px monospace";
            ctx.textAlign = "center";

            ctx.fillText(
              `HDG ${targetHeading}°`,
              endX,
              endY - 20
            );

            ctx.textAlign = "start";
          } else {
            // 转弯飞行 - 使用与updateAircraftHeading完全相同的逻辑

            // 获取角度差
            const clockwiseDiff = this.dragLine.clockwiseDiff;
            const counterClockwiseDiff = this.dragLine.counterClockwiseDiff;

            // 使用与指令和飞行逻辑相同的转向方向确定方式
            let isTurnClockwise;

            if (this.dragLine.turnDirection === 'right') {
              isTurnClockwise = true;
            } else if (this.dragLine.turnDirection === 'left') {
              isTurnClockwise = false;
            } else {
              // 如果没有指定，使用角度差确定
              isTurnClockwise = clockwiseDiff <= counterClockwiseDiff;
            }

            // 开始绘制路径
            ctx.beginPath();
            ctx.moveTo(startX, startY);

            // 使用与updateAircraftHeading完全相同的逻辑模拟飞行
            let currentHeading = startHeading;
            let currentX = startX;
            let currentY = startY;

            // 路径分段
            const steps = 200;  // 足够多的步数确保平滑显示

            // 使用与updateAircraftHeading相同的转弯逻辑
            const startToTargetDiff = isTurnClockwise ?
              (targetHeading - startHeading + 360) % 360 :
              (startHeading - targetHeading + 360) % 360;

            // 计算相对于当前航向，需要调整的角度（取最小值）
            const headingDiff = Math.min(clockwiseDiff, counterClockwiseDiff);

            // 基础转向速率
            const baseTurnRate = 0.5;

            // 动态调整转向速率 - 角度差越大，转向速率越小
            let turnRateMultiplier = 1.0;

            // 当角度差大于30度时开始减小转向速率
            if (headingDiff > 30) {
              // 角度越大，系数越小，但保持最小0.3倍速率
              turnRateMultiplier = Math.max(0.3, 1 - (headingDiff - 30) / 150);
            }

            // 应用系数计算实际转向速率
            const turnRate = baseTurnRate * turnRateMultiplier;

            for (let i = 0; i < steps; i++) {
              // 使用与updateAircraftHeading相同的航向更新逻辑
              if (currentHeading !== targetHeading) {
                if (isTurnClockwise) {
                  // 顺时针转向（右转）
                  const currentClockwiseDiff = (targetHeading - currentHeading + 360) % 360;
                  if (currentClockwiseDiff <= turnRate) {
                    currentHeading = targetHeading;
                  } else {
                    currentHeading = (currentHeading + turnRate) % 360;
                  }
                } else {
                  // 逆时针转向（左转）
                  const currentCounterClockwiseDiff = (currentHeading - targetHeading + 360) % 360;
                  if (currentCounterClockwiseDiff <= turnRate) {
                    currentHeading = targetHeading;
                  } else {
                    currentHeading = (currentHeading - turnRate + 360) % 360;
                  }
                }
              }

              // 根据当前航向移动 - 确保航向角度与飞行方向一致 (0度是北)
              const rad = (currentHeading * Math.PI) / 180;
              const dx = Math.sin(rad) * 2;  // 放大移动距离以可视化轨迹
              const dy = -Math.cos(rad) * 2;  // 注意负号！0度是上方，所以cos为负

              currentX += dx;
              currentY += dy;

              // 绘制轨迹点
              ctx.lineTo(currentX, currentY);

              // 如果已到达目标航向，再继续直线飞行一段距离后停止
              if (currentHeading === targetHeading) {
                // 如果已经达到目标航向，再飞行100步就停止
                if (i > 100) break;
              }
            }

            // 完成路径绘制
            ctx.stroke();

            // 在轨迹终点显示目标航向文本
            ctx.setLineDash([]);
            ctx.fillStyle = "#00ffcc";
            ctx.font = "12px monospace";
            ctx.textAlign = "center";

            // 显示转弯方向和目标航向
            const dirText = isTurnClockwise ? 'right' : 'left';
            ctx.fillText(
              `${dirText} HDG ${targetHeading}°`,
              currentX,
              currentY - 20
            );

            ctx.textAlign = "start";
          }
        }

        // 重置绘图状态
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }

      // 绘制即将出现的飞机和倒计时
      for (const plane of this.incomingAircraft) {
        ctx.save();

        // 设置倒计时文本样式
        ctx.fillStyle = "#ff9900"; // 橙色表示警告/即将出现
        ctx.font = "bold 24px monospace";
        ctx.textAlign = "center";

        // 根据飞机出现的边缘位置显示不同的倒计时效果
        let countdownText = plane.countdown.toString();
        let offsetX = 0;
        let offsetY = 0;

        // 调整倒计时位置和显示方式
        if (plane.position === "left") {
          // 从左边出现的飞机，倒计时显示在右侧
          offsetX = 30;
          // 同时显示部分倒计时序列，例如只显示"321"
          countdownText = plane.countdown <= 3 ? plane.countdown.toString() : "";
        } else if (plane.position === "right") {
          // 从右边出现的飞机，倒计时显示在左侧
          offsetX = -30;
          // 同样只显示部分倒计时
          countdownText = plane.countdown <= 3 ? plane.countdown.toString() : "";
        } else if (plane.position === "top") {
          // 从上方(北部)出现的飞机，倒计时显示在下方
          offsetY = 30;
          // 显示逆序倒计时 (1到5，而不是5到1)
          countdownText = (6 - plane.countdown).toString();
        } else if (plane.position === "bottom") {
          // 从下方(南部)出现的飞机，倒计时显示在上方
          offsetY = -30;
          // 显示完整倒计时
          countdownText = plane.countdown.toString();
        }

        // 在飞机位置周围显示倒计时
        ctx.fillText(countdownText, plane.x + offsetX, plane.y + offsetY);

        // 如果需要，可以添加飞机ID和提示文本
        ctx.font = "14px monospace";
        ctx.fillText(`${plane.id}`, plane.x, plane.y + 25);

        ctx.restore();
      }

      // 如果游戏已结束，绘制游戏结束画面
      if (this.isGameOver) {
        this.drawGameOver(ctx);
      }
    },
    getClickedPlane(x, y) {
      // 考虑到飞机图标的大小，使用更合适的点击区域
      const clickRadius = 30; // 点击判定半径

      return this.airplanes.find(plane => {
        const distance = Math.sqrt(
          Math.pow(plane.x - x, 2) +
          Math.pow(plane.y - y, 2)
        );
        return distance < clickRadius;
      });
    },
    getCanvasInteractionPoint(event) {
      const canvas = this.$refs.radarCanvas;
      if (!canvas || !event) return null;
      return getScaledCanvasPoint(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        canvas.width,
        canvas.height,
      );
    },
    startTalkPointer(event) {
      if (event.pointerType === "mouse" || this.activeTalkPointerId !== null) return;
      event.preventDefault();
      this.unlockAudioForPlayback();
      this.activeTalkPointerId = event.pointerId;
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch (error) {
        // Pointer capture is optional on older mobile browsers.
      }
      this.startVoiceCommand(false);
    },
    endTalkPointer(event) {
      if (event.pointerType === "mouse" || event.pointerId !== this.activeTalkPointerId) return;
      event.preventDefault();
      this.stopVoiceCommand();
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch (error) {
        // The browser may already have released capture.
      }
      this.activeTalkPointerId = null;
    },
    startPointerDrag(event) {
      if (event.pointerType === "mouse" || this.activePointerId !== null) return;
      event.preventDefault();
      this.unlockAudioForPlayback();
      this.activePointerId = event.pointerId;
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch (error) {
        // Pointer capture is optional on older mobile browsers.
      }
      this.startDrag(event);
    },
    movePointerDrag(event) {
      if (event.pointerType === "mouse" || event.pointerId !== this.activePointerId) return;
      event.preventDefault();
      this.onDrag(event);
    },
    endPointerDrag(event) {
      if (event.pointerType === "mouse" || event.pointerId !== this.activePointerId) return;
      event.preventDefault();
      this.endDrag(event);
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch (error) {
        // The browser may already have released capture after pointerup.
      }
      this.activePointerId = null;
    },
    cancelPointerDrag(event) {
      if (event.pointerType === "mouse" || event.pointerId !== this.activePointerId) return;
      event.preventDefault();

      if (this.dragFollowing) {
        const queue = this.airport.departureQueue || {
          x: this.airport.center.x,
          y: this.airport.center.y,
          spacingX: 0,
          spacingY: 50,
        };
        const queuePosition = this.dragFollowing.queuePosition || 0;
        this.dragFollowing.x = queue.x + queuePosition * (queue.spacingX || 0);
        this.dragFollowing.y = queue.y + queuePosition * (queue.spacingY || 50);
      }
      if (this.selectedPlane) this.selectedPlane.selected = false;
      this.selectedPlane = null;
      this.dragging = false;
      this.dragFollowing = null;
      this.dragLine = null;
      this.activePointerId = null;
    },
    startDrag(event) {
      if (this.gameStatus !== 'running' && !this.isGameOver) return;
      const point = this.getCanvasInteractionPoint(event);
      if (!point) return;
      const { x, y } = point;

      // 如果游戏已结束，检查是否点击了按钮
      if (this.isGameOver) {
        // 检查"RESTART"按钮
        if (this.isPointInRect(x, y, 700, 700, 200, 60)) {
          this.handleRestartButton();
          return;
        }

        // 检查"MENU"按钮
        if (this.isPointInRect(x, y, 950, 700, 200, 60)) {
          this.handleMenuButton();
          return;
        }

        return; // 游戏结束状态下，如果没点击按钮，忽略其他点击
      }

      // 查找被点击的飞机
      const coarsePointer = event.pointerType === "touch" || event.pointerType === "pen";
      const hitRadius = coarsePointer
        ? getCoarsePointerHitRadius(point.scaleX, point.scaleY)
        : 30;
      const clicked = this.findClickedPlane(x, y, hitRadius);

      if (clicked) {
        // 问题2修复：检查起飞飞机是否已离开跑道
        if (clicked.state === "TAKEOFF" && !this.isAircraftOffRunway(clicked)) {
          // 飞机还在跑道上，显示警告但不允许拖拽
          this.addToCommunicationLog(`${clicked.id}, must exit runway before accepting heading commands`);
          // 移除语音通话，仅在日志中显示
          return;
        }

        this.selectedPlane = clicked;
        clicked.selected = true;
        this.dragging = true;
        if (clicked.state === "READY_FOR_TAKEOFF") {
          this.dragFollowing = clicked;
        } else {
          this.dragLine = {
            x1: clicked.x,
            y1: clicked.y,
            x2: x,
            y2: y,
            dragging: true
          };
        }
      }
    },
    onDrag(event) {
      if (!this.dragging || this.gameStatus !== 'running') return;
      const point = this.getCanvasInteractionPoint(event);
      if (!point) return;
      const newX = point.x;
      const newY = point.y;

        if (this.dragFollowing) {
          this.dragFollowing.x = newX;
          this.dragFollowing.y = newY;
        } else if (this.selectedPlane) {
        // 问题2修复：在拖拽过程中也检查起飞飞机是否已离开跑道
        if (this.selectedPlane.state === "TAKEOFF" && !this.isAircraftOffRunway(this.selectedPlane)) {
          // 飞机还在跑道上，只允许显示跑道方向的拖拽线
          // 计算跑道方向航向
          const runwayHeading = (this.selectedPlane.heading + 360) % 360;
          // 计算沿跑道方向的点
          const rad = (runwayHeading * Math.PI) / 180;
          const dx = Math.sin(rad) * 150; // 150像素长的线
          const dy = -Math.cos(rad) * 150;

          // 更新拖拽线，只允许沿跑道方向
          this.dragLine = {
            x1: this.selectedPlane.x,
            y1: this.selectedPlane.y,
            x2: this.selectedPlane.x + dx,
            y2: this.selectedPlane.y + dy,
            startHeading: runwayHeading,
            targetHeading: runwayHeading,
            dragging: true,
            isDirectFlight: true,
            turnDirection: 'none',
            isOnRunway: true
          };
          return;
        }

          const dx = newX - this.selectedPlane.x;
          const dy = newY - this.selectedPlane.y;

        // 检查是否拖到了跑道入口
        const runwayCheck = this.checkNearRunwayEntrance(newX, newY);
        const isNearRunwayEntrance = runwayCheck && runwayCheck.isNear;

        // 直接使用与飞机移动相同的逻辑计算航向
        // 飞机移动时使用: dx = Math.sin(rad) * speed; dy = -Math.cos(rad) * speed;
        // 因此，对于航向计算，我们反向解出rad: rad = Math.atan2(dx, -dy)
        const targetAngle = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);

        // 计算当前航向 (0-359)
        const currentHeading = Math.round(this.selectedPlane.heading) % 360;

        // 计算顺时针和逆时针的角度差
        const clockwiseDiff = (targetAngle - currentHeading + 360) % 360;
        const counterClockwiseDiff = (currentHeading - targetAngle + 360) % 360;

        // 判定是否为直线飞行 - 如果角度差很小或是完全相同，视为直线飞行
        const angleThreshold = 15; // 角度阈值，小于此视为直线
        const isDirectFlight = clockwiseDiff < angleThreshold || counterClockwiseDiff < angleThreshold;

        // 确定转向方向 - 选择转弯角度最小的方向
        let turnDirection = 'none';
        if (!isDirectFlight) {
          turnDirection = clockwiseDiff <= counterClockwiseDiff ? 'right' : 'left';
        }

        // 保存拖拽中的指令线信息
          this.dragLine = {
            x1: this.selectedPlane.x,
            y1: this.selectedPlane.y,
            x2: newX,
          y2: newY,
          startHeading: currentHeading,
          targetHeading: targetAngle,
          turnDirection: turnDirection,
          clockwiseDiff: clockwiseDiff,
          counterClockwiseDiff: counterClockwiseDiff,
          dragging: true,
          isDirectFlight: isDirectFlight,
          // 添加跑道相关信息
          isNearRunwayEntrance: isNearRunwayEntrance,
          runwayInfo: isNearRunwayEntrance && runwayCheck ? runwayCheck.info : null
        };
      }
    },
    endDrag(event) {
      if (!this.dragging || this.gameStatus !== 'running') return;

      // 处理准备起飞的飞机特殊情况
      if (this.dragFollowing && this.selectedPlane) {
        const plane = this.selectedPlane;
        const x = plane.x;
        const y = plane.y;

        const queue = this.airport.departureQueue || { x: this.airport.center.x, y: this.airport.center.y, spacingX: 0, spacingY: 50 };
        const queuePosition = plane.queuePosition || 0;
        const originalX = queue.x + queuePosition * (queue.spacingX || 0);
        const originalY = queue.y + queuePosition * (queue.spacingY || 50);

        // 记录当前状态
        const originalState = plane.state;
        const wasReadyForTakeoff = originalState === "READY_FOR_TAKEOFF";

        if (plane.state === "READY_FOR_TAKEOFF") {
          const runwayCheck = this.checkNearRunwayEntrance(x, y);
          const runwayInfo = runwayCheck.isNear ? runwayCheck.info : null;
          const occupyingPlane = runwayInfo
            ? this.getRunwayOccupyingAircraft(runwayInfo.id, plane)
            : null;
          const success = Boolean(runwayInfo && !occupyingPlane);

          if (occupyingPlane) {
            this.speak(`${plane.id}, hold position, runway occupied by ${occupyingPlane.id}`);
          }

          if (success) {
            plane.x = runwayInfo.x;
            plane.y = runwayInfo.y;
            plane.heading = runwayInfo.direction;
            plane.targetHeading = runwayInfo.direction;
            plane.runway = runwayInfo.id;
            this.initializeTakeoffRoll(plane, runwayInfo.id);

            const message = `${plane.id}, cleared for takeoff runway ${runwayInfo.id}`;
            this.speak(message);
            console.log(`Taking off runway ${runwayInfo.id}, heading:`, plane.heading);
          }

          // 如果放置不成功，将飞机返回原始位置
          if (!success) {
            plane.x = originalX;
            plane.y = originalY;
            if (!occupyingPlane) {
              this.addToCommunicationLog(`${plane.id}, unable to take position, return to gate`);
            }
            console.log(`${plane.id} 未成功放置到跑道端口，返回原位`);
        } else {
            // 如果成功起飞，从队列中移除
            delete plane.queuePosition;
          }

          // 如果状态改变（READY_FOR_TAKEOFF -> TAKEOFF或仍为READY_FOR_TAKEOFF但位置改变了）
          // 更新队列
          if (wasReadyForTakeoff) {
            this.updateTakeoffQueue();
          }
        }

        plane.selected = false;
        this.selectedPlane = null;
        this.dragging = false;
        this.dragFollowing = null;
        return;
      }

      if (!this.selectedPlane || !this.dragLine) {
        // 清理状态
        this.selectedPlane = null;
        this.dragging = false;
        this.dragFollowing = null;
        return;
      }

      const plane = this.selectedPlane;

      // 离开跑道校验
      if (plane.state === "TAKEOFF" && !this.isAircraftOffRunway(plane)) {
        // 如果飞机还在跑道上，不允许转向，发出警告提示
        this.addToCommunicationLog(`${plane.id}, please exit runway before turning`);

        // 重置拖拽状态
        plane.selected = false;
        this.selectedPlane = null;
        this.dragging = false;
        this.dragFollowing = null;
        this.dragLine = null;
        return;
      }

      // 检查是否拖到了跑道入口
      if (this.dragLine.isNearRunwayEntrance && ["APPROACH", "FLYING", "FINAL_APPROACH"].includes(plane.state)) {
        // 创建一个进场指令
        const runwayInfo = this.dragLine.runwayInfo;

        if (!runwayInfo) {
          console.error("Runway information missing in dragLine");
          return;
        }

        // Repeating the same clearance must keep the established approach.
        // Previously, a second touch drag on final was treated as a heading
        // command, which cancelled the landing and triggered another go-around.
        if (this.continueExistingApproach(plane, runwayInfo.id)) {
          plane.selected = false;
          this.selectedPlane = null;
          this.dragging = false;
          this.dragFollowing = null;
          this.dragLine = null;
          return;
        }

        // 设置飞机目标为跑道入口位置
        const entranceX = runwayInfo.x;
        const entranceY = runwayInfo.y;

        // 计算当前航向与最终跑道航向的差异，用于确定转向方向
        const currentHeading = Math.round(plane.heading) % 360;
        const finalHeading = runwayInfo.direction;

        // 保存进场航迹信息，供飞机跟随
        this.dragLine.dragging = false;
        this.dragLine.landingApproach = true;
        this.dragLine.runwayEntrance = {
          x: entranceX,
          y: entranceY
        };
        this.dragLine.finalHeading = finalHeading;

        // 使用改进的进场航迹生成方法
        const finalApproachDistance = getFinalApproachDistance(plane.altitude);
        this.dragLine.finalApproachDistance = finalApproachDistance;
        const pathInfo = this.drawApproachPath(
          this.ctx,
          plane.x,
          plane.y,
          entranceX,
          entranceY,
          currentHeading,
          finalHeading,
          true, // 默认顺时针转向，实际由航迹规划算法决定
          finalApproachDistance,
        );

        // 直接设置为最终进场状态
        plane.state = "FINAL_APPROACH";
        plane.landingRunway = runwayInfo.id;
        plane.landingDirection = finalHeading;
        plane.runway = null;
        plane.missedApproachActive = false;
        plane.newCommandIssued = false;
        plane.approachPathCreated = true;

        // 保存当前速度值
        const currentSpeed = plane.speed;

        // 在飞机对象上存储进场相关信息，用于实际飞行
        plane.approachPath = {
          // 起点和终点
          startX: plane.x,
          startY: plane.y,
          runwayX: entranceX,
          runwayY: entranceY,

          // 当前和目标航向
          startHeading: currentHeading,
          finalHeading: finalHeading,

          // 贝塞尔曲线控制点和关键点 - 用于飞机跟随航迹
          bezierPoints: {
            start: { x: plane.x, y: plane.y },
            cp1: pathInfo.controlPoints[0],
            cp2: pathInfo.controlPoints[1],
            preApproach: pathInfo.preApproachPoint
          },
          finalApproachPoint: pathInfo.finalApproachPoint,
          trajectory: pathInfo.trajectory,

          // 进场阶段跟踪
          phase: "INITIAL", // INITIAL -> TURN -> FINAL_APPROACH -> LANDING
          progressT: 0, // 贝塞尔曲线参数，从0到1
          lastUpdateTime: Date.now(),

          // 明确设置原始速度 - 确保进场过程中速度连续性
          originalSpeed: currentSpeed,
          startAltitude: plane.altitude ?? plane.targetAltitude ?? 3000,
          finalGateAltitude: 1200,
          thresholdCrossingAltitude: 50,

          // 初始化速度因子为1.0，确保前期不减速
          speedFactor: 1.0,

          // 预计算曲线长度，避免初始帧的速度异常
          curveLength: pathInfo.curveLength
        };

        // 确保速度连续性，避免突然加速
        console.log(`${plane.id} 进场速度设置: ${currentSpeed.toFixed(2)}`);

        // 航迹进场使用贝塞尔曲线插值来更新位置
        // 不再直接设置目标航向，而是在updateFlights中动态计算

        // 发布落地许可
        const message = `${plane.id}, cleared to land runway ${runwayInfo.id}`;
          this.speak(message);

        // 保存进场轨迹显示3秒 - 延长显示时间以便观察
        setTimeout(() => {
          this.dragLine = null;
        }, 3000);

        console.log(`${plane.id} cleared to land runway ${runwayInfo.id}, direction=${finalHeading}°`);
        } else {
        // 常规航向指令处理
        if (this.dragLine.dragging) {
          // 重新计算目标航向，确保一致性
          const dx = this.dragLine.x2 - this.dragLine.x1;
          const dy = this.dragLine.y2 - this.dragLine.y1;
          const targetHeading = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);

          // 更新dragLine和飞机的目标航向
          this.dragLine.targetHeading = targetHeading;
          plane.targetHeading = targetHeading;
        }

        const targetHeading = Math.round(this.dragLine.targetHeading) % 360;
        const turnDirection = this.dragLine.turnDirection;

        // 检查飞机是否处于特殊状态（进场或着陆），如果是则重置状态
        this.resetApproachOrLandingState(plane);

        // 确保飞机目标航向与dragLine中的一致
        plane.targetHeading = targetHeading;

        // 保存转向方向到飞机对象
        if (turnDirection && turnDirection !== 'none') {
          plane.forcedTurnDirection = turnDirection;
          plane.preferredTurnDirection = turnDirection;
        }

        let message;
        if (this.dragLine.isDirectFlight) {
          // 直线飞行指令 - 改为英文
          message = `${plane.id}, maintain heading ${targetHeading}`;
          plane.forcedTurnDirection = null; // 取消任何转向方向
          plane.preferredTurnDirection = null;
        } else {
          // 转弯指令 - 改为英文
          const dirText = turnDirection === 'right' ? 'turn right' : 'turn left';
          message = `${plane.id}, ${dirText} heading ${targetHeading}`;
          console.log(`${plane.id} 转向指令: ${dirText}, 当前=${Math.round(this.dragLine.startHeading)}°, 目标=${targetHeading}°`);
        }

        // 只在通话记录中显示
          this.speak(message);

        // 更新dragLine，将其标记为非拖拽状态，用于显示预计飞行轨迹
        if (this.dragLine) {
          this.dragLine.dragging = false;
        }

        // 保持预计轨迹显示1.5秒
        setTimeout(() => {
          this.dragLine = null;
        }, 1500);
      }

      if (plane) {
        plane.selected = false;
      }

        this.selectedPlane = null;
        this.dragging = false;
        this.dragFollowing = null;
    },
    getGameStatusText() {
      switch(this.gameStatus) {
        case 'start': return 'Ready';
        case 'stopped': return 'Not Started';
        case 'running': return 'Running';
        case 'paused': return 'Paused';
        case 'ended': return 'Ended';
        default: return 'Unknown';
      }
    },
    // 添加获取难度文本的方法
    getDifficultyText() {
      switch(this.difficulty) {
        case 'beginner': return 'Beginner';
        case 'intermediate': return 'Intermediate';
        case 'advanced': return 'Advanced';
        case 'expert': return 'Expert';
        default: return 'Unknown';
      }
    },
    // 绘制导航台方法
    drawNavBeacons(ctx) {
      // 使用与雷达界面相同的蓝色
      ctx.fillStyle = "#8fffe6";
      ctx.strokeStyle = "#8fffe6";
      ctx.lineWidth = 1;

      // 绘制每个导航台
      for (const beacon of this.navBeacons) {
        // 绘制三角形导航台标记
        ctx.beginPath();

        // 三角形的三个顶点
        const triangleSize = 15;
        ctx.moveTo(beacon.x, beacon.y - triangleSize); // 顶点
        ctx.lineTo(beacon.x - triangleSize, beacon.y + triangleSize); // 左下
        ctx.lineTo(beacon.x + triangleSize, beacon.y + triangleSize); // 右下
        ctx.closePath();

        // 描边和填充
        ctx.stroke();
        ctx.globalAlpha = 0.5; // 半透明填充
        ctx.fill();
        ctx.globalAlpha = 1.0; // 恢复透明度

        // 绘制导航台ID
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.fillText(beacon.id, beacon.x, beacon.y - 25);
        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(143, 255, 230, 0.62)";
        const beaconDetails = [beacon.type || 'FIX', beacon.freq].filter(Boolean).join(' ');
        ctx.fillText(beaconDetails, beacon.x, beacon.y + 35);
        ctx.fillStyle = "#8fffe6";
        ctx.textAlign = "start";
      }
    },
    // 检查位置是否在跑道入口附近 - 优化检测逻辑
    checkNearRunwayEntrance(x, y) {
      const runwayEntrances = this.runways.map(runway => ({
        x: runway.startX,
        y: runway.startY,
        id: runway.id,
        direction: runway.heading,
        type: runway.heading === 0 ? "south" : "north",
        radius: 55,
      }));

      // 检查是否接近任一跑道入口
      for (const entrance of runwayEntrances) {
        const distance = Math.sqrt(
          Math.pow(x - entrance.x, 2) +
          Math.pow(y - entrance.y, 2)
        );

        if (distance <= entrance.radius) {
          console.log(`检测到接近跑道入口: ${entrance.id}, 距离=${distance.toFixed(1)}px`);
          return {
            isNear: true,
            info: entrance
          };
        }
      }

      return { isNear: false };
    },
    createAndDrawApproachTrajectory(ctx, startX, startY, endX, endY, startHeading, finalHeading, finalApproachDistance) {
      const trajectory = buildSmoothApproachTrajectory({
        startX,
        startY,
        startHeading,
        runwayX: endX,
        runwayY: endY,
        finalHeading,
        finalApproachDistance,
      });

      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        const sampleStep = 4;
        for (let distance = sampleStep; distance < trajectory.curveLength; distance += sampleStep) {
          const pose = getApproachPoseAtDistance(trajectory, distance);
          ctx.lineTo(pose.point.x, pose.point.y);
        }
        ctx.lineTo(trajectory.finalApproachPoint.x, trajectory.finalApproachPoint.y);
        ctx.lineTo(endX, endY);
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "#00ffcc";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        const middlePose = getApproachPoseAtDistance(trajectory, trajectory.curveLength / 2);
        this.drawArrowHead(
          ctx,
          middlePose.point.x,
          middlePose.point.y,
          middlePose.tangent.x,
          middlePose.tangent.y,
          10,
        );
        const finalVector = {
          x: Math.sin(finalHeading * Math.PI / 180),
          y: -Math.cos(finalHeading * Math.PI / 180),
        };
        this.drawArrowHead(
          ctx,
          trajectory.finalApproachPoint.x,
          trajectory.finalApproachPoint.y,
          finalVector.x,
          finalVector.y,
          10,
        );
      }

      return {
        trajectory,
        finalApproachPoint: trajectory.finalApproachPoint,
        preApproachPoint: trajectory.finalApproachPoint,
        curveLength: trajectory.curveLength,
        controlPoints: [trajectory.finalApproachPoint, trajectory.finalApproachPoint],
      };
    },

    // 绘制与飞机实际跟随路线完全一致的进场航迹
    drawApproachPath(ctx, startX, startY, endX, endY, startHeading, finalHeading, clockwise, finalApproachDistance = 220) {
      return this.createAndDrawApproachTrajectory(
        ctx,
        startX,
        startY,
        endX,
        endY,
        startHeading,
        finalHeading,
        finalApproachDistance,
      );

      try {
        // 清除之前的路径，开始一个新路径
        ctx.beginPath();
        ctx.moveTo(startX, startY);

        // 航迹规划的关键点
        const fromPos = { x: startX, y: startY };
        const runwayPos = { x: endX, y: endY };

        // 计算跑道延长线的点 - 向外延伸2000像素，确保足够长
        const runwayAngle = (finalHeading * Math.PI) / 180;
        const oppRunwayAngle = ((finalHeading + 180) % 360) * Math.PI / 180;

        // 计算跑道延长线上的点 - 从跑道反向延伸
        const extendedRunwayX = runwayPos.x + Math.sin(oppRunwayAngle) * 2000;
        const extendedRunwayY = runwayPos.y - Math.cos(oppRunwayAngle) * 2000;
        const extendedRunwayPoint = { x: extendedRunwayX, y: extendedRunwayY };

        // 确定进场点 - 跑道延长线上距离跑道一定距离的点
        // 问题2修复: 缩短直线进近航迹长度，从300像素减到100像素，大约是跑道长度的三分之一
        const finalApproachX = runwayPos.x + Math.sin(oppRunwayAngle) * finalApproachDistance;
        const finalApproachY = runwayPos.y - Math.cos(oppRunwayAngle) * finalApproachDistance;
        const finalApproachPoint = { x: finalApproachX, y: finalApproachY };

        // 计算从当前位置到进场点的方向向量
        const toFinalApproachVector = {
          x: finalApproachPoint.x - fromPos.x,
          y: finalApproachPoint.y - fromPos.y
        };

        // 归一化向量
        const vectorLength = Math.sqrt(
          toFinalApproachVector.x * toFinalApproachVector.x +
          toFinalApproachVector.y * toFinalApproachVector.y
        );

        // 计算当前航向到进场航向的夹角
        const currHeadingRad = (startHeading * Math.PI) / 180;
        const targetVector = {
          x: Math.sin(currHeadingRad),
          y: -Math.cos(currHeadingRad)
        };

        // 问题1修复: 重新设计贝塞尔曲线控制点，确保转弯有自然的弧度，防止原地掉头
        // 计算当前飞行方向和目标航向之间的夹角
        const currentDirection = Math.atan2(targetVector.y, targetVector.x);
        const targetDirection = Math.atan2(-toFinalApproachVector.y, toFinalApproachVector.x);

        // 计算角度差异（弧度）
        let angleDiff = targetDirection - currentDirection;
        // 标准化到 -π 到 π 之间
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // 根据角度差异确定合适的转弯半径（角度越大，半径越大）
        const turnRadius = Math.min(vectorLength * 0.4, 200 + Math.abs(angleDiff) * 100);

        // 基于合适的转弯半径计算基础点和控制点
        const distanceAlongCurrent = Math.max(turnRadius, vectorLength * 0.2);
        const basePointX = fromPos.x + targetVector.x * distanceAlongCurrent;
        const basePointY = fromPos.y + targetVector.y * distanceAlongCurrent;

        // 计算控制点1 - 从基础点沿当前航向延伸
        const cp1x = basePointX + targetVector.x * turnRadius * 0.8;
        const cp1y = basePointY + targetVector.y * turnRadius * 0.8;

        // 计算进场点之前的点 - 在跑道延长线上
        const preApproachDistance = finalApproachDistance * 1.4; // 再往外一点
        const preApproachX = runwayPos.x + Math.sin(oppRunwayAngle) * preApproachDistance;
        const preApproachY = runwayPos.y - Math.cos(oppRunwayAngle) * preApproachDistance;

        // 计算控制点2 - 从预进场点沿跑道方向延伸
        const runwayVector = {
          x: Math.sin(oppRunwayAngle),
          y: -Math.cos(oppRunwayAngle)
        };
        const cp2x = preApproachX + runwayVector.x * turnRadius * 0.8;
        const cp2y = preApproachY + runwayVector.y * turnRadius * 0.8;

        // 调试输出
        console.log(`绘制航迹 - 角度差: ${(angleDiff * 180 / Math.PI).toFixed(1)}度, 转弯半径: ${turnRadius.toFixed(1)}像素`);

        // 使用三次贝塞尔曲线绘制平滑的进场航迹
        // 从当前位置到基础点，再到预进场点，最后到最终进场点
        ctx.lineTo(basePointX, basePointY); // 沿当前航向飞行一小段

        // 绘制贝塞尔曲线 - 平滑过渡到跑道延长线
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, preApproachX, preApproachY);

        // 从预进场点到最终进场点的直线段
        ctx.lineTo(finalApproachPoint.x, finalApproachPoint.y);

        // 从最终进场点到跑道入口的直线段 - 这是最终进近航段
        ctx.lineTo(runwayPos.x, runwayPos.y);

        // 设置虚线样式绘制航迹
        ctx.setLineDash([5, 5]); // 5像素线段，5像素间隔
        ctx.strokeStyle = "#00ffcc";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 绘制箭头指示方向 - 多个箭头以显示路径方向
        // 重置线型为实线，以绘制箭头
        ctx.setLineDash([]);

        // 在贝塞尔曲线中间位置绘制一个箭头
        const midPointT = 0.5; // 贝塞尔曲线的中点参数
        const midPointX = Math.pow(1-midPointT, 3) * basePointX +
                          3 * Math.pow(1-midPointT, 2) * midPointT * cp1x +
                          3 * (1-midPointT) * Math.pow(midPointT, 2) * cp2x +
                          Math.pow(midPointT, 3) * preApproachX;

        const midPointY = Math.pow(1-midPointT, 3) * basePointY +
                          3 * Math.pow(1-midPointT, 2) * midPointT * cp1y +
                          3 * (1-midPointT) * Math.pow(midPointT, 2) * cp2y +
                          Math.pow(midPointT, 3) * preApproachY;

        // 计算贝塞尔曲线在中点处的切线方向
        const tangentX = -3 * Math.pow(1-midPointT, 2) * basePointX +
                         3 * (Math.pow(1-midPointT, 2) - 2 * (1-midPointT) * midPointT) * cp1x +
                         3 * (2 * (1-midPointT) * midPointT - Math.pow(midPointT, 2)) * cp2x +
                         3 * Math.pow(midPointT, 2) * preApproachX;

        const tangentY = -3 * Math.pow(1-midPointT, 2) * basePointY +
                         3 * (Math.pow(1-midPointT, 2) - 2 * (1-midPointT) * midPointT) * cp1y +
                         3 * (2 * (1-midPointT) * midPointT - Math.pow(midPointT, 2)) * cp2y +
                         3 * Math.pow(midPointT, 2) * preApproachY;

        // 归一化切线向量
        const tangentLength = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
        const normalizedTangentX = tangentX / tangentLength;
        const normalizedTangentY = tangentY / tangentLength;

        // 在曲线中点绘制箭头
        this.drawArrowHead(ctx, midPointX, midPointY,
                          normalizedTangentX, normalizedTangentY, 10);

        // 在最终进场点绘制箭头
        this.drawArrowHead(ctx, finalApproachPoint.x, finalApproachPoint.y,
                          Math.sin(runwayAngle), -Math.cos(runwayAngle), 10);

        // 还原默认线型，防止影响后续绘制
        ctx.setLineDash([]);

        // 返回进场航迹信息用于飞机导航
        // 确保返回值包含所有必要的信息
        const pathInfo = {
          controlPoints: [
            { x: cp1x, y: cp1y },
            { x: cp2x, y: cp2y }
          ],
          preApproachPoint: { x: preApproachX, y: preApproachY },
          finalApproachPoint: { x: finalApproachX, y: finalApproachY },
          // 估算贝塞尔曲线长度 - 用于计算飞行时间
          curveLength: Math.sqrt(Math.pow(preApproachX - startX, 2) + Math.pow(preApproachY - startY, 2)) * 1.3
        };

        return pathInfo;
      } catch (error) {
        console.error("绘制进场路径时出错:", error);

        // 即使出错，也返回一个有效的对象
        return {
          controlPoints: [
            { x: startX + 100, y: startY },
            { x: endX - 100, y: endY }
          ],
          preApproachPoint: { x: endX, y: endY },
          finalApproachPoint: { x: endX, y: endY },
          curveLength: 500
        };
      }
    },

    // 绘制箭头头部的辅助方法
    drawArrowHead(ctx, x, y, dirX, dirY, size) {
      // 保存当前绘图状态
      ctx.save();

      // 设置颜色和样式
      ctx.fillStyle = "#00ffcc";

      // 绘制箭头
      ctx.beginPath();

      // 计算垂直于方向的向量
      const perpX = -dirY;
      const perpY = dirX;

      // 箭头三个点的坐标
      const tipX = x;
      const tipY = y;

      // 箭头后面两个点
      const leftX = x - size * dirX + size * 0.5 * perpX;
      const leftY = y - size * dirY + size * 0.5 * perpY;

      const rightX = x - size * dirX - size * 0.5 * perpX;
      const rightY = y - size * dirY - size * 0.5 * perpY;

      // 绘制箭头路径
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();

      // 填充箭头
      ctx.fill();

      // 恢复之前的绘图状态
      ctx.restore();
    },
    // 新增方法 - 更新进场飞行的飞机位置和航向 - 简化版本，确保可靠
    updateApproachFlight(plane, dt) {
      try {
        // 检查是否有必要的路径数据
        if (!plane || !plane.approachPath) {
          return false;
        }

        // 检查是否收到新命令
        if (plane.newCommandIssued) {
          console.log(`${plane.id} 在最终进场过程中收到新命令，取消进场`);
          this.resetApproachOrLandingState(plane);
          return true;
        }

        // 防止重复调用造成问题
        if (plane._updatingApproach) {
          return true; // 已经在更新中，返回true避免常规更新
        }
        plane._updatingApproach = true;

        // 简化逻辑：确保所有必要的数据都存在
        const path = plane.approachPath;
        if (!path.phase || (path.phase === "INITIAL" && !path.trajectory)) {
          console.error(`${plane.id} 进场路径数据不完整`);
          plane._updatingApproach = false;
          return false;
        }

        // 获取原始速度并基于阶段计算实际使用的速度
        const baseSpeed = path.originalSpeed || 0.2;

        // 根据进场阶段处理
        try {
          switch(path.phase) {
            case "INITIAL":
              path.curveLength = path.trajectory.curveLength;
              path.speedFactor = path.speedFactor || 1;
              plane.speed = baseSpeed * path.speedFactor;
              path.totalDistance = (path.totalDistance || 0) + getMovementDistance(plane.speed, dt);
              path.totalDistance = Math.min(path.totalDistance, path.curveLength);
              const approachPose = getApproachPoseAtDistance(path.trajectory, path.totalDistance);
              path.progressT = approachPose.progress;
              plane.x = approachPose.point.x;
              plane.y = approachPose.point.y;
              plane.heading = vectorToHeading(approachPose.tangent);
              plane.targetHeading = plane.heading;

              const automaticInitialAirspeed = Math.round(220 - 20 * path.progressT);
              const initialTargetAirspeed = plane.assignedSpeed
                ? Math.min(automaticInitialAirspeed, plane.assignedSpeed)
                : automaticInitialAirspeed;
              plane.speed = Math.max(0.1, Math.min(0.24, baseSpeed * initialTargetAirspeed / 220));
              plane.indicatedSpeed = getNextValue(
                plane.indicatedSpeed || initialTargetAirspeed,
                initialTargetAirspeed,
                25,
                dt,
              );

              if (path.progressT >= 1.0) {
                path.progressT = 1.0;
                path.phase = "FINAL_APPROACH";
                path.distanceToRunway = Math.sqrt(
                  Math.pow(path.runwayX - plane.x, 2) +
                  Math.pow(path.runwayY - plane.y, 2)
                );
                path.initialDistanceToRunway = path.distanceToRunway;
                path.speedFactor = Math.min(path.speedFactor, 1.0);
                console.log(`${plane.id} 进入最终进场阶段，距离跑道${Math.round(path.distanceToRunway)}像素，速度系数${path.speedFactor.toFixed(2)}, 当前速度${plane.speed.toFixed(2)}`);
                plane._updatingApproach = false;
                return true;
              }
              break;

            case "FINAL_APPROACH":
              // 最终进场 - 直线飞向跑道入口

              // 计算到跑道入口的距离
              const dx = path.runwayX - plane.x;
              const dy = path.runwayY - plane.y;
              const distToRunway = Math.sqrt(dx*dx + dy*dy);
              path.distanceToRunway = distToRunway;

              // 根据到跑道的距离计算速度系数
              // 重要改进：使用更平滑的过渡，距离远时几乎不减速
              if (path.initialDistanceToRunway > 0) {
                const distanceRatio = Math.min(1, distToRunway / path.initialDistanceToRunway);

                // 改进版本：使用三次函数曲线实现更平滑的速度变化
                // 当距离跑道较远时(distanceRatio接近1)，速度几乎不变
                // 当接近跑道时(distanceRatio接近0)，速度明显减小
                const speedReductionFactor = distanceRatio * distanceRatio * distanceRatio;

                // 从初始的1.0逐渐减少到0.6，三次函数确保远距离时变化非常缓慢
                path.speedFactor = 0.6 + (0.4 * speedReductionFactor);
              } else {
                // 如果没有初始距离记录，使用一个安全的值
                path.speedFactor = 0.8;
              }

              // 应用速度系数
              plane.speed = baseSpeed * path.speedFactor;
              const airspeedRatio = path.initialDistanceToRunway > 0
                ? Math.min(1, distToRunway / path.initialDistanceToRunway)
                : 0.5;
              const automaticFinalAirspeed = Math.round(135 + 65 * airspeedRatio);
              const finalTargetAirspeed = plane.assignedSpeed
                ? Math.max(130, Math.min(automaticFinalAirspeed, plane.assignedSpeed))
                : automaticFinalAirspeed;
              plane.speed = Math.max(0.1, Math.min(plane.speed, finalTargetAirspeed / 1250));
              plane.indicatedSpeed = getNextValue(
                plane.indicatedSpeed || finalTargetAirspeed,
                finalTargetAirspeed,
                25,
                dt,
              );

              // 设置飞机航向为跑道方向
              plane.heading = path.finalHeading;
              plane.targetHeading = path.finalHeading;

              // 以当前速度移动
              const rad = (path.finalHeading * Math.PI) / 180;
              const movementDistance = getMovementDistance(plane.speed, dt);
              plane.x += Math.sin(rad) * movementDistance;
              plane.y += -Math.cos(rad) * movementDistance;

              // 定期记录调试信息
              if (Math.random() < 0.01) { // 平均每100帧记录一次
                console.log(`${plane.id} 最终进场中，距离跑道${Math.round(distToRunway)}像素，速度系数${path.speedFactor.toFixed(2)}, 速度${plane.speed.toFixed(2)}`);
              }

              // 检查是否到达跑道入口
              if (distToRunway < this.touchdownCaptureDistance) {
                const landingStarted = this.beginLandingRoll(plane, path.runwayX, path.runwayY);
                if (!landingStarted) break;

                // 发出着陆确认
                const message = `${plane.id}, landing runway ${plane.landingRunway}`;
                this.addToCommunicationLog(message);

                console.log(`${plane.id} 到达跑道入口，开始着陆，最终速度系数${path.speedFactor.toFixed(2)}, 着陆速度${plane.speed.toFixed(2)}`);

                // 清除目标跑道数据，防止重复处理
                plane.targetRunwayX = undefined;
                plane.targetRunwayY = undefined;

                // 跳过常规航向更新
              }
              break;

            default:
              console.warn(`${plane.id} 未知的进场阶段: ${path.phase}`);
              plane._updatingApproach = false;
              return false;
          }
        } catch (phaseError) {
          console.error(`处理${plane.id}的${path.phase}阶段时出错:`, phaseError);
          // 使用安全的线性移动
          this.moveTowardsRunway(plane);
        }

        plane._updatingApproach = false;
        return true;

      } catch (error) {
        console.error("updateApproachFlight严重错误:", error);

        // 重置状态防止卡住
        if (plane) {
          plane._updatingApproach = false;
          plane.state = "APPROACH";
          plane.approachPath = null;
        }

        return false;
      }
    },

    // 安全地更新飞机在贝塞尔曲线上的位置
    updatePlaneBezierPosition(plane, t) {
      try {
        const path = plane.approachPath;
        if (!path || !path.bezierPoints) return;

        // 贝塞尔点
        const p0 = path.bezierPoints.start;
        const p1 = path.bezierPoints.cp1;
        const p2 = path.bezierPoints.cp2;
        const p3 = path.bezierPoints.preApproach;

        // 计算位置
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        // 位置
        const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
        const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;

        // 更新飞机位置
        if (!isNaN(x) && !isNaN(y)) {
          plane.x = x;
          plane.y = y;

          // 计算切线方向用于航向
          const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
          const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);

          // 计算航向
          if (dx !== 0 || dy !== 0) {
            let heading = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (heading < 0) heading += 360;
            plane.heading = Math.round(heading);
            plane.targetHeading = plane.heading;
          }
        } else {
          // 位置计算出错，使用备用方法
          this.moveTowardsRunway(plane);
        }
      } catch (error) {
        console.error("计算贝塞尔位置时出错:", error);
        this.moveTowardsRunway(plane);
      }
    },

    // 当贝塞尔曲线计算失败时，使用简单的线性移动
    moveTowardsRunway(plane) {
      try {
        if (!plane || !plane.approachPath) return;

        const path = plane.approachPath;
        const speed = path.originalSpeed || plane.speed || 0.2;

        // 向跑道方向移动
        const dx = path.runwayX - plane.x;
        const dy = path.runwayY - plane.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist > 0) {
          plane.x += (dx / dist) * speed;
          plane.y += (dy / dist) * speed;

          // 更新航向指向跑道
          let heading = Math.atan2(dx, -dy) * 180 / Math.PI;
          if (heading < 0) heading += 360;
          plane.heading = Math.round(heading);
          plane.targetHeading = plane.heading;
        }
      } catch (error) {
        console.error("备用移动方法出错:", error);
      }
    },
    // 添加新方法，检查飞机是否已经离开跑道区域
    isAircraftOffRunway(plane) {
      const runway = plane.runway ? this.runways.find(r => r.id === plane.runway) : null;
      const strips = runway
        ? [this.airport.physicalRunways.find(strip => strip.id === runway.strip)].filter(Boolean)
        : this.airport.physicalRunways;

      const onRunway = strips.some(strip => this.isPointInsideRunwayStrip(plane.x, plane.y, strip, 35));
      if (onRunway) {
        console.log(`${plane.id} has not vacated the runway safety area`);
      }
      return !onRunway;
    },

    isPointInsideRunwayStrip(x, y, strip, margin = 0) {
      const heading = strip.heading ?? 0;
      const rad = heading * Math.PI / 180;
      const axis = { x: Math.sin(rad), y: -Math.cos(rad) };
      const perp = { x: Math.cos(rad), y: Math.sin(rad) };
      const relX = x - strip.x;
      const relY = y - strip.y;
      const along = relX * axis.x + relY * axis.y;
      const across = relX * perp.x + relY * perp.y;
      return Math.abs(along) <= strip.length / 2 + margin && Math.abs(across) <= strip.width / 2 + margin;
    },

    getRunwayStrip(runwayId) {
      const runway = this.runways.find(item => item.id === runwayId);
      return runway
        ? this.airport.physicalRunways.find(strip => strip.id === runway.strip) || null
        : null;
    },

    getRunwayCenterline(strip) {
      const heading = (strip?.heading || 0) * Math.PI / 180;
      const halfLength = (strip?.length || 0) / 2;
      const offsetX = Math.sin(heading) * halfLength;
      const offsetY = -Math.cos(heading) * halfLength;
      return {
        start: { x: strip.x - offsetX, y: strip.y - offsetY },
        end: { x: strip.x + offsetX, y: strip.y + offsetY },
      };
    },

    doSegmentsIntersect(first, second) {
      const orientation = (a, b, c) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const firstStart = orientation(first.start, first.end, second.start);
      const firstEnd = orientation(first.start, first.end, second.end);
      const secondStart = orientation(second.start, second.end, first.start);
      const secondEnd = orientation(second.start, second.end, first.end);
      return firstStart * firstEnd <= 0 && secondStart * secondEnd <= 0;
    },

    doRunwaysConflict(firstRunwayId, secondRunwayId) {
      const firstStrip = this.getRunwayStrip(firstRunwayId);
      const secondStrip = this.getRunwayStrip(secondRunwayId);
      if (!firstStrip || !secondStrip) return false;
      if (firstStrip.id === secondStrip.id) return true;
      return this.doSegmentsIntersect(
        this.getRunwayCenterline(firstStrip),
        this.getRunwayCenterline(secondStrip),
      );
    },

    getRunwayOccupyingAircraft(runwayId, excludedPlane = null) {
      if (!runwayId) return null;
      return this.airplanes.find(plane => {
        if (plane === excludedPlane || !["TAKEOFF", "LANDING"].includes(plane.state)) return false;
        const activeRunway = plane.runway || plane.landingRunway;
        return activeRunway &&
          this.doRunwaysConflict(runwayId, activeRunway) &&
          !this.isAircraftOffRunway(plane);
      }) || null;
    },

    getRunwayHeading(runwayId) {
      const runway = this.runways.find(item => item.id === runwayId);
      return runway ? runway.heading : 0;
    },

    initializeTakeoffRoll(plane, runwayId) {
      const runway = this.runways.find(item => item.id === runwayId);
      if (!plane || !runway) return false;

      plane.state = "TAKEOFF";
      plane.runway = runway.id;
      plane.heading = runway.heading;
      plane.targetHeading = runway.heading;
      plane.speed = 0.04;
      plane.targetMotionSpeed = 0.22;
      plane.indicatedSpeed = 80;
      plane.targetIndicatedSpeed = 220;
      plane.altitude = 0;
      plane.verticalSpeed = 0;
      plane.airborne = false;
      plane.takeoffRunwayProgress = 0;
      plane.targetAltitude = Math.max(plane.targetAltitude || 0, 5000);
      plane.departureProcedure = null;
      plane.departureProcedureWaypointIndex = 0;
      return true;
    },

    calculateRunwayProgress(plane, runway, strip) {
      return getRunwayTravelProgress(plane, runway, strip);
    },

    calculateBearing(fromX, fromY, toX, toY) {
      const dx = toX - fromX;
      const dy = toY - fromY;
      return Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);
    },

    cleanupSpeechRecognition() {
      if (!this.recognition) return;
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (e) {
        // Ignore stale browser recognition sessions.
      }
      this.recognition = null;
    },

    restartVoiceSession(sessionId) {
      if (!this.isRecording || sessionId !== this.voiceSessionId) return;
      if (this.voiceRestartTimeout) {
        clearTimeout(this.voiceRestartTimeout);
      }
      this.voiceRestartTimeout = setTimeout(() => {
        if (!this.isRecording || sessionId !== this.voiceSessionId || !this.recognition) return;
        try {
          this.recognition.start();
          this.voiceStatusText = 'Transmitting...';
        } catch (err) {
          console.error('Failed to restart speech recognition:', err);
          this.voiceStatusText = 'Mic restart failed';
        }
      }, 180);
    },

    commitVoiceCommand(command) {
      const normalized = (command || '').trim();
      if (!normalized || this.voiceHasFinalResult) return;
      this.voiceHasFinalResult = true;
      this.addToCommunicationLog(`TX: ${normalized}`);
      this.processVoiceCommand(normalized);
    },

    flushPendingVoiceCommand() {
      if (this.voiceCommitTimeout) {
        clearTimeout(this.voiceCommitTimeout);
        this.voiceCommitTimeout = null;
      }

      const commandToSend = this.pendingVoiceCommandText || this.voiceCommandText;
      if (commandToSend?.trim()) {
        this.commitVoiceCommand(commandToSend);
        this.voiceStatusText = this.voiceHasFinalResult ? 'Command sent' : 'Hold left Shift to transmit';
      } else {
        this.voiceStatusText = 'No speech recognized';
      }
    },

    schedulePendingVoiceCommand(delay = 0) {
      if (this.voiceCommitTimeout) {
        clearTimeout(this.voiceCommitTimeout);
      }
      this.voiceCommitTimeout = setTimeout(() => {
        this.voiceCommitTimeout = null;
        this.flushPendingVoiceCommand();
      }, delay);
    },

    // 初始化语音识别 - 支持多语言
    initSpeechRecognition() {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('Browser does not support speech recognition');
        this.voiceStatusText = 'Speech recognition unavailable';
        return;
      }

      this.cleanupSpeechRecognition();

      // 创建语音识别对象
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();

      // 配置语音识别 - 英文
      this.recognition.continuous = false;
      this.recognition.interimResults = true; // 显示中间结果
      this.recognition.lang = 'en-US'; // 使用英语
      this.recognition.maxAlternatives = 5; // 增加备选识别结果数量

      // 处理识别结果
      this.recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        const sessionId = this.voiceSessionId;

        // 尝试找到最佳匹配结果
        let bestTranscript = "";
        let highestConfidence = 0;

        // 检查所有可能的识别结果
        for (let i = 0; i < result.length; i++) {
          const transcript = result[i].transcript.trim();
          const confidence = result[i].confidence;

          // 针对航空通信进行简单的评分 - 偏好包含航班号和航空术语的结果
          let score = confidence;

          // 增加包含航班号格式的识别结果权重
          if (/\b(b|bravo)\s*\d{4}\b/i.test(transcript) || /\b\d{4}\b/i.test(transcript)) {
            score += 0.2;
          }

          // 增加包含常见航空指令的权重 - 使用英文术语
          const aviationTerms = ["heading", "turn", "left", "right", "runway", "cleared", "land", "takeoff", "climb", "descend", "direct", "go around"];

          for (const term of aviationTerms) {
            if (transcript.toLowerCase().includes(term)) {
              score += 0.05;
            }
          }

          if (score > highestConfidence) {
            highestConfidence = score;
            bestTranscript = transcript;
          }
        }

        // 将语音识别到的"BRAVO"替换为"B"，用于显示
        let displayText = bestTranscript;
        displayText = displayText.replace(/\bbravo\b/gi, "B");
        this.voiceCommandText = displayText;
        if (displayText.trim()) {
          this.pendingVoiceCommandText = displayText;
        }

        // Push-to-talk mode: final results are cached while Shift is held.
        // The command is executed only when the transmit key is released.
        if (result.isFinal && displayText.trim() !== '') {
          console.log("Speech recognition result:", bestTranscript, "confidence:", highestConfidence);
          this.voiceStatusText = 'Release Shift to send';
          if (this.voiceStopRequested) {
            this.voiceStatusText = 'Sending command...';
          }
        }
      };

      // 错误处理
      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);

        if ((event.error === 'no-speech' || event.error === 'aborted') && this.isRecording) {
          this.voiceStatusText = event.error === 'no-speech' ? 'Listening...' : 'Transmission reset';
          return;
        }

        this.voiceStatusText = `Mic error: ${event.error}`;
        this.isRecording = false;
      };

      // 识别结束
      this.recognition.onend = () => {
        console.log('Speech recognition ended');

        if (this.isRecording && !this.voiceStopRequested && (this.continuousMode || this.shiftKeyPressed || this.spacePressHandled)) {
          this.restartVoiceSession(this.voiceSessionId);
        } else {
          this.isRecording = false;
          if (this.pendingVoiceCommandText || this.voiceCommandText) {
            // Mobile browsers keep the microphone audio route active briefly
            // after recognition ends. Give it time to return to the speaker.
            this.voiceStatusText = 'Sending command...';
            this.schedulePendingVoiceCommand(this.isTouchDevice ? 350 : 0);
          } else {
            this.flushPendingVoiceCommand();
          }

          if (this.voiceClearTimeout) {
            clearTimeout(this.voiceClearTimeout);
          }
          this.voiceClearTimeout = setTimeout(() => {
            this.voiceCommandText = '';
            this.voiceStatusText = 'Hold left Shift to transmit';
          }, 5000);
        }
      };
    },

    // 开始语音命令 - 支持多语言
    startVoiceCommand(continuous = false) {
      if (this.gameStatus !== 'running' || this.isRecording) return;

      if (this.testScenario === 'voice') {
        this.isRecording = true;
        this.voiceCommandText = 'B9001 turn right heading one eight zero';
        this.pendingVoiceCommandText = this.voiceCommandText;
        this.voiceHasFinalResult = false;
        this.voiceStopRequested = false;
        this.voiceStatusText = 'Release Shift to send';
        return;
      }

      // 防止频繁点击
      const now = Date.now();
      if (now - this.lastVoiceCommandTime < 500) return;
      this.lastVoiceCommandTime = now;

      console.log('Starting recording...');
      this.isRecording = true;
      this.voiceCommandText = '';
      this.pendingVoiceCommandText = '';
      this.voiceHasFinalResult = false;
      this.voiceStopRequested = false;
      if (this.voiceCommitTimeout) {
        clearTimeout(this.voiceCommitTimeout);
        this.voiceCommitTimeout = null;
      }
      this.voiceSessionId += 1;
      this.voiceStatusText = 'Transmitting...';
      this.continuousMode = continuous; // Store whether we're in continuous mode

      try {
        // 重新创建识别对象以确保干净的状态，并确保使用正确的语言
        this.initSpeechRecognition();
        if (!this.recognition) {
          this.isRecording = false;
          return;
        }

        this.recognition.start();
      } catch (e) {
        console.error('Failed to start speech recognition:', e);
        this.isRecording = false;
      }
    },

    // 停止语音命令 - 确保可靠执行
    stopVoiceCommand() {
      if (!this.isRecording && !this.pendingVoiceCommandText && !this.voiceCommandText) return;

      console.log('停止录音...');
      this.voiceStopRequested = true;

      // 清除可能的计时器
      if (this.voiceRecognitionTimeout) {
        clearTimeout(this.voiceRecognitionTimeout);
        this.voiceRecognitionTimeout = null;
      }

      if (this.voiceRestartTimeout) {
        clearTimeout(this.voiceRestartTimeout);
        this.voiceRestartTimeout = null;
      }

      // The deterministic test path has no live microphone to release.
      if (this.testScenario === 'voice' && (this.pendingVoiceCommandText || this.voiceCommandText)) {
        this.flushPendingVoiceCommand();
      }

      try {
        if (this.recognition && this.testScenario !== 'voice') this.recognition.stop();
      } catch (e) {
        console.error('语音识别停止失败:', e);
      }

      if (!this.voiceHasFinalResult && this.testScenario !== 'voice') {
        // Fallback for browsers that fail to dispatch recognition.onend.
        this.schedulePendingVoiceCommand(this.isTouchDevice ? 1000 : 600);
      }

      // 即使recognition.stop()失败也标记为已停止
      this.isRecording = false;
      this.continuousMode = false;
      this.shiftKeyPressed = false;
      this.spacePressHandled = false;
      this.voiceStatusText = this.voiceHasFinalResult
        ? 'Command sent'
        : (this.pendingVoiceCommandText || this.voiceCommandText ? 'Sending command...' : 'Hold left Shift to transmit');
    },

    // 处理语音指令 - 支持多语言
    processVoiceCommand(command) {
      if (!command || this.gameStatus !== 'running') return;

      // 添加命令频率限制，防止短时间内多次处理导致性能问题
      const now = Date.now();
      if (now - this.lastVoiceCommandProcessTime < 300) { // 至少间隔300ms
        console.log('命令处理过于频繁，忽略此次命令');
        return;
      }
      this.lastVoiceCommandProcessTime = now;

      // 记录原始命令
      console.log(isEnglish ? 'Received voice command:' : 'Received voice command:', command);

      try {
        // 预处理和规范化命令，兼容浏览器识别出的英文数字词
        let processedCommand = normalizeVoiceCommand(command);


        // 标准陆空通话用语替换 - 仅保留规范用语
        const standardCorrections = isEnglish
          ? {
              // B前缀标准化
              'bravo ': 'b',

              // 标准航向指令
              'heading': 'heading',
              'turn left': 'turn left',
              'turn right': 'turn right',

              // 标准起飞指令
              'takeoff': 'take off',
              'cleared for takeoff': 'take off',

              // 标准着陆指令
              'cleared to land': 'land',

              // 标准跑道术语
              'runway': 'runway'
            }
          : {
              // 标准航班号前缀
              '比': 'b',

              // 标准航向指令
              '航向': '航向',
              '左转': '左转',
              '右转': '右转',

              // 标准起飞指令
              '起飞': '起飞',

              // 标准着陆指令
              '着陆': '着陆',

              // 标准跑道术语
              '跑道': '跑道'
            };

        for (const [standard, correction] of Object.entries(standardCorrections)) {
          processedCommand = processedCommand.replace(new RegExp(standard, 'gi'), correction);
        }

        // 转换中文数字为阿拉伯数字
        if (!isEnglish) {
          const chineseDigitMap = {
            '洞': '0', '零': '0',
            '幺': '1', '一': '1', '壹': '1',
            '两': '2', '二': '2', '贰': '2', '兩': '2',
            '三': '3', '叁': '3',
            '四': '4', '肆': '4',
            '五': '5', '伍': '5',
            '六': '6', '陆': '6', '陸': '6',
            '七': '7', '柒': '7', '拐': '7',
            '八': '8', '捌': '8',
            '九': '9', '玖': '9'
          };

          // 替换中文数字
          for (const [chinese, arabic] of Object.entries(chineseDigitMap)) {
            processedCommand = processedCommand.replace(new RegExp(chinese, 'g'), arabic);
          }

          console.log("Chinese digits replaced:", processedCommand);

          // 特别处理四位连续数字的中文表达 (如"幺两三四"，"六九两三")
          const chineseDigitPattern = /([洞零幺一壹两二贰兩三叁四肆五伍六陆陸七柒拐八捌九玖]{4})/g;
          const chineseMatches = [...processedCommand.matchAll(chineseDigitPattern)];

          if (chineseMatches.length > 0) {
            let chineseDigits = chineseMatches[0][1];
            let arabicDigits = "";

            // 将每个中文数字转换为阿拉伯数字
            for (let i = 0; i < chineseDigits.length; i++) {
              if (chineseDigitMap[chineseDigits[i]]) {
                arabicDigits += chineseDigitMap[chineseDigits[i]];
              }
            }

            if (arabicDigits.length === 4) {
              console.log(`Identified Chinese flight number: ${chineseDigits} -> ${arabicDigits}`);
              // 直接在命令中添加阿拉伯数字形式，保留原来的中文表达
              processedCommand = processedCommand.replace(chineseMatches[0][0],
                chineseMatches[0][0] + " " + arabicDigits);
            }
          }
        }

        // 转换为小写并清理
        const normalizedCommand = processedCommand;

        // 提取飞机ID和指令 - 更优先识别4位数字
        let targetPlaneId = null;
        let instruction = normalizedCommand;

        // 识别航班号 - 支持 "bravo 1234"、"B1234"、"1234"
        const digitPattern = /(?:\bb\s*)?(\d{4})\b/gi;
        const digitMatches = [...normalizedCommand.matchAll(digitPattern)];

        if (digitMatches.length > 0) {
          const digits = digitMatches[0][1];
          console.log("Identified 4-digit number:", digits);

          // 在所有飞机中查找匹配的ID
          const matchingPlanes = this.airplanes.filter(plane => {
            // 提取飞机ID中的数字部分
            const planeDigits = plane.id.replace(/\D/g, '');
            // 精确匹配后四位数字
            return planeDigits.endsWith(digits) || planeDigits === digits;
          });

          if (matchingPlanes.length > 0) {
            // 找到匹配的飞机
            targetPlaneId = matchingPlanes[0].id;
            console.log(`Found matching flight: ${targetPlaneId}, by number: ${digits}`);
          } else {
            // 使用B+数字作为ID
            targetPlaneId = "B" + digits;
            console.log(`Constructed flight ID: ${targetPlaneId}`);
          }
        }

        // 如果未识别到航班号但有选中的飞机，则使用选中的飞机
        if (!targetPlaneId && this.selectedPlane) {
          targetPlaneId = this.selectedPlane.id;
          console.log(`使用当前选中的飞机: ${targetPlaneId}`);
        }

        if (!targetPlaneId) {
          const controllablePlanes = this.airplanes.filter(item =>
            ["FLYING", "APPROACH", "FINAL_APPROACH", "TAKEOFF", "READY_FOR_TAKEOFF"].includes(item.state)
          );
          if (controllablePlanes.length === 1) {
            targetPlaneId = controllablePlanes[0].id;
            console.log(`Only one controllable aircraft, using ${targetPlaneId}`);
          }
        }

        if (!targetPlaneId) {
          this.addToCommunicationLog(`RX: ${normalizedCommand}`);
          this.addToCommunicationLog(isEnglish
            ? "No target aircraft specified, please select an aircraft or include a flight number in your command"
            : "No target aircraft specified, please select an aircraft or include a flight number in your command");
          return;
        }

        // 查找对应的飞机
        const plane = this.getPlaneById(targetPlaneId);
        if (!plane) {
          const activeIds = this.airplanes.map(item => item.id).join(", ") || "none";
          this.addToCommunicationLog(`RX: ${normalizedCommand}`);
          this.addToCommunicationLog(isEnglish
            ? `Flight ${targetPlaneId} not found. Active aircraft: ${activeIds}`
            : `Flight ${targetPlaneId} not found. Active aircraft: ${activeIds}`);
          return;
        }

        // 如果飞机是当前选中飞机，则显示选中效果
        if (!plane.selected) {
          this.selectPlane(plane);
        }

        // 提取指令部分 - 移除航班号前缀和四位数字，避免把航班号误判成航向
        const targetDigits = targetPlaneId.replace(/\D/g, '');
        instruction = normalizedCommand
          .replace(new RegExp(`\\b${targetPlaneId}\\b`, 'i'), '')
          .replace(new RegExp(`\\bb\\s*${targetDigits}\\b`, 'i'), '')
          .replace(new RegExp(`\\b${targetDigits}\\b`, 'i'), '')
          .trim();
        console.log(`分离出指令部分: "${instruction}"`);

        // 检查是否是落地相关指令
        const isLandingCommand = isEnglish
          ? instruction.includes('land') || instruction.includes('landing')
          : instruction.includes('着陆') || instruction.includes('落地');
        const isGoAroundCommand = isEnglish
          ? instruction.includes('go around') || instruction.includes('missed approach') || instruction.includes('abort landing') || instruction.includes('cancel landing')
          : instruction.includes('复飞') || instruction.includes('中止着陆') || instruction.includes('取消着陆');

        if (isGoAroundCommand) {
          this.processGoAroundCommand(targetPlaneId);
          return;
        }

        const isSpeedCommand = isEnglish
          ? instruction.includes('speed')
          : instruction.includes('速度');
        if (isSpeedCommand) {
          const speed = extractSpeed(instruction);
          if (speed !== null) {
            this.processSpeedCommand(targetPlaneId, speed);
            return;
          }
        }

        // 如果飞机正在进场落地但收到的不是落地指令，取消当前的落地进程
        if ((plane.state === "FINAL_APPROACH" || plane.state === "LANDING") && !isLandingCommand) {
          console.log(`${targetPlaneId} is in final approach, received non-landing command "${instruction}", canceling landing command`);
          this.initiateMissedApproach(plane, { preserveHeading: true, log: true });
        }

        // ===== 严格的标准陆空通话指令识别 =====
        console.log(`分析指令: "${instruction}"`);

        // 1. 检查起飞指令
        const isTakeoffCommand = isEnglish
          ? instruction.includes('take off')
          : instruction.includes('起飞');

        if (isTakeoffCommand) {
          console.log("Identified as takeoff command");
          this.processTakeoffCommand(targetPlaneId, instruction);
          return;
        }

        // 2. 检查着陆指令
        if ((isEnglish && instruction.includes('land')) ||
            (!isEnglish && instruction.includes('着陆'))) {

          console.log("Identified as landing command");

          // 确认飞机存在并标记新命令
          const targetPlane = this.getPlaneById(targetPlaneId);
          if (targetPlane) {
            this.processLandingCommand(targetPlaneId, instruction);
          } else {
            console.warn(`着陆指令目标飞机 ${targetPlaneId} 不存在`);
            this.addToCommunicationLog(isEnglish
              ? `Aircraft ${targetPlaneId} not found`
              : `Aircraft ${targetPlaneId} not found`);
          }
          return;
        }

        // 3. 检查离场程序/SID 指令
        const isProcedureCommand = isEnglish
          ? instruction.includes('sid') || instruction.includes('departure') || instruction.includes('via')
          : instruction.includes('离场') || instruction.includes('程序');

        if (isProcedureCommand) {
          const procedureId = extractProcedureId(instruction, this.departureProcedures, plane.runway);
          if (procedureId) {
            console.log(`Identified as departure procedure command: ${procedureId}`);
            this.processDepartureProcedureCommand(targetPlaneId, procedureId);
            return;
          }
        }

        // 4. 检查直飞导航台指令
        const isDirectCommand = isEnglish
          ? instruction.includes('direct') || instruction.includes('proceed')
          : instruction.includes('直飞') || instruction.includes('导航台');

        if (isDirectCommand) {
          const beaconId = extractBeaconId(instruction, this.navBeacons.map(beacon => beacon.id));
          if (beaconId) {
            console.log(`Identified as direct-to command: ${beaconId}`);
            this.processDirectToBeaconCommand(targetPlaneId, beaconId);
            return;
          }
        }

        // 5. 检查高度指令
        const isAltitudeCommand = isEnglish
          ? instruction.includes('altitude') || instruction.includes('climb') || instruction.includes('descend') || instruction.includes('flight level') || instruction.includes('level')
          : instruction.includes('高度') || instruction.includes('上升') || instruction.includes('下降');

        if (isAltitudeCommand) {
          const altitude = extractAltitude(instruction);
          if (altitude !== null) {
            console.log(`Identified as altitude command: ${altitude}`);
            this.processAltitudeCommand(targetPlaneId, altitude);
            return;
          }
        }

        // 6. 检查航向指令
        let isHeadingCommand = false;
        let turnDirection = null;

        if (isEnglish) {
          // 英文转向指令：turn left/right heading XXX
          if (instruction.includes('turn left')) {
            turnDirection = 'left';
            isHeadingCommand = true;
          } else if (instruction.includes('turn right')) {
            turnDirection = 'right';
            isHeadingCommand = true;
          } else if (instruction.includes('heading') || instruction.includes('head')) {
            isHeadingCommand = true;
          }
        } else {
          // 中文转向指令：左转/右转航向XXX
          if (instruction.includes('左转')) {
            turnDirection = 'left';
            isHeadingCommand = true;
          } else if (instruction.includes('右转')) {
            turnDirection = 'right';
            isHeadingCommand = true;
          } else if (instruction.includes('航向')) {
            isHeadingCommand = true;
          }
        }

        if (isHeadingCommand) {
          // 尝试提取航向数字
          const heading = extractHeading(instruction);
          if (heading !== null) {
              console.log(`Identified as heading command: ${heading}°, turn direction: ${turnDirection || "auto"}`);

              // 标记飞机收到新命令，确保在下一帧取消进场
              const targetPlane = this.getPlaneById(targetPlaneId);
              if (targetPlane) {
                this.processHeadingCommand(targetPlaneId, instruction);
              } else {
                console.warn(`航向指令目标飞机 ${targetPlaneId} 不存在`);
                this.addToCommunicationLog(isEnglish
                  ? `Aircraft ${targetPlaneId} not found`
                  : `Aircraft ${targetPlaneId} not found`);
              }
              return;
          }
        }

        // 未识别的指令
        this.addToCommunicationLog(`RX: ${normalizedCommand}`);
        this.addToCommunicationLog(`Decoded instruction: "${instruction || '(empty)'}"`);
        this.addToCommunicationLog(isEnglish
          ? `Command not recognized. Use standard ATC phrases like "turn heading 180" or "cleared to land runway 36L"`
          : `Command not recognized. Use standard ATC phrases like "turn heading 180" or "cleared to land runway 36L"`);
      } catch (processingError) {
        console.error('Error processing voice command::', processingError);
        this.addToCommunicationLog(isEnglish
          ? 'Error processing voice command'
          : 'Error processing voice command');
        return;
      }

      // 接下来原有的处理流程
      // ... existing code ...
    },

    // 处理航向指令 - 支持多语言
    processHeadingCommand(planeId, command) {
      console.log(`处理航向指令: "${command}" 对 ${planeId}`);

      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(isEnglish
            ? `${planeId} not found`
            : `${planeId} not found`);
          return;
        }

        // 如果飞机正在进场落地，航向指令相当于中止进近后复飞转向。
        if (plane.state === "FINAL_APPROACH" || plane.state === "LANDING") {
          console.log(`${planeId} is in final approach, canceling landing command and returning to normal flight state`);
          this.initiateMissedApproach(plane, { preserveHeading: true, log: true });
        }

        // 提取目标航向
        let targetHeading = null;
        let turnDirection = null;

        // 标准陆空通话用语格式的航向指令
        if (isEnglish) {
          // 英文标准格式: "turn left/right heading XXX"
          const leftTurnMatch = command.match(/turn\s+left\b/i);
          const rightTurnMatch = command.match(/turn\s+right\b/i);
          const heading = extractHeading(command);

          if (heading !== null && leftTurnMatch) {
            targetHeading = heading;
            turnDirection = 'left';
          } else if (heading !== null && rightTurnMatch) {
            targetHeading = heading;
            turnDirection = 'right';
          } else if (heading !== null) {
            targetHeading = heading;
          }
        } else {
          // 中文标准格式: "左转/右转航向XXX"
          const leftTurnMatch = command.match(/左转\s*航向\s*(\d{1,3})/i);
          const rightTurnMatch = command.match(/右转\s*航向\s*(\d{1,3})/i);
          const headingMatch = command.match(/航向\s*(\d{1,3})/i);

          if (leftTurnMatch) {
            targetHeading = parseInt(leftTurnMatch[1]);
            turnDirection = 'left';
          } else if (rightTurnMatch) {
            targetHeading = parseInt(rightTurnMatch[1]);
            turnDirection = 'right';
          } else if (headingMatch) {
            targetHeading = parseInt(headingMatch[1]);
          }
        }

        // 未找到有效航向
        if (targetHeading === null) {
          // 只转向但没有指定航向的情况
          if (command.includes('left') || command.includes('左转')) {
            // 左转 30 度
            turnDirection = 'left';
            targetHeading = (plane.heading - 30 + 360) % 360;
          } else if (command.includes('right') || command.includes('右转')) {
            // 右转 30 度
            turnDirection = 'right';
            targetHeading = (plane.heading + 30) % 360;
          } else {
            this.addToCommunicationLog(isEnglish
              ? `Invalid heading command format. Please use "turn heading XXX" or "turn left/right heading XXX"`
              : `Invalid heading command format. Please use "turn heading XXX" or "turn left/right heading XXX"`);
            return;
          }
        }

        // 确保航向在有效范围内
        targetHeading = Math.max(0, Math.min(359, targetHeading));

        // 计算最佳转向方向（如果未指定）
        if (!turnDirection) {
          // 计算顺时针和逆时针距离
          const clockwiseDist = (targetHeading - plane.heading + 360) % 360;
          const counterClockwiseDist = (plane.heading - targetHeading + 360) % 360;

          // 选择较短的转向方向
          turnDirection = clockwiseDist <= counterClockwiseDist ? 'right' : 'left';
        }

        // 检查飞机是否处于特殊状态（进场或着陆），如果是则重置状态
        this.resetApproachOrLandingState(plane);

        // 设置飞机的目标航向
        plane.targetHeading = targetHeading;
        plane.targetBeaconId = null;
        plane.targetBeaconX = undefined;
        plane.targetBeaconY = undefined;
        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;
        if (plane.state === "TAKEOFF") {
          if (plane.targetAltitude === undefined || plane.targetAltitude === null) {
            plane.targetAltitude = 5000;
          }
        } else {
          plane.state = plane.state === 'HOLDING' ? 'HOLDING' : 'FLYING';
        }

        // 添加到通信日志并播报
        const message = isEnglish
          ? `${planeId}, turn ${turnDirection} heading ${targetHeading}`
          : `${planeId}, ${turnDirection === 'left' ? '左' : '右'}转航向${targetHeading}`;

        this.speak(message);

        console.log(`航向命令已接受: ${planeId} 转向 ${targetHeading}° (${turnDirection})`);
      } catch (error) {
        console.error('Error processing heading command::', error);
        this.addToCommunicationLog(isEnglish
          ? `Error processing heading command for ${planeId}`
          : `Error processing heading command for ${planeId}`);
      }
    },

    processDirectToBeaconCommand(planeId, beaconId) {
      console.log(`处理直飞导航台指令: ${planeId} direct ${beaconId}`);

      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(`${planeId} not found`);
          return;
        }

        if (plane.flightType !== "DEPARTURE") {
          this.addToCommunicationLog(`${planeId}, handoff points are available to departure traffic only`);
          return;
        }

        const beacon = this.navBeacons.find(item => item.id.toUpperCase() === beaconId.toUpperCase());
        if (!beacon) {
          this.addToCommunicationLog(`Navigation beacon ${beaconId} not found`);
          return;
        }

        if (plane.state === "READY_FOR_TAKEOFF") {
          this.addToCommunicationLog(`${planeId}, direct ${beacon.id} unavailable until airborne`);
          return;
        }

        if (plane.state === "TAKEOFF" && !this.isAircraftOffRunway(plane)) {
          this.addToCommunicationLog(`${planeId}, maintain runway heading until clear of runway`);
          return;
        }

        this.resetApproachOrLandingState(plane);

        plane.targetBeaconId = beacon.id;
        plane.targetBeaconX = beacon.x;
        plane.targetBeaconY = beacon.y;
        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;
        plane.targetHeading = this.calculateBearing(plane.x, plane.y, beacon.x, beacon.y);
        plane.forcedTurnDirection = null;
        plane.preferredTurnDirection = null;
        if (plane.state !== "TAKEOFF") {
          plane.state = "FLYING";
          plane.targetMotionSpeed = 0.2;
          plane.targetIndicatedSpeed = 250;
        }

        this.speak(`${planeId}, proceed direct ${beacon.id}`);
      } catch (error) {
        console.error('Error processing direct-to beacon command:', error);
        this.addToCommunicationLog(`Error processing direct ${beaconId} for ${planeId}`);
      }
    },

    processDepartureProcedureCommand(planeId, procedureId) {
      console.log(`处理离场程序指令: ${planeId} via ${procedureId}`);

      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(`${planeId} not found`);
          return;
        }

        if (plane.flightType !== "DEPARTURE") {
          this.addToCommunicationLog(`${planeId}, departure procedure unavailable for arrival traffic`);
          return;
        }

        const procedure = this.departureProcedures.find(item => item.id.toUpperCase() === procedureId.toUpperCase());
        if (!procedure) {
          this.addToCommunicationLog(`Departure procedure ${procedureId} not found`);
          return;
        }

        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;
        this.addToCommunicationLog(
          `${planeId}, automatic SID guidance unavailable; assign heading or proceed direct to any handoff point`,
        );
      } catch (error) {
        console.error('Error processing departure procedure command:', error);
        this.addToCommunicationLog(`Error processing ${procedureId} for ${planeId}`);
      }
    },

    processGoAroundCommand(planeId) {
      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(`${planeId} not found`);
          return;
        }

        if (!["APPROACH", "FINAL_APPROACH", "LANDING"].includes(plane.state) && !plane.landingRunway) {
          this.addToCommunicationLog(`${planeId}, go around unavailable outside approach`);
          return;
        }

        this.initiateMissedApproach(plane, { log: false });
        this.speak(`${planeId}, go around, climb ${plane.targetAltitude}`);
      } catch (error) {
        console.error('Error processing go-around command:', error);
        this.addToCommunicationLog(`Error processing go around for ${planeId}`);
      }
    },

    processAltitudeCommand(planeId, altitude) {
      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(`${planeId} not found`);
          return;
        }

        if (plane.state === "READY_FOR_TAKEOFF") {
          this.addToCommunicationLog(`${planeId}, altitude instruction unavailable while holding on ground`);
          return;
        }

        const safeAltitude = Math.max(0, Math.min(45000, Math.round(altitude / 100) * 100));
        plane.targetAltitude = safeAltitude;
        const currentAltitude = plane.altitude || 0;
        const verb = safeAltitude > currentAltitude + 100 ? "climb" : safeAltitude < currentAltitude - 100 ? "descend" : "maintain";
        this.speak(`${planeId}, ${verb} altitude ${safeAltitude}`);
      } catch (error) {
        console.error('Error processing altitude command:', error);
        this.addToCommunicationLog(`Error processing altitude command for ${planeId}`);
      }
    },

    processSpeedCommand(planeId, speed) {
      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(`${planeId} not found`);
          return;
        }

        if (["READY_FOR_TAKEOFF", "LANDING"].includes(plane.state)) {
          this.addToCommunicationLog(`${planeId}, speed instruction unavailable in current state`);
          return;
        }

        const assignedSpeed = Math.max(130, Math.min(320, Math.round(speed / 5) * 5));
        const currentSpeed = plane.indicatedSpeed || assignedSpeed;
        plane.assignedSpeed = assignedSpeed;
        plane.targetIndicatedSpeed = assignedSpeed;
        plane.targetMotionSpeed = Math.max(0.1, Math.min(0.26, assignedSpeed / 1250));
        const instruction = assignedSpeed < currentSpeed - 5
          ? `reduce speed to ${assignedSpeed} knots`
          : assignedSpeed > currentSpeed + 5
            ? `increase speed to ${assignedSpeed} knots`
            : `maintain speed ${assignedSpeed} knots`;
        this.speak(`${planeId}, ${instruction}`);
      } catch (error) {
        console.error('Error processing speed command:', error);
        this.addToCommunicationLog(`Error processing speed command for ${planeId}`);
      }
    },

    continueExistingApproach(plane, runwayId) {
      const isSameActiveApproach = Boolean(
        plane?.approachPath &&
        plane.landingRunway === runwayId &&
        ["APPROACH", "FINAL_APPROACH"].includes(plane.state)
      );
      if (!isSameActiveApproach) return false;

      plane.missedApproachActive = false;
      plane.newCommandIssued = false;
      this.speak(`${plane.id}, continue approach runway ${runwayId}`);
      return true;
    },

    // 处理着陆指令 - 极简版本，确保不会卡住
    processLandingCommand(planeId, command) {
      console.log(`处理着陆指令: "${command}" 对 ${planeId}`);

      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(isEnglish
            ? `${planeId} not found`
            : `${planeId} 未找到`);
          return;
        }

        // 如果飞机不在空中，无法执行着陆
        if (plane.state !== "FLYING" && plane.state !== "APPROACH" && plane.state !== "FINAL_APPROACH") {
          this.addToCommunicationLog(isEnglish
            ? `${planeId} cannot execute landing command in current state`
            : `${planeId} cannot execute landing command in current state`);
          return;
        }

        // 提取跑道号 - 只支持标准格式
        let runwayId = null;
        if (isEnglish) {
          runwayId = extractRunwayId(command);
        } else {
          // 中文标准格式: "着陆跑道36左"
          const runwayMatch = command.match(/跑道\s*(\d{2})([左右中]?)/i);
          if (runwayMatch) {
            const directionMap = { '左': 'L', '右': 'R', '中': 'C' };
            const direction = runwayMatch[2] ? directionMap[runwayMatch[2]] || '' : '';
            runwayId = runwayMatch[1] + direction;
          }
        }

        // 验证跑道ID
        if (!runwayId) {
          this.addToCommunicationLog(isEnglish
            ? `${planeId}, please specify runway for landing (e.g. "land runway 36L")`
            : `${planeId}，请指定着陆跑道（例如"着陆跑道36左"）`);
          return;
        }

        // 匹配有效的跑道
        const runway = this.runways.find(r => r.id === runwayId);
        if (!runway) {
          this.addToCommunicationLog(isEnglish
            ? `Runway ${runwayId} not found`
            : `跑道${runwayId}未找到`);
          return;
        }

        if (this.continueExistingApproach(plane, runwayId)) {
          return;
        }

        console.log(`处理${planeId}向跑道${runwayId}的着陆请求`);

        // 计算跑道入口坐标
        const runwayEntrance = this.getRunwayEntrance(runway);
        if (!runwayEntrance) {
          console.error(`Unable to find entrance coordinates for runway ${runwayId}`);
          return;
        }

        // 设置飞机状态为进场
        plane.state = "APPROACH";
        plane.landingRunway = runwayId;
        plane.targetAltitude = Math.min(plane.targetAltitude || plane.altitude || 3000, 3000);
        plane.missedApproachActive = false;
        plane.targetBeaconId = null;
        plane.targetBeaconX = undefined;
        plane.targetBeaconY = undefined;
        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;

        // 创建进场路径 - 使用贝塞尔曲线
        try {
          // Always create a complete path. The former near-threshold shortcut put
          // the aircraft in FINAL_APPROACH without an approachPath, so it could
          // fly through the runway and never enter the landing roll.
          this.calculateApproachPath(plane);

          const message = isEnglish
            ? `${planeId}, cleared to land runway ${runwayId}`
            : `${planeId}，着陆跑道${runwayId}`;

          this.speak(message);
        } catch (error) {
          console.error('创建进场路径时出错:', error);
          this.addToCommunicationLog(isEnglish
            ? `Error processing landing command for ${planeId}`
            : `Error processing landing command for ${planeId}`);
        }
      } catch (error) {
        console.error('处理着陆指令时出错:', error);
        this.addToCommunicationLog(isEnglish
          ? `Error processing landing command for ${planeId}`
          : `处理${planeId}的着陆指令时出错`);
      }
    },

    // 获取跑道入口坐标
    getRunwayEntrance(runway) {
      if (!runway) return null;
      return { x: runway.startX, y: runway.startY };
    },

    // 创建进场路径
    createApproachPath(plane, runway) {
      plane.landingRunway = runway.id;
      this.calculateApproachPath(plane);
    },

    // 处理起飞指令 - 支持多语言和语音识别
    processTakeoffCommand(planeId, command) {
      console.log(`处理起飞指令: "${command}" 对 ${planeId}`);

      try {
        const plane = this.getPlaneById(planeId);
        if (!plane) {
          this.addToCommunicationLog(isEnglish
            ? `${planeId} not found`
            : `${planeId} 未找到`);
          return;
        }

        if (plane.state !== "READY_FOR_TAKEOFF") {
          this.addToCommunicationLog(`${planeId}, takeoff clearance unavailable in current state`);
          return;
        }

        // 提取跑道号
        let runwayId = null;

        // 从指令中提取跑道号 - 标准格式
        if (isEnglish) {
          runwayId = extractRunwayId(command);
        } else {
          // 中文标准格式："起飞跑道36左"
          const runwayMatch = command.match(/跑道\s*(\d{2})([左右中]?)/i);
          if (runwayMatch) {
            const directionMap = { '左': 'L', '右': 'R', '中': 'C' };
            const direction = runwayMatch[2] ? directionMap[runwayMatch[2]] || '' : '';
            runwayId = runwayMatch[1] + direction;
          }
        }

        console.log("提取的跑道号:", runwayId);

        runwayId = runwayId || plane.runway;
        if (!runwayId) {
          this.addToCommunicationLog(isEnglish
            ? `${planeId} not on runway. Please specify runway (e.g. "takeoff runway 36L")`
            : `${planeId}不在跑道上。请指定跑道（例如"起飞跑道36左"）`);
          return;
        }

        const runway = this.runways.find(item => item.id === runwayId);
        if (!runway) {
          this.addToCommunicationLog(`Runway ${runwayId} not found`);
          return;
        }

        const occupyingPlane = this.getRunwayOccupyingAircraft(runway.id, plane);
        if (occupyingPlane) {
          const message = `${planeId}, hold position, runway occupied by ${occupyingPlane.id}`;
          this.speak(message);
          return;
        }

        plane.x = runway.startX;
        plane.y = runway.startY;
        plane.runway = runway.id;
        plane.targetBeaconId = null;
        plane.targetBeaconX = undefined;
        plane.targetBeaconY = undefined;
        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;

        this.initializeTakeoffRoll(plane, runway.id);
        delete plane.queuePosition;
        this.updateTakeoffQueue();

        const message = isEnglish
          ? `${planeId}, cleared for takeoff runway ${runwayId}`
          : `${planeId}，起飞跑道${runwayId}`;
        this.speak(message);
      } catch (error) {
        console.error('处理起飞指令时出错:', error);
        this.addToCommunicationLog(isEnglish
          ? `Error processing takeoff command for ${planeId}`
          : `处理${planeId}的起飞指令时出错`);
      }
    },

    assignApproachPath(plane, runway, entrance) {
      const finalApproachDistance = getFinalApproachDistance(plane.altitude);
      const trajectory = buildSmoothApproachTrajectory({
        startX: plane.x,
        startY: plane.y,
        startHeading: plane.heading,
        runwayX: entrance.x,
        runwayY: entrance.y,
        finalHeading: runway.heading,
        finalApproachDistance,
      });

      plane.landingRunway = runway.id;
      plane.landingDirection = runway.heading;
      plane.state = "FINAL_APPROACH";
      plane.runway = null;
      plane.missedApproachActive = false;
      plane.approachPath = {
        startX: plane.x,
        startY: plane.y,
        runwayX: entrance.x,
        runwayY: entrance.y,
        startHeading: plane.heading,
        finalHeading: runway.heading,
        finalApproachPoint: trajectory.finalApproachPoint,
        trajectory,
        phase: "INITIAL",
        progressT: 0,
        totalDistance: 0,
        lastUpdateTime: Date.now(),
        originalSpeed: plane.speed || 0.2,
        startAltitude: plane.altitude ?? plane.targetAltitude ?? 3000,
        finalGateAltitude: 1200,
        thresholdCrossingAltitude: 50,
        speedFactor: 1,
        curveLength: trajectory.curveLength,
      };
      plane.approachPathCreated = true;
      plane.newCommandIssued = false;

      this.dragLine = {
        x1: plane.x,
        y1: plane.y,
        x2: entrance.x,
        y2: entrance.y,
        startX: plane.x,
        startY: plane.y,
        endX: entrance.x,
        endY: entrance.y,
        startHeading: plane.heading,
        finalHeading: runway.heading,
        landingApproach: true,
        runwayEntrance: entrance,
        runwayInfo: { id: runway.id, x: entrance.x, y: entrance.y, direction: runway.heading },
        runwayId: runway.id,
        finalApproachDistance,
      };

      setTimeout(() => {
        if (this.dragLine?.landingApproach && this.dragLine.runwayId === runway.id) {
          this.dragLine = null;
        }
      }, 3000);

      this.addToCommunicationLog(`${plane.id} starting approach, runway ${runway.id}`);
      return trajectory;
    },

    // 计算进场路径
    calculateApproachPath(plane) {
      try {
        if (!plane || !plane.landingRunway) {
          console.error("Unable to calculate approach path: missing aircraft or runway information", plane);
          return;
        }

        const runway = this.runways.find(item => item.id === plane.landingRunway);
        const entrance = runway ? this.getRunwayEntrance(runway) : null;

        if (!runway || !entrance) {
          console.error(`无效的跑道标识: ${plane.landingRunway}`);
          return;
        }

        this.assignApproachPath(plane, runway, entrance);
        return;

        const entranceX = entrance.x;
        const entranceY = entrance.y;
        const finalHeading = runway.heading;

        // 获取当前飞机信息
        const startX = plane.x;
        const startY = plane.y;
        const currentHeading = Math.round(plane.heading) % 360;

        // 计算从当前位置到跑道入口的方向向量
        const dx = entranceX - startX;
        const dy = entranceY - startY;
        const distance = Math.sqrt(dx*dx + dy*dy);

        // 设置正确的转弯方向
        const clockwiseDiff = (finalHeading - currentHeading + 360) % 360;
        const counterClockwiseDiff = (currentHeading - finalHeading + 360) % 360;
        const shouldTurnClockwise = clockwiseDiff <= counterClockwiseDiff;
        const turnDir = shouldTurnClockwise ? "right" : "left";

        // 为绘制航线创建拖拽线信息
        this.dragLine = {
          startX: startX,
          startY: startY,
          endX: entranceX,
          endY: entranceY,
          startHeading: currentHeading,
          finalHeading: finalHeading,
          shouldTurnClockwise: shouldTurnClockwise,
          landingApproach: true,
          runwayEntrance: entrance,
          runwayId: plane.landingRunway,
          finalApproachDistance: getFinalApproachDistance(plane.altitude),
        };

        // 使用简化的贝塞尔曲线控制点计算
        // 创建一个简单的S形曲线连接当前位置和跑道入口

        // 1. 计算跑道延长线上的进场点
        const runwayAngle = (finalHeading * Math.PI) / 180;
        const oppRunwayAngle = ((finalHeading + 180) % 360) * Math.PI / 180;

        // 简化：最终进近点 - 跑道延长线上的点
        const finalApproachDistance = getFinalApproachDistance(plane.altitude);
        const finalApproachX = entranceX + Math.sin(oppRunwayAngle) * finalApproachDistance;
        const finalApproachY = entranceY - Math.cos(oppRunwayAngle) * finalApproachDistance;

        // 2. 计算控制点 - 简化计算，避免复杂的角度和向量计算
        // 控制点1 - 从起点沿当前航向延伸一段距离
        const headingRad = (currentHeading * Math.PI) / 180;
        const controlDist1 = Math.min(distance * 0.3, 150);
        const cp1x = startX + Math.sin(headingRad) * controlDist1;
        const cp1y = startY - Math.cos(headingRad) * controlDist1;

        // 控制点2 - 从进场点沿跑道方向延伸
        const controlDist2 = Math.min(distance * 0.3, 150);
        const cp2x = finalApproachX + Math.sin(oppRunwayAngle) * controlDist2;
        const cp2y = finalApproachY - Math.cos(oppRunwayAngle) * controlDist2;

        // 设置飞机的进场路径信息 - 简化版本
        plane.approachPath = {
          // 基本信息
          startX: startX,
          startY: startY,
          runwayX: entranceX,
          runwayY: entranceY,
          startHeading: currentHeading,
          finalHeading: finalHeading,

          // 贝塞尔曲线点
          bezierPoints: {
            start: { x: startX, y: startY },
            cp1: { x: cp1x, y: cp1y },
            cp2: { x: cp2x, y: cp2y },
            preApproach: { x: finalApproachX, y: finalApproachY }
          },

          // 进场状态
          phase: "INITIAL",
          progressT: 0,
          lastUpdateTime: Date.now(),
          originalSpeed: plane.speed,
          startAltitude: plane.altitude ?? plane.targetAltitude ?? 3000,
          finalGateAltitude: 1200,
          thresholdCrossingAltitude: 50,

          // 添加初始速度因子设置，确保曲线段使用合适的速度
          speedFactor: 1.0,

          // 预先计算曲线长度估计值，避免第一帧速度异常
          curveLength: this.calculateBezierLength(
            { x: startX, y: startY },
            { x: cp1x, y: cp1y },
            { x: cp2x, y: cp2y },
            { x: finalApproachX, y: finalApproachY }
          )
        };

        plane.state = "FINAL_APPROACH";

        // 确保更新方法知道如何处理这个飞机
        plane.approachPathCreated = true;

        // 重置任何可能存在的新命令标记，避免立即取消
        plane.newCommandIssued = false;

        // 将进场航线显示3秒
        setTimeout(() => {
          if (this.dragLine && this.dragLine.landingApproach) {
            this.dragLine = null;
          }
        }, 3000);

        // 记录日志
        this.addToCommunicationLog(`${plane.id} starting approach, runway ${plane.landingRunway}`);
        console.log(`${plane.id} approach path calculated [runway=${plane.landingRunway}, heading=${finalHeading}°]`);
      } catch (error) {
        // 捕获任何可能发生的错误，防止游戏卡住
        console.error("计算进场路径时出错:", error);
      }
    },

    // 找到被点击的飞机
    findClickedPlane(x, y, clickRadius = 30) {
      // 考虑到飞机图标的大小，使用更合适的点击区域
      return this.airplanes.find(plane => {
        const distance = Math.sqrt(
          Math.pow(plane.x - x, 2) +
          Math.pow(plane.y - y, 2)
        );
        return distance < clickRadius;
      });
    },
    // 处理键盘按下事件
    handleGlobalKeyDown(event) {
      if (event.key === 'Escape' && this.settingsOpen) {
        event.preventDefault();
        this.closeSettings();
        return;
      }

      const isLeftShift = event.code === 'ShiftLeft' || (event.keyCode === 16 && event.location === 1);
      if (isLeftShift && this.gameStatus === 'running') {
        event.preventDefault();
        if (!this.shiftKeyPressed) {
          this.shiftKeyPressed = true;
          this.startVoiceCommand(false);
        }
        return;
      }

      // 空格键保留为备用通话键
      if (event.code === 'Space' && this.gameStatus === 'running' && !this.spacePressHandled) {
        event.preventDefault();
        this.spacePressHandled = true;
        this.startVoiceCommand(false);
      }
    },

    // 处理键盘释放事件
    handleGlobalKeyUp(event) {
      const isLeftShift = event.code === 'ShiftLeft' || (event.keyCode === 16 && event.location === 1);
      if (isLeftShift) {
        event.preventDefault();
        this.shiftKeyPressed = false;
        this.stopVoiceCommand();
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        this.spacePressHandled = false;
        this.stopVoiceCommand();
      }
    },
    handleKeyDown(event) {
      this.handleGlobalKeyDown(event);
    },
    handleKeyUp(event) {
      this.handleGlobalKeyUp(event);
    },
    onKeyDown(event) {
      this.handleGlobalKeyDown(event);
    },
    onKeyUp(event) {
      this.handleGlobalKeyUp(event);
    },
    // 添加贝塞尔曲线计算辅助函数
    evaluateBezierCurve(t, p0, p1, p2, p3) {
      try {
        // 安全检查输入参数
        if (t < 0 || t > 1 || !p0 || !p1 || !p2 || !p3) {
          console.error("贝塞尔曲线参数错误", { t, p0, p1, p2, p3 });
          return null;
        }

        // 计算贝塞尔曲线上的点
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        return {
          x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
          y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
        };
      } catch (error) {
        console.error("贝塞尔曲线计算错误", error);
        return { x: p0.x, y: p0.y }; // 返回起点作为安全值
      }
    },

    // 计算贝塞尔曲线在参数t处的切线方向
    evaluateBezierTangent(t, p0, p1, p2, p3) {
      try {
        // 安全检查输入参数
        if (t < 0 || t > 1 || !p0 || !p1 || !p2 || !p3) {
          console.error("贝塞尔切线参数错误", { t, p0, p1, p2, p3 });
          return { x: 1, y: 0 }; // 默认向右
        }

        // 计算贝塞尔曲线在t处的切线方向
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;

        // 计算导数
        const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
        const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);

        // 归一化切线向量
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.0001) {
          return { x: 1, y: 0 }; // 防止除以零
        }

        return {
          x: dx / length,
          y: dy / length
        };
      } catch (error) {
        console.error("贝塞尔切线计算错误", error);
        return { x: 1, y: 0 }; // 默认向右
      }
    },

    // 估算贝塞尔曲线长度 - 使用线段近似方法
    calculateBezierLength(p0, p1, p2, p3) {
      try {
        // 安全检查
        if (!p0 || !p1 || !p2 || !p3) {
          console.error("贝塞尔长度计算参数错误", { p0, p1, p2, p3 });
          return 300; // 返回一个安全的默认值
        }

        // 使用分段线性近似估算贝塞尔曲线长度
        const segments = 20; // 分段数，可以根据需要调整精度
        let length = 0;
        let prevPoint = p0;

        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const point = this.evaluateBezierCurve(t, p0, p1, p2, p3);

          if (point) {
            const dx = point.x - prevPoint.x;
            const dy = point.y - prevPoint.y;
            length += Math.sqrt(dx * dx + dy * dy);
            prevPoint = point;
          }
        }

        // 增加一个安全系数，确保不会低估曲线长度
        return length * 1.1;
      } catch (error) {
        console.error("计算贝塞尔曲线长度错误", error);
        return 300; // 返回一个安全的默认值
      }
    },
    // 获取中文难度名称
    getChineseDifficulty() {
      const difficultyMap = {
        'easy': '简单',
        'medium': '中等',
        'hard': '困难'
      };
      return difficultyMap[this.difficulty] || '未知';
    },
    // 新方法：检查并生成新飞机以维持游戏难度
    checkAndSpawnNewAircraft() {
      // 如果游戏不在运行状态，不生成新飞机
      if (this.gameStatus !== 'running' || this.testMode) return;
      if (this.isTrafficFlowRestrictedForGroundDelay()) return;

      console.log(`检查飞机数量: 当前 ${this.airplanes.length}/${this.dynamicMaxAircraftCount}`);

      // 如果当前飞机数量低于动态最大限制，生成新飞机
      if (this.airplanes.length < this.dynamicMaxAircraftCount) {
        // 随机决定生成进场还是起飞飞机
        const spawnType = Math.random() < 0.7 ? 'approach' : 'departure';

        if (spawnType === 'approach') {
          this.spawnApproach();
        } else {
          this.spawnDeparture();
        }

        console.log(`当前飞机数量(${this.airplanes.length})低于最大限制(${this.dynamicMaxAircraftCount})，生成新飞机`);
      }
    },
    // 重置进场和着陆状态，确保飞机能执行新命令
    resetApproachOrLandingState(plane) {
      if (!plane) return false;

      // 检查当前状态
      const needsReset = plane.state === "FINAL_APPROACH" || plane.state === "LANDING";

      if (needsReset) {
        console.log(`${plane.id} 正在${plane.state === "FINAL_APPROACH" ? "进场" : "着陆"}，但收到新命令，将其状态重置为FLYING`);
        this.initiateMissedApproach(plane, { preserveHeading: true, log: true });
        plane.targetBeaconId = null;
        plane.targetBeaconX = undefined;
        plane.targetBeaconY = undefined;
        plane.departureProcedure = null;
        plane.departureProcedureWaypointIndex = 0;

        return true;
      }

      return false;
    },

    // 更新游戏进度
    advanceSimulationClock(dt) {
      if (this.gameStatus !== 'running') return;

      this.simulationElapsedMs += Math.max(0, Number(dt) || 0) * 1000;
      this.updateGameProgress();

      if (this.gamePhaseEndTime > 0 && this.simulationElapsedMs >= this.gamePhaseEndTime) {
        if (this.gamePhase === 'busy' && Math.random() < 0.3) {
          this.enterCalmPhase();
        } else {
          this.enterNormalPhase();
        }
      }
    },

    spawnNextTraffic() {
      if (this.gameStatus !== 'running' || this.testMode) return;

      // Once a departure reaches the warning threshold, meter new traffic until
      // the player creates a runway slot. Existing traffic remains active.
      if (this.isTrafficFlowRestrictedForGroundDelay()) return;

      this.checkGamePhase();
      if (Math.random() < 0.7) this.spawnApproach();
      else this.spawnDeparture();
    },

    scheduleTrafficSpawnTimer() {
      clearInterval(this.spawnApproachInterval);
      this.spawnApproachInterval = null;
      if (this.gameStatus !== 'running' || this.testMode) return;

      const realDelay = Math.max(250, this.currentSpawnInterval / this.speedLevel);
      this.spawnApproachInterval = setInterval(() => this.spawnNextTraffic(), realDelay);
    },

    updateGameProgress() {
      // 游戏暂停或结束时不更新进度
      if (this.gameStatus !== 'running') return;

      // 计算游戏已进行的时间（分钟）
      const gameTimeMinutes = this.simulationElapsedMs / 60000;

      // 根据时间更新游戏进度等级（0-10）
      // 每5分钟增加一个等级，最高10级
      const newProgressLevel = Math.min(Math.floor(gameTimeMinutes / 5), 10);

      if (newProgressLevel !== this.gameProgressLevel) {
        this.gameProgressLevel = newProgressLevel;
        console.log(`游戏进度提升到 ${this.gameProgressLevel} 级`);

        // 更新动态最大飞机数量 - 每提升2级增加1架飞机
        const progressBonus = Math.floor(this.gameProgressLevel / 2);
        this.dynamicMaxAircraftCount = this.maxAircraftCount[this.difficulty] + progressBonus;

        // 添加提示信息
        if (progressBonus > 0) {
          this.addToCommunicationLog(`Air traffic increasing. Max aircraft: ${this.dynamicMaxAircraftCount}`);
        }
      }
    },

    // 检查并更新游戏阶段
    checkGamePhase() {
      // 游戏暂停或结束时不检查阶段
      if (this.gameStatus !== 'running') return;

      const now = this.simulationElapsedMs;
      const currentSettings = this.difficultySettings[this.difficulty];

      // 如果当前是正常阶段，随机决定是否进入繁忙阶段
      if (this.gamePhase === 'normal') {
        const busyProbability = currentSettings.busyPhaseProbability + (this.gameProgressLevel * 0.02);
        if (Math.random() < busyProbability) {
          // 进入繁忙阶段
          this.gamePhase = 'busy';
          this.gamePhaseStartTime = now;
          this.gamePhaseEndTime = now + 30000 + Math.random() * 30000;
          this.currentSpawnInterval = currentSettings.busySpawnInterval - (this.gameProgressLevel * 300);
          this.dynamicMaxAircraftCount += 1; // 繁忙时期增加1架飞机

          console.log(`进入繁忙阶段，生成间隔减少到 ${this.currentSpawnInterval}ms，最大飞机数增加到 ${this.dynamicMaxAircraftCount}`);
          this.addToCommunicationLog('Traffic is getting busy. Prepare for increased workload.');

          this.scheduleTrafficSpawnTimer();
        }
      }
    },

    // 进入正常阶段
    enterNormalPhase() {
      this.gamePhase = 'normal';
      this.gamePhaseStartTime = this.simulationElapsedMs;
      this.gamePhaseEndTime = 0;

      const currentSettings = this.difficultySettings[this.difficulty];
      this.currentSpawnInterval = currentSettings.baseSpawnInterval - (this.gameProgressLevel * 400);
      this.dynamicMaxAircraftCount = this.maxAircraftCount[this.difficulty] + Math.floor(this.gameProgressLevel / 2);

      console.log(`返回正常阶段，生成间隔设为 ${this.currentSpawnInterval}ms，最大飞机数设为 ${this.dynamicMaxAircraftCount}`);
      this.addToCommunicationLog('Traffic returning to normal levels.');

      this.scheduleTrafficSpawnTimer();
    },

    // 进入平静阶段
    enterCalmPhase() {
      this.gamePhase = 'calm';
      this.gamePhaseStartTime = this.simulationElapsedMs;

      const currentSettings = this.difficultySettings[this.difficulty];
      this.currentSpawnInterval = currentSettings.calmSpawnInterval;
      this.gamePhaseEndTime = this.simulationElapsedMs + Math.max(
        5000,
        currentSettings.calmPhaseDuration - (this.gameProgressLevel * 2000),
      );
      this.dynamicMaxAircraftCount = Math.max(2, this.maxAircraftCount[this.difficulty] - 1 + Math.floor(this.gameProgressLevel / 3));

      console.log(`进入平静阶段，生成间隔增加到 ${this.currentSpawnInterval}ms，最大飞机数减少到 ${this.dynamicMaxAircraftCount}`);
      this.addToCommunicationLog('Traffic is calming down. Take a brief respite.');

      this.scheduleTrafficSpawnTimer();
    },

    // 添加游戏结束相关方法

    // 检查飞机之间的碰撞
    checkCollisions() {
      // 对所有飞机进行碰撞检测，不管状态如何
      for (let i = 0; i < this.airplanes.length; i++) {
        const plane1 = this.airplanes[i];

        // 跳过正在拖动中的飞机、已标记为问题飞机的飞机，以及等待起飞的飞机
        if (this.problemAircraft.includes(plane1) ||
            this.problemAircraft.includes(plane1.id) ||
            plane1 === this.dragFollowing ||
            plane1.state === "READY_FOR_TAKEOFF") continue;

        for (let j = i + 1; j < this.airplanes.length; j++) {
          const plane2 = this.airplanes[j];

          // 跳过正在拖动中的飞机、已标记为问题飞机的飞机，以及等待起飞的飞机
          if (this.problemAircraft.includes(plane2) ||
              this.problemAircraft.includes(plane2.id) ||
              plane2 === this.dragFollowing ||
              plane2.state === "READY_FOR_TAKEOFF") continue;

          // 计算两飞机之间的距离
          const distance = Math.sqrt(
            Math.pow(plane1.x - plane2.x, 2) +
            Math.pow(plane1.y - plane2.y, 2)
          );

          const verticalDistance = Math.abs((plane1.altitude || 0) - (plane2.altitude || 0));

          // 雷达目标重叠仍需考虑垂直距离；高度充分分离的交叉航迹不是碰撞。
          const isHardCollision = distance < this.hardCollisionDistance &&
            verticalDistance < this.hardCollisionVerticalDistance;
          if (isAircraftConflict(distance, verticalDistance, this)) {
            console.log(`检测到冲突: ${plane1.id}(${plane1.state}) 与 ${plane2.id}(${plane2.state}) 距离=${distance}, 高度差=${verticalDistance}`);

            // 标记问题飞机并触发游戏结束
            this.problemAircraft = [plane1, plane2]; // 存储整个飞机对象而不是ID

            // 记录具体的碰撞位置信息用于调试
            const locationDesc = this.getLocationDescription(plane1, plane2);

            // 创建全英文的碰撞消息
            const conflictType = isHardCollision ? "radar targets overlapped" : "lost separation";
            this.triggerGameOver("COLLISION", `${plane1.id}(${plane1.state}) ${conflictType} with ${plane2.id}(${plane2.state}) ${locationDesc}, vertical ${Math.round(verticalDistance)}ft`);
            return true;
          }
        }
      }

      return false;
    },

    // 添加辅助函数获取位置描述
    getLocationDescription(plane1, plane2) {
      // 检查是否都在跑道上
      if ((plane1.state === "LANDING" || plane1.state === "TAKEOFF" || plane1.state === "LANDED") &&
          (plane2.state === "LANDING" || plane2.state === "TAKEOFF" || plane2.state === "LANDED")) {
        return "on runway";
      }
      else if (plane1.runway || plane2.runway) {
        return "near runway";
      }
      else {
        return "in airspace";
      }
    },

    // 检查飞机是否飞出边界
    checkAircraftOutOfBounds() {
      // 如果游戏已结束，不再检测
      if (this.isGameOver) return;

      // 获取所有飞行中的飞机（包括起飞和着陆的飞机）
      const flyingPlanes = this.airplanes.filter(plane =>
        plane.state === "FLYING" ||
        plane.state === "APPROACH" ||
        plane.state === "FINAL_APPROACH" ||
        plane.state === "TAKEOFF" ||
        plane.state === "LANDING"
      );

      for (const plane of flyingPlanes) {
        // 检查飞机是否超出雷达边界
        if (plane.x < this.radarBounds.minX ||
            plane.x > this.radarBounds.maxX ||
            plane.y < this.radarBounds.minY ||
            plane.y > this.radarBounds.maxY) {

          this.problemAircraft = [plane];
          this.triggerGameOver(
            "OUT_OF_BOUNDS",
            `RADAR CONTACT LOST: ${plane.id} has exited controlled airspace`
          );
          return;
        }
      }
    },

    checkRestrictedAreaViolations() {
      if (this.isGameOver) return;

      const controlledStates = ["FLYING", "APPROACH", "FINAL_APPROACH", "TAKEOFF"];
      const activeAreas = this.restrictedAreas.filter(area => area.active && area.points?.length >= 3);
      if (activeAreas.length === 0) return;

      for (const plane of this.airplanes) {
        if (!controlledStates.includes(plane.state)) continue;

        const violatedArea = activeAreas.find(area => this.isPointInPolygon(plane.x, plane.y, area.points));
        if (violatedArea) {
          this.problemAircraft = [plane];
          this.triggerGameOver(
            "RESTRICTED_AREA",
            `AIRSPACE VIOLATION: ${plane.id} entered ${violatedArea.id} ${violatedArea.label}`
          );
          return;
        }
      }
    },

    isPointInPolygon(x, y, points) {
      return isPointInPolygon(x, y, points);
    },

    // 检查地面等待超时
    checkGroundDelays(dt) {
      // 如果游戏已结束，不再检测
      if (this.isGameOver) return;

      // Only the head of the queue is currently actionable. Aircraft behind it
      // begin accumulating delay after they move to the front.
      const plane = this.getNextDepartureInQueue();
      if (!plane) return;

      plane.groundWaitElapsedMs = (plane.groundWaitElapsedMs || 0) +
        Math.max(0, Number(dt) || 0) * 1000;

      const warningThreshold = this.currentGroundWaitTimeout * this.groundDelayWarningRatio;
      if (plane.groundWaitElapsedMs >= warningThreshold && !plane.groundDelayWarningIssued) {
        plane.groundDelayWarningIssued = true;
        this.addToCommunicationLog(
          `GROUND DELAY WARNING: ${plane.id}, prioritize the next departure slot`
        );
      }

      if (plane.groundWaitElapsedMs > this.currentGroundWaitTimeout) {
        this.problemAircraft = [plane];
        this.triggerGameOver(
          "GROUND_DELAY",
          `GROUND DELAY: ${plane.id} exceeded maximum waiting time`
        );
      }
    },

    getNextDepartureInQueue() {
      return this.airplanes
        .filter(plane => plane.state === "READY_FOR_TAKEOFF")
        .sort((first, second) =>
          (first.queuePosition ?? Number.MAX_SAFE_INTEGER) -
          (second.queuePosition ?? Number.MAX_SAFE_INTEGER)
        )[0] || null;
    },

    isTrafficFlowRestrictedForGroundDelay() {
      const plane = this.getNextDepartureInQueue();
      return Boolean(plane &&
        (plane.groundWaitElapsedMs || 0) >=
          this.currentGroundWaitTimeout * this.groundDelayWarningRatio);
    },

    // 触发游戏结束
    triggerGameOver(reason, message) {
      if (this.isGameOver) return; // 防止多次触发

      this.isGameOver = true;
      this.gameOverReason = reason;
      this.gameOverMessage = message;

      // 记录到通信日志
      this.addToCommunicationLog(message);
      this.addToCommunicationLog("GAME OVER");

      // 开始问题飞机闪烁
      this.startProblemAircraftBlinking();

      // 更改游戏状态
      this.gameStatus = 'ended';

      // 停止所有定时器
      this.clearAllGameTimers();

      // 根据不同原因播放不同的音效
      this.playGameOverSound(reason);

      console.log("游戏结束:", reason, message);
    },

    // 开始问题飞机闪烁
    startProblemAircraftBlinking() {
      // 清除可能存在的之前的闪烁定时器
      if (this.blinkTimer) {
        clearInterval(this.blinkTimer);
      }

      // 每500毫秒切换一次闪烁状态，实现每秒闪烁2次
      this.blinkTimer = setInterval(() => {
        this.isBlinking = !this.isBlinking;
      }, 500);
    },

    // 播放游戏结束音效
    playGameOverSound(reason) {
      // 根据不同原因播放不同的音效
      switch(reason) {
        case "COLLISION":
          // 碰撞警报声
          this.speak("Collision alert! Collision alert!");
          break;
        case "OUT_OF_BOUNDS":
          // 飞出雷达范围提示音
          this.speak("Radar contact lost!");
          break;
        case "GROUND_DELAY":
          // 地面延误警告音
          this.speak("Ground delay timeout!");
          break;
        case "RESTRICTED_AREA":
          this.speak("Airspace violation!");
          break;
      }
    },

    // 清除所有游戏定时器
    clearAllGameTimers() {
      // 清除飞机生成定时器
      if (this.spawnApproachInterval) {
        clearInterval(this.spawnApproachInterval);
        this.spawnApproachInterval = null;
      }

      if (this.spawnDepartureInterval) {
        clearInterval(this.spawnDepartureInterval);
        this.spawnDepartureInterval = null;
      }

      // 清除游戏进度更新定时器
      if (this.gameProgressInterval) {
        clearInterval(this.gameProgressInterval);
        this.gameProgressInterval = null;
      }

      // 清除阶段变更定时器
      if (this.phaseChangeTimeout) {
        clearTimeout(this.phaseChangeTimeout);
        this.phaseChangeTimeout = null;
      }
    },

    // 绘制游戏结束画面
    drawGameOver(ctx) {
      // 半透明黑色背景
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(0, 0, 1800, 1200);

      // 游戏结束标题
      ctx.fillStyle = "#FF0000";
      ctx.font = "bold 80px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", 900, 400);

      // 显示最终得分
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 40px Arial";
      ctx.fillText(`FINAL SCORE: ${this.score}`, 900, 500);

      // 显示游戏结束原因
      ctx.fillStyle = "#FF9900";
      ctx.font = "30px Arial";
      ctx.fillText(this.gameOverMessage, 900, 580);

      // 绘制重新开始和返回菜单按钮
      this.drawGameOverButtons(ctx);

      // 恢复文本对齐设置
      ctx.textAlign = "start";
    },

    // 绘制游戏结束画面的按钮
    drawGameOverButtons(ctx) {
      // 绘制"RESTART"按钮
      ctx.fillStyle = "#003366";
      this.drawButton(ctx, 700, 700, 200, 60, "RESTART");

      // 绘制"RETURN TO MENU"按钮
      ctx.fillStyle = "#003366";
      this.drawButton(ctx, 950, 700, 200, 60, "MENU");
    },

    // 绘制按钮
    drawButton(ctx, x, y, width, height, text) {
      ctx.fillRect(x, y, width, height);

      // 按钮边框
      ctx.strokeStyle = "#00ffcc";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // 按钮文字
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width/2, y + height/2);

      // 恢复默认设置
      ctx.textBaseline = "alphabetic";
    },

    // 检查点是否在矩形内
    isPointInRect(x, y, rectX, rectY, rectWidth, rectHeight) {
      return x >= rectX && x <= rectX + rectWidth &&
             y >= rectY && y <= rectY + rectHeight;
    },

    // 处理"RESTART"按钮点击
    handleRestartButton() {
      console.log("重新开始游戏");

      // 清除游戏结束状态
      this.isGameOver = false;
      this.gameOverReason = '';
      this.gameOverMessage = '';
      this.problemAircraft = [];

      // 清除闪烁计时器
      if (this.blinkTimer) {
        clearInterval(this.blinkTimer);
        this.blinkTimer = null;
      }

      // 重新开始游戏
      this.restartGame();
      this.startGame();
    },

    // 处理"MENU"按钮点击
    handleMenuButton() {
      console.log("返回菜单");

      // 清除游戏结束状态
      this.isGameOver = false;
      this.gameOverReason = '';
      this.gameOverMessage = '';
      this.problemAircraft = [];

      // 清除闪烁计时器
      if (this.blinkTimer) {
        clearInterval(this.blinkTimer);
        this.blinkTimer = null;
      }

      // 重置游戏
      this.restartGame();
    },
    // 判断飞机是否在同一跑道上
    arePlanesOnSameRunway(plane1, plane2) {
      // 如果两架飞机都有runway属性且值相同，说明在同一跑道上
      if (plane1.runway && plane2.runway && plane1.runway === plane2.runway) {
        return true;
      }
      return false;
    },
    // 更新等待起飞的飞机队列
    updateTakeoffQueue() {
      // 只处理等待起飞的飞机
      const waitingPlanes = this.airplanes.filter(p => p.state === "READY_FOR_TAKEOFF");

      // 按队列位置排序
      waitingPlanes.sort((a, b) => {
        return (a.queuePosition || 0) - (b.queuePosition || 0);
      });

      const queue = this.airport.departureQueue || { x: this.airport.center.x, y: this.airport.center.y, spacingX: 0, spacingY: 50 };

      // 更新每架飞机的位置和队列号
      waitingPlanes.forEach((plane, index) => {
        plane.queuePosition = index;
        plane.x = queue.x + index * (queue.spacingX || 0);
        plane.y = queue.y + index * (queue.spacingY || 50);
      });
    },
    setSpeedLevel(level) {
      if ([0.5, 1, 1.5, 2].includes(level)) {
        this.speedLevel = level;
        this.scheduleTrafficSpawnTimer();
      }
    }
  },
  watch: {
    // 监听难度变化，如果在游戏运行中切换难度，重新设置生成间隔
    difficulty() {
      if (this.gameStatus === 'running') {
        // 清除现有间隔
        clearInterval(this.spawnApproachInterval);
        if (this.spawnDepartureInterval) {
          clearInterval(this.spawnDepartureInterval);
        }

        // 重置游戏阶段为正常
        this.gamePhase = 'normal';

        // 更新动态最大飞机数量
        this.dynamicMaxAircraftCount = this.maxAircraftCount[this.difficulty] + Math.floor(this.gameProgressLevel / 2);

        // 使用新难度设置
        const settings = this.currentDifficultySettings;
        this.currentSpawnInterval = settings.baseSpawnInterval;

        this.gamePhaseStartTime = this.simulationElapsedMs;
        this.gamePhaseEndTime = 0;
        this.scheduleTrafficSpawnTimer();

        // 添加难度变更信息到通信记录
        const difficultyText = this.getDifficultyText();
        this.addToCommunicationLog(`Difficulty changed to: ${difficultyText}`);
      }
    }
  }
};
</script>
