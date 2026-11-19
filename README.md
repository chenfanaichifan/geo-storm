# 几何雷霆 · geo-storm

一个用原生 Canvas 写的竖版飞行射击小游戏。没有框架、没有构建步骤，四个文件直接跑。

## 玩法

- 按住屏幕或鼠标拖动，飞机跟着走
- 子弹自动发射，不用点
- 吃掉落的道具：`H` 回血、`S` 护盾、`R` 短暂射速翻倍
- 空格键（或右下角圆钮）放炸弹，清空敌弹
- 每 10 波一个 Boss，Boss 有三阶段

## 本地运行

直接双击 `index.html` 就能玩。

需要起服务时：

```bash
python -m http.server 8000
```

然后打开 `http://localhost:8000`。

## 技术

- 原生 Canvas 2D，无第三方库
- Pointer Events，鼠标和触屏共用一套输入
- 纯静态，可托管在 GitHub Pages / Netlify / Vercel

## 文件结构

```
index.html      页面骨架与 HUD
style.css       布局、安全区适配、横屏提示
logic.js        纯函数逻辑（碰撞、升级曲线、补给判定）
game.js         主循环、敌机、弹幕、Boss、渲染
tools/selftest.js   逻辑自测，node tools/selftest.js
```

## 自测

```bash
node tools/selftest.js
```

覆盖矩形相交、钳制、插值、伤害结算、回血、护盾、最高分、升级曲线、击杀经验等 31 条断言。

## 开发记录

- `PROJECT_SCOPE.md` 范围与技术选型
- `PLAN.md` 分阶段计划
- `DEV_LOG.md` 每个阶段做了什么、用户反馈
- `DECISIONS.md` 关键取舍
- `ERROR_LOG.md` 出错与修复记录
