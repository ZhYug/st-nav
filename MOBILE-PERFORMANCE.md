# v3.1.4 手机端性能优化

本版本在 v3.1.3-performance 基础上优化移动端首屏、图片、CSS 和 JS。

## 主要改动

- 首页 CSS 增加 preload，并保留极小的 critical CSS，降低首屏白屏时间。
- app.js 使用 defer，避免脚本参与 HTML 解析阻塞。
- 导航图标使用 native lazy-loading、async decoding 和首屏优先级。
- 移动端关闭高开销的 backdrop-filter、环境光、纹理层和卡片 hover transform。
- 移动端导航卡片使用 `content-visibility: auto`，减少长列表初始布局/绘制。
- 搜索输入使用 requestAnimationFrame 合帧，避免每个按键同步重建整张卡片列表。
- 导航收藏、复制、卡片点击改为事件委托，减少大量 DOM 事件监听器。
- localStorage 读取增加容错，避免损坏数据导致首页初始化失败。
- 增加 `prefers-reduced-motion` 支持。
- 同时修正公共 bootstrap 接口：`url` 始终保留真实目标地址，`short_url` 单独表示短链接地址。

## 部署

无需新增数据库 Migration。直接替换部署即可。
