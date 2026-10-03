const UI = require('./base/UI');
const SoundManager = require('./base/SoundManager');
const MainMenu = require('./pages/MainMenu');
const RulesDialog = require('./pages/RulesDialog');
const RoomLobby = require('./pages/RoomLobby');
const GameStage = require('./pages/GameStage');

let canvas = wx.createCanvas();
let ctx = canvas.getContext('2d');

const MUTE_BTN = { x: 12, y: 52, w: 32, h: 32 };

function Main() {
    this.currentScene = 1;
    this.animFrame = 0;

    const info = wx.getSystemInfoSync();
    this.windowWidth = info.screenWidth;
    this.windowHeight = info.screenHeight;

    canvas.width = this.windowWidth;
    canvas.height = this.windowHeight;

    this.mainMenu = new MainMenu();
    this.rulesDialog = new RulesDialog();
    this.roomLobby = new RoomLobby();
    this.gameStage = new GameStage();

    this.initEvents();

    this.boundLoop = this.loop.bind(this);
    this.boundLoop();

    SoundManager.playBgm();
}

Main.prototype.drawMuteButton = function () {
    const b = MUTE_BTN;
    ctx.save();
    UI.drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(SoundManager.isMuted() ? '🔇' : '🔊', b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.restore();
};

Main.prototype.hitMuteButton = function (x, y) {
    const b = MUTE_BTN;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
};

Main.prototype.loop = function () {
    this.animFrame++;

    UI.drawGameBackground(ctx, this.windowWidth, this.windowHeight, this.animFrame);

    switch (this.currentScene) {
        case 1:
            this.mainMenu.render(ctx, this.windowWidth, this.windowHeight, this.animFrame);
            break;
        case 2:
            this.rulesDialog.render(ctx, this.windowWidth, this.windowHeight);
            break;
        case 3:
            this.roomLobby.render(ctx, this.windowWidth, this.windowHeight);
            break;
        case 4:
            this.gameStage.render(ctx, this.windowWidth, this.windowHeight);
            break;
    }

    this.drawMuteButton();

    requestAnimationFrame(this.boundLoop);
};

Main.prototype.initEvents = function () {
    const self = this;
    const changeScene = function (nextScene, roomData) {
        if (nextScene === 4) {
            SoundManager.stopBgm();
            self.gameStage.resetGame(roomData, changeScene, self.roomLobby);
        } else if (nextScene === 3) {
            if (self.roomLobby && typeof self.roomLobby.resetForNewGame === 'function') {
                self.roomLobby.resetForNewGame();
            }
        } else if (nextScene === 1) {
            SoundManager.playBgm();
        }

        self.currentScene = nextScene;
    };

    wx.onTouchStart(function (e) {
        const touch = e.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        if (self.hitMuteButton(x, y)) {
            const muted = SoundManager.toggleMute();

            if (!muted) SoundManager.playClick();
            return;
        }

        if (self.currentScene === 1) {
            SoundManager.playBgm();
        }

        switch (self.currentScene) {
            case 1:
                self.mainMenu.handleTouch(x, y, self.windowWidth, self.windowHeight, changeScene);
                break;
            case 2:
                self.rulesDialog.handleTouch(x, y, self.windowWidth, self.windowHeight, changeScene);
                break;
            case 3:
                self.roomLobby.handleTouch(x, y, self.windowWidth, self.windowHeight, changeScene);
                break;
            case 4:
                self.gameStage.handleTouch(x, y, self.windowWidth, self.windowHeight, changeScene);
                break;
        }
    });
};

module.exports = Main;