# 需求字段阅读与迭代工具联合验收

规格 #81，实现任务 #82—#86，版本 0.4.45。本记录区分合成边界通过和真实部署验证，未执行的交付项保持待完成。

## 公开边界与证据

| 范围 | 可复现证据 | 已验证行为 |
| --- | --- | --- |
| 需求短属性 | `tests/story-fields.test.mjs`、`tests/story-fields-interaction.check.cjs` | 实际项目/类别定义、前六项、更多及空项、零/false、未知/缺失/失败、只读、局部重试；未打开富文本未请求 |
| 富文本页签 | `tests/story-fields.test.mjs`、`tests/story-documents-interaction.check.cjs` | 实际注册只读 RPC；按需取值、原文保真、有界失败、竞态隔离；切页位置、重开/换单重置、评论草稿/焦点；侧栏/弹窗 × 主题 × 宽窄屏 |
| 当前迭代/候选 | `tests/iteration-tools.test.mjs` | 三类目标、原始值状态、实际项目候选、跨页、同名隔离、部分失败/截断及凭据保护 |
| 受控迭代更新 | `tests/iteration-update.test.mjs` | 真实工具/RPC注册；授权、旧值冲突、同值无POST、项目核实；三类端点字段白名单；拒绝/未知/接受未核实、卡片/存储故障不重放 |
| 混合阅读与迭代 | `tests/iteration-interaction.check.cjs`、`tests/fixtures/navigation-daemon.mjs` | 同一详情内短属性/富文本阅读后，通过实际 MCP 工具写入；真实卡片 renderer 通知详情、工作台和任务看板；直接 RPC 无新卡也刷新；接受后503显示未核实卡、恢复后只读重试核对且无重复POST；切回文档保持可读 |
| 原有交互 | 状态、详情、工作流及导航的现有交互脚本 | 原有状态候选/确认、草稿保护、完整详情与 tab 复用；测试宿主新增的 settings hook 使用 ready/revision/values 契约 |

Node 测试使用实际贡献注册或工具边界与可控 HTTP；UI 测试渲染实际插件组件，调用真实隔离 Paseo daemon/RPC/MCP，外部 TAPD 是 loopback 合成服务。宿主控件与 contribution 装配由测试适配，不能把它称作完整真实客户端或真实 TAPD 写入验收。旧 UI smoke 的 RPC 适配也不替代上述 daemon 公开边界。

#82—#85 各自保留红→绿证据；#86 的增量先复现缺少混合字段/故障场景，再扩展原迭代 fixture，不新增测试框架或产品写入口。所有合成写只发送单目标迭代身份字段，不改变状态、评论、人员、标签、父子关系或承担关系，provider prompts 为零，不生成截图。完整自定义正文不进入历史卡片；恢复和刷新只读。

## 复现

使用已受信、与当前主线 SDK 匹配的完整构建，设置 `PASEO_RUNTIME_DIR`；旧 smoke 另设 `PASEO_APP_DIR` 为该构建的 `packages/app`。UI 依赖使用该构建已有的 esbuild、React Native Web、Playwright；系统需要的浏览器动态库与字体配置由测试环境提供，无需修改产品依赖。

```sh
npm test
npm run typecheck
npm run lint
git diff --check
node tests/story-fields-interaction.check.cjs
node tests/story-documents-interaction.check.cjs
node tests/iteration-interaction.check.cjs
npm run test:workflow
npm run test:navigation
npm run test:settings
npm run test:ownership
node tests/public-daemon-fields.check.mjs
npm run test:ui
```

真实 daemon 验收使用 Linux user/mount namespace，隔离 HOME/PASEO_HOME、屏蔽环境凭据，可信 runtime、插件、依赖和 Node 只读挂载。只安装到新建临时 daemon，结束清理自身进程/目录。测试内模拟重载/重启属于隔离验收，不重启本机运行中的 daemon；缺少隔离能力时直接失败。

## 语义和限制

- 详情自定义字段只读。已有 Agent 文本/富文本编辑的 readonly、授权及完整原始旧值规则不变；阅读能力不扩大写权限。
- 富文本超过既有 50,000 字符边界会明确失败，不声称展示完整超限内容；未返回、null、空串、无法识别不混为“尚未填写”。各页阅读位置只保留当前打开期间。
- `tapd_item_iteration` 提供 `returned/state/value`；`tapd_iterations` 提供实际项目候选和有界分页完整性；`tapd_update_iteration` 要求精确目标、完整原始 `expectedValue`、同项目已有非零 `iterationId` 和 `confirmed: true`。首版不解除/创建/批量修改迭代。
- 写前检查不是远端原子条件锁。只有精确新鲜回读的 `outcome=verified` 才报告已核实；`writeState=accepted/outcome=unverified` 和未知传输结果先读取核对，绝不自动重放。历史卡片只是操作时摘要。
- 任务看板卡片目前不增加迭代展示。验收观察真实看板刷新、工作台迭代数据及完整详情的新值，承担关系及业务状态保持不变。
- 官方[缺陷更新文档](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/update_bug.html)参数表不完整；不能仅因遗漏参数推断不支持，也不能从响应字段或通用 options 透传推断实际部署已支持。需求、任务、缺陷的合成写入验证均不证明真实账号权限、后端字段兼容性或并发安全。未经专用目标和明确授权，不试写真实业务单据；真实部署迭代写入兼容性仍未核实。

## 交付门槛

当前实现任务的定向验收与前序证据不替代最终集成检查。最终 Node/UI 回归、规范与规格两轴复核以及本机纯只读交付核对的结果由集成 PR 记录；本记录不提前宣称其完成。

fork 合入主线后，本机交付仅重载现有 `tapd-workbench` 插件，核对实际 server/client 版本、设置修订、关联及会话数据保留；不重装、不重启运行中的 daemon。实际部署只读核对明确目标的字段、类型、当前迭代和候选；输出仅版本、数量、状态及保留结论，不记录凭据、业务正文或真实身份。不得把生产环境的“应被拒绝”更新请求当只读检查。merge 后纯只读核对的结果另报，无需将私人部署结果写入本记录。当前社区/上游发布不在本次范围。
