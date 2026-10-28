# TAPD 方案字段与阶段反馈能力研究

日期：2026-10-28。状态：研究完成，未实施。本文是本轮唯一新增文件。

结论：插件已有项目定位、创建字段发现、创建时附加字段、明确授权的评论和状态修改、静默绑定与部分派发恢复；没有已有方案字段的 discover/read/update/read-back 闭环。不能用创建、评论、筛选字段或结果卡片冒充方案字段更新。自动回评确实混淆回合结束与业务完成，但现场重复评论、父单状态失败的原因未证实。

本轮已读取本仓调研任务和父 Bot 需求的当前正文。按仓库脱敏规则，不在本文复制账号、真实任务链接或编号、Agent 身份、业务项目/单据标识。对应关系留在会话交接，GitHub 回写由父 Bot 独占。用户已确认的方向是：只回写明确阶段成果，普通回合通过 Agent 通知；字段工具缺失时允许已授权同平台浏览器读取旧值、保留内容、编辑并回读；协调流程由用户在 Bot 设置页定义，其载体由 Bot 项目研究；工蜂正式关联工具另记缺口。

## 证据基线与边界

本文 `路径:行号` 相对本仓根目录；`../paseo/`、`../paseo-bot/` 是只读的同级源码仓，不是生产安装目录。下文“证实”指源码/契约事实；验收矩阵是后续计划，不是线上通过记录。

| 来源 | 基线 / 本轮观察 | 能证明什么 |
| --- | --- | --- |
| 本仓 | HEAD `e06e04a730266f1b2869967686d21947157f44b9`；初始工作区 clean；package 0.4.36 | 本轮调查的插件实现；不是已安装插件修订证明 |
| 前期跨仓研究 | `../paseo-bot/docs/project-research-coordination.md`；该仓 HEAD `9df62016bc8de1978b1be4b6bed336ee3383ebca` | 待独立核实的前期结论；当前父需求优先于其中旧的候选方案 |
| Paseo 源码 | HEAD `d972f67c3fea06fbc163608f5ddcc2c443de83ac` | `../paseo/packages/plugin/src/server/lifecycle.ts:49` 和 `../paseo/packages/server/src/server/plugins/lifecycle/index.ts:100` 均是空 timeline 契约；未改该仓 |
| 本仓已安装 SDK | package 自报 0.13.2；`node_modules/@getpaseo/plugin/dist/server/index.d.ts:5` 导出 `defineAgentTool`；`node_modules/@getpaseo/plugin/dist/server/lifecycle.d.ts:53` 标明 timeline 弃用且恒空 | 实际可读的开发依赖契约；不证明 SDK 构建来源或生产宿主版本 |
| 锁文件与源码差异 | `package-lock.json:709` 锁 registry SDK 0.13.2；同级 Paseo 的 `../paseo/packages/plugin/src/server/index.ts:1` 至文件末尾没有工具导出；`scripts/use-main-sdk.mjs:4` 至末尾提供显式复制主线 dist 的开发步骤 | package 版本号相同不能证明内容相同；本轮没有执行复制、安装或重载 |
| 当前会话工具目录 | 发现 16 个 TAPD 工具，名称与下表一致；没有字段更新工具；GitHub 插件工具不可用，按 `docs/agents/issue-tracker.md:9` 用只读 `gh` | 只证明此会话暴露的工具元数据；没有调用真实 TAPD 工具、读取配置或探测权限 |

已安装 SDK 文件 SHA-256：server/index.d.ts 为 `f0fdfc62315cbdf33c89afaa270a8637e37cfe1bc2627b4efd8f0902bf0beba4`；server/lifecycle.d.ts 为 `ab396a86870c2be51739e21a9b30a1ef4cfdf6d4a3ccc6021a69abfd23bafb0b`。仓库已有主线兼容说明见 `docs/superpowers/specs/2026-10-27-agent-tools-design.md:11`、`OVERVIEW.md:64`，其历史验证不能当成本轮生产兼容验证。

2026-10-28 读取的 [Paseo 官方插件参考](https://paseo.sh/docs/plugins/reference#events) 同样明确旧 timeline 恒空、应按需读取历史；同页旧字段表仍称完整快照，存在文档内部冲突。以实际类型和事件发送源码交叉核验。官方 [Agent tools 契约](https://paseo.sh/docs/plugins/reference#attach-tools-to-agents) 已有工具注册；不能因同级旧源码无导出否认该公开能力。未查询目标 TAPD 部署，也不以公开 TAPD API 文档推断目标项目字段 key、类型或权限。

已读约定及原始设计：`AGENTS.md:1`、`docs/agents/issue-tracker.md:1`、`GLOSSARY.md:1`、`docs/superpowers/specs/2026-10-27-agent-tools-design.md:1`、`docs/superpowers/specs/2026-10-20-create-child-under-story-design.md:19`、`docs/decisions/agent-tool-bindings.md:1`。本研究不作新的架构决策，不新增 ADR。

## 确认、纠正与未知

前期研究关于创建元数据、详情投影、状态候选限制、空 timeline 和不能确认现场根因的主体结论得到独立确认。下表的精度纠正用于防止将这些结论过度概括；新增细节主要是字段过滤/警告在不同入口的差异、inflight 缓存、自动回评只选第一绑定及测试覆盖边界。前期文档已包含最新阶段决定，旧候选方案段落需保持一致。

| 判断 | 结论 | 证据 / 限定 |
| --- | --- | --- |
| 确认 | 已有方案字段的读写闭环缺失 | 工具枚举 `server/agent-tools.ts:115`；RPC `shared/contracts.ts:355`、`:379`、`:400`、`:412`、`:434`；注册 `index.server.ts:48` |
| 纠正精度 | 不是完全没有字段发现：有创建元数据，但不足以发现更新能力 | `server/tapd.ts:964` 只输出经过过滤的创建字段，原始类型/只读原因不保留；不代表当前单据可编辑 |
| 确认并限定 | 动态附加字段仅在 create 路径透传；标准 status/comment 另有写接口 | `server/tapd.ts:1039` 过滤 denylist 后提交；`:948` 禁止 id/status/description 等受控字段，不能借 create 更新已有单据 |
| 纠正精度 | create 元数据不构成服务端字段白名单校验 | `server/agent-tools.ts:140` 要求先读只是工具说明；`server/tapd.ts:1039` 未验证字段是否在元数据中、类型、必填和可编辑性；服务端可能拒绝，不能承诺任意 extraFields 成功 |
| 确认 | 详情没有自定义字段出口 | `server/tapd.ts:1360` 固定投影；`shared/contracts.ts:434` 固定 output。即使 API 返回 custom 字段也丢弃；当前 GET 未显式请求这些字段，不证明 API 默认返回它们 |
| 纠正精度 | 字段读取失败并非所有入口都静默 | `server/tapd.ts:973` 返回空字段；Agent 路径经 `readWarnings` 提供泛化警告（`server/agent-tools.ts:40`、`tests/agent-tools.test.mjs:186`）；普通 createFields RPC 没有该警告输出 |
| 确认 | 状态/评论工具错误未分类；UI 路径还不同 | 工具 `server/agent-tools.ts:101` 合并失败；状态 UI `client/workbench/EntityWriteBack.tsx:47` 泛化；评论 UI `:109` 显示错误 message；共享 HTTP 保留未经结构化分类的 info（`server/tapd.ts:896`） |
| 确认并限定 | completed 被自动评论映射为“已完成”，不是自动改状态 | `server/handlers.ts:293` 至 `:302` 仅调用 addComment；`shared/contracts.ts:122` 默认关闭；未读实际开关 |
| 确认 | 旧 timeline 会使当前契约下的摘要为空 | `index.server.ts:115` 传 event.timeline；`server/agent-state.ts:28` 仅倒序找一条 assistant_message；没有补读历史 |
| 纠正方案 | 仅改中性文案仍不满足已确认需求 | 普通回合不应再自动发 TAPD 评论；保留 Agent 通知与本地状态，阶段成果通过显式评论工具写入，不再将“保留每轮中性回评”列为未决选择 |
| 确认并限定 | 有重复回评风险，没有业务写入去重保证 | 自动回评没有 turn/阶段幂等键或已写记录；显式评论也无幂等键；卡片恢复和绑定幂等不等于评论幂等 |
| 未知 | 目标“方案设计”的真实 key、原始类型、是否只读、单据级编辑权限、API 可见性、并发条件更新能力 | 本轮没有目标部署证据，不猜 key，不把 label 匹配当唯一标识 |
| 未知 | 现场两次回评的来源、父单状态失败原因、实际 daemon/app/插件修订、SDK 与目标平台契合程度 | 未读生产配置/日志/凭据、未作目标读写；不能归因于权限、父子限制或重复事件 |

## 当前能力：哪些无需实现

`index.server.ts:39` 合并业务工具和派发工具，`:87` 在 session-open 注入并跳过 history；没有隐藏的任意 HTTP 或已有字段更新入口。

| 工具 | 已有路径与用途 | 对本需求的边界 |
| --- | --- | --- |
| `tapd_projects`、`tapd_check` | 配置项目枚举、连接检查 | 不是字段/写权限探测 |
| `tapd_board`、`tapd_search` | 列表、有限搜索；warnings/truncated | 不能以空结果证明未创建或目标不存在 |
| `tapd_entity` | handlers.entity → fetchEntity；实际项目、正文、最近评论、父子单据 | 无自定义字段；不保证 fresh read |
| `tapd_filter_options`、`tapd_filter_fields`、`tapd_members` | 现有筛选与人员候选 | filter_fields 取首个项目并合并类型，不可代替逐项目编辑元数据（`server/tapd.ts:1053`） |
| `tapd_status_options` | 项目/类型的状态 key、label，零 TTL 请求 | 返回字段候选，不验证当前状态能否转移、权限或流程必填项（`server/tapd.ts:413`） |
| `tapd_create_fields` | 按项目/类型读取创建元数据、当前用户昵称 | 可辅助识别候选；不能证明更新权限，不能发现全部被过滤字段 |
| `tapd_create` | 创建需求/任务/缺陷；任务/缺陷用 storyId 挂父需求 | 已支持建立调研子任务，无需重造；先读父单和必填项；不能凭 extraFields 覆写已有 id |
| `tapd_add_comment` | actualTarget 核对实际项目 → handlers.addComment → POST /comments | 足够承载获授权阶段结果；纯文本转义；不承担方案字段保存或状态推进 |
| `tapd_update_status` | actualTarget → 项目状态候选 → unchanged 判断 → POST | 已有授权和合法 key 才写；成功结果是请求接受及提交值快照，没有自动回读当前状态 |
| `tapd_agent_options`、`tapd_bind_agent`、`tapd_dispatch_agent` | 已有候选、静默绑定、创建工作区/Agent、保存绑定后 send | 有部分失败恢复信息；没有证据保证 Bot 原生父子通知链，需独立验收 |

业务工具落点为 `server/agent-tools.ts:116` 至 `:169`，派发工具为 `server/agent-assignment.ts:34` 至 `:80`。写工具的 `confirmed: true` 是调用方授权声明，不是新的用户审批服务；已有授权覆盖目标/动作/内容时可复用（`skills/paseo-tapd/SKILL.md:24`、`:35`、`:39`）。不要因本研究另增反复确认。

当前可用操作序列：读取明确父单 → create_fields → 经授权 create 挂载调研 task；研究成果通过 entity → add_comment；需要状态推进才 entity → status_options → update_status → 再读详情核实。字段闭环未补齐时，已授权的同平台浏览器可以完成旧值读取、保留编辑和回读；不能回读就报告未验证，不能改发评论冒充字段保存。本轮未使用浏览器进入真实 TAPD。

## 字段发现与更新：必须区分的结果

创建元数据将 `readonly=true/1/"1"`、denylist、未知 html_type、空 label 字段删除；rich_edit/textarea 合并成 textarea，数字等类型也被折成 text（`server/tapd.ts:811`、`:982`、`:997`）。缓存 30 分钟（`:972`）。因此现有输出无法可靠区分下表，更无法确定名为“方案设计”的项目字段。

| 观察 | 能说什么 | 不能说什么 / 后续所需证据 |
| --- | --- | --- |
| 返回候选 key/label | 在该次创建元数据投影中可见 | 不能据此宣称现有单据可编辑；必须核对实际项目、类型、单据和编辑约束 |
| 字段缺失 | 当前投影没给出该字段 | 可能为过滤、接口不返回、类型不支持或权限；不能编造 key，也不能直接判“无权限” |
| readonly 明确为真 | 元数据明确标为只读 | 应保留原因并禁止 POST；不能把缺省 readonly 当写授权 |
| 未知类型或缺类型 | 插件不能可靠编码该值 | 应返回 unsupported/unknown，不能当普通字符串透传 |
| HTTP 401/403 | 可区分认证或请求被拒绝 | 不能只凭 403 宣称某字段无权限；具体业务原因需部署明确错误码/权限证据 |
| 请求成功但 data 空/形状不符 | 无结果或协议形状不支持 | 不能伪装为空字段全集；返回 completeness/unsupported 信息 |
| 原值空、字段不存在、字段未被接口返回 | 三种状态必须分别保留 | 不可都压成空字符串，否则会错误覆盖或清空 |

最小建议是三个有边界的能力，而非四个独立写工具：项目/类型字段发现、指定单据字段读取、单字段更新（内部校验并回读）。以下名字是候选接口，不是已注册工具，也不是实际 TAPD 字段 key：

| 候选接口 | 最小输入与输出 | 实施位置 |
| --- | --- | --- |
| `tapd_field_definitions` | workspaceId/kind；可按 label 缩小候选但保留真实 key、原始类型、显式 readonly 与 unknown、选项/限制、完整性 | `shared/contracts.ts` + `server/handlers.ts` + `server/tapd.ts`；复用字段端点映射但不复用有损创建投影 |
| `tapd_read_field` | workspaceId/kind/id/fieldKey；返回字段是否返回、原始值/格式、可用的修改版本、读取时间 | 固定单据端点、显式字段选择、校验项目与实际 id；不暴露任意 endpoint/params 或整张原始 row |
| `tapd_update_field` | 同一目标、fieldKey、期望旧值或可靠版本、新值、confirmed；输出 unchanged / verified / conflict / outcome_unknown 等明确结果 | handlers 中统一校验，Agent 工具与 RPC 共享；回读是写操作的一部分，供调用方再次 read 恢复 |

先支持目标部署证实需要且能保真往返的文本字段；如果实际是 rich_edit，先确认 HTML/富文本编码与保存后的规范化，不把 create 的纯文本转义照搬。不顺带做所有字段的表单引擎。字段只在明确项目/类型/单据下定位，label 同名或多候选时拒绝自动选择。

更新顺序：受控元数据 → fresh read 原值 → 对比获批旧值并保留人工内容 → 仅提交目标字段 → fresh read 回读对比。若新值已等于当前值，返回 unchanged，无 POST。旧值冲突应返回冲突，不能重写整条单据。若目标 API 支持原子条件更新则使用；本轮没有此证据。仅客户端比较不能消除读写间竞态，也不能宣称事务或零覆盖风险。

关键共享边界：`requestPost` 当前跳过所有空字符串（`server/tapd.ts:864`），直接复用将无法清空字段；创建 extraFields 还 trim 非空值（`:1043`），不能用于保真更新。应只在明确允许清空的受控更新路径保留空值，不改变创建/评论语义。所有校验应放在共享 handler/服务层，不只放在 Agent wrapper，否则 RPC 会绕开。

## 错误、fresh read 与结果可信度

`TapdApiError` 仅有 message/detail（`server/tapd.ts:108`）。GET 分辨 HTTP 失败、非 JSON、业务 status（`:293`）；POST 将非 2xx、非 JSON、业务拒绝合并（`:890`），可能携带服务端 info。工具外层统一安全失败提示保护了敏感内容，但同时抹掉失败阶段、是否已发送、HTTP 状态和业务错误码（`server/agent-tools.ts:18`、`:101`）。

最小改进在 requestJson/requestPost → handlers → tools/RPC 公用错误结果：保留允许公开的 phase、HTTP status、经部署验证的业务 code、写入是否未发送/明确拒绝/结果未知；对外 message 用固定安全文案。权限、字段不存在、类型不支持、工作流限制、版本冲突只在有明确证据时分类，否则 unknown。不得通过回显 info、原始响应/请求体或 URL 中认证信息换取诊断能力。UI 评论/创建当前显示原始 Error.message 的路径也需覆盖（`client/workbench/EntityWriteBack.tsx:109`、`client/workbench/CreateEntityModal.tsx:188`），不能只保护模型侧。

必须修正“先读回即可安全重试”的隐含保证：

- `requestJson` 默认缓存 20 秒且复用同 URL inflight（`server/tapd.ts:195`、`:263`）；`fetchEntity` 没有 fresh 参数（`:1344`）。`actualTarget` 因而也可能读旧值。
- 状态/评论只有 POST 返回成功后才清缓存（`:571`、`:593`）；超时后仍可能读到旧快照；create 成功路径没有清缓存（`:1046`）。新字段闭环与不确定写入恢复要有可靠 fresh 语义，避免复用写前在途读取；简单 TTL=0 仍会复用 inflight。
- `tapd_update_status` 的 entity 快照直接采用提交值（`server/agent-tools.ts:161`），不是远端回读。`tapd_add_comment` 不返回新评论 ID（`server/handlers.ts:171`），只确认请求成功。
- 评论详情最多 30 条且无分页/total/截断标记（`server/tapd.ts:1406`）。没读到评论不等于没写；需要时补同项目限定的评论分页核对，或已授权浏览器，仍不足则保留 unknown。
- 请求发出后超时/断连不可自动重新 POST。远端接受而展示失败已有保护，保留其成功语义，不要因新增回读失败改报“写入失败可重试”（`server/agent-tools.ts:78` 至 `:103`）。

当前“子单成功、父单失败”只能分目标分别记录结果；没有证据推导为父需求工作流约束、角色权限或字段缺失。后续诊断要收集脱敏后的实际项目/类型、当前与目标状态 key、请求阶段、HTTP/业务 code、fresh 回读结果和运行版本；不采集凭据及原始敏感请求。

## 阶段反馈、去重和可重入恢复

自动链路是 `index.server.ts:112` → `recordTurnEnd` → `autoReportAfterTurn`。记录只按 Agent 保存最新一条内存值、最多 500 条、摘要 200 字，重启即失（`server/agent-state.ts:11`）。未保存 event.turnId；endedAt 取处理时刻。autoReport 取合并绑定的第一条匹配（`index.server.ts:34`、`server/handlers.ts:289`），不是遍历所有绑定；同一绑定在旧/新存储重复并不会仅因此产生两次 POST。自动回评 catch 全吞，调用方也不 await（`server/handlers.ts:303`、`index.server.ts:121`）。

| 层次 | 已有保证 | 缺失 / 不能外推 |
| --- | --- | --- |
| 绑定存储 | endpoint + TAPD 项目 + kind/id + Agent 为键，串行原子保存；重复 put 不新增同键（`server/agent-links.ts:17`） | 不等于派发幂等；同目标可绑定多个 Agent |
| 工具派发 | 保存绑定后再 send；失败返回 phase、已创建 ID、bound、promptSent unknown/false（`server/agent-assignment.ts:61`） | 重新调用仍可能新建；workspace/Agent 创建服务端成功但响应丢失时可能连 ID 都拿不到；不是自动续跑事务 |
| 显式评论 | 授权、实际项目检查、无内部自动重试 | 重复调用会再次 POST；无阶段去重或 exactly-once |
| 自动评论 | 默认关闭，开启且有绑定才写；实际项目重新读取 | 重复事件/人工阶段评论同时发生时无去重；只有第一绑定；失败静默；未证明现场发生 |
| 结果卡片 | `server/conversation.ts:149` 按稳定卡片 ID 补展示，`:236` 同 source 不重复收录；展示失败不反转已成功写入 | source 默认随机，且记录在远端操作之后；不是远端评论幂等日志，不能拿卡片存在/缺失判定远端未写 |
| 普通消息观察 | `server/conversation-messages.ts:42` 已用公开 timeline 分页/来源标识 | 只收录链接，不提供回合成果摘要；`index.server.ts:114` 调它不能修复 `recordTurnEnd` 的空摘要 |

按已确认要求，最小调整是去掉普通 turn-ended → TAPD 评论副作用，保留本地 Agent 状态和宿主通知；明确阶段成果继续调用已有 add_comment。旧 autoReport 设置的停用/兼容说明、设置页和 README 必须一起调整，不能只改标题。也不能悄悄把开关重新解释成“模型自动判阶段完成”。本地展示 `client/workbench/EntityDetailContent.tsx:628` 的“上次完成”应改为明确回合语义。

如果仍需本地回合摘要，按公开 timeline 补读并界定当前回合，处理分页、gap、无 assistant 输出、历史会话重开及 turnId 为空/复用；不能单取最近一条旧回复。优先借用已有读取模式，不把链接观察器改为工作流引擎。阶段成果以显式记录为准，不由摘要推导业务完成。无需为不再执行的自动评论另建去重数据库。

同一事项的恢复：由单一协调者查阶段成果后续写，评论结果未知先核对远端，未能核实则不重提；绑定失败且 Agent 已存在可用 bind 补齐；promptSent unknown 核查活动，不能再 dispatch。工具测试中的“starts exactly once”仅指一次调用，不涵盖跨调用重放。UI Dispatch 路径在 agents.create 时已带 prompt，之后才通过 onCreated 保存旧设置关联（`client/workbench/DispatchModal.tsx:188`、`client/workbench/EntityDetailExperience.tsx:61`）；UI Bind 可发送默认通知（`client/workbench/BindAgentModal.tsx:105`）。不能将工具的先绑定后发送/静默保证推广到 UI，暂不为本研究重写两套派发流程。

## 最小改进文件与调用面

以下是建议实施范围，不是本轮已修改文件。优先补直接阻塞，不新增任意 HTTP 转发器、通用工作流引擎、Bot 平台适配库或第二套绑定存储。

| 目标 | 文件 / 调用面 | 必须一起处理的约束 |
| --- | --- | --- |
| 字段发现/读/更新回读 | `server/tapd.ts`、`server/handlers.ts`、`shared/contracts.ts`、`server/agent-tools.ts`、`index.server.ts` | 项目范围、真实 key、原始类型、缺失与空值、明确权限/unknown、保真编码、旧值冲突、fresh 回读、写后未知结果 |
| 安全错误和 fresh 恢复 | requestJson/requestPost 及 status/comment/create 调用者；`client/workbench/EntityWriteBack.tsx`、`client/workbench/CreateEntityModal.tsx` | 保留已成功写入；共用安全错误映射；RPC 与 Agent 都不得泄露原始失败详情 |
| 阶段语义 | `index.server.ts`、`server/handlers.ts`、`server/agent-state.ts`、`client/workbench/SettingsForm.tsx`、`client/workbench/EntityDetailContent.tsx`、`shared/contracts.ts` | 普通回合零 TAPD POST；旧设置行为说明；本地状态与业务状态独立；摘要读取不串回合 |
| 新字段操作的结果展示 | `shared/conversation.ts:20`、`server/agent-tools.ts:42`、`client/conversation/EntityResultCard.tsx:13`、现有 conversation runtime | 若纳入现有成功写入卡片，增加受控 operation 和文案，保留旧卡片兼容；字段正文不能持久化到卡片/来源存储。不要伪装 comment/status |
| UI 详情调用者 | `client/workbench/EntityDetailContent.tsx:74` 使用 entityRpc；Dispatch 引用其 output 类型；会话刷新另用 `fetchEntitySummary`（`server/conversation.ts:312`） | 独立单字段 read 最小，不必把所有自定义值塞入每张详情/搜索/会话摘要；若改 entityRpc 则这些消费者一起核查 |
| 创建现有路径 | `client/workbench/CreateEntityModal.tsx:73`、`:174`；`server/agent-tools.ts:140` | 不因新编辑能力破坏挂载创建、必填候选与 denylist；创建无需重造 |
| 技能与对外约定 | `skills/paseo-tapd/SKILL.md`、`README.md`、`OVERVIEW.md`、`paseo-plugin.json`；发布时 `package.json` 与 `shared/version.ts` 同步 | 写清真实工具和阶段路径、浏览器临时路径、错误/重试边界、字段可见数据流；不沿用旧“每轮自动回评”。本研究无行为变化，不改版本或发布文档 |

技能现有阶段、授权复用与未知写入恢复说明已可直接使用（`skills/paseo-tapd/SKILL.md:28` 至 `:49`）。需要补的是字段能力与“普通回合不回评”的准确规则，不是重写整个工作流。已安装技能是否由目标 provider 加载属于运行验收，不能以仓库有文件证明生效（`OVERVIEW.md:119`）。

## 可复用测试接缝与验收矩阵

本轮只读测试，没有运行测试、构建、类型检查、lint、daemon 或 UI。已有测试是未来复用证据，不是本轮通过记录。

| 接缝 | 已有覆盖 | 应补内容 |
| --- | --- | --- |
| `tests/agent-tools.test.mjs:26` fetch mock + execute | schemas/确认、实际项目、denylist/转义、状态 unchanged、取消、秘密脱敏、部分失败；`:247` 注册 hook | 字段原始元数据、更新/回读、权限/错误阶段、缓存后不确定写入；`:55` 工具数量需同步 |
| `tests/agent-assignment.test.mjs:44` | 绑定重启幂等、派发部分失败、绑定先于 send、取消；`:93` 自动评论用实际项目 | 阶段策略后的零自动 POST；重复事件、多个绑定；不要继续把一次自动评论测试当阶段验收 |
| `tests/conversation-write-results.test.mjs:44`、`:57`、`:74` | 写后快照、展示失败/取消后仍成功、恢复不重写、未知结果不生成成功卡片 | 新字段操作 verified 与 outcome_unknown 区分；回读失败不重写；旧卡片兼容 |
| `tests/conversation-links.test.mjs:31` | 空 timeline 的链接收录/重放 | 它传字符串 outcome，且只测链接；不能证明真实 `{kind: ...}` 回合摘要或阶段回评正确，应新增准确事件 fixture |
| `tests/daemon-lifecycle.check.mjs:10`、`:18`、`:68` | 临时 home + 真实 daemon + loopback mock；固定三次显式写，恢复零写 | 匹配 SDK 的真实 Agent 父子通知、turn-ended、阶段单次写、重连；目前不是目标 TAPD/真实模型权限验收 |
| `tests/status-dropdown-interaction.check.cjs:1` | fake RPC 的状态 UI，无截图 | 安全分类错误、状态不确定不诱导重提；若改 UI，仅跑相关交互 |

| 验收场景（合成数据优先） | 通过条件 | 层次 |
| --- | --- | --- |
| 两项目同名方案字段，不同 key/类型 | 每次按实际项目发现；无跨项目复用；同名不猜 | handlers/tools + HTTP fixture |
| 只读、缺类型、不支持类型、权限拒绝、元数据失败、合法空表 | 返回可区分结果；不支持/明确只读零 POST；失败不伪装“字段不存在” | HTTP fixture + 后续目标部署只读核验 |
| API 返回字段但当前详情投影会丢弃 | 新 read 保留指定字段；不返回无关字段/凭据；缺失/null/空串不混淆 | contracts + HTTP fixture |
| 普通文本/真实需要的富文本/清空 | 编码往返符合已确认语义，人工段落保留；受控清空确实发空值 | fixture；部署格式另验 |
| 缺 confirmed、错项目、错 id、未发现 key、非法值 | 共享边界拒绝，零 POST；RPC 不绕过 Agent 校验 | tools + handler/RPC |
| 当前值等于新值 / 与期望旧值冲突 | unchanged 零 POST / conflict 零 POST；不覆盖他人更新 | HTTP fixture |
| POST 成功但回读不同/失败 | 不标 verified；明确已提交而未确认或结果未知；不自动重提 | HTTP fixture |
| 请求已接收后超时、缓存里是旧值、写前 GET 仍在途 | fresh 核查不能命中旧缓存或写前 pending；外部写次数不增加 | HTTP fixture |
| 评论超过 30 条、首次响应丢失 | 不以未查到证明未写；必要分页/原站核查；证据不足停在 unknown | fixture + 浏览器验收 |
| 父单状态拒绝、子单成功 | 分开报告；安全 HTTP/code/phase；不猜权限或父子限制；没有自动回滚 | HTTP fixture |
| completed/failed/canceled，正文“待验收”，自动开关旧值为 true | 普通 turn-ended 全部零 TAPD POST；Agent 通知/本地回合状态仍可用 | handler/hook + 隔离 daemon |
| 空 timeline、旧回复、多页、turnId 为空/重开复用 | 摘要对应本回合或明确未知，不能取旧成果；不触发业务完成 | SDK fixture + 隔离 daemon |
| 相同阶段重连、评论未知、成功后卡片失败 | 单一写入者先核对；不重复评论/派发；卡片恢复零业务 POST | conversation + coordinator 验收 |
| 派发 partial / 创建响应丢失 | 有 ID 时复用、无 ID 时核查现存资源；不盲重建；Bot 接到真实通知 | assignment + 真实宿主/provider |
| 字段工具缺失，已授权浏览器路径 | 同平台旧值读取、保留编辑、保存后重新读取字段；无法验证则未完成，评论不能替代 | 受控浏览器/目标平台，另行授权执行 |
| 秘密出现在上游错误、字段内容或摘要 | 模型、RPC UI、日志、卡片/存储均无秘密；仅固定安全错误；不以原文诊断 | 合成 fixture；不接触真实秘密 |

每条验收需记录代码/SDK/daemon/app/provider 基线、请求次数和最终读值。fixture 无法证明真实权限、原子更新能力或模型会选择正确工具；后续真实部署只读确认与获授权写入验收分开记录。浏览器留编辑/回读文本证据，不截图；没有作者提供且确认脱敏的图片就不生成或替换媒体。

## 交接给父 Bot 的可回写内容

### 调研子任务结果摘要（草案，尚未回写）

已独立核对 TAPD 插件源码、16 个工具注册、共享 handlers/contracts、创建/详情/状态/评论/派发调用者、现有测试、开发 SDK 与宿主源码差异。证据文档为 `docs/tapd-design-fields-research.md`，当前仅在工作区，未提交远端。

确认：已有创建字段元数据和创建 extraFields；已有单据自定义字段被详情投影丢弃，没有字段更新/回读工具。创建元数据过滤只读/未知类型，不能证明更新权限；工具读取失败有泛化 warnings，UI 元数据路径缺该区分。状态候选不是允许转移证明，成功状态卡片不是回读。自动回评把 completed 写成“已完成”评论且仍用空 timeline；不自动改状态，无评论去重。绑定幂等、派发 partial、卡片恢复不重放业务写入可复用。

建议最小补齐字段发现、单字段读、带旧值校验与 fresh 回读的更新，以及共享安全错误分类；特别处理空值、省略字段、缓存/inflight 与超时未知结果。按已确认方向停止普通回合自动评论，明确阶段继续使用现有评论工具。真实字段 key/类型/权限、现场重复评论和父状态失败根因、生产兼容与通知链仍未知。未实现、未提交/推送、未安装/重载、未读私人配置、未作真实 TAPD 写入。

### 父需求方案修订建议（保留其他已确认内容）

1. 保留并细化现有字段缺口结论：有创建元数据，但缺少项目/单据编辑语义和已有方案字段读写回读闭环。三项受控能力即可，回读内置于更新；不能用 create、comment 或筛选字段替代。
2. 保留“用户在 Bot 设置页自定义协调流程”；提示词/skill 载体继续由 Bot 项目定，不恢复前期固定薄技能的预设。
3. 保留当前父设计“普通回合只走 Agent 通知、明确阶段成果才回写”的决定，清理前期文档仍残留的“改为中性自动回评”旧候选。实施落点是停止 turn-ended 的评论副作用，阶段继续复用现有工具；阶段完成不代表验收通过，状态仍显式授权并按实际项目 key 提交。
4. 增加安全错误分类和写入恢复限定：未发送、明确拒绝、结果未知分别报告；fresh read 避开缓存/旧在途请求；评论有限列表不能证明未写；写成功而回读/卡片失败不重复提交。旧值校验不冒充原子并发控制。
5. 保留已授权同平台浏览器的临时闭环，必须读旧值、保留编辑、回读字段；不能验证则未完成。工蜂正式关联工具单独记录，不扩大本仓实现。
6. 最小验收复用现有 HTTP、Agent 工具、conversation 和隔离 daemon 接缝；明确增加字段、普通回合零写、阶段去重恢复、SDK/通知链验收。生产字段权限与现场根因继续标未知。

## 本轮验证与未测范围

- 完成只读 GitHub 任务/父需求正文和评论查询；只查看本轮工具目录；未做 GitHub 写入，也未重复验证已由父协调者确认的原生父子关联。
- 完成本地基线、定向调用者/测试/契约检索、源码行号与 SDK 声明指纹核对。前期研究为对照材料，事实逐项回到所属源码。一次宿主目录检索路径不存在，后通过 rg --files 定位实际 server/plugins/lifecycle 路径。
- 官方文档 llms.txt 读取遇到不支持的 Markdown content-type，随后读取插件 reference HTML 的工具及事件段成功；没有将在线文档当部署验证。
- 本轮仅对新增 Markdown 检查引用路径/行号范围、去敏和空白；没有功能代码变更，不运行全套或聚焦构建/测试。测试清单是阅读结果，验收矩阵全部待执行。
- 未测生产字段、API 错误码、状态流转、写权限、富文本保存规范化、原子并发条件、真实模型选择、父子通知、目标浏览器编辑或任何真实 TAPD 写入；未读取私有配置/凭据/日志，未修改其他仓库，未安装、重载、提交或推送，未捕获/生成图片。
