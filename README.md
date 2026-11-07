# Kira Note

跨会话的长期记忆库，带一本笔记本样式的侧栏面板。

记忆以纯文件形式存放在 `~/.kira-note/`（Markdown + 索引 + 追加式事件日志），没有任何数据库、后台定时器或网络调用。Agent 通过四个工具读写，人类通过侧栏面板审阅。

## 组成

| 面 | 文件 | 作用 |
| --- | --- | --- |
| Host | `lib/index.js` | 挂载存储、注册注入段、注册工具、启动 Remote 服务 |
| 注入 | `lib/injection.js` + `lib/core.js` | 每轮把「功能说明 + 选中条目 + 缺口提示」写进系统提示词 |
| 工具 | `lib/tools.js` | `kira_recall` / `kira_raw` / `kira_write` / `kira_status` |
| Remote | `lib/service.js` + `lib/typert.host.js` + `lib/typert.remote-client.js` | 面板用的 7 个端点：snapshot / detail / write / update / status / move / injectionLog |
| 面板 | `lib/client.js`（由 `src/` 生成） | `sidebar.panellist` 图标 + `main` 面板（与对话同列） |
| 核心 | `lib/format.js`、`lib/store.js`、`lib/core.js`、`lib/sync.js` | 零依赖的解析、存储、业务逻辑、同步注入 |

## 面板源码

面板按「已实现版」视觉稿 `Kira-Note-UI-预览.html` 做成日记本样式。`lib/client.js` 是构建产物，不要直接改：

```
src/head.js       模块头、token、图标、localStorage 键
src/styles.css    从视觉稿抽取的设计 CSS（#kira-app → .kira-panel）
src/extra.css     宿主页面外壳、侧栏图标、注入记录表、弹层补充
src/strings.js    zh/en 文案
src/logic.js      纯函数、Api、Controller（状态与动作）
src/views.js      书脊、左栏、右页、编辑态、日历、菜单、弹窗
src/tail.js       Remote 描述符、apply(ctx)、导出

node scripts/build-client.mjs   # → lib/client.js
```

改完重跑构建，再乒乓热重载插件即可。

## 数据布局

```
~/.kira-note/
  user/entries/<id>.md            user/INDEX.md
  projects/<project-id>/entries/<id>.md
  projects/<project-id>/INDEX.md
  projects.json                   id → { path, name, gitRemote?, created }
  events.jsonl                    追加不改写的事件流
  injection-journal.jsonl         每次注入快照变化一行
```

条目是 YAML frontmatter + Markdown 正文；`summary`（≤40 字）进索引行，`title` 只给人看。状态有 `active / expired / superseded / archived`，动作有 supersede / expire / archive / restore / pin / unpin / review，**没有删除**。

## 注入规则

- 每侧（个人 / 当前项目）保底 10 条、10 KB；另一侧不足时额度让给这一侧。
- 剩余额度按 `pinned → 规则类 type → updated → id` 在两侧间竞争，封顶 25 条 / 25 KB（含标题与缺口行的整段字节数）。
- 单条先试全文，放不下降级为索引行，再放不下就跳过。
- 缺口分三类各占一行：超出上限、因状态排除、不属于本工作区，并指向 `kira_recall`。
- 快照内容不变时逐字返回同一份文本（不返回空串），只有变化才写 `injection-journal.jsonl`。

## 面板

左侧栏出现 Kira Note 图标（未审阅时有小圆点）。它和「对话」「上下文洞察」一样是**主面板**：点击后占据对话栏，不弹浮层；面板内关闭按钮或 `Esc` 回到对话。

面板本身：左侧目录 + 记忆列表，右侧只读详情（可编辑），三个页签「记忆 / 审阅 N / Kira 注入记录」。支持 `/` 搜索、↑↓ 选择、Enter 打开、Ctrl+E 编辑、Ctrl+S 保存、Esc 关闭、Alt+← 单列返回，目录配色存 localStorage。

细节：目录块可右键换 8 种颜色（同时给出白字对比度），左栏与右页之间可拖拽调宽（300–560px），书脊右侧的月亮/太阳切换纸面主题，未审阅条目在目录上有紫点、在列表与详情上各有提示条。

新建与改写：

- 目录右键「新建记忆」（或 `Ctrl+N`）在右页进入编辑态，保存后自动选中新条目；面板写入的条目直接标记为已审阅（作者是人），并追记一条 `review` 事件。
- 保存时按字段 diff 生成事件；并发冲突（`expectedUpdated` 不匹配）弹出二选一：重新载入最新版，或以草稿覆盖保存。
- `置顶 / 取消置顶 / 归档 / 恢复 / 置为过期` 执行后 5 秒内可点 toast 上的「撤销」，撤销本身也是一条事件。
- 状态栏右侧显示索引占用与实际字节；条目被 200 行上限裁掉时按类型汇总；索引占满时状态栏出现红色「索引已满」。
- 磁盘上有读不动的条目文件（坏 frontmatter）时不再静默丢弃：状态栏显示「跳过 N 条坏数据」，其余条目照常列出。

> 实现要点：一个 `sidebar.panellist` 行 + 同 id 的 `main` cell。侧栏行由宿主绘制（图标尺寸、选中态由 `size`/`active` props 传入），面板拿到的 props 不带 Session，因此所有数据都经 `remote.kiraNote` 取。

## 安装

在 DSH 会话里：

```
plugin_manager action=install_bundle target=<绝对路径>/kira-note
```

装完重启 `dsh`（bundle patch 在启动时加载）。`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`，后者用 `insert` 新增 Cordis entry。

改完源码不必重装：`plugin_manager action=set_plugin target=include:kira-note` 先 `enabled:false` 再 `enabled:true` 即热重载。

## 测试

```
npm test          # node --test test/ —— 34 个用例，覆盖 format / store / core / 注入 / journal
```

`@deepseek-ai/*` 只在宿主里由 loader 解析，本地 node 进程 import 会 `ERR_MODULE_NOT_FOUND`，因此 tools / service / client 走宿主内实测。另有 `tools/smoke/apply.mjs`（假 ctx 验证槽位注册）与 `tools/smoke/render.mjs`（17 个场景的 SSR 渲染冒烟，`--preview` 出静态预览）。

## 诊断

挂载期的单面失败写入 `~/.kira-note/boot-errors.log`（带堆栈），不会拖垮其它面。

Remote 服务的方法**不能使用 `#private`**：Cordis 把 Service 交给 Gateway 的是 Proxy，私有方法在 Proxy 上会抛 `Receiver must be an instance of class <Service>`（面板里显示为「出错了：…」）。普通方法加 `this.store` 访问没有这个问题。
