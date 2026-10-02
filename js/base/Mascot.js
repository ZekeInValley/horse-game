/**
 * Q版小马吉祥物组件
 */
function drawCuteHorse(ctx, x, y, scale, mainColor) {
  scale = scale || 1.0;
  mainColor = mainColor || '#E67E22';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // 耳朵
  ctx.fillStyle = '#D35400';
  ctx.beginPath();
  ctx.ellipse(-22, -28, 8, 16, -Math.PI / 6, 0, Math.PI * 2);
  ctx.ellipse(22, -28, 8, 16, Math.PI / 6, 0, Math.PI * 2);
  ctx.fill();

  // 身体/头部
  ctx.fillStyle = mainColor;
  ctx.beginPath();
  ctx.arc(0, 0, 32, 0, Math.PI * 2);
  ctx.fill();

  // 鬃毛
  ctx.fillStyle = '#A04000';
  ctx.beginPath();
  ctx.arc(0, -32, 10, 0, Math.PI * 2);
  ctx.fill();

  // 吻部
  ctx.fillStyle = '#FAD7A0';
  ctx.beginPath();
  ctx.ellipse(0, 10, 18, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // 鼻孔
  ctx.fillStyle = '#A04000';
  ctx.beginPath();
  ctx.arc(-6, 10, 2.5, 0, Math.PI * 2);
  ctx.arc(6, 10, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 豆豆眼
  ctx.fillStyle = '#2C3E50';
  ctx.beginPath();
  ctx.arc(-12, -6, 4, 0, Math.PI * 2);
  ctx.arc(12, -6, 4, 0, Math.PI * 2);
  ctx.fill();

  // 眼部高光
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(-13, -8, 1.5, 0, Math.PI * 2);
  ctx.arc(11, -8, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // 腮红
  ctx.fillStyle = 'rgba(231, 76, 60, 0.4)';
  ctx.beginPath();
  ctx.arc(-20, 2, 6, 0, Math.PI * 2);
  ctx.arc(20, 2, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

module.exports = {
  drawCuteHorse: drawCuteHorse
};