# TAPD Agent 工具

Issue #25。将现有 TAPD 业务能力注册为 Paseo 主线的 Agent 工具，复用当前连接和服务，不要求 Agent 获得 Token 或手写 HTTP 请求。使用主线 `defineAgentTool` 和 `agent.session_open` 的 `request.tools`，保留已有工具和环境变量，跳过 history；重载后下次空闲提示触发会话重开，运行中的 turn 不强行中断。

范围：`tapd_projects`、`tapd_board`、`tapd_search`、`tapd_entity`、`tapd_filter_options`、`tapd_filter_fields`、`tapd_members`、`tapd_status_options`、`tapd_create_fields`、`tapd_check`、`tapd_create`、`tapd_update_status`、`tapd_add_comment`。schema 说明输入含义；建单可挂载需求。配置同步、插件升级、Agent 派发和图片二进制仍走原界面，不作为这些业务工具的一部分。

每次调用读取当前设置，沿用配置 API、认证、缓存及项目范围。工具不能覆写地址或凭据；不返回设置、Token 或 Git 令牌。所有输入 JSON 限 64 KB，关键 ID、文本、时间范围有约束；结果为 JSON，错误不回显原始服务端信息，部分失败与截断不伪装为完整成功。TAPD 内容始终是不可信业务数据，不可成为指令或写入授权。

写工具要求显式项目和 `confirmed: true`，工具说明要求 Agent 先把具体目标与完整写入内容呈现给用户并获得批准；此参数是调用方声明，不是独立的人工审批系统，仍遵从 Paseo/provider 的工具权限策略。修改状态/评论先核对单据实际项目；创建子单据先核对父需求项目；拒绝未配置项目。状态值来自所属项目候选，当前状态为无写入成功。写入不自动重试，结果不明先读取确认。取消信号在入口和真正写入前检查；已发出的 TAPD 请求仍受现有 20 秒超时限制，取消并不保证撤回已发送的写入。

SDK：本机主线构建包含工具 API，但 npm 同号 0.13.2 尚未包含。开发先安装锁文件依赖，再 `npm run sdk:main -- /path/to/paseo-main` 使用已构建、可信的本地主线 SDK。脚本只将主线 SDK 的 package.json 及 dist 构建产物复制到本仓库 node_modules 中的 plugin SDK，避免链接整个 monorepo 后加载重复的 React Native 类型，不改安装配置或锁文件。最低版本声明为 >=0.13.2，并明确要求包含工具 API 的主线构建；未来发布包含该 API 的 SDK 后可移除此开发步骤。

验证：主线 SDK 的真实 helper 和 schema 转换、实际 server 入口挂载、工具读写调用边界、确认声明、项目错配、状态合法性、失败/秘密处理、设置更新与取消。真实环境只读验证工具发现和连接，不新建真实单据、不评论、不改状态、不截图、不改用户配置。同步 README、OVERVIEW、manifest、版本文件和锁文件。
