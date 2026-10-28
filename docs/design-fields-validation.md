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

TDD：先新增缺失工具、字段冲突/保真、fresh 被旧请求阻塞、旧回合误取摘要、字段卡片缺失和创建缺编号的失败断言，再逐项实现；聚焦测试记录见 PR。首轮检查使用既有依赖和匹配 SDK；本次验证收尾仅在临时目录补依赖并复用安装主线的公开构建产物，未改宿主源码或产品依赖。

## 未测范围与部署验收

本地 fixture 只证明插件控制流和序列化；该隔离阶段未访问真实 TAPD 或安装/重载生产插件。后续按用户明确授权完成本机部署与只读连接检查，见下节；未测试父 Bot/Team 派发、外部通知或真实模型工具授权链。目标部署的字段 key、字段类型、readonly 完整性、账号/单据权限、HTML 规范化及空串清空结果仍未知。上线前应在授权测试单据上依次发现、读原文、确认旧/新值、单字段提交、fresh 回读；未知或不匹配保留原证据并人工核对。当前范围不新增 task/bug 字段编辑、通用表单、原子条件写或评论幂等存储。

## 本轮检查结果

- `npm run typecheck`：退出 0。
- `npm run lint`：退出 0，4 条既有 unused eslint-disable 警告，无错误。
- `npm test`：退出 0，112 项通过；Node 提示既有模块类型声明缺失，无失败。
- 状态 UI 隔离检查：首轮退出 1（误以不完整的同级开发 checkout 作为测试依赖来源，缺少 esbuild）；本次改用安装主线的构建依赖并补临时动态库，退出 0，覆盖项目/类型候选、当前值不提交、重复点击、安全报错、刷新和窄屏暗色详情。
- 新增公开接口 daemon 字段检查：退出 0，两个不同进程、真实插件 worker/RPC、25 次本地读取、4 次明确模拟 POST（含 1 次拒绝）、0 次重放；通过旧值冲突、安全拒绝、accepted/unverified、清空、插件重载和 daemon 重启。旧 `daemon-lifecycle.check.mjs` 使用内部测试工具，本轮未运行；不能把新检查称为完整 Agent 生命周期验收。
- `git diff --check`：退出 0；新增内容仅脱敏示例，无图片改动。

## 独立两轴审查

首次审查固定为基线至 `85448f569fd4b99acbf3581548177c19ab60e07f`。Standards 与 Spec 各报告 1 项 P2：英文说明残留旧自动回评及旧工具计数，违反文档同步要求；修复提交同步所有相关英文段落。未发现其他可操作的规范/规格问题，未合并或重排两轴结论。规格审查独立重跑字段、回合反馈及卡片恢复三组测试，18/18 通过、退出 0。修复复核与最终提交范围以集成 PR 记录为准；审查不代表真实部署验证。

## 验证收尾：环境、命令和准确范围

当前安装的 `0.13.2` 是主线 `6b7d49f0d8d21d01565f9517a8c2a30e2a587e2a` 构建，包含 `defineAgentTool`；首轮所查同级开发 checkout 不是该安装构建。公开 npm `0.13.2` 不含该导出与当前宿主能力是两件事。此次也核对了 npm 的 `0.14.0-beta.1` SDK 已包含导出，校验下载包的 registry SHA-512 integrity；最终 daemon 验证直接复用当前主线构建的公开包入口，没有替换其 SDK，也没有部署 beta。

UI 测试实际复用主线 app 依赖：esbuild 0.28.1、Playwright 1.58.2、React/React DOM 19.2.3、react-native-web 0.21.2；使用对应缓存 Chromium headless shell 1208，新建临时浏览器 profile，无截图。TencentOS 4.4 缺少 libgbm/libasound，以下 [Ubuntu 官方包归档](https://archive.ubuntu.com/ubuntu/pool/main/) 仅解压到临时目录，通过测试进程 LD_LIBRARY_PATH 加载，未系统安装：

| 包 | SHA-256 |
| --- | --- |
| libgbm1_22.0.1-1ubuntu2_amd64.deb | f15116201bc7ec40cc0b34b41571dd1e9e3520d4e08aafab084a02f8ca071160 |
| libasound2_1.2.6.1-1ubuntu1_amd64.deb | cb208a762817bde5b83d1d52b7b89c747e9b484c857ea114bf97bacc1b29ecae |
| libwayland-server0_1.20.0-1_amd64.deb | 83616131541e45455a30afe67f65c817e72a20f85ccf36a1d64930d89fa313d3 |

`RUNTIME_ROOT` 指受信任的完整主线构建；`TEST_LIB_DIR` 指上述临时解压目录。在没有这两个缺包的机器上可省略 LD_LIBRARY_PATH：

```bash
PASEO_APP_DIR="$RUNTIME_ROOT/packages/app" \
  LD_LIBRARY_PATH="$TEST_LIB_DIR/usr/lib/x86_64-linux-gnu" \
  node tests/status-dropdown-interaction.check.cjs
# exit 0
PASEO_RUNTIME_DIR="$RUNTIME_ROOT" node tests/public-daemon-fields.check.mjs
# exit 0
```

新脚本要求 Linux user/mount namespace（unshare、mount、bash）。它只从 `@getpaseo/server` 和 `@getpaseo/client/node` 公开入口构建/连接 daemon，不调用 test-utils、内部模块或 agentManager。临时 home 与真实用户 home 分离，主线/插件/依赖/Node 只读挂载；禁用全部真实 provider、relay、语音和元数据模型，凭据及单据均为 fixture。插件只安装/重载在临时 daemon，API 只指向 loopback 模拟服务；进程退出清理临时状态。缺少命名空间能力时直接失败，不降级到真实 home。

本次没有修改产品实现，故未机械重跑首轮已通过的 112 项测试、typecheck 和 lint。新增验收脚本的 Standards 审查发现中转挂载别名仍可写；已将别名及最终路径全部 remount 为只读，并在启动前用可写性检查断言。该发现不证明此前运行发生过宿主修改。修复复测与两轴复核结论记录在 PR。仍未验证真实模型/MCP 授权、普通回合通知、Agent 归档/删除跨进程恢复或真实 TAPD 权限；旧值比较的并发窗口和未知评论结果核对限制不变。就本任务的代码审查和受控验证而言可建议转 ready；按用户要求 PR 仍保留 draft，转 ready 不代表部署验收通过。

## 用户授权后的本机部署与冒烟检查

部署的产品及测试代码固定于 `ad6512a614899c394b876fa7e7b13fcd35c88539`，版本 `0.4.37`；后续提交仅补本节记录。宿主仍为上述主线 `0.13.2`。使用公开 client 与 daemon-control 导出的标准本机认证流程，不手工读取或输出配置文件/凭据。

已有同名目录安装不能被 `install` 覆盖，而 remove 会删除插件设置。因此通过公开 `listPlugins` 读取安装元数据，保留全部来源及启用状态，用 `patchDaemonConfig` 仅替换目标插件目录，再调用 `reloadPlugin`。未删除插件、改设置值、迁移绑定数据或重启宿主。插件现加载任务工作树；该目录与依赖必须继续保留。回退时以相同方式恢复原主目录并重载即可，回退本身未执行。未合入或发布，PR 保留 draft。

| 检查 | 本机结果 |
| --- | --- |
| `npm run typecheck` | 部署前重跑，退出 0 |
| 公开 SDK 切换来源并重载 | 退出 0；目标 running、无 load error，其他插件来源/启用/运行状态未变 |
| `paseo plugin ls tapd-workbench --json` | 退出 0，来源为目标工作树 |
| client catalog | bundle 存在并含版本 0.4.37；并非真实客户端界面交互验收 |
| `tapd.agent_status` 空集合 | 返回空集合成功 |
| 新字段 RPC | 三个方法均可达；字段发现/读取拒绝未配置的模拟项目，更新拒绝 confirmed=false，未提交业务写入 |
| `tapd.check` 空参数 | 使用已有设置，真实 TAPD 只读鉴权成功；仅记录成功标志，不保存用户身份或业务 ID |
| 插件日志 | 未发现本次部署产生的新错误；已有 IPC channel closed 记录早于本次部署，未据此推断线上根因 |
| 当前 Agent 旧工具引用 | 重载后失效；本轮没有重新打开 provider session，不能宣称真实模型已拿到新工具 |

上述部署脚本与本机冒烟脚本均退出 0；一次无认证连接探测曾退出 1，使用宿主标准认证流程后连接成功。临时脚本只在本机保存，文档不收录实际路径、身份、项目或凭据。没有为检查新增产品依赖，也未机械重复全套 112 项测试。

仍需在后续打开的 Agent 会话确认工具重新注入；没有执行真实字段编辑/清空、评论或状态流转，也未核实目标部署字段元数据/权限、真实模型授权、普通回合通知链或客户端画面。隔离 daemon 的冲突/回读/重载验证仍为这些写入边界的现有证据，不能等同真实 TAPD 写入验收。
