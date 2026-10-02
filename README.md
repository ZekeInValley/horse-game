# 马儿游戏 / Horse Game（微信小游戏）

多人同步的「几匹马 / 出发 / 扣喽」反应类小游戏。

A multiplayer reaction mini-game for WeChat: shout the right command — *N horses* / *Go* / *Kou* — in turn.

---

## 功能 / Features

- 单机 / 多人房间  
  Single-player and multiplayer rooms
- 云开发数据库同步（房主权威）  
  Cloud database sync with host-authority model
- 大厅占座、准备、开始  
  Lobby: take a seat, ready up, start game
- 房间 10 分钟空闲自动清空  
  Auto-clear idle rooms after 10 minutes of inactivity

---

## 运行 / How to Run

1. 用微信开发者工具打开本项目  
   Open this project in WeChat DevTools
2. 配置云开发环境，创建 `rooms` 集合  
   Set up Cloud Base and create a `rooms` collection
3. 权限：开发阶段可读可写  
   Permissions: read/write for all users during development
4. 编译预览 / 真机调试  
   Compile & preview, or debug on a real device

---

## 技术 / Tech Stack

- 微信小游戏 Canvas  
  WeChat Mini Game Canvas
- 微信云开发 Database + watch  
  WeChat Cloud Base Database + realtime `watch`