const Mascot = require('../base/Mascot');
const UI = require('../base/UI');
const SoundManager = require('../base/SoundManager');

function MainMenu() {}

MainMenu.prototype.render = function (ctx, windowWidth, windowHeight, animFrame) {
    const centerY = windowHeight * 0.38;
    const bounce = Math.sin((animFrame || 0) * 0.08) * 8;

    Mascot.drawCuteHorse(ctx, windowWidth / 2, centerY - 90 + bounce, 1.55, '#E67E22');
    UI.draw3DText(ctx, 'HORSE GAME', windowWidth / 2, centerY + bounce, 60, '#FFE000', '#F2994A');
    UI.draw3DText(ctx, '马 儿 游 戏', windowWidth / 2, centerY + 58 + bounce, 36, '#FFF200', '#FFA500');

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ 节奏挑战 · 经典派对游戏 ⚡', windowWidth / 2, centerY + 105 + bounce);
    ctx.restore();

    const btnWidth = 135;
    const btnHeight = 48;
    const btnY = windowHeight * 0.78;
    const gap = 20;
    const ruleBtnX = windowWidth / 2 - btnWidth - gap / 2;
    const startBtnX = windowWidth / 2 + gap / 2;

    UI.drawFancyBtn(ctx, ruleBtnX, btnY, btnWidth, btnHeight, '#2F80ED', '#1D5297', '游戏规则');
    UI.drawFancyBtn(ctx, startBtnX, btnY, btnWidth, btnHeight, '#27AE60', '#1E723D', '开始游戏');
};

MainMenu.prototype.handleTouch = function (x, y, windowWidth, windowHeight, changeScene) {
    const btnWidth = 135;
    const btnHeight = 48;
    const btnY = windowHeight * 0.78;
    const gap = 20;

    const ruleBtnX = windowWidth / 2 - btnWidth - gap / 2;
    if (x >= ruleBtnX && x <= ruleBtnX + btnWidth && y >= btnY && y <= btnY + btnHeight) {
        SoundManager.playClick();
        changeScene(2);
        return;
    }

    const startBtnX = windowWidth / 2 + gap / 2;
    if (x >= startBtnX && x <= startBtnX + btnWidth && y >= btnY && y <= btnY + btnHeight) {
        SoundManager.playClick();
        changeScene(3);
        return;
    }
};

module.exports = MainMenu;