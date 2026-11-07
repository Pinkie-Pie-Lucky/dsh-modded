# 魔改版 DeepSeek Harness（本地自由版）

基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的个人魔改版，面向本地自用：**更自由、限制更少、无遥测、不绑账号**。

## 相对官方改了什么

### 行为默认值

改动集中在 [`packages/bundle/base/cordis.patch.yml`](packages/bundle/base/cordis.patch.yml)（改的是所有 profile 共享的默认值，因此默认启动即魔改版，无官方/魔改并存问题）：

| 改动 | 效果 |
|------|------|
| 文件沙箱默认 `danger-full-access` | 不再限制文件写入，任意路径可改 |
| 审批策略改为 `never` | 不再弹出审批确认 |
| 关闭遥测 `otel` | 不向 deepseeksvc.com 上报 |
| 关闭遥测 `session-telemetry-otel` | 同上 |
| 关闭 DeepSeek 账号平台 | 不要求账号登录 |
| 关闭账号登录适配器 | 仅用 API key 接入 |

### 本地身份（阿墨）

界面上的「谁在跟你说话」也改成了本地的：

- [`packages/client/ui-chat`](packages/client/ui-chat) 新增助手回复的左侧槽位 `conversation.chat.assistant.before`；空置时不占位，因此不装身份包就和官方一致。
- 新包 [`packages/client/ui-agent-avatar`](packages/client/ui-agent-avatar) 占用三个席位：回复头像、侧边栏品牌标记、侧边栏品牌名字。图稿是包内的 [`avatar.svg`](packages/client/ui-agent-avatar/src/client/assets/avatar.svg)（宣纸底＋墨色鲸），名字是 `AgentIdentityName.tsx` 里的 `AGENT_NAME`（阿墨）。
- 该行在 [`packages/bundle/web-app/cordis.patch.yml`](packages/bundle/web-app/cordis.patch.yml) 的 `ui-agent-avatar` 处；删掉这一行就退回官方的鱼形标记与「本地构建」标签。
- 注意：占住侧边栏品牌名字位后，外壳原本那行「本地构建 + commit 版本」的显示与点击复制会一并让位。

改动已用 git 提交，`git log` 可查完整记录。

## 构建

要求 Node.js >= 24.9.0、pnpm 11.x。

```sh
corepack enable        # 启用 pnpm
pnpm install
pnpm run build
```

国内网络建议先切换镜像：

```sh
pnpm config set registry https://registry.npmmirror.com/
```

## 运行（与官方版隔离并存）

```powershell
# Windows PowerShell，在仓库根目录
.\run-modded.ps1                 # 浏览器界面
.\run-modded.ps1 -Mode headless  # 纯命令行
```

- 默认家目录为 `U:\modded-home`，可用 `-HomeDir` 参数自定义；
- 会话、设置、凭据都存这里，与官方版的 `~/.dsh` 完全隔离，两版可同时运行、互不干扰；
- 模型接入：设置环境变量 `DEEPSEEK_API_KEY` 即可，无需账号登录。

## 许可

继承上游 [MIT](LICENSE) 许可。
