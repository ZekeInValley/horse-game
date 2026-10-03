const UI = require('../base/UI');
const SoundManager = require('../base/SoundManager');

function RulesDialog() {}

RulesDialog.prototype.render = function (ctx, windowWidth, windowHeight) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);

    const cardW = windowWidth * 0.72;
    const cardH = windowHeight * 0.82;
    const cardX = (windowWidth - cardW) / 2;
    const cardY = (windowHeight - cardH) / 2;

    ctx.save();
    UI.drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    UI.drawRoundedRectPath(ctx, cardX, cardY, cardW, 55, 24);
    ctx.fillStyle = '#2ECC71';
    ctx.fill();
    ctx.fillRect(cardX, cardY + 30, cardW, 25);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('【 马儿游戏规则 】', windowWidth / 2, cardY + 28);

    ctx.font = '15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333333';

    const rules = [
        "1. 喊口号：从'1匹马'开始，按顺序喊：X匹马 -> 出发(X次) -> 扣喽(X次)",
        "2. 轮流答：玩家与AI按顺序选择动作，每次响应限时 2 秒",
        "3. 生命值：每个角色拥有 2 滴血，答错或超时扣1血，归零淘汰",
        "4. 重置机制：任意角色答错后，回合重置，重新从'1匹马'开始",
        "5. 终极赢家：坚持到最后一刻的角色获得胜利！"
    ];

    rules.forEach(function (line, index) {
        ctx.fillText(line, cardX + 30, cardY + 85 + index * 30);
    });

    UI.drawFancyBtn(ctx, windowWidth / 2 - 65, cardY + cardH - 55, 130, 42, '#F2994A', '#B76211', '我懂了');
    ctx.restore();
};

RulesDialog.prototype.handleTouch = function (x, y, windowWidth, windowHeight, changeScene) {
    const cardH = windowHeight * 0.82;
    const cardY = (windowHeight - cardH) / 2;
    const closeBtnX = windowWidth / 2 - 65;
    const closeBtnY = cardY + cardH - 55;

    if (x >= closeBtnX && x <= closeBtnX + 130 && y >= closeBtnY && y <= closeBtnY + 42) {
        SoundManager.playClick();
        changeScene(1);
    }
};

module.exports = RulesDialog;