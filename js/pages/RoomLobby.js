const Mascot = require('../base/Mascot');
const UI = require('../base/UI');
const SoundManager = require('../base/SoundManager');

const SEAT_COLORS = ['#E67E22', '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#F1C40F'];

function hit(x, y, r) {
    return r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function hitBox(x, y, bx, by, bw, bh) {
    return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function RoomLobby() {
    this.db = wx.cloud.database();
    this.watcher = null;
    this._watchStarting = false;
    this._watchRetryTimer = null;
    this._idleCheckTimer = null;
    this._wasSeated = false;

    this.isInRoom = false;
    this.roomCode = '8888';
    this.playerName = '玩家' + Math.floor(Math.random() * 899 + 100);
    this.mySeatIndex = -1;
    this.changeSceneRef = null;
    this.IDLE_MS = 10 * 60 * 1000;

    let storedId = '';
    try { storedId = wx.getStorageSync('horse_player_id') || ''; } catch (e) {}
    if (!storedId) {
        storedId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        try { wx.setStorageSync('horse_player_id', storedId); } catch (e) {}
    }
    this.playerId = storedId;
    this.seats = this.createEmptySeats();

    const self = this;
    if (typeof wx.onHide === 'function') {
        wx.onHide(function () {
            if (!self.isInRoom || self.mySeatIndex === -1) return;
            self.updateSeatOnCloud(self.mySeatIndex, self.emptySeatPatch()).catch(function () {});
            self.applyLocalSeat(self.mySeatIndex, self.emptySeatPatch());
            self.mySeatIndex = -1;
            self._wasSeated = false;
        });
    }
}

RoomLobby.prototype.createEmptySeats = function () {
    return SEAT_COLORS.map(function (c, i) {
        return { id: i + 1, name: '空座位', isEmpty: true, isReady: false, color: c, playerId: '' };
    });
};

RoomLobby.prototype.emptySeatPatch = function () {
    return { isEmpty: true, name: '空座位', isReady: false, playerId: '' };
};

RoomLobby.prototype.isMySeat = function (s) {
    if (!s || s.isEmpty) return false;
    if (s.playerId && s.playerId === this.playerId) return true;
    return !s.playerId && s.name === this.playerName;
};

RoomLobby.prototype.findMySeatIndex = function () {
    for (let i = 0; i < this.seats.length; i++) {
        if (this.isMySeat(this.seats[i])) return i;
    }
    return -1;
};

RoomLobby.prototype.ensureMySeat = function () {
    if (this.mySeatIndex === -1) this.mySeatIndex = this.findMySeatIndex();
    return this.mySeatIndex;
};

RoomLobby.prototype.isRoomIdle = function (roomData) {
    if (!roomData) return false;
    return (Date.now() - (roomData.lastActiveTime || 0)) >= this.IDLE_MS;
};

RoomLobby.prototype.clearRoomSeatsOnCloud = function () {
    return this.db.collection('rooms').doc(this.roomCode).update({
        data: {
            status: 'WAITING',
            seats: this.createEmptySeats(),
            lastActiveTime: Date.now()
        }
    });
};

RoomLobby.prototype.applyRoomClearedLocally = function (reason) {
    this.seats = this.createEmptySeats();
    this.mySeatIndex = -1;
    this._wasSeated = false;
    this.stopIdleCheck();
    this.closeWatch();
    this.isInRoom = false;
    if (reason) wx.showToast({ title: reason, icon: 'none', duration: 2500 });
};

RoomLobby.prototype.enterLobby = function () {
    this.isInRoom = true;
    this.startWatch();
    this.startIdleCheck();
};

RoomLobby.prototype.startIdleCheck = function () {
    this.stopIdleCheck();
    const self = this;
    this._idleCheckTimer = setInterval(function () {
        if (!self.isInRoom || !self.roomCode) return;
        self.db.collection('rooms').doc(self.roomCode).get().then(function (res) {
            const data = res.data;
            if (!data || data.status === 'GAMING') return;
            if (!self.isRoomIdle(data)) return;
            self.clearRoomSeatsOnCloud().then(function () {
                self.applyRoomClearedLocally('房间超时已清空，请重新进入');
            }).catch(function () {});
        }).catch(function () {});
    }, 60 * 1000);
};

RoomLobby.prototype.stopIdleCheck = function () {
    if (this._idleCheckTimer) {
        clearInterval(this._idleCheckTimer);
        this._idleCheckTimer = null;
    }
};

RoomLobby.prototype.enterRoom = function () {
    if (!this.roomCode || !this.roomCode.trim()) {
        wx.showToast({ title: '请输入有效的房间号', icon: 'none' });
        return;
    }
    if (!this.playerName || !this.playerName.trim()) {
        wx.showToast({ title: '请输入玩家昵称', icon: 'none' });
        return;
    }

    const self = this;
    const roomRef = this.db.collection('rooms').doc(this.roomCode);
    wx.showLoading({ title: '进入房间中...' });
    this._wasSeated = false;

    function afterClear(msg) {
        self.seats = self.createEmptySeats();
        self.mySeatIndex = -1;
        self.enterLobby();
        if (msg) wx.showToast({ title: msg, icon: 'none' });
    }

    roomRef.get().then(function (res) {
        const data = res.data || {};

        // 超过 10 分钟无活动：整桌清空
        if (self.isRoomIdle(data)) {
            return self.clearRoomSeatsOnCloud().then(function () {
                afterClear('原房间已超时清空');
            }).catch(function () {
                afterClear();
            });
        }

        // 残留 GAMING（对局未正常结束）：清座后进大厅
        if (data.status === 'GAMING') {
            return self.clearRoomSeatsOnCloud().then(function () {
                afterClear('对局已失效，房间已重置');
            }).catch(function () {
                self.applyCloudSeats(data.seats);
                self.enterLobby();
            });
        }

        self.applyCloudSeats(data.seats);
        roomRef.update({ data: { lastActiveTime: Date.now() } }).catch(function () {});
        self.enterLobby();
    }).catch(function () {
        const emptySeats = self.createEmptySeats();
        roomRef.set({
            data: {
                status: 'WAITING',
                seats: emptySeats,
                lastActiveTime: Date.now()
            }
        }).then(function () {
            self.seats = emptySeats;
            self.enterLobby();
        }).catch(function () {
            self.enterLobby();
        });
    }).finally(function () {
        wx.hideLoading();
    });
};

RoomLobby.prototype.applyCloudSeats = function (cloudSeats) {
    if (!cloudSeats || !Array.isArray(cloudSeats)) return;
    this.mySeatIndex = -1;
    for (let idx = 0; idx < cloudSeats.length; idx++) {
        if (!this.seats[idx]) continue;
        const s = cloudSeats[idx];
        this.seats[idx].id = s.id != null ? s.id : (idx + 1);
        this.seats[idx].name = s.name || '空座位';
        this.seats[idx].isEmpty = !!s.isEmpty;
        this.seats[idx].isReady = !!s.isReady;
        this.seats[idx].color = s.color || this.seats[idx].color;
        this.seats[idx].playerId = s.playerId || '';
        if (this.isMySeat(this.seats[idx])) this.mySeatIndex = idx;
    }
    if (this.mySeatIndex !== -1) this._wasSeated = true;
};

RoomLobby.prototype.resetForNewGame = function () {
    const self = this;
    this.seats.forEach(function (s) { s.isReady = false; });
    if (!this.roomCode) {
        this.startWatch();
        this.startIdleCheck();
        return;
    }
    const updateData = { status: 'WAITING', lastActiveTime: Date.now() };
    for (let i = 0; i < 6; i++) updateData['seats.' + i + '.isReady'] = false;
    this.db.collection('rooms').doc(this.roomCode).update({ data: updateData })
        .then(function () {
            self.startWatch();
            self.startIdleCheck();
        })
        .catch(function (err) {
            console.error('重置房间状态失败:', err);
            self.startWatch();
            self.startIdleCheck();
        });
};

RoomLobby.prototype.closeWatch = function () {
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

RoomLobby.prototype.startWatch = function () {
    if (this._watchStarting) return;
    this.closeWatch();
    if (!this.roomCode || !this.isInRoom) return;

    const self = this;
    this._watchStarting = true;
    this._watchRetryTimer = setTimeout(function () {
        self._watchRetryTimer = null;
        if (!self.isInRoom || !self.roomCode) {
            self._watchStarting = false;
            return;
        }
        try {
            self.watcher = self.db.collection('rooms').doc(self.roomCode).watch({
                onChange: function (snapshot) {
                    if (!snapshot.docs || !snapshot.docs.length || !self.isInRoom) return;
                    const roomData = snapshot.docs[0];
                    self.applyCloudSeats(roomData.seats);

                    const allEmpty = (roomData.seats || []).every(function (s) {
                        return !s || s.isEmpty;
                    });
                    if (self._wasSeated && allEmpty && roomData.status !== 'GAMING') {
                        self.applyRoomClearedLocally('房间已超时清空');
                        return;
                    }

                    if (roomData.status === 'GAMING') {
                        self.stopIdleCheck();
                        self.closeWatch();
                        if (typeof self.changeSceneRef === 'function') {
                            self.changeSceneRef(4, {
                                roomCode: self.roomCode,
                                seats: self.seats,
                                mySeatIndex: self.mySeatIndex,
                                playerName: self.playerName
                            });
                        }
                    }
                },
                onError: function (err) {
                    console.warn('房间监听错误:', err);
                    self.watcher = null;
                    self._watchStarting = false;
                    if (self._watchRetryTimer) clearTimeout(self._watchRetryTimer);
                    self._watchRetryTimer = setTimeout(function () {
                        self._watchRetryTimer = null;
                        if (self.isInRoom) self.startWatch();
                    }, 3000);
                }
            });
            self._watchStarting = false;
        } catch (e) {
            console.warn('startWatch 异常:', e);
            self._watchStarting = false;
            self.watcher = null;
        }
    }, 300);
};

RoomLobby.prototype.updateSeatOnCloud = function (index, patch) {
    if (index < 0 || index > 5) return Promise.reject(new Error('invalid seat'));
    const data = { lastActiveTime: Date.now() };
    Object.keys(patch).forEach(function (key) {
        data['seats.' + index + '.' + key] = patch[key];
    });
    return this.db.collection('rooms').doc(this.roomCode).update({ data: data });
};

RoomLobby.prototype.applyLocalSeat = function (index, patch) {
    const seat = this.seats[index];
    if (!seat) return;
    Object.keys(patch).forEach(function (k) { seat[k] = patch[k]; });
};

RoomLobby.prototype.claimSeat = function (index) {
    if (index < 0 || index > 5) return;
    const self = this;
    wx.showLoading({ title: '入座中...' });
    this.db.collection('rooms').doc(this.roomCode).get().then(function (res) {
        const cloudSeats = (res.data && res.data.seats) || [];
        const target = cloudSeats[index];
        if (target && !target.isEmpty && !self.isMySeat(target)) {
            wx.hideLoading();
            wx.showToast({ title: '该位置已被占用', icon: 'none' });
            self.applyCloudSeats(cloudSeats);
            return;
        }
        const releasePromise = (self.mySeatIndex !== -1 && self.mySeatIndex !== index)
            ? self.updateSeatOnCloud(self.mySeatIndex, self.emptySeatPatch())
            : Promise.resolve();
        return releasePromise.then(function () {
            return self.updateSeatOnCloud(index, {
                isEmpty: false,
                name: self.playerName,
                isReady: false,
                playerId: self.playerId
            });
        }).then(function () {
            if (self.mySeatIndex !== -1 && self.mySeatIndex !== index) {
                self.applyLocalSeat(self.mySeatIndex, self.emptySeatPatch());
            }
            self.mySeatIndex = index;
            self.applyLocalSeat(index, {
                isEmpty: false,
                name: self.playerName,
                isReady: false,
                playerId: self.playerId
            });
            self._wasSeated = true;
            wx.hideLoading();
        });
    }).catch(function (err) {
        wx.hideLoading();
        console.error('占座失败:', err);
        wx.showToast({ title: '入座失败，请重试', icon: 'none' });
    });
};

RoomLobby.prototype.toggleReady = function () {
    if (this.ensureMySeat() === -1) {
        wx.showToast({ title: '请先选择一个座位！', icon: 'none' });
        return;
    }
    const mySeat = this.seats[this.mySeatIndex];
    const nextReady = !mySeat.isReady;
    mySeat.isReady = nextReady;
    this.updateSeatOnCloud(this.mySeatIndex, { isReady: nextReady }).catch(function (err) {
        console.error('准备状态更新失败:', err);
        mySeat.isReady = !nextReady;
        wx.showToast({ title: '更新失败', icon: 'none' });
    });
};

RoomLobby.prototype.startGame = function (changeScene) {
    const self = this;
    if (this.ensureMySeat() === -1) {
        wx.showToast({ title: '请先选择座位并准备！', icon: 'none' });
        return;
    }
    if (!this.checkAllSeatsReady()) {
        wx.showToast({ title: '还有玩家未准备！', icon: 'none' });
        return;
    }
    wx.showLoading({ title: '正在进入游戏...' });
    this.db.collection('rooms').doc(this.roomCode).update({
        data: { status: 'GAMING', lastActiveTime: Date.now() }
    }).then(function () {
        wx.hideLoading();
        self.stopIdleCheck();
        self.closeWatch();
        const fn = typeof changeScene === 'function' ? changeScene : self.changeSceneRef;
        if (typeof fn === 'function') {
            fn(4, {
                roomCode: self.roomCode,
                seats: self.seats,
                mySeatIndex: self.mySeatIndex,
                playerName: self.playerName
            });
        }
    }).catch(function (err) {
        wx.hideLoading();
        console.error('开始游戏更新失败:', err);
        wx.showToast({ title: '更新失败，请检查数据库权限', icon: 'none' });
    });
};

RoomLobby.prototype.checkAllSeatsReady = function () {
    const occupied = this.seats.filter(function (s) { return !s.isEmpty; });
    return occupied.length > 0 && occupied.every(function (s) { return s.isReady; });
};

RoomLobby.prototype.render = function (ctx, windowWidth, windowHeight) {
    if (!this.isInRoom) this.renderLoginDialog(ctx, windowWidth, windowHeight);
    else this.renderLobbySeats(ctx, windowWidth, windowHeight);
};

RoomLobby.prototype.renderLoginDialog = function (ctx, windowWidth, windowHeight) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);
    const cardW = Math.min(340, windowWidth - 40);
    const cardH = 320;
    const cardX = (windowWidth - cardW) / 2;
    const cardY = (windowHeight - cardH) / 2;
    UI.drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.fillStyle = '#2C3E50';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('加入 / 创建房间', windowWidth / 2, cardY + 45);
    const inputW = cardW - 60;
    const inputH = 46;
    const inputX = cardX + 30;
    this.roomInputRect = { x: inputX, y: cardY + 80, width: inputW, height: inputH };
    UI.drawRoundedRectPath(ctx, inputX, cardY + 80, inputW, inputH, 10);
    ctx.fillStyle = '#F2F4F4';
    ctx.fill();
    ctx.strokeStyle = '#BDC3C7';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('房间号：' + this.roomCode + '   ✎', inputX + 15, cardY + 80 + inputH / 2);
    this.nameInputRect = { x: inputX, y: cardY + 145, width: inputW, height: inputH };
    UI.drawRoundedRectPath(ctx, inputX, cardY + 145, inputW, inputH, 10);
    ctx.fillStyle = '#F2F4F4';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#333333';
    ctx.fillText('昵   称：' + this.playerName + '   ✎', inputX + 15, cardY + 145 + inputH / 2);
    this.enterBtnRect = { x: inputX, y: cardY + 225, width: inputW, height: 50 };
    UI.drawFancyBtn(ctx, inputX, cardY + 225, inputW, 50, '#27AE60', '#1E723D', '进入房间');
    UI.drawFancyBtn(ctx, 20, 20, 70, 36, '#EB5757', '#9B2C2C', '返回');
    ctx.restore();
};

RoomLobby.prototype.renderLobbySeats = function (ctx, windowWidth, windowHeight) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, windowWidth, 60);
    UI.drawFancyBtn(ctx, 15, 12, 70, 36, '#EB5757', '#9B2C2C', '退出');
    ctx.fillStyle = '#FFE000';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('房间号：' + this.roomCode, windowWidth / 2, 30);
    ctx.restore();

    const cols = 3;
    const cardW = 110;
    const cardH = 110;
    const startX = (windowWidth - (cols * cardW + (cols - 1) * 15)) / 2;
    const startY = windowHeight * 0.22;
    const self = this;
    this.seats.forEach(function (seat, index) {
        const x = startX + (index % cols) * (cardW + 15);
        const y = startY + Math.floor(index / cols) * (cardH + 20);
        seat.rect = { x: x, y: y, width: cardW, height: cardH };
        self.drawSeatCard(ctx, x, y, cardW, cardH, seat, index + 1);
    });

    const btnY = windowHeight * 0.80;
    const btnH = 50;
    const btnW = 140;
    const spacing = 20;
    const startBtnX = (windowWidth - (btnW * 2 + spacing)) / 2;
    const mySeat = this.mySeatIndex !== -1 ? this.seats[this.mySeatIndex] : null;
    const isReady = !!(mySeat && mySeat.isReady);

    this.readyBtnRect = { x: startBtnX, y: btnY, width: btnW, height: btnH };
    UI.drawFancyBtn(
        ctx, startBtnX, btnY, btnW, btnH,
        isReady ? '#E67E22' : '#27AE60',
        isReady ? '#A04000' : '#1E723D',
        isReady ? '取消准备' : '准 备'
    );

    this.startGameBtnRect = { x: startBtnX + btnW + spacing, y: btnY, width: btnW, height: btnH };
    const allReady = this.checkAllSeatsReady();
    UI.drawFancyBtn(
        ctx, this.startGameBtnRect.x, btnY, btnW, btnH,
        allReady ? '#27AE60' : '#95A5A6',
        allReady ? '#1E723D' : '#7F8C8D',
        '开始游戏'
    );
};

RoomLobby.prototype.drawSeatCard = function (ctx, x, y, width, height, seat, seatNum) {
    ctx.save();
    const isMine = this.mySeatIndex !== -1 && this.seats[this.mySeatIndex] === seat;
    UI.drawRoundedRectPath(ctx, x, y, width, height, 16);
    ctx.fillStyle = isMine ? '#FFF8E7' : '#FFFFFF';
    ctx.fill();
    if (isMine) {
        ctx.strokeStyle = '#F2994A';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    if (seat.isEmpty) {
        ctx.fillStyle = '#95A5A6';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('位置 ' + seatNum, x + width / 2, y + height / 2 - 12);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#27AE60';
        ctx.fillText('+ 点击坐下', x + width / 2, y + height / 2 + 15);
    } else {
        Mascot.drawCuteHorse(ctx, x + width / 2, y + 38, 0.6, seat.color || '#E67E22');
        ctx.fillStyle = '#2C3E50';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seat.name, x + width / 2, y + 72);
        ctx.fillStyle = seat.isReady ? '#27AE60' : '#E74C3C';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(seat.isReady ? '✅ 已准备' : '⏳ 未准备', x + width / 2, y + 92);
    }
    ctx.restore();
};

RoomLobby.prototype.openKeyboard = function (defaultValue, maxLength, onInput) {
    wx.showKeyboard({
        defaultValue: defaultValue,
        maxLength: maxLength,
        confirmType: 'done',
        success: function () {
            wx.onKeyboardInput(function (res) {
                if (res.value !== undefined) onInput(res.value);
            });
        }
    });
};

RoomLobby.prototype.handleTouch = function (x, y, windowWidth, windowHeight, changeScene) {
    if (changeScene) this.changeSceneRef = changeScene;
    const self = this;

    if (!this.isInRoom) {
        if (hitBox(x, y, 20, 20, 70, 36)) {
            SoundManager.playClick();
            if (typeof changeScene === 'function') changeScene(1);
            return;
        }
        if (hit(x, y, this.roomInputRect)) {
            SoundManager.playClick();
            this.openKeyboard(this.roomCode, 4, function (v) { self.roomCode = v; });
            return;
        }
        if (hit(x, y, this.nameInputRect)) {
            SoundManager.playClick();
            this.openKeyboard(this.playerName, 6, function (v) { self.playerName = v; });
            return;
        }
        if (hit(x, y, this.enterBtnRect)) {
            SoundManager.playClick();
            this.enterRoom();
        }
        return;
    }

    if (hitBox(x, y, 15, 12, 70, 36)) {
        SoundManager.playClick();
        if (this.mySeatIndex !== -1) {
            this.updateSeatOnCloud(this.mySeatIndex, this.emptySeatPatch()).catch(function () {});
            this.applyLocalSeat(this.mySeatIndex, this.emptySeatPatch());
        }
        this.stopIdleCheck();
        this.closeWatch();
        this.isInRoom = false;
        this.mySeatIndex = -1;
        this._wasSeated = false;
        return;
    }

    for (let index = 0; index < this.seats.length; index++) {
        const seat = this.seats[index];
        if (!hit(x, y, seat.rect)) continue;
        if (!seat.isEmpty && !this.isMySeat(seat)) {
            wx.showToast({ title: '该位置已被占用', icon: 'none' });
            return;
        }
        if (index !== this.mySeatIndex) {
            SoundManager.playClick();
            this.claimSeat(index);
        }
        return;
    }

    if (hit(x, y, this.readyBtnRect)) {
        SoundManager.playClick();
        this.toggleReady();
        return;
    }
    if (hit(x, y, this.startGameBtnRect)) {
        SoundManager.playClick();
        this.startGame(changeScene);
    }
};

module.exports = RoomLobby;