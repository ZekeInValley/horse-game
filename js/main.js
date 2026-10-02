const UI = require('./base/UI');
const MainMenu = require('./pages/MainMenu');
const RulesDialog = require('./pages/RulesDialog');
const RoomLobby = require('./pages/RoomLobby');
const GameStage = require('./pages/GameStage');

let canvas = wx.createCanvas();
let ctx = canvas.getContext('2d');

function Main() {
    this.currentScene = 1; // 1-主菜单, 2-规则, 3-房间大厅, 4-主战场
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
    
    // 绑定 loop 函数对象，避免每次 requestAnimationFrame 都使用 bind 创建新函数
    this.boundLoop = this.loop.bind(this);
    this.boundLoop();
}

Main.prototype.loop = function() {
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

    requestAnimationFrame(this.boundLoop);
};

Main.prototype.initEvents = function() {
    const self = this;
    const changeScene = function(nextScene, roomData) {
        // 进入游戏场景 4
        if (nextScene === 4) {
            self.gameStage.resetGame(roomData, changeScene, self.roomLobby);
        }
        // 从结算/游戏退回大厅场景 3
        else if (nextScene === 3) {
            if (self.roomLobby && typeof self.roomLobby.resetForNewGame === 'function') {
                self.roomLobby.resetForNewGame();
            }
        }

        self.currentScene = nextScene;
    };

    wx.onTouchStart(function(e) {
        const touch = e.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;

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