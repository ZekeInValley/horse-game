function drawGameBackground(ctx, windowWidth, windowHeight, animFrame) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, windowHeight);
  skyGrad.addColorStop(0, '#56CCF2');
  skyGrad.addColorStop(0.7, '#2F80ED');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, windowWidth, windowHeight);

  ctx.save();
  ctx.translate(windowWidth / 2, windowHeight * 0.25);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  const rays = 12;
  for (let i = 0; i < rays; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const angle1 = (i * (360 / rays) + animFrame * 0.2) * Math.PI / 180;
      const angle2 = ((i + 0.5) * (360 / rays) + animFrame * 0.2) * Math.PI / 180;
      ctx.arc(0, 0, windowWidth, angle1, angle2);
      ctx.fill();
  }
  ctx.restore();

  drawCloud(ctx, (animFrame * 0.3) % (windowWidth + 200) - 100, windowHeight * 0.12, 0.85);
  drawCloud(ctx, ((animFrame * 0.2) + 320) % (windowWidth + 200) - 100, windowHeight * 0.22, 0.65);

  ctx.fillStyle = '#27AE60';
  ctx.beginPath();
  ctx.arc(windowWidth * 0.2, windowHeight + 110, windowHeight * 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2ECC71';
  ctx.beginPath();
  ctx.arc(windowWidth * 0.7, windowHeight + 170, windowHeight * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloud(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.arc(25, -10, 30, 0, Math.PI * 2);
  ctx.arc(55, 0, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function draw3DText(ctx, text, x, y, fontSize, topColor, bottomColor) {
  topColor = topColor || '#FFE000';
  bottomColor = bottomColor || '#799F0C';

  ctx.save();
  ctx.font = '900 ' + fontSize + 'px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#1A252F';
  for (let i = 1; i <= 6; i++) {
      ctx.fillText(text, x, y + i);
  }

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(6, fontSize / 5);
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);

  const textGrad = ctx.createLinearGradient(0, y - fontSize / 2, 0, y + fontSize / 2);
  textGrad.addColorStop(0, topColor);
  textGrad.addColorStop(1, bottomColor);
  ctx.fillStyle = textGrad;
  ctx.fillText(text, x, y);

  ctx.restore();
}

/**
 * 优化后的卡通风格按键绘制函数
 */
function drawFancyBtn(ctx, x, y, width, height, mainColor, darkColor, text) {
  const radius = height / 2;
  ctx.save();

  // 1. 绘制底部立体阴影
  drawRoundedRectPath(ctx, x, y + 5, width, height, radius);
  ctx.fillStyle = darkColor;
  ctx.fill();

  // 2. 绘制按键主体
  drawRoundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = mainColor;
  ctx.fill();

  // 3. 绘制顶部弧形半透明白色高光（增添卡通胶囊质感）
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius - 3, Math.PI, Math.PI * 1.5);
  ctx.lineTo(x + width - radius, y + 3);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 4. 绘制粗体卡通文字与黑色立体描边
  ctx.font = '900 20px "Arial Black", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 黑色加粗描边（确保白色文字在任何背景色上都极其清晰且具有卡通描边感）
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x + width / 2, y + height / 2 + 1);

  // 白色填充主体
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, x + width / 2, y + height / 2 + 1);

  ctx.restore();
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = {
  drawGameBackground: drawGameBackground,
  draw3DText: draw3DText,
  drawFancyBtn: drawFancyBtn,
  drawRoundedRectPath: drawRoundedRectPath
};