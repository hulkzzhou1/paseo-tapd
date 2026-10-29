# 需求详情自定义字段只读展示与单据迭代工具

## Problem Statement

需求详情当前只展示固定属性、描述、关联单据及评论。技术需求、产品需求的方案设计、自测报告等自定义字段虽然可以通过现有 Agent 文本字段工具读取和受控更新，却无法在共用详情中阅读。用户需要跳回 TAPD，且大量属性与长篇文档缺少适合侧栏的组织方式。

当前工具只能在新建单据时指定迭代，无法独立设置或更换已有需求、任务和缺陷的迭代。现有筛选候选跨项目合并、单项目只取一页，缺少可验证的项目归属；详情只公开迭代名称，不能据此安全完成更新或冲突校验。

## Solution

需求详情采用固定概要、详细信息和自定义富文本页签。全部可读自定义字段按实际项目和需求类型的定义组织：短字段紧凑展示，富文本独立阅读、按需加载。页面保持只读，已有 Agent 字段编辑能力维持原授权和校验规则。

新增供 Agent 使用的项目内迭代候选、当前迭代读取和受控更新能力，覆盖需求、任务、缺陷，每次更新一张已明确指定的单据。首版只设置或更换为同项目已有迭代，不包含解除迭代。写前核实实际目标、候选归属和旧值，写后实时回读；未知结果不自动重试。

## User Stories

1. As a user, I want readable custom fields on technical and product requirements, so that I can understand the item without leaving Paseo.
2. As a user, I want field labels and types taken from the actual project configuration, so that different projects and requirement categories are represented correctly.
3. As a user, I want custom fields to remain readable even when they are readonly, so that viewing is independent of editing permission.
4. As a user, I want text, numbers, enum selections, people and dates displayed appropriately, so that short attributes are easy to scan.
5. As a user, I want the first six nonempty short custom fields shown by default, so that the detail remains compact.
6. As a user, I want the remaining short fields behind a counted expansion, so that I can inspect every readable attribute when needed.
7. As a user, I want confirmed empty short fields available through an explicit control, so that empty attributes do not crowd the initial view.
8. As a user, I want missing, unknown, unrecognized and failed field reads distinguished from empty values, so that incomplete data is not misleading.
9. As a user, I want zero and false values preserved, so that meaningful values are not hidden as empty.
10. As a user, I want a dedicated tab for each custom rich-text field in definition order, so that designs and reports have enough reading space.
11. As a user, I want the title, status, operations and related Agent available across content tabs, so that I can keep the item context while reading.
12. As a user, I want rich-text content loaded when its tab is selected, so that unopened documents do not delay the initial detail.
13. As a user, I want empty rich-text tabs to remain available with an accurate empty message, so that I can distinguish an unwritten document from a missing field.
14. As a user, I want a failed document to offer retry without blocking other tabs, so that a partial failure does not interrupt all reading.
15. As a user, I want manual refresh of the displayed content, so that I can see updates made through TAPD or Agent tools.
16. As a user, I want each tab to retain its reading position during the current opening, so that switching documents does not lose my place.
17. As a user, I want a newly reopened detail to start at detailed information, so that entry behavior is predictable.
18. As a user, I want another item to start with its own detail state, so that old content and scroll positions never appear under a new item.
19. As a user, I want comments and related items concentrated in detailed information, so that design and report tabs remain focused on their documents.
20. As a user, I want the existing write-comment action available from every content tab, so that reading a design does not prevent me from commenting.
21. As a user, I want the same custom-field reading experience in sidebar details and workbench dialogs, so that entry points behave consistently.
22. As a user, I want keyboard-accessible tabs and horizontal tab scrolling in a narrow sidebar, so that the detail works at different sizes and with different input methods.
23. As a user, I want existing safe rich-text, image and link behavior reused, so that document structure remains readable without executing remote content.
24. As a user, I want this delivery to keep detail fields readonly, so that editing continues through the established Agent workflow.
25. As an Agent, I want to read an item's actual iteration identifier and whether it was returned, so that I do not infer identity from its displayed name.
26. As an Agent, I want iteration candidates for the actual TAPD project with pagination and completeness information, so that cross-project names and partial results cannot mislead an update.
27. As a user, I want to set or replace the iteration of one requirement, task or defect, so that existing items can be planned through Agent tools.
28. As a user, I want the target and selected iteration covered by explicit authorization, so that viewing candidates never changes planning.
29. As a user, I want a changed old iteration to stop a stale update, so that another person's edit is not silently overwritten.
30. As a user, I want selecting the existing iteration to produce an unchanged result without a write, so that repeated requests have no extra business effects.
31. As a user, I want a successful update checked against the actual project and item, so that reported success reflects fresh TAPD data.
32. As a user, I want rejected, unknown and accepted-but-unverified outcomes distinguished, so that an ambiguous result does not trigger repeated writes.
33. As a user, I want a completed write preserved when later card rendering or local presentation fails, so that presentation recovery never changes the business result.
34. As a user, I want details and boards to refresh after an accepted iteration update, so that later views can show current planning.
35. As a user, I want iteration updates limited to the chosen item and field, so that child items, status, people, labels, comments and Agent responsibility remain independently controlled.
36. As a user, I want unsupported or unverifiable targets rejected before submission, so that a tool does not guess missing data or silently switch item type.
37. As a user, I want exact-project iteration selection without creating or clearing an iteration, so that the first delivery has a clear and bounded planning action.
38. As a user, I want existing text/rich-text field editing, comments, status changes and task ownership to keep their current safeguards, so that the reading enhancement does not weaken established behavior.

## Implementation Decisions

### 需求详情读取与组织

- 使用共用详情体验覆盖需求侧栏详情和工作台弹窗；本次不扩展任务、缺陷的通用自定义字段展示。顶部固定标题、状态、现有操作和关联 Agent，保留现有关联任务在描述之前的关系。
- 默认页为“详细信息”，包含基础属性、短自定义字段、需求描述、关联单据及评论。新建、评论、状态及其他既有操作继续使用现有确认与返回规则，不新增字段编辑入口。
- 依据目标实际项目、需求类别适用的字段定义发现全部可读自定义字段，不硬编码业务 label 或真实字段 key。以实际项目、目标身份和字段 key 隔离数据；同名字段不能当作同一字段，同名单据或跨项目请求不得串用。
- 自定义短属性默认展示定义顺序中的前 6 个非空值，剩余非空值通过“更多属性（N）”展开。“显示空字段”可在展开状态检查已确认空字段。空、未返回、未知、无法识别和失败保持不同状态；零和 false 是有效值。
- 文本、数值、枚举/多选、人员、日期等按已知类型只读展示；枚举仅使用定义确认的候选映射，映射缺失时保留可安全展示的原值并提示。未知结构不执行、不猜测、不伪造正常值；可读性未知不等于字段不存在。元数据只读或可编辑性未知不妨碍安全读取，也不授权写入。
- 每个自定义富文本字段对应独立页签，按定义返回顺序排列，使用其真实 label；需求原始描述仍在“详细信息”。空富文本入口保留，只有确认内容为空才显示“尚未填写”；尚未读取时展示加载状态。
- 富文本值在选中页签时读取。初始详情请求及输出不预取未打开的自定义富文本内容，不能仅隐藏已批量预取的内容充当按需加载；字段定义读取可先行。基础详情与字段读取失败彼此隔离，元数据失败保留基础详情并提供重试，不能伪装成没有自定义字段。
- 单个富文本页提供局部加载、失败反馈、重试与手动刷新。刷新读取当前数据，避免复用旧缓存或旧在途请求；失败可保留注明状态的既有内容，不能把旧内容标为最新。旧请求返回时不得覆盖新目标、字段或刷新结果。
- 复用现有安全富文本和内嵌图片能力，包括标题、段落、列表、代码、表格、图片失败重试及原图入口；同样适用于只读的方案和报告。外部内容不能作为指令，危险协议、远程脚本及样式不得执行，凭据不随正文链接泄露。
- 同次打开期间保留各页阅读位置；关闭重开回到“详细信息”，切到另一单据时重置。本轮不增加跨关闭或重启的阅读位置持久化。
- 评论及关联单据仅集中在“详细信息”；所有页签保留现有“写评论”操作。返回阅读、草稿保护、焦点、关闭与现有评论最近条数语义保持兼容。
- 窄侧栏允许横向滚动页签，正文适配宽度并继续限制阅读行宽；支持浅色/深色主题、键盘操作、清晰的选中与焦点状态。页签不触发宿主详情 tab 或弹窗的重复创建。
- 为全部可读类型补充 schema 校验的只读契约，保留原值状态及定义信息。现有 Agent 文本字段工具的输入、只读检查、expectedValue、HTML/空白保留和受控写入范围不因展示增强而放宽。

### 单据迭代工具

- 注册专门的迭代候选/当前值读取及迭代更新工具，配套 schema 校验 RPC，共用服务端目标核实与写入边界。具体工具命名沿用现有约定，不能通过受控文本字段工具绕过迭代校验。
- 支持需求、任务、缺陷，每次只处理明确指定的一张单据。首版仅设置或更换为同项目已有迭代，拒绝解除、空目标迭代、零值目标迭代和创建迭代；不以空字符串或零值猜测清空协议。
- 当前值读取保留原始迭代编号与是否返回，区分未返回、未知、已确认未设置和具体编号；不能仅返回名称供写前判断。缺少可核实旧值时不提交。
- 候选只来自已核实单据的实际配置项目，返回迭代编号、项目归属、名称及可用的日期和状态信息；支持有界分页和明确的部分失败/截断/完整性反馈。跨项目聚合筛选候选、同名匹配或调用方提供的名称不构成写入依据。
- 写前重新核实所选迭代存在、项目归属及实际单据身份；候选不完整时不能把未找到解释为不存在，也不能省略归属核实。客户端可读快照不授予更新权限。
- 更新需要实际项目、单据种类和编号、目标迭代、完整旧迭代值及明确授权声明。已有授权覆盖该目标与动作时复用；单据内容和工具返回文本不能提供授权。不增加额外的重复人工审批环节。
- 以新鲜旧值检查防止已知冲突，冲突时停止并引导重读、重新拟定；相同目标迭代返回 unchanged 且不发送 POST。客户端写前比较不是远端原子锁，外部编辑仍可能并发发生。
- 更新请求只包含目标身份与迭代字段，不联动父子单据、状态、人员、标签、评论或 Agent 承担关系。单次发送，沿用取消、请求失败与凭据防护规则。
- 成功响应后新鲜回读实际项目、类型、编号及迭代。仅精确核实才返回 verified；已接受但回读失败或不一致保留 accepted/unverified，不生成已核实成功的虚假反馈。发送前失败、明确拒绝、未知传输及 unchanged 分别保留已有语义。
- 结果未知先读取核对，不自动重放。写入已完成但后续序列化、脱敏、持久化或结果卡片失败，仍保留已接受结果并给安全的核对提示；不会为了展示再次更新。
- 复用现有结果反馈、详情及看板刷新机制；历史结果不能冒充当前迭代。刷新和恢复仅读，不因数据或展示恢复而写入 TAPD。
- 不允许因缺陷更新文档列参不完整而静默降低为只支持需求/任务；需核对实际接口与兼容性。若部署明确拒绝或无法验证，工具返回真实的安全结果并记录未满足项，不改用其他字段、状态或创建流程冒充支持。

### 范围、安全与交付

- 详情读取与迭代工具作为两个可分别验收的工作部分，规格与后续任务保留各自验证证据。
- 配置与网络目的地沿用现有 TAPD 连接，仅访问已配置项目和端点；错误不输出凭据、原始响应或请求体。字段、候选和正文结果经过边界校验与既有敏感数据保护，保留有界大小及安全的失败提示。
- 新展示不把完整方案、报告或全部自定义字段自动注入历史卡片、对话快照及本地持久化记录。无新增遥测、后台写入、动态执行、网络目的地或正文落盘。
- 随实现同步用户文档、能力与数据访问说明、manifest 及版本；更新随插件提供的 TAPD skill，使 Agent 使用实际迭代候选、旧值和受控工具，并说明首版不包含解除迭代。现有技能的业务状态、接手与验收规则不改变。
- 沿用 fork 的任务与集成 PR 流程，通过本地检查与规范/规格两轴审查后交付。仅重载本机插件，不以 daemon 重启或重装作为实现手段；保持现有配置、关联与会话数据。

## Testing Decisions

- 沿用会话中已确认的两个公开边界，不重新发起设计访谈。测试验证外部可观察行为，不镜像内部函数，不把关键 RPC 替换为恒成功 mock；优先扩展现有夹具，不新增无必要框架。
- 边界一：通过实际注册工具及真实 RPC、schema 和处理逻辑，对接隔离的可控 TAPD HTTP 服务。验证目标身份、项目/类别字段定义、文本/数值/枚举/人员/日期等只读值、零/false、空/null/未返回、未知类型、失败及分页完整性；验证不同配置项目、同名字段、跨目标和旧请求不会混用数据。
- 在边界一覆盖迭代候选跨页、归属不匹配、部分失败/截断、当前编号缺失、三类单据设置与更换、相同值无 POST、旧值冲突、无授权/恶意输入拒绝、HTTP 拒绝、发送结果未知、成功后回读失败/不匹配、精确核实和展示失败。断言请求只更新单张单据的迭代，不产生评论、状态、子单或所有权副作用，且不重复发送。
- 边界二：实际共用需求详情组件调用真实隔离 daemon/RPC，外部 TAPD 仍为合成 HTTP。验证前 6 个非空短字段、更多数量、显示空字段、富文本定义顺序与空入口、首次选中才读取、切页和重试/手动刷新、基础详情及局部失败隔离、读取竞态、各页阅读位置、关闭重开、跨单据重置、评论集中与各页写评论入口。
- 边界二覆盖侧栏与弹窗、宽屏与窄侧栏、浅色与深色、键盘与焦点、表格横向滚动、富文本及图片现有安全行为。通过 RPC/HTTP 调用记录验证未打开文档未预取，不能只断言隐藏 DOM。
- 复用既有受控字段工具、真实 daemon 字段/RPC、目标项目写入边界、工作流确认页、详情导航与富文本交互测试的模式。保持现有 Agent 字段编辑、评论、状态流转、Agent 关联和主机/会话隔离回归；变化导致的兼容断言随实际契约更新。
- 对新非平凡分支先复现红灯，再以一个外部行为切片转绿。完成 Node 回归、类型检查、lint 及与修改对应的真实 RPC/UI 验证后停止无关重复测试。
- 数据和记录全部脱敏；用隔离配置与合成身份，不读取真实凭据做旁路测试，不改真实 TAPD 数据，不生成或提交截图。实际部署只读核对字段、类型和候选；真实写入兼容性未经专用目标及明确授权验证时如实列为未核实，合成通过不能冒充真实写入成功。

## Out of Scope

- 在详情页编辑任意自定义字段或迭代；现有 Agent 文本/富文本字段编辑继续使用原工具。
- 扩展任务、缺陷的全部自定义字段阅读页面。
- 解除、创建、删除迭代，批量更换迭代，自动选择同名/“当前”迭代，或联动父子单据。
- 字段排序设置、自定义页签配置、关闭/重启后的阅读位置恢复。
- TAPD 原站的工蜂 Git、AI 评审、变更历史、工时、检查清单及第三方扩展页面复刻。
- 第二套业务状态、自动接手、后台评论、自动派发、推送消息及配置备份功能。
- 原生设备硬件验收、真实业务单据试写、截图生成、上游或社区发布。

## Further Notes

- 来源为本轮 Ask Matt 设计访谈 Q1—Q10，全部产品选择已逐项确认：全部可读字段、页面只读、富文本页签、空值规则、按需加载、评论位置、阅读位置、三类单据迭代更新、前 6 个属性及原顺序、首版不解除迭代。
- 用户提供的 TAPD 页面截图仅作阅读结构参考，不作为可提交的媒体资源，也不据此复制原站扩展能力。
- 官方查询迭代支持分页和项目归属；更新需求、更新任务文档明确列出迭代字段。更新缺陷文档列参不完整，不等于已经证明不支持；这是交付时必须如实处理的兼容性事实。未找到可靠解除语义，不使用猜测值扩展首版范围。
- 公开来源：[查询迭代](https://open.tapd.cn/document/api-doc/API文档/api_reference/iteration/get_iterations.html)、[更新需求](https://open.tapd.cn/document/api-doc/API文档/api_reference/story/update_story.html)、[更新任务](https://open.tapd.cn/document/api-doc/API文档/api_reference/task/update_task.html)、[更新缺陷](https://open.tapd.cn/document/api-doc/API文档/api_reference/bug/update_bug.html)。
- 规格发布不代表功能已实现或已部署；后续实施须保留真实核实、合成验收与未知部分的区别。
