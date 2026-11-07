---
description: "Agent 在界面里的身份：回复头像、侧边栏印记与名字。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-avatar

[English](README.md) | 中文

## 概述

本包给 Agent 一个界面身份：每条助手回复旁的头像，以及侧边栏品牌行里的印记与名字。这些席位分别由 Chat 与侧边栏声明，且各自在空置时渲染自己的回退，因此移除本行即恢复外壳的鱼形标记、本地构建标签与整宽回复，不影响消息内容、会话数据或任何模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 组合已把本插件与其他 Chat 行一起挂载。这里没有设置项，也没有插件页开关：这一行就是唯一的开关，身份随包提供。

### 三个席位

| 席位 | 渲染内容 |
| --- | --- |
| `conversation.chat.assistant.before` | 助手回复正文之前、左侧槽位里的头像。 |
| `sidebar.brand.mark` | 同一张图稿作为侧边栏品牌标记，尺寸由侧边栏给定（24px）。 |
| `sidebar.brand.name` | 标记旁的名字，沿用品牌行自身的 18px/600 排版。 |

### 更换身份

把你的图片替换掉随包的[图稿](src/client/assets/avatar.svg)，然后重新构建本包。客户端构建支持 `.svg`、`.png`、`.webp`、`.jpg`、`.jpeg` 这些资产格式；它会把文件以内容修订名写入 `lib/assets/`，并把 import 编译为 asset 路由提供的文档相对 URL。名字在 [`src/client/AgentIdentityName.tsx`](src/client/AgentIdentityName.tsx) 的 `AGENT_NAME`。若要用另一套身份，应让另一个占用者接管席位——这里每个席位都只容纳一个占用者，替代是替换本行而不是与本行并列。

### 哪些回复带头像

回复席位对每个回复正文渲染一次。折叠的轮次会把它的过程片段以 `groupPart: 'reasoning'` 传入，这些片段不显示头像，于是一轮里头像是出现在回复旁边而不是叙述旁边。`final` 表示该正文是否为该轮的最终回复，`step` 表示它在轮内的助手步号，因此其他占用者可以不改 Chat 就采用不同的规则。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Chat 的 assistant-step 渲染器声明 `conversation.chat.assistant.before`，并在回复正文之前渲染一个固定 28px 宽的槽位；侧边栏在品牌行里声明 `sidebar.brand.mark` 与 `sidebar.brand.name`。空席位不渲染任何元素，所以空置的槽位不占宽度，空置的品牌位保留外壳的鱼形标记与本地构建标签。本包通过 `ctx.slots.inject()` 注册这三个席位，因此无论本行在声明者之前还是之后激活都能工作，并随声明一并撤回，HMR 期间不会留下残缺的身份。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空的 Loader 席位。两处界面共用同一张图稿：客户端预设把它输出到 `lib/assets/`，并把每处 import 改写成客户端模块加载器解析的 `require.asset()` 引用。图稿是宣纸底配墨色鲸，因此明暗主题下都站得住，不需要按主题另做一份。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-chat](../ui-chat/README.zh.md)——声明 `conversation.chat.assistant.before` 席位并围绕它渲染回复槽位。
- [ui-sidebar](../ui-sidebar/README.zh.md)——声明并渲染品牌行的标记与名字席位。
- [ui-brand-official](../ui-brand-official/README.zh.md)——官方构建 profile 下同一批侧边栏席位的随包占用者。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载、注册 slot 并发布包内资产。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **每个席位只容纳一个占用者**——替代的头像、标记或名字是替换本行；三个席位都不会同时渲染两个占用者。
- **身份在构建期固定**——换图或改名都需要改包并重新构建，因为不存在运行时的身份设置。
- **侧边栏的版本行让位给名字**——外壳的本地构建回退还会显示构建版本并在点击时复制它；占住名字席位后这行显示就没有了。
- **槽位几何固定**——28px 列宽来自 Chat 外壳，24px 标记尺寸来自本包样式表，两者都不跟随用户偏好。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
