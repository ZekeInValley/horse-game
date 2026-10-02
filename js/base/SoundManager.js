/**
 * 音频/音效管理器 (SoundManager.js)
 * 封装微信小游戏 wx.createInnerAudioContext 接口，支持快速重置播放
 */
class SoundManager {
  constructor() {
      this.sounds = {};
      
      // 建议的音效资源路径（可替换为项目本地路径或远程 CDN URL）
      this.soundSources = {
          // 1. 三种核心马儿动作音效
          horse: 'audio/horse_neigh.mp3',   // “一匹马”：清脆响亮的马嘶鸣声
          start: 'audio/horse_gallop.mp3',  // “出发”：短促急促的马蹄奔跑声
          kou:   'audio/horse_hoof.mp3',    // “扣喽”：清晰干脆的马蹄踩地/木踏声
          
          // 2. 辅助游戏反馈音效
          error: 'audio/wrong.mp3',         // 犯错/扣血/超时提示音
          win:   'audio/win.mp3',           // 胜利/通关欢呼音效
          go:    'audio/start_go.mp3'       // 3,2,1倒计时结束 GO 音效
      };

      this.init();
  }

  init() {
      // 预加载所有音效资源
      for (let key in this.soundSources) {
          try {
              const audio = wx.createInnerAudioContext();
              audio.src = this.soundSources[key];
              this.sounds[key] = audio;
          } catch (e) {
              console.warn('创建音频上下文失败:', key, e);
          }
      }
  }

  /**
   * 基础播放方法：重置进度并播放
   */
  playSound(key) {
      if (this.sounds[key]) {
          try {
              this.sounds[key].stop(); // 先停止，防止快速连续点击时没声音
              this.sounds[key].play();
          } catch (e) {
              console.error('播放音效出错:', key, e);
          }
      }
  }

  // --- 专门的动作音效调用 ---
  playHorse() { this.playSound('horse'); }
  playStart() { this.playSound('start'); }
  playKou()   { this.playSound('kou'); }
  
  // --- 游戏状态音效调用 ---
  playError() { this.playSound('error'); }
  playWin()   { this.playSound('win'); }
  playGo()    { this.playSound('go'); }

  /**
   * 销毁所有音频上下文，释放资源
   */
  destroy() {
      for (let key in this.sounds) {
          if (this.sounds[key]) {
              this.sounds[key].destroy();
          }
      }
      this.sounds = {};
  }
}

module.exports = new SoundManager();