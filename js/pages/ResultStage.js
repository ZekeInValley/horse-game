const UI = require('../base/UI');
const SoundManager = require('../base/SoundManager');

function ResultStage() {
    this.players = [];
    this.winnerName = '';
    this.onRestart = null;
    this.onBackHome = null;
    this.btn1Area = { x: 0, y: 0, w: 0, h: 0 };
    this.btn2Area = { x: 0, y: 0, w: 0, h: 0 };
}

ResultStage.prototype.init = function (players, winnerName, onRestart, onBackHome) {
    this.players = players || [];
    this.winnerName = winnerName || '';
    this.onRestart = onRestart;
    this.onBackHome = onBackHome;
};

ResultStage.prototype.render = function (ctx, windowWidth, windowHeight) {
    ctx.save();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, windowWidth, windowHeight);

    const count = this.players.length || 6;
    const dialogW = Math.min(360, windowWidth - 40);
    const dialogH = Math.min(windowHeight - 40, 120 + count * 30 + 70);
    const x = (windowWidth - dialogW) / 2;
    const y = (windowHeight - dialogH) / 2;

    UI.drawRoundedRectPath(ctx, x, y, dialogW, dialogH, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.fillStyle = '#27AE60';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 最终排行榜 🏆', windowWidth / 2, y + 38);

    const sortedPlayers = this.players.slice().sort(function (a, b) {
        const ra = (a.rank > 0) ? a.rank : 99;
        const rb = (b.rank > 0) ? b.rank : 99;
        if (ra !== rb) return ra - rb;
        return (a.seatIndex || 0) - (b.seatIndex || 0);
    });

    const startListY = y + 75;
    const rowH = 28;

    sortedPlayers.forEach(function (p, i) {
        const rowY = startListY + i * rowH;
        const showRank = (p.rank > 0) ? p.rank : (i + 1);

        if (i % 2 === 0) {
            ctx.fillStyle = '#F8F9F9';
            ctx.fillRect(x + 15, rowY - 14, dialogW - 30, rowH);
        }

        ctx.textAlign = 'left';
        if (showRank === 1) {
            ctx.fillStyle = '#F39C12';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('🥇 第 1 名', x + 25, rowY);
        } else if (showRank === 2) {
            ctx.fillStyle = '#7F8C8D';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('🥈 第 2 名', x + 25, rowY);
        } else if (showRank === 3) {
            ctx.fillStyle = '#D35400';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('🥉 第 3 名', x + 25, rowY);
        } else {
            ctx.fillStyle = '#95A5A6';
            ctx.font = '14px sans-serif';
            ctx.fillText('  第 ' + showRank + ' 名', x + 25, rowY);
        }

        ctx.fillStyle = showRank === 1 ? '#D35400' : '#2C3E50';
        ctx.font = showRank === 1 ? 'bold 14px sans-serif' : '14px sans-serif';
        ctx.fillText(p.name, x + 115, rowY);

        ctx.fillStyle = p.isAI ? '#95A5A6' : '#27AE60';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(p.isAI ? '【AI】' : '【玩家】', x + dialogW - 25, rowY);
    });

    const btnW = 120;
    const btnH = 42;
    const btnY = y + dialogH - 56;
    const btnGap = 16;
    const btn1X = windowWidth / 2 - btnW - btnGap / 2;
    const btn2X = windowWidth / 2 + btnGap / 2;

    this.btn1Area = { x: btn1X, y: btnY, w: btnW, h: btnH };
    this.btn2Area = { x: btn2X, y: btnY, w: btnW, h: btnH };

    UI.drawFancyBtn(ctx, btn1X, btnY, btnW, btnH, '#95A5A6', '#7F8C8D', '回到主页');
    UI.drawFancyBtn(ctx, btn2X, btnY, btnW, btnH, '#2F80ED', '#1D5297', '再来一局');

    ctx.restore();
};

ResultStage.prototype.handleTouch = function (x, y, windowWidth, windowHeight, changeScene) {
    let b1 = this.btn1Area;
    let b2 = this.btn2Area;

    if (b1.w === 0 || b2.w === 0) {
        const count = this.players.length || 6;
        const dialogH = Math.min(windowHeight - 40, 120 + count * 30 + 70);
        const dialogY = (windowHeight - dialogH) / 2;
        const btnW = 120;
        const btnH = 42;
        const btnY = dialogY + dialogH - 56;
        const btnGap = 16;
        b1 = { x: windowWidth / 2 - btnW - btnGap / 2, y: btnY, w: btnW, h: btnH };
        b2 = { x: windowWidth / 2 + btnGap / 2, y: btnY, w: btnW, h: btnH };
    }

    if (x >= b1.x && x <= b1.x + b1.w && y >= b1.y && y <= b1.y + b1.h) {
        SoundManager.playClick();
        if (typeof this.onBackHome === 'function') this.onBackHome(changeScene);
        else if (typeof changeScene === 'function') changeScene(1);
        return true;
    }

    if (x >= b2.x && x <= b2.x + b2.w && y >= b2.y && y <= b2.y + b2.h) {
        SoundManager.playClick();
        if (typeof this.onRestart === 'function') this.onRestart(changeScene);
        else if (typeof changeScene === 'function') changeScene(3);
        return true;
    }

    return false;
};

module.exports = ResultStage;