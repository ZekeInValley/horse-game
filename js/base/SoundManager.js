class SoundManager {
  constructor() {
    this.sounds = {};
    this._bgmOn = false;
    this._wantBgm = false;
    this.muted = false;

    try {
      this.muted = !!wx.getStorageSync('horse_muted');
    } catch (e) {}

    this.soundSources = {
      horse: 'audio/horse_neigh.mp3',
      start: 'audio/horse_gallop.mp3',
      kou:   'audio/horse_hoof.mp3',
      error: 'audio/wrong.mp3',
      win:   'audio/win.mp3',
      go:    'audio/start_go.mp3',
      click: 'audio/click.mp3',
      bgm:   'audio/bgm.mp3'
    };

    this.init();
  }

  init() {
    for (let key in this.soundSources) {
      try {
        const audio = wx.createInnerAudioContext();
        audio.src = this.soundSources[key];
        if (key === 'bgm') {
          audio.loop = true;
          audio.volume = 0.45;
        }
        this.sounds[key] = audio;
      } catch (e) {
        console.warn('创建音频上下文失败:', key, e);
      }
    }
  }

  isMuted() {
    return !!this.muted;
  }

  setMuted(muted) {
    this.muted = !!muted;
    try {
      wx.setStorageSync('horse_muted', this.muted);
    } catch (e) {}

    if (this.muted) {
      const bgm = this.sounds.bgm;
      if (bgm) {
        try { bgm.stop(); } catch (e) {}
      }
      this._bgmOn = false;
    } else if (this._wantBgm) {
      this._bgmOn = false;
      this.playBgm();
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  playSound(key) {
    if (this.muted || !this.sounds[key]) return;
    try {
      this.sounds[key].stop();
      this.sounds[key].seek(0);
      this.sounds[key].play();
    } catch (e) {
      console.error('播放音效出错:', key, e);
    }
  }

  playHorse() { this.playSound('horse'); }
  playStart() { this.playSound('start'); }
  playKou()   { this.playSound('kou'); }
  playError() { this.playSound('error'); }
  playWin()   { this.playSound('win'); }
  playGo()    { this.playSound('go'); }
  playClick() { this.playSound('click'); }

  playBgm() {
    this._wantBgm = true;
    const bgm = this.sounds.bgm;
    if (!bgm || this.muted || this._bgmOn) return;
    this._bgmOn = true;
    try {
      bgm.play();
    } catch (e) {
      this._bgmOn = false;
      console.error('播放 BGM 出错:', e);
    }
  }

  stopBgm() {
    this._wantBgm = false;
    const bgm = this.sounds.bgm;
    if (!bgm) return;
    this._bgmOn = false;
    try {
      bgm.stop();
    } catch (e) {
      console.error('停止 BGM 出错:', e);
    }
  }

  destroy() {
    this.stopBgm();
    for (let key in this.sounds) {
      if (this.sounds[key]) this.sounds[key].destroy();
    }
    this.sounds = {};
  }
}

module.exports = new SoundManager();