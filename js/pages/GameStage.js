const Mascot = require('../base/Mascot');
const UI = require('../base/UI');
const ResultStage = require('./ResultStage');
const SoundManager = require('../base/SoundManager');

const DEFAULT_AI_NAMES = ['奔跑马驹', '黑马选手', '汗血宝马', '小马过河', '赤兔神驹'];
const DEFAULT_COLORS = ['#E67E22', '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#F1C40F'];

const mainColor = '#E67E22';
const darkColor = '#D35400';

function GameStage() {
    this.roomCode = '8888';
    this.mySeatIndex = -1;
    this.isHost = false;
    this.resultStage = new ResultStage();

    if (typeof wx !== 'undefined' && wx.cloud) {
        this.db = wx.cloud.database();
    }
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

    this.resetGame();
}

GameStage.prototype.resetGame = function(roomData, changeScene, roomStage) {
    this.stopWatch();
    this.hasTriggeredGameOverUI = false;

    if (roomData) {
        if (roomData.roomCode) this.roomCode = roomData.roomCode;
        if (typeof roomData.mySeatIndex === 'number') this.mySeatIndex = roomData.mySeatIndex;
    }

    this.changeScene = changeScene;
    this.roomStage = roomStage;

    this.players = [];
    let aiIdx = 0;

    for (let i = 0; i < 6; i++) {
        let seat = roomData && roomData.seats && roomData.seats[i];
        if (seat && !seat.isEmpty) {
            this.players.push({
                id: i + 1,
                seatIndex: i,
                name: seat.name,
                hp: seat.hp !== undefined ? seat.hp : 2,
                isAI: false,
                color: seat.color || DEFAULT_COLORS[i],
                isAlive: seat.isAlive !== undefined ? seat.isAlive : true,
                lastSpeech: seat.lastSpeech || '',
                speechTimer: 0,
                rank: seat.rank || 0
            });
        } else {
            this.players.push({
                id: i + 1,
                seatIndex: i,
                name: DEFAULT_AI_NAMES[aiIdx++] || ('AI马驹' + (i + 1)),
                hp: 2,
                isAI: true,
                color: DEFAULT_COLORS[i],
                isAlive: true,
                lastSpeech: '',
                speechTimer: 0,
                rank: 0
            });
        }
    }

    this.isHost = this.computeIsHost();

    this.humanCount = this.players.filter(function(p) { return !p.isAI; }).length;
    this.isMultiplayer = this.humanCount >= 2;

    // 单人 2 秒，多人 3 秒
    this.turnDuration = this.isMultiplayer ? 3.0 : 2.0;
    // AI 固定约 0.9 秒出牌
    this.aiMinDelay = 0.75;
    this.aiMaxDelay = 0.92;
    this.pauseDuration = this.isMultiplayer ? 2.5 : 2.0;

    this.horseCount = 1;
    this.currentStage = 'HORSE';
    this.stageProgress = 0;
    this.turnIndex = 0;

    this.timer = this.turnDuration;
    this._timerBase = this.timer;
    this._timerBaseAt = Date.now();
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
            setTimeout(function() {
                self.syncToCloud();
            }, 150);
        }
    }
};

GameStage.prototype.computeIsHost = function() {
    let minHumanSeat = 999;
    for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.isAI) {
            if (p.seatIndex < minHumanSeat) minHumanSeat = p.seatIndex;
        }
    }
    if (minHumanSeat === 999) {
        return true;
    }
    return this.mySeatIndex === minHumanSeat;
};

GameStage.prototype.resetAITimer = function() {
    const min = this.aiMinDelay != null ? this.aiMinDelay : 0.9;
    const max = this.aiMaxDelay != null ? this.aiMaxDelay : 0.9;
    this.aiActionTimer = min + Math.random() * (max - min);
};

GameStage.prototype.closeWatchOnly = function() {
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

GameStage.prototype.startWatch = function() {
    if (!this.db || !this.roomCode) return;

    const self = this;
    if (this._watchStarting) return;

    this.closeWatchOnly();
    this._watchStarting = true;

    this._watchRetryTimer = setTimeout(function() {
        self._watchRetryTimer = null;
        if (self.isGameOver || !self.roomCode) {
            self._watchStarting = false;
            return;
        }

        try {
            self.watcher = self.db.collection('rooms').doc(self.roomCode).watch({
                onChange: function(snapshot) {
                    if (snapshot.docs && snapshot.docs.length > 0) {
                        self.onCloudStateUpdate(snapshot.docs[0]);
                    }
                },
                onError: function(err) {
                    console.warn('GameStage 监听错误:', err);
                    self.watcher = null;
                    self._watchStarting = false;

                    if (self._watchRetryTimer) clearTimeout(self._watchRetryTimer);
                    self._watchRetryTimer = setTimeout(function() {
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

GameStage.prototype.startPollingBackup = function() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    const self = this;
    // 多人 300ms，减轻非房主延迟；单人 1200ms
    const interval = this.isMultiplayer ? 300 : 1200;

    this.pollTimer = setInterval(function() {
        if (self.isGameOver || !self.db) return;

        self.db.collection('rooms').doc(self.roomCode).get().then(function(res) {
            if (res.data) {
                self.onCloudStateUpdate(res.data);
            }
        }).catch(function() {});
    }, interval);
};

GameStage.prototype.stopWatch = function() {
    this.closeWatchOnly();
    if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
    }
};

GameStage.prototype.onCloudStateUpdate = function(data) {
    if (!data.gameState) return;

    const state = data.gameState;
    if (state.lastUpdateTime && state.lastUpdateTime <= this.lastServerTime) {
        return;
    }
    this.lastServerTime = state.lastUpdateTime || Date.now();
    this._lastCloudAt = Date.now();

    const oldTurnIndex = this.turnIndex;
    const now = Date.now();

    this.horseCount = state.horseCount != null ? state.horseCount : this.horseCount;
    this.currentStage = state.currentStage || this.currentStage;
    this.stageProgress = state.stageProgress != null ? state.stageProgress : this.stageProgress;
    this.turnIndex = state.turnIndex != null ? state.turnIndex : this.turnIndex;

    if (state.timer !== undefined) {
        this.timer = state.timer;
        this._timerBase = state.timer;
        this._timerBaseAt = now;
    }

    if (state.isStartCounting !== undefined) {
        this.isStartCounting = !!state.isStartCounting;
    }
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

    this.errorPlayerName = state.errorPlayerName || '';
    this.errorReason = state.errorReason || '';
    this.isGameOver = !!state.isGameOver;
    this.winnerName = state.winnerName || '';

    if (Array.isArray(state.players)) {
        for (let i = 0; i < this.players.length; i++) {
            if (state.players[i]) {
                const cloudP = state.players[i];
                const localP = this.players[i];

                localP.hp = cloudP.hp;
                localP.isAlive = cloudP.isAlive;
                localP.rank = cloudP.rank;

                if (cloudP.lastSpeech && cloudP.lastSpeech !== localP.lastSpeech) {
                    localP.lastSpeech = cloudP.lastSpeech;
                    localP.speechTimer = 70;

                    if (cloudP.lastSpeech.indexOf('马') >= 0) SoundManager.playHorse();
                    else if (cloudP.lastSpeech.indexOf('出发') >= 0) SoundManager.playStart();
                    else if (cloudP.lastSpeech.indexOf('扣喽') >= 0) SoundManager.playKou();
                }
            }
        }
    }

    if (oldTurnIndex !== this.turnIndex) {
        this.resetAITimer();
    }

    if (this.isGameOver && !this.hasTriggeredGameOverUI) {
        this.hasTriggeredGameOverUI = true;
        this.triggerGameOverUI();
    }
};

GameStage.prototype.syncToCloud = function() {
    if (!this.db || !this.roomCode) return;

    const simplePlayers = this.players.map(function(p) {
        return {
            id: p.id,
            name: p.name,
            hp: p.hp,
            isAlive: p.isAlive,
            lastSpeech: p.lastSpeech,
            rank: p.rank,
            isAI: p.isAI
        };
    });

    const now = Date.now();
    this.lastServerTime = now;

    const gameState = {
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
        players: simplePlayers,
        lastUpdateTime: now
    };

    this.db.collection('rooms').doc(this.roomCode).update({
        data: { gameState: gameState }
    }).catch(function() {});
};

GameStage.prototype.areAllHumanOut = function() {
    return !this.players.some(function(p) { return !p.isAI && p.isAlive; });
};

GameStage.prototype.triggerGameOverUI = function() {
    SoundManager.playWin();

    const self = this;
    this.resultStage.init(
        this.players,
        this.winnerName,
        function onRestart(changeSceneFn) {
            self.stopWatch();
            const cb = changeSceneFn || self.changeScene;
            if (self.roomStage) {
                if (typeof self.roomStage.setReadyStatus === 'function') {
                    self.roomStage.setReadyStatus(false);
                } else {
                    self.roomStage.isReady = false;
                }
            }
            if (typeof cb === 'function') {
                cb(3);
            }
        },
        function onBackHome(changeSceneFn) {
            self.stopWatch();
            const cb = changeSceneFn || self.changeScene;
            if (typeof cb === 'function') {
                cb(1);
            }
        }
    );
};

GameStage.prototype.triggerGameOver = function() {
    this.isGameOver = true;
    this.syncToCloud();
    this.triggerGameOverUI();
};

GameStage.prototype.quickEndGame = function() {
    const alivePlayers = this.players.filter(function(p) {
        return p.isAlive;
    });

    alivePlayers.sort(function(a, b) {
        if (b.hp !== a.hp) return b.hp - a.hp;
        return a.seatIndex - b.seatIndex;
    });

    alivePlayers.forEach(function(p, i) {
        p.rank = i + 1;
    });

    const used = {};
    this.players.forEach(function(p) {
        if (p.rank > 0) used[p.rank] = true;
    });

    let tail = this.players.length;
    this.players.forEach(function(p) {
        if (!p.isAlive && (!p.rank || p.rank <= 0)) {
            while (tail >= 1 && used[tail]) tail--;
            if (tail >= 1) {
                p.rank = tail;
                used[tail] = true;
                tail--;
            }
        }
    });

    if (alivePlayers.length > 0) {
        this.winnerName = alivePlayers[0].name;
    } else {
        this.winnerName = '无胜者';
    }

    this.isPaused = false;
    this.triggerGameOver();
};

GameStage.prototype.updateLogic = function() {
    if (this.isGameOver) return;

    const now = Date.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // 非房主：只推算显示时间，不推进规则
    if (!this.isHost) {
        if (this.isStartCounting) {
            this.startCountTimer = Math.max(0, this._startCountBase - (now - this._startCountBaseAt) / 1000);
            return;
        }
        if (this.isPaused) {
            this.pauseTimer = Math.max(0, this._pauseBase - (now - this._pauseBaseAt) / 1000);
            return;
        }
        this.timer = Math.max(0, this._timerBase - (now - this._timerBaseAt) / 1000);
        return;
    }

    // ===== 以下仅房主 =====

    if (this.isStartCounting) {
        this.startCountTimer -= delta;
        if (this.startCountTimer <= 0) {
            this.isStartCounting = false;
            this.startCountTimer = 0;
            this.timer = this.turnDuration;
            this._timerBase = this.timer;
            this._timerBaseAt = now;
            SoundManager.playGo();
            this.resetAITimer();
            this.syncToCloud();
        } else if (now - this._lastTimerSyncAt > 400) {
            this._lastTimerSyncAt = now;
            this.syncToCloud();
        }
        return;
    }

    if (this.isPaused) {
        this.pauseTimer -= delta;
        if (this.pauseTimer <= 0) {
            this.isPaused = false;
            this.timer = this.turnDuration;
            this._timerBase = this.timer;
            this._timerBaseAt = now;
            this.resetAITimer();
            this.syncToCloud();
        } else if (now - this._lastTimerSyncAt > 400) {
            this._lastTimerSyncAt = now;
            this.syncToCloud();
        }
        return;
    }

    const curPlayer = this.players[this.turnIndex];

    if (!curPlayer || !curPlayer.isAlive) {
        this.nextTurn();
        this.syncToCloud();
        return;
    }

    this.timer -= delta;
    if (this.timer <= 0) {
        this.triggerError('反应超时');
        return;
    }

    if (now - this._lastTimerSyncAt > 400) {
        this._lastTimerSyncAt = now;
        this.syncToCloud();
    }

    if (curPlayer.isAI) {
        this.aiActionTimer -= delta;
        if (this.aiActionTimer <= 0) {
            this.resetAITimer();

            const isCorrect = Math.random() < 0.95;
            if (isCorrect) {
                this.handleAction(this.currentStage);
            } else {
                const wrongActions = ['HORSE', 'START', 'KOU'].filter(function(a) {
                    return a !== this.currentStage;
                }, this);
                const wrongChoice = wrongActions[Math.floor(Math.random() * wrongActions.length)];
                this.handleAction(wrongChoice);
            }
        }
    }
};

GameStage.prototype.handleAction = function(actionType) {
    if (this.isGameOver || this.isPaused || this.isStartCounting) return;

    let curPlayer = this.players[this.turnIndex];
    if (!curPlayer || !curPlayer.isAlive) return;

    if (actionType === 'HORSE') {
        curPlayer.lastSpeech = this.horseCount + ' 匹马!';
        SoundManager.playHorse();
    } else if (actionType === 'START') {
        curPlayer.lastSpeech = '出发!';
        SoundManager.playStart();
    } else if (actionType === 'KOU') {
        curPlayer.lastSpeech = '扣喽!';
        SoundManager.playKou();
    }
    curPlayer.speechTimer = 70;

    if (actionType === this.currentStage) {
        this.advanceGameStep();
    } else {
        this.triggerError('喊错指令');
        return;
    }

    this.syncToCloud();
};

GameStage.prototype.advanceGameStep = function() {
    this.stageProgress++;

    if (this.currentStage === 'HORSE') {
        this.currentStage = 'START';
        this.stageProgress = 0;
    } else if (this.currentStage === 'START') {
        if (this.stageProgress >= this.horseCount) {
            this.currentStage = 'KOU';
            this.stageProgress = 0;
        }
    } else if (this.currentStage === 'KOU') {
        if (this.stageProgress >= this.horseCount) {
            this.horseCount++;
            this.currentStage = 'HORSE';
            this.stageProgress = 0;
            this.showTip('🎉 完美！升级到 ' + this.horseCount + ' 匹马！');
        }
    }

    this.nextTurn();
};

GameStage.prototype.nextTurn = function() {
    this.timer = this.turnDuration;
    this._timerBase = this.timer;
    this._timerBaseAt = Date.now();

    let count = 0;
    do {
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        count++;
        if (count > 10) break;
    } while (!this.players[this.turnIndex].isAlive);

    this.resetAITimer();
};

GameStage.prototype.triggerError = function(reason) {
    let wrongPlayer = this.players[this.turnIndex];
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

    let alivePlayers = this.players.filter(function(p) { return p.isAlive; });
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

    if (!wrongPlayer.isAlive) {
        let nextIndex = this.turnIndex;
        let count = 0;
        do {
            nextIndex = (nextIndex + 1) % this.players.length;
            count++;
            if (count > 10) break;
        } while (!this.players[nextIndex].isAlive);

        this.turnIndex = nextIndex;
    }

    this.syncToCloud();
};

GameStage.prototype.showTip = function(msg) {
    this.tipMessage = msg;
    this.tipTimer = 90;
};

GameStage.prototype.render = function(ctx, windowWidth, windowHeight) {
    this.updateLogic();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, windowWidth, 65);

    UI.drawFancyBtn(ctx, 15, 12, 70, 36, '#EB5757', '#9B2C2C', '退出');

    if (this.areAllHumanOut() && !this.isGameOver) {
        UI.drawFancyBtn(ctx, windowWidth - 110, windowHeight * 0.74, 95, 36, '#F39C12', '#B76211', '快速结束');
    }

    const targetText = '目标喊话：' + this.getExpectedActionName();
    ctx.fillStyle = '#FFE000';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(targetText, windowWidth / 2, 22);

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

    if (this.isMultiplayer && Date.now() - this._lastCloudAt > 2500) {
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
    this.players.forEach(function(p, index) {
        const r = Math.floor(index / cols);
        const c = index % cols;
        const x = startX + c * (cardW + 12);
        const y = startY + r * (cardH + 12);

        self.drawPlayerCard(ctx, x, y, cardW, cardH, p, index === self.turnIndex);
    });

    if (!this.isGameOver) {
        const btnY = windowHeight * 0.83;
        const btnW = Math.min(110, (windowWidth - 50) / 3);
        const btnH = 48;
        const gap = 10;
        const totalW = btnW * 3 + gap * 2;
        const startBtnX = (windowWidth - totalW) / 2;

        UI.drawFancyBtn(ctx, startBtnX, btnY, btnW, btnH, mainColor, darkColor, this.horseCount + ' 匹马');
        UI.drawFancyBtn(ctx, startBtnX + btnW + gap, btnY, btnW, btnH, '#2F80ED', '#1D5297', '出发！');
        UI.drawFancyBtn(ctx, startBtnX + (btnW + gap) * 2, btnY, btnW, btnH, '#27AE60', '#1E723D', '扣喽！');
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

    if (this.isStartCounting) {
        this.drawStartCountdownOverlay(ctx, windowWidth, windowHeight);
    }

    if (this.isPaused && !this.isGameOver) {
        this.drawErrorOverlay(ctx, windowWidth, windowHeight);
    }

    if (this.isGameOver) {
        this.resultStage.render(ctx, windowWidth, windowHeight);
    }
};

GameStage.prototype.drawErrorOverlay = function(ctx, windowWidth, windowHeight) {
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
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#FFE000';
    const nextPlayerName = this.players[this.turnIndex] ? this.players[this.turnIndex].name : '';
    ctx.fillText(secondsLeft + ' 秒后由【' + nextPlayerName + '】重新开始...', windowWidth / 2, windowHeight / 2 + 60);

    ctx.restore();
};

GameStage.prototype.drawStartCountdownOverlay = function(ctx, windowWidth, windowHeight) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);

    const countNum = Math.ceil(this.startCountTimer);
    let displayStr = countNum > 0 ? countNum.toString() : 'GO!';

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

GameStage.prototype.drawPlayerCard = function(ctx, x, y, w, h, player, isCurrentTurn) {
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

GameStage.prototype.getExpectedActionName = function() {
    if (this.currentStage === 'HORSE') {
        return this.horseCount + ' 匹马';
    } else if (this.currentStage === 'START') {
        return '出发 (' + (this.stageProgress + 1) + '/' + this.horseCount + ')';
    } else if (this.currentStage === 'KOU') {
        return '扣喽 (' + (this.stageProgress + 1) + '/' + this.horseCount + ')';
    }
};

GameStage.prototype.handleTouch = function(x, y, windowWidth, windowHeight, changeScene) {
    const cb = changeScene || this.changeScene;

    if (this.isGameOver) {
        this.resultStage.handleTouch(x, y, windowWidth, windowHeight, cb);
        return;
    }

    if (x >= 15 && x <= 85 && y >= 12 && y <= 48) {
        this.stopWatch();
        if (cb) cb(1);
        return;
    }

    if (this.areAllHumanOut() && !this.isGameOver) {
        const btnX = windowWidth - 110;
        const btnY = windowHeight * 0.74;
        if (x >= btnX && x <= btnX + 95 && y >= btnY && y <= btnY + 36) {
            if (this.isHost) {
                this.quickEndGame();
            }
            return;
        }
    }

    const curPlayer = this.players[this.turnIndex];
    if (!curPlayer || this.isStartCounting || this.isPaused || curPlayer.isAI || !curPlayer.isAlive) {
        return;
    }

    if (this.mySeatIndex !== -1 && curPlayer.seatIndex !== this.mySeatIndex) {
        return;
    }

    const btnY = windowHeight * 0.83;
    const btnW = Math.min(110, (windowWidth - 50) / 3);
    const btnH = 48;
    const gap = 10;
    const totalW = btnW * 3 + gap * 2;
    const startBtnX = (windowWidth - totalW) / 2;

    if (x >= startBtnX && x <= startBtnX + btnW && y >= btnY && y <= btnY + btnH) {
        this.handleAction('HORSE');
        return;
    }

    const btn2X = startBtnX + btnW + gap;
    if (x >= btn2X && x <= btn2X + btnW && y >= btnY && y <= btnY + btnH) {
        this.handleAction('START');
        return;
    }

    const btn3X = startBtnX + (btnW + gap) * 2;
    if (x >= btn3X && x <= btn3X + btnW && y >= btnY && y <= btnY + btnH) {
        this.handleAction('KOU');
        return;
    }
};

module.exports = GameStage;