const Mascot = require('../base/Mascot');
const UI = require('../base/UI');
const ResultStage = require('./ResultStage');
const SoundManager = require('../base/SoundManager');

const DEFAULT_AI_NAMES = ['奔跑马驹', '黑马选手', '汗血宝马', '小马过河', '赤兔神驹'];
const DEFAULT_COLORS = ['#E67E22', '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#F1C40F'];
const MAIN_COLOR = '#E67E22';
const DARK_COLOR = '#D35400';

// 倒计时类同步间隔（毫秒）：拉长可减轻卡顿，事件仍立即 sync
const TIMER_SYNC_MS = 900;
const POLL_MS_HOST = 1500;
const POLL_MS_GUEST = 600;

const ACTION_SOUND = {
    HORSE: function () { SoundManager.playHorse(); },
    START: function () { SoundManager.playStart(); },
    KOU: function () { SoundManager.playKou(); }
};

function hit(x, y, rx, ry, rw, rh) {
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
}

function GameStage() {
    this.roomCode = '8888';
    this.mySeatIndex = -1;
    this.isHost = false;
    this.resultStage = new ResultStage();
    this.db = (typeof wx !== 'undefined' && wx.cloud) ? wx.cloud.database() : null;
    this.watcher = null;
    this.pollTimer = null;
    this.lastServerTime = 0;
    this._watchStarting = false;
    this._watchRetryTimer = null;
    this.aiActionTimer = 0;
    this.hasTriggeredGameOverUI = false;
    this._timerBase = 2.0;
    this._timerBaseAt = Date.now();
    this._pauseBase = 0;
    this._pauseBaseAt = 0;
    this._startCountBase = 3.0;
    this._startCountBaseAt = Date.now();
    this._lastTimerSyncAt = 0;
    this._lastCloudAt = Date.now();
    this._syncInFlight = false;
    this.resetGame();
}

GameStage.prototype.resetGame = function (roomData, changeScene, roomStage) {
    this.stopWatch();
    this.hasTriggeredGameOverUI = false;
    this._syncInFlight = false;

    if (roomData) {
        if (roomData.roomCode) this.roomCode = roomData.roomCode;
        if (typeof roomData.mySeatIndex === 'number') this.mySeatIndex = roomData.mySeatIndex;
    }

    this.changeScene = changeScene;
    this.roomStage = roomStage;
    this.players = [];
    let aiIdx = 0;

    for (let i = 0; i < 6; i++) {
        const seat = roomData && roomData.seats && roomData.seats[i];
        const occupied = seat && !seat.isEmpty;
        this.players.push({
            id: i + 1,
            seatIndex: i,
            name: occupied ? seat.name : (DEFAULT_AI_NAMES[aiIdx++] || ('AI马驹' + (i + 1))),
            hp: occupied && seat.hp !== undefined ? seat.hp : 2,
            isAI: !occupied,
            color: (occupied && seat.color) || DEFAULT_COLORS[i],
            isAlive: occupied && seat.isAlive !== undefined ? seat.isAlive : true,
            lastSpeech: (occupied && seat.lastSpeech) || '',
            speechTimer: 0,
            rank: (occupied && seat.rank) || 0
        });
    }

    this.isHost = this.computeIsHost();
    this.humanCount = this.players.filter(function (p) { return !p.isAI; }).length;
    this.isMultiplayer = this.humanCount >= 2;
    this.turnDuration = this.isMultiplayer ? 3.0 : 2.0;
    this.aiMinDelay = 0.75;
    this.aiMaxDelay = 0.92;
    this.pauseDuration = this.isMultiplayer ? 2.5 : 2.0;

    this.horseCount = 1;
    this.currentStage = 'HORSE';
    this.stageProgress = 0;
    this.turnIndex = 0;
    this.resetTurnClock();
    this.lastTime = Date.now();
    this.isGameOver = false;
    this.winnerName = '';
    this.tipMessage = '比赛开始！从 1 匹马开始！';
    this.tipTimer = 90;
    this.isStartCounting = true;
    this.startCountTimer = 3.0;
    this._startCountBase = 3.0;
    this._startCountBaseAt = Date.now();
    this.isPaused = false;
    this.pauseTimer = 0;
    this._pauseBase = 0;
    this._pauseBaseAt = Date.now();
    this.errorPlayerName = '';
    this.errorReason = '';
    this.eliminatedCount = 0;
    this._lastTimerSyncAt = 0;
    this._lastCloudAt = Date.now();
    this.resetAITimer();

    if (this.db && this.roomCode) {
        this.startWatch();
        this.startPollingBackup();
        if (this.isHost) {
            const self = this;
            setTimeout(function () { self.syncToCloud(true); }, 150);
        }
    }
};

GameStage.prototype.computeIsHost = function () {
    let min = 999;
    for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.isAI && p.seatIndex < min) min = p.seatIndex;
    }
    return min === 999 || this.mySeatIndex === min;
};

GameStage.prototype.resetAITimer = function () {
    const min = this.aiMinDelay != null ? this.aiMinDelay : 0.9;
    const max = this.aiMaxDelay != null ? this.aiMaxDelay : 0.9;
    this.aiActionTimer = min + Math.random() * (max - min);
};

GameStage.prototype.resetTurnClock = function () {
    this.timer = this.turnDuration;
    this._timerBase = this.timer;
    this._timerBaseAt = Date.now();
};

GameStage.prototype.nextAliveIndex = function (fromIndex) {
    let i = fromIndex;
    let n = 0;
    do {
        i = (i + 1) % this.players.length;
        n++;
        if (n > 10) break;
    } while (!this.players[i].isAlive);
    return i;
};

// force=true：关键事件立即写库；否则仅按 TIMER_SYNC_MS 节流
GameStage.prototype.throttleSync = function (now, force) {
    if (!force && now - this._lastTimerSyncAt < TIMER_SYNC_MS) return;
    this._lastTimerSyncAt = now;
    this.syncToCloud(force);
};

GameStage.prototype.closeWatchOnly = function () {
    if (this.watcher) {
        try { this.watcher.close(); } catch (e) {}
        this.watcher = null;
    }
    this._watchStarting = false;
    if (this._watchRetryTimer) {
        clearTimeout(this._watchRetryTimer);
        this._watchRetryTimer = null;
    }
};

GameStage.prototype.startWatch = function () {
    if (!this.db || !this.roomCode || this._watchStarting) return;
    const self = this;
    this.closeWatchOnly();
    this._watchStarting = true;

    this._watchRetryTimer = setTimeout(function () {
        self._watchRetryTimer = null;
        if (self.isGameOver || !self.roomCode) {
            self._watchStarting = false;
            return;
        }
        try {
            self.watcher = self.db.collection('rooms').doc(self.roomCode).watch({
                onChange: function (snapshot) {
                    if (snapshot.docs && snapshot.docs.length > 0) {
                        self.onCloudStateUpdate(snapshot.docs[0]);
                    }
                },
                onError: function (err) {
                    console.warn('GameStage 监听错误:', err);
                    self.watcher = null;
                    self._watchStarting = false;
                    if (self._watchRetryTimer) clearTimeout(self._watchRetryTimer);
                    self._watchRetryTimer = setTimeout(function () {
                        self._watchRetryTimer = null;
                        if (!self.isGameOver) self.startWatch();
                    }, 3000);
                }
            });
            self._watchStarting = false;
        } catch (e) {
            self._watchStarting = false;
            self.watcher = null;
        }
    }, 300);
};

GameStage.prototype.startPollingBackup = function () {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const self = this;
    // 房主权威，轮询仅作兜底；
    const interval = this.isHost
        ? (this.isMultiplayer ? POLL_MS_HOST : 2000)
        : (this.isMultiplayer ? POLL_MS_GUEST : 1200);

    this.pollTimer = setInterval(function () {
        if (self.isGameOver || !self.db) return;
        self.db.collection('rooms').doc(self.roomCode).get().then(function (res) {
            if (res.data) self.onCloudStateUpdate(res.data);
        }).catch(function () {});
    }, interval);
};

GameStage.prototype.stopWatch = function () {
    this.closeWatchOnly();
    if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
    }
};

GameStage.prototype.playSpeechSound = function (text) {
    if (!text) return;
    if (text.indexOf('马') >= 0) SoundManager.playHorse();
    else if (text.indexOf('出发') >= 0) SoundManager.playStart();
    else if (text.indexOf('扣喽') >= 0) SoundManager.playKou();
};

GameStage.prototype.onCloudStateUpdate = function (data) {
    if (!data.gameState) return;
    const state = data.gameState;
    if (state.lastUpdateTime && state.lastUpdateTime <= this.lastServerTime) return;

    if (this.isHost && state.lastUpdateTime && state.lastUpdateTime < this.lastServerTime) return;

    this.lastServerTime = state.lastUpdateTime || Date.now();
    this._lastCloudAt = Date.now();
    const oldTurnIndex = this.turnIndex;
    const now = Date.now();

    if (state.horseCount != null) this.horseCount = state.horseCount;
    if (state.currentStage) this.currentStage = state.currentStage;
    if (state.stageProgress != null) this.stageProgress = state.stageProgress;
    if (state.turnIndex != null) this.turnIndex = state.turnIndex;

    // 非房主：用云端时间做本地外推；房主保持自己的推进
    if (!this.isHost) {
        if (state.timer !== undefined) {
            this.timer = state.timer;
            this._timerBase = state.timer;
            this._timerBaseAt = now;
        }
        if (state.isStartCounting !== undefined) this.isStartCounting = !!state.isStartCounting;
        if (state.startCountTimer !== undefined) {
            this.startCountTimer = state.startCountTimer;
            this._startCountBase = state.startCountTimer;
            this._startCountBaseAt = now;
        }
        this.isPaused = !!state.isPaused;
        if (state.pauseTimer !== undefined) {
            this.pauseTimer = state.pauseTimer;
            this._pauseBase = state.pauseTimer;
            this._pauseBaseAt = now;
        }
    } else {
        // 房主仍同步对方动作带来的规则字段，倒计时以本地为准
        if (state.isStartCounting === false && this.isStartCounting) {
            this.isStartCounting = false;
        }
        if (state.isPaused && !this.isPaused) {
            this.isPaused = true;
            if (state.pauseTimer !== undefined) {
                this.pauseTimer = state.pauseTimer;
                this._pauseBase = state.pauseTimer;
                this._pauseBaseAt = now;
            }
        }
        if (state.isPaused === false && this.isPaused && state.pauseTimer === 0) {
            // 由云端确认的暂停结束较少见，保持本地
        }
    }

    this.errorPlayerName = state.errorPlayerName || '';
    this.errorReason = state.errorReason || '';
    this.isGameOver = !!state.isGameOver;
    this.winnerName = state.winnerName || '';

    if (Array.isArray(state.players)) {
        for (let i = 0; i < this.players.length; i++) {
            const cloudP = state.players[i];
            if (!cloudP) continue;
            const localP = this.players[i];
            localP.hp = cloudP.hp;
            localP.isAlive = cloudP.isAlive;
            localP.rank = cloudP.rank;
            if (cloudP.lastSpeech && cloudP.lastSpeech !== localP.lastSpeech) {
                localP.lastSpeech = cloudP.lastSpeech;
                localP.speechTimer = 70;
                this.playSpeechSound(cloudP.lastSpeech);
            }
        }
    }

    if (oldTurnIndex !== this.turnIndex) this.resetAITimer();
    if (this.isGameOver && !this.hasTriggeredGameOverUI) {
        this.hasTriggeredGameOverUI = true;
        this.triggerGameOverUI();
    }
};

GameStage.prototype.syncToCloud = function (force) {
    if (!this.db || !this.roomCode) return;
    if (this._syncInFlight && !force) return;

    const now = Date.now();
    this.lastServerTime = now;
    this._syncInFlight = true;
    const self = this;

    this.db.collection('rooms').doc(this.roomCode).update({
        data: {
            gameState: {
                horseCount: this.horseCount,
                currentStage: this.currentStage,
                stageProgress: this.stageProgress,
                turnIndex: this.turnIndex,
                timer: this.timer,
                isStartCounting: this.isStartCounting,
                startCountTimer: this.startCountTimer,
                isPaused: this.isPaused,
                pauseTimer: this.pauseTimer,
                errorPlayerName: this.errorPlayerName,
                errorReason: this.errorReason,
                isGameOver: this.isGameOver,
                winnerName: this.winnerName,
                lastUpdateTime: now,
                players: this.players.map(function (p) {
                    return {
                        id: p.id,
                        name: p.name,
                        hp: p.hp,
                        isAlive: p.isAlive,
                        lastSpeech: p.lastSpeech,
                        rank: p.rank,
                        isAI: p.isAI
                    };
                })
            }
        }
    }).then(function () {
        self._syncInFlight = false;
        self._lastCloudAt = Date.now();
    }).catch(function () {
        self._syncInFlight = false;
    });
};

GameStage.prototype.areAllHumanOut = function () {
    return !this.players.some(function (p) { return !p.isAI && p.isAlive; });
};

GameStage.prototype.triggerGameOverUI = function () {
    SoundManager.playWin();
    const self = this;
    this.resultStage.init(
        this.players,
        this.winnerName,
        function onRestart(changeSceneFn) {
            self.stopWatch();
            const cb = changeSceneFn || self.changeScene;
            if (self.roomStage) {
                if (typeof self.roomStage.setReadyStatus === 'function') self.roomStage.setReadyStatus(false);
                else self.roomStage.isReady = false;
            }
            if (typeof cb === 'function') cb(3);
        },
        function onBackHome(changeSceneFn) {
            self.stopWatch();
            const cb = changeSceneFn || self.changeScene;
            if (typeof cb === 'function') cb(1);
        }
    );
};

GameStage.prototype.triggerGameOver = function () {
    this.isGameOver = true;
    this.syncToCloud(true);
    this.triggerGameOverUI();
};

GameStage.prototype.quickEndGame = function () {
    const alivePlayers = this.players.filter(function (p) { return p.isAlive; });
    alivePlayers.sort(function (a, b) {
        if (b.hp !== a.hp) return b.hp - a.hp;
        return a.seatIndex - b.seatIndex;
    });
    alivePlayers.forEach(function (p, i) { p.rank = i + 1; });

    const used = {};
    this.players.forEach(function (p) { if (p.rank > 0) used[p.rank] = true; });
    let tail = this.players.length;
    this.players.forEach(function (p) {
        if (!p.isAlive && (!p.rank || p.rank <= 0)) {
            while (tail >= 1 && used[tail]) tail--;
            if (tail >= 1) {
                p.rank = tail;
                used[tail] = true;
                tail--;
            }
        }
    });

    this.winnerName = alivePlayers.length > 0 ? alivePlayers[0].name : '无胜者';
    this.isPaused = false;
    this.triggerGameOver();
};

GameStage.prototype.endHostCountdown = function () {
    this.resetTurnClock();
    this.resetAITimer();
    this.syncToCloud(true);
};

GameStage.prototype.updateLogic = function () {
    if (this.isGameOver) return;
    const now = Date.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!this.isHost) {
        if (this.isStartCounting) {
            this.startCountTimer = Math.max(0, this._startCountBase - (now - this._startCountBaseAt) / 1000);
        } else if (this.isPaused) {
            this.pauseTimer = Math.max(0, this._pauseBase - (now - this._pauseBaseAt) / 1000);
        } else {
            this.timer = Math.max(0, this._timerBase - (now - this._timerBaseAt) / 1000);
        }
        return;
    }

    if (this.isStartCounting) {
        this.startCountTimer -= delta;
        if (this.startCountTimer <= 0) {
            this.isStartCounting = false;
            this.startCountTimer = 0;
            SoundManager.playGo();
            this.endHostCountdown();
        } else {
            this.throttleSync(now, false);
        }
        return;
    }

    if (this.isPaused) {
        this.pauseTimer -= delta;
        if (this.pauseTimer <= 0) {
            this.isPaused = false;
            this.endHostCountdown();
        } else {
            this.throttleSync(now, false);
        }
        return;
    }

    const curPlayer = this.players[this.turnIndex];
    if (!curPlayer || !curPlayer.isAlive) {
        this.nextTurn();
        this.syncToCloud(true);
        return;
    }

    this.timer -= delta;
    if (this.timer <= 0) {
        this.triggerError('反应超时');
        return;
    }
    this.throttleSync(now, false);

    if (!curPlayer.isAI) return;
    this.aiActionTimer -= delta;
    if (this.aiActionTimer > 0) return;
    this.resetAITimer();
    if (Math.random() < 0.95) {
        this.handleAction(this.currentStage);
        return;
    }
    const wrongs = ['HORSE', 'START', 'KOU'].filter(function (a) {
        return a !== this.currentStage;
    }, this);
    this.handleAction(wrongs[Math.floor(Math.random() * wrongs.length)]);
};

GameStage.prototype.handleAction = function (actionType) {
    if (this.isGameOver || this.isPaused || this.isStartCounting) return;
    const curPlayer = this.players[this.turnIndex];
    if (!curPlayer || !curPlayer.isAlive) return;

    if (actionType === 'HORSE') curPlayer.lastSpeech = this.horseCount + ' 匹马!';
    else if (actionType === 'START') curPlayer.lastSpeech = '出发!';
    else if (actionType === 'KOU') curPlayer.lastSpeech = '扣喽!';
    if (ACTION_SOUND[actionType]) ACTION_SOUND[actionType]();
    curPlayer.speechTimer = 70;

    if (actionType !== this.currentStage) {
        this.triggerError('喊错指令');
        return;
    }
    this.advanceGameStep();
    this.syncToCloud(true);
};

GameStage.prototype.advanceGameStep = function () {
    this.stageProgress++;
    if (this.currentStage === 'HORSE') {
        this.currentStage = 'START';
        this.stageProgress = 0;
    } else if (this.currentStage === 'START' && this.stageProgress >= this.horseCount) {
        this.currentStage = 'KOU';
        this.stageProgress = 0;
    } else if (this.currentStage === 'KOU' && this.stageProgress >= this.horseCount) {
        this.horseCount++;
        this.currentStage = 'HORSE';
        this.stageProgress = 0;
        this.showTip('🎉 完美！升级到 ' + this.horseCount + ' 匹马！');
    }
    this.nextTurn();
};

GameStage.prototype.nextTurn = function () {
    this.resetTurnClock();
    this.turnIndex = this.nextAliveIndex(this.turnIndex);
    this.resetAITimer();
};

GameStage.prototype.triggerError = function (reason) {
    const wrongPlayer = this.players[this.turnIndex];
    if (!wrongPlayer) return;
    SoundManager.playError();
    wrongPlayer.hp--;
    this.errorPlayerName = wrongPlayer.name;
    this.errorReason = reason;

    let tip = wrongPlayer.name + ' ' + reason + ' 扣 1 心!';
    if (wrongPlayer.hp <= 0) {
        wrongPlayer.hp = 0;
        wrongPlayer.isAlive = false;
        this.eliminatedCount++;
        wrongPlayer.rank = this.players.length - this.eliminatedCount + 1;
        tip = wrongPlayer.name + ' 淘汰！获得第 ' + wrongPlayer.rank + ' 名';
    }
    this.showTip(tip);

    const alivePlayers = this.players.filter(function (p) { return p.isAlive; });
    if (alivePlayers.length <= 1) {
        if (alivePlayers.length === 1) {
            alivePlayers[0].rank = 1;
            this.winnerName = alivePlayers[0].name;
        } else {
            this.winnerName = '无胜者';
        }
        this.triggerGameOver();
        return;
    }

    this.isPaused = true;
    this.pauseTimer = this.pauseDuration;
    this._pauseBase = this.pauseTimer;
    this._pauseBaseAt = Date.now();
    this.horseCount = 1;
    this.currentStage = 'HORSE';
    this.stageProgress = 0;
    if (!wrongPlayer.isAlive) this.turnIndex = this.nextAliveIndex(this.turnIndex);
    this.syncToCloud(true);
};

GameStage.prototype.showTip = function (msg) {
    this.tipMessage = msg;
    this.tipTimer = 90;
};

GameStage.prototype.getActionBtns = function (windowWidth, windowHeight) {
    const btnY = windowHeight * 0.83;
    const btnW = Math.min(110, (windowWidth - 50) / 3);
    const btnH = 48;
    const gap = 10;
    const startX = (windowWidth - (btnW * 3 + gap * 2)) / 2;
    return [
        { type: 'HORSE', x: startX, y: btnY, w: btnW, h: btnH, bg: MAIN_COLOR, dark: DARK_COLOR, label: this.horseCount + ' 匹马' },
        { type: 'START', x: startX + btnW + gap, y: btnY, w: btnW, h: btnH, bg: '#2F80ED', dark: '#1D5297', label: '出发！' },
        { type: 'KOU', x: startX + (btnW + gap) * 2, y: btnY, w: btnW, h: btnH, bg: '#27AE60', dark: '#1E723D', label: '扣喽！' }
    ];
};

GameStage.prototype.render = function (ctx, windowWidth, windowHeight) {
    this.updateLogic();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, windowWidth, 65);
    UI.drawFancyBtn(ctx, 15, 12, 70, 36, '#EB5757', '#9B2C2C', '退出');

    if (this.areAllHumanOut() && !this.isGameOver) {
        UI.drawFancyBtn(ctx, windowWidth - 110, windowHeight * 0.74, 95, 36, '#F39C12', '#B76211', '快速结束');
    }

    ctx.fillStyle = '#FFE000';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('目标喊话：' + this.getExpectedActionName(), windowWidth / 2, 22);

    const curPlayer = this.players[this.turnIndex] || this.players[0];
    if (this.isStartCounting) {
        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('⌛ 准备阶段... 比赛即将开启', windowWidth / 2, 48);
    } else if (this.isPaused) {
        ctx.fillStyle = '#FF4D4D';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('⚠️ 犯错重新开始中...', windowWidth / 2, 48);
    } else {
        ctx.fillStyle = this.timer < 0.8 ? '#FF4D4D' : '#FFFFFF';
        ctx.font = '14px sans-serif';
        ctx.fillText('轮到【' + curPlayer.name + '】 限时: ' + Math.max(0, this.timer).toFixed(1) + 's', windowWidth / 2, 48);
    }

    if (this.isMultiplayer && Date.now() - this._lastCloudAt > 2800) {
        ctx.fillStyle = '#FF9800';
        ctx.font = '11px sans-serif';
        ctx.fillText('网络延迟中…', windowWidth / 2, 62);
    }
    ctx.restore();

    const cols = 3;
    const cardW = Math.min(105, (windowWidth - 60) / 3);
    const cardH = 105;
    const startX = (windowWidth - (cols * cardW + (cols - 1) * 12)) / 2;
    const startY = windowHeight * 0.18;
    const self = this;
    this.players.forEach(function (p, index) {
        const x = startX + (index % cols) * (cardW + 12);
        const y = startY + Math.floor(index / cols) * (cardH + 12);
        self.drawPlayerCard(ctx, x, y, cardW, cardH, p, index === self.turnIndex);
    });

    if (!this.isGameOver) {
        this.getActionBtns(windowWidth, windowHeight).forEach(function (b) {
            UI.drawFancyBtn(ctx, b.x, b.y, b.w, b.h, b.bg, b.dark, b.label);
        });
    }

    if (this.tipMessage && this.tipTimer > 0 && !this.isPaused) {
        this.tipTimer--;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        const tipY = windowHeight * 0.72;
        UI.drawRoundedRectPath(ctx, windowWidth / 2 - 140, tipY, 280, 38, 19);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.tipMessage, windowWidth / 2, tipY + 19);
        ctx.restore();
    }

    if (this.isStartCounting) this.drawStartCountdownOverlay(ctx, windowWidth, windowHeight);
    if (this.isPaused && !this.isGameOver) this.drawErrorOverlay(ctx, windowWidth, windowHeight);
    if (this.isGameOver) this.resultStage.render(ctx, windowWidth, windowHeight);
};

GameStage.prototype.drawErrorOverlay = function (ctx, windowWidth, windowHeight) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);

    const errorText = this.errorPlayerName + '口令错误！';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6;
    ctx.strokeText(errorText, windowWidth / 2, windowHeight / 2 - 30);
    ctx.fillStyle = '#FF2D55';
    ctx.fillText(errorText, windowWidth / 2, windowHeight / 2 - 30);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#E0E0E0';
    ctx.fillText('原因：' + this.errorReason, windowWidth / 2, windowHeight / 2 + 15);

    const secondsLeft = Math.max(0, Math.ceil(this.pauseTimer));
    const nextName = this.players[this.turnIndex] ? this.players[this.turnIndex].name : '';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#FFE000';
    ctx.fillText(secondsLeft + ' 秒后由【' + nextName + '】重新开始...', windowWidth / 2, windowHeight / 2 + 60);
    ctx.restore();
};

GameStage.prototype.drawStartCountdownOverlay = function (ctx, windowWidth, windowHeight) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);

    const countNum = Math.ceil(this.startCountTimer);
    const displayStr = countNum > 0 ? String(countNum) : 'GO!';
    ctx.fillStyle = '#FFE000';
    ctx.font = '900 80px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.strokeText(displayStr, windowWidth / 2, windowHeight / 2 - 20);
    ctx.fillText(displayStr, windowWidth / 2, windowHeight / 2 - 20);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('全员就位，游戏即将开始...', windowWidth / 2, windowHeight / 2 + 60);
    ctx.restore();
};

GameStage.prototype.drawPlayerCard = function (ctx, x, y, w, h, player, isCurrentTurn) {
    ctx.save();
    UI.drawRoundedRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = player.isAlive ? (isCurrentTurn ? '#FFF3CD' : '#FFFFFF') : '#E0E0E0';
    ctx.fill();

    if (isCurrentTurn && player.isAlive && !this.isGameOver) {
        ctx.strokeStyle = '#F39C12';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    if (!player.isAlive) {
        ctx.fillStyle = '#7F8C8D';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('OUT 淘汰', x + w / 2, y + h / 2 - 10);
        ctx.font = '12px sans-serif';
        ctx.fillText('第 ' + player.rank + ' 名', x + w / 2, y + h / 2 + 12);
    } else {
        Mascot.drawCuteHorse(ctx, x + w / 2, y + 36, 0.55, player.color);
        ctx.fillStyle = '#2C3E50';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, x + w / 2, y + 72);
        let hpStr = '';
        for (let i = 0; i < player.hp; i++) hpStr += '❤️';
        ctx.font = '11px sans-serif';
        ctx.fillText(hpStr, x + w / 2, y + 90);
    }

    if (player.speechTimer > 0) {
        player.speechTimer--;
        UI.drawRoundedRectPath(ctx, x + 3, y + 3, w - 6, h - 6, 12);
        ctx.fillStyle = 'rgba(41, 128, 185, 0.92)';
        ctx.fill();
        ctx.fillStyle = '#FFE000';
        ctx.font = '900 16px "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(player.lastSpeech, x + w / 2, y + h / 2);
        ctx.fillText(player.lastSpeech, x + w / 2, y + h / 2);
    }
    ctx.restore();
};

GameStage.prototype.getExpectedActionName = function () {
    if (this.currentStage === 'HORSE') return this.horseCount + ' 匹马';
    if (this.currentStage === 'START') return '出发 (' + (this.stageProgress + 1) + '/' + this.horseCount + ')';
    if (this.currentStage === 'KOU') return '扣喽 (' + (this.stageProgress + 1) + '/' + this.horseCount + ')';
};

GameStage.prototype.handleTouch = function (x, y, windowWidth, windowHeight, changeScene) {
    const cb = changeScene || this.changeScene;
    if (this.isGameOver) {
        this.resultStage.handleTouch(x, y, windowWidth, windowHeight, cb);
        return;
    }
    if (hit(x, y, 15, 12, 70, 36)) {
        SoundManager.playClick();
        this.stopWatch();
        if (cb) cb(1);
        return;
    }
    if (this.areAllHumanOut() && !this.isGameOver) {
        if (hit(x, y, windowWidth - 110, windowHeight * 0.74, 95, 36)) {
            if (this.isHost) {
                SoundManager.playClick();
                this.quickEndGame();
            }
            return;
        }
    }

    const curPlayer = this.players[this.turnIndex];
    if (!curPlayer || this.isStartCounting || this.isPaused || curPlayer.isAI || !curPlayer.isAlive) return;
    if (this.mySeatIndex !== -1 && curPlayer.seatIndex !== this.mySeatIndex) return;

    const btns = this.getActionBtns(windowWidth, windowHeight);
    for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        if (hit(x, y, b.x, b.y, b.w, b.h)) {

            this.handleAction(b.type);
            return;
        }
    }
};

module.exports = GameStage;