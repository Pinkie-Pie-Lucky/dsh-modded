---
description: "ctx.web 的 Bing 结果页搜索提供方：部署方如何挂载免密钥的 HTML 搜索——抓取并解析 Bing 公开结果页、它会报告什么，以及它无法保证什么。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-bing

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-bing`，harness 通过 Bing 公开结果页检索 web：提供方从本机抓取该页面，把其中的 `li.b_algo` 结果块归约为标题、URL、摘要与日期，并且只报告页面确实包含的内容。当部署没有可用的搜索 API、且能接受以第三方 HTML 作为来源时选择它。它绝不编造——无法归约的页面以失败告终，而不是产出结果——也绝不执行任何东西：不运行 JavaScript、不带 Cookie、不把标记中的文字当作指令。一次搜索就是一次有界的 HTTP GET，注册为 `bing` 搜索提供方。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已加载 web 服务的组合中挂载本提供方；它以 `bing` 搜索提供方身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——也可以用 `searchProvider: bing` 固定。只要还有另一个可用的搜索提供方，就请显式固定：存在两个可用提供方时，seam 会报告 `WEB_PROVIDER_AMBIGUOUS`，而不是自行选择。

### 何时选择

当部署没有可用的搜索 API、且能接受把 Bing 公开结果页作为唯一结果来源时选择此后端。它完全不需要凭据，因此在拿不到 API 密钥的环境里同样可用。当结果的完整度、可用性或稳定性比「能搜到」更重要时避免使用它：提供方依赖一个它无法控制的页面，[已知限制与延期工作](#known-limitations-and-deferred-work)中的每一条限制都源自这一依赖。

### 最小配置

加载 web 服务与本提供方。端点默认为 `https://cn.bing.com/search`；在 `www.bing.com` 会以跨域重定向答复的机器上，这个区域主机直接返回结果。请把 `searchURL` 指向该部署环境中能直接答复的结果主机。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: bing
- name: '@deepseek-ai/dsh-web-search-bing'
  config:
    searchURL: https://cn.bing.com/search
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `searchURL` | `https://cn.bing.com/search` | 绝对结果页 URL；`q`、可选的 `mkt` 与 `count` 提示会合并进它已有的参数。不是绝对 HTTP(S) URL 的值会让挂载失败 |
| `timeoutMs` | `30000` | 单次搜索的正数毫秒期限，须在 Node 定时器范围内；超时以 `WEB_SEARCH_TIMEOUT` 失败 |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | 每次请求发送的 `User-Agent` 标头。默认值是有意选择的：实测该端点对它与浏览器 UA 返回同样的结果 |
| `market` | 未设置 | Bing 市场（`mkt`）参数，例如 `en-US`；不设置则不发送，空值等同于不设置 |

### 搜索返回什么

`content` 始终省略：本提供方没有答案文本，也不会合成一段。`sources[]` 来自页面的 `li.b_algo` 块——`title` 取自块内标题，`url` 取自该标题的锚点，`snippet` 取自摘要段落，`publishedAt` 取自 Bing 印在摘要前的日期戳，并按页面给出的精度渲染为日期级 ISO-8601。标题不带绝对 HTTP(S) 链接的结果块会被丢弃，重复项只报告一次；`maxResults` 被应用两次：请求层的 `count` 提示，以及服务在返回路径上的截断。

### 失败与恢复

失败是携带可按机器路由 code 的 `WebError`。调用方取消为 `WEB_ABORTED`，提供方自身的期限为 `WEB_SEARCH_TIMEOUT`；非 2xx 应答、不可用页面，以及不产出任何结果的页面都是 `WEB_PROVIDER_ERROR`。不产出结果的页面绝不会被变成结果：消息说明它没有观察到可识别的 Bing 结果块，给出它看到的状态码与长度，并在页面带有验证标记时指出该标记，因为在提供方看来「查询没有结果」与「页面结构改变」长得一样。会离开所配置 origin 的重定向会被拒绝，并指出它指向的 origin，因此搜索绝不会跟随端点离开部署所选定的位置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本提供方建立在三项承诺之上：

- **只报告，绝不编造。** 只有页面确实携带的字段才会成为来源。标题缺少可用链接的结果块会被跳过，而不是用块内的展示域名补上；解析器无法归约的页面会带着所观察到的事实失败，而不是返回一个空的成功。
- **标记即数据。** 抓回的正文既不执行也不当作指令阅读：内联脚本与样式在任何候选文本被检视之前就被丢弃，页面里没有任何东西能改变提供方接下来的行为。
- **传输属于本机，而不属于本包。** 请求走进程级 `fetch`，由它解析 `@deepseek-ai/dsh-http-proxy` 安装的 dispatcher，因此配置的代理无需此处任何代码即可生效。由于只导入仓库内工作区包、不导入任何第三方模块，除 harness 自身外本插件没有运行时依赖。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Config schema、挂载期校验与提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `BingSearchProvider`：URL 构造、有界 GET、重定向策略、页面大小上限与错误分类 |
| [`src/parse.ts`](src/parse.ts) | 页面标记的纯归约：非内容剔除、实体解码、结果块扫描与日期戳 |

### 请求流程

一次搜索先捕获已解析的选项，把 `q`、可选的 `mkt` 与钳制后的 `count` 合并进配置的页面 URL，再用融合后的期限信号发出一次 GET。同源重定向会在跳数上限内跟随，跨域重定向会被拒绝；声明的超上限 `Content-Length` 在读取正文前即被拒绝，未声明却超上限的正文会在上限处截断。正文随后交给纯解析器：剔除非内容、扫描配平的 `li.b_algo` 块，并把每块归约为来源字段。零来源会以说明所观察到事实的失败告终，而不是空结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入服务与面向模型的工具。

- [web 子系统](../../../docs/subsystems/web.zh.md)——穷尽式的搜索请求／结果词汇与错误码。
- [web 包映射](../README.zh.md)——Web 包家族与各角色。
- [dsh-web](../web/README.zh.md)——本提供方注册进入的 web 服务，含其提供方选择规则。
- [dsh-tool-web](../tool-web/README.zh.md)——渲染本提供方来源的面向模型 `web_search` 工具。
- [dsh-web-fetch-http](../web-fetch-http/README.zh.md)——本提供方沿用其有界 HTTP 约定的同族后端。
- [web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——搜索与抓取为何共用一项提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

### 间接的会话工具结果

#### 模型看到的内容

通过 `dsh-tool-web`，会话模型会看到每个来源的 URL、标题、摘要与日期，以及本提供方的确切失败消息：包括 `Bing search timed out`、`Bing search aborted`、`Bing search <url> answered HTTP <status>`、HTTP 429 与 403 追加的限流措辞、说明状态码、长度与所发现验证标记的无结果失败，以及跨域重定向拒绝。错误包装与不可信内容提示属于消费方。

#### Token 影响

注册不会直接产生会话 token。结果 token 随返回来源及其摘要增长，服务会在工具渲染之前把 `sources[]` 截断到请求的 `maxResults`。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 抓取的页面标记

#### 模型看到的内容

页面本身的内容不会进入模型。原始标记从不进入模型请求：只有归约后的来源字段会进入，且内联脚本、样式与注释在任何文本被检视之前就被丢弃。因此，看起来像指令的页面文字只是模型可能读到的摘要数据，绝不是提供方据此行动的东西。

#### Token 影响

不会转发任何页面字节，只有归约后的字段计入；因此当 130 KB 与 90 KB 的页面产出相同来源时，两者的成本相同。

#### KV Cache 影响

其自身没有额外影响：归约发生在工具结果写入之前，因此缓存行为就是该工具结果本来的行为。

### 会话工具列表（间接）

#### 模型看到的内容

本包不会直接贡献任何内容。提供方不声明 `ready()`，因此 seam 视其就绪，`dsh-tool-web` 继续以自身的 schema 与提示词说明提供 `web_search`；本插件不贡献任何提示词段落，也不贡献自己的工具定义。

#### Token 影响

零：注册提供方不会给请求增加 schema 或说明文本。

#### KV Cache 影响

无：挂载本提供方不会改变声明的工具集。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明提供方在哪些情况下不完整或不可用。它们是当前包约束，每条都由实测得出或由其工作方式直接推出。

- **结果来源是本包无法控制的页面**——Bing 随时可能改变其标记，而结构改变会以 `WEB_PROVIDER_ERROR` 失败，不会降级为部分结果。
- **只读取第一页结果**——在每一次实测查询中，该端点都没有兑现 `count` 提示，未能兑现时服务只能截断已返回的内容，因此请求更多结果不会去抓第二页。
- **限流与人工校验只会被报告，不会被绕过**——出现验证页或 429 时搜索即失败；提供方不发送 Cookie、不解验证、也不重试。
- **结果随地区、语言与会话状态变化**——实测中同一查询在不同市场返回不同结果；`market` 用于选择 `mkt` 参数，提供方不发送 Cookie 或登录态。
- **`publishedAt` 只有天级精度且常常缺失**——它取自 Bing 印在摘要前的日期戳，没有该戳的页面产出的来源就没有日期；Bing 显示的展示域名在来源结构中并无对应字段，因此不会与 URL 分开报告。
- **`summary` 从不设置**——来源结构中较长的摘要不会被填充，因为页面只提供所见的那一段摘要。
- **一次搜索只抓一个页面，且没有排序信号**——提供方按页面顺序报告、不重新排序、仅按 URL 去重，也无法合并多个页面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文和相关 Agent Note 为准。

#### 新包仍需补齐的生成产物

[`tests/fixtures/`](tests/fixtures/bing-deepseek-harness.html) 下记录的夹取样本固定为撰写时的实时页面，由 [`tests/fixtures/refresh-fixture.ts`](tests/fixtures/refresh-fixture.ts) 重新录制，该文件是手动工具，不属于任何套件。仓库的生成目录（`tsconfig.base.json` 的别名区、配置目录以及文档图）只有在运行各自的生成器后才会包含本包，因此在补齐之前，profile 层必须通过其他途径解析本包。

</details>
