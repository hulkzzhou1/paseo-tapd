# 需求字段更新与阶段反馈验收

实现基线：`e06e04a730266f1b2869967686d21947157f44b9`，插件版本 `0.4.37`。研究基线见 [研究记录](tapd-design-fields-research.md)；该文描述改动前状态，不代表本版仍缺少字段工具。实现提交和两轴审查范围由关联集成 PR 固定，本文不自引用提交哈希。

## 契约依据与边界

- [官方需求字段元数据](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_story_fields_info.html)：GET `/stories/get_fields_info` 按项目返回字段 key、label、html_type、readonly。
- [官方需求读取](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_stories.html)：GET `/stories` 支持项目、编号与显式 fields。
- [官方需求更新](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/update_story.html)：POST `/stories` 支持项目、编号、description 及 custom_field_*。这只是公开契约，未证明目标部署鉴权、实际 key、字段权限或清空语义。

实现仅开放需求 description 和发现到的自定义文本/富文本字段；不猜业务 key、不改其他字段、不提供任意 HTTP。readonly 三态与 supported 分开，未返回字段和实际权限不足也不混同。字段值不裁剪、不转纯文本，未返回、null、空串分别保留；清空请求发送明确空串并回读核实。返回 HTML 被服务端规范化时，精确比较会保守报告 unverified。

旧值比较发生在提交前，不能阻止比较之后的并发修改；需要原子保证时必须先确认服务端条件写契约。本版没有该保证。accepted/unverified 是远端已接受但内容未核实，unknown 是没有可靠写结果，两者都先 fresh 核对，不能盲重试。卡片只记录有限实体摘要，不记录方案正文；复用既有恢复流程，不重放写入。

普通 turn-ended 仅更新本机 Agent 状态；兼容旧设置为 true 也不评论、不改业务状态。不从 deprecated timeline 猜当前回合摘要，详情明确提示查看会话，失败只显示固定安全提示。显式阶段评论仍要求原有授权，并无 exactly-once 保证；近期评论列表不能证明历史中不存在重复，必要时在已授权同平台页面核对。

## 验收矩阵

| 边界 | 受控证据 | 预期 |
| --- | --- | --- |
| 元数据/字段类型/实际项目 | `tests/fields.test.mjs` | 保留只读/未知/不支持；缺权限读取失败不伪装空列表 |
| 未返回/null/空串/原始 HTML | 同上 | 原文保真；显式清空仅发送目标列 |
| 授权/项目/旧值冲突 | 同上 | 共享 handlers 与 Agent 边界拒绝错误输入，零 POST |
| 网络丢失/HTTP 拒绝/业务拒绝 | 同上 | 安全分类，无上游响应及凭据，无自动重试 |
| fresh/旧在途/缓存 | 同上 | 回读取得新值，不复用写前请求 |
| 已接受但回读失败/不同/卡片失败 | 同上 | 保留 accepted，仅 verified 生成字段成功卡片 |
| 创建成功响应缺少编号 | 同上 | unknown，不能误报 not_sent |
| 恢复与数据最小化 | `tests/conversation-write-results.test.mjs` | 字段卡片恢复且无正文/重复 POST |
| 旧自动回评配置与三种回合结果 | `tests/turn-feedback.test.mjs` | completed/failed/canceled 均零 TAPD 请求，状态可读，摘要不串轮 |
| 工具注册/旧写操作/关联 | `tests/agent-tools.test.mjs`, `tests/agent-assignment.test.mjs` | 新增三工具，复用既有绑定/派发/显式评论 |
| 状态 UI 写错误 | `tests/status-dropdown-interaction.check.cjs` | 不泄露错误，提示核对而非直接重试 |

TDD：先新增缺失工具、字段冲突/保真、fresh 被旧请求阻塞、旧回合误取摘要、字段卡片缺失和创建缺编号的失败断言，再逐项实现；聚焦测试记录见 PR。检查使用既有依赖和匹配 SDK，未安装依赖或更改宿主。

## 未测范围与部署验收

本地 fixture 只证明插件控制流和序列化，未访问真实 TAPD、私有配置或凭据，未安装/重载生产插件，未测试父 Bot/Team 派发、外部通知或真实模型工具授权链。目标部署的字段 key、字段类型、readonly 完整性、账号/单据权限、HTML 规范化及空串清空结果仍未知。上线前应在授权测试单据上依次发现、读原文、确认旧/新值、单字段提交、fresh 回读；未知或不匹配保留原证据并人工核对。当前范围不新增 task/bug 字段编辑、通用表单、原子条件写或评论幂等存储。

## 本轮检查结果

- `npm run typecheck`：退出 0。
- `npm run lint`：退出 0，4 条既有 unused eslint-disable 警告，无错误。
- `npm test`：退出 0，112 项通过；Node 提示既有模块类型声明缺失，无失败。
- 状态 UI 隔离检查：退出 1，现有宿主 app checkout 缺少 esbuild，测试未进入浏览器交互；保留更新后的安全错误断言，未安装依赖或修改宿主。
- daemon 实进程检查未运行：可用同级宿主源码缺少 defineAgentTool 导出，无法作为匹配主线宿主；已有注册/RPC/恢复 fixture 通过不等于真实 daemon 验收。
- `git diff --check`：退出 0；新增内容仅脱敏示例，无图片改动。
