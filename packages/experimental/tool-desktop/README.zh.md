---
description: "Windows 桌面工具：窗口枚举、屏幕截图、鼠标与键盘输入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-desktop

[English](README.md) | 中文

## 概述

本包为 Windows 宿主提供七个面向模型的桌面工具：枚举可见窗口、截取屏幕或单个窗口、激活窗口、移动鼠标、点击、输入文本、发送快捷键。每个工具都通过一个全新的 PowerShell 进程驱动宿主自身的桌面会话，其中窗口遍历与输入注入在编译后的 C# 辅助代码里执行。非 Windows 宿主不注册任何工具。

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

在应当拥有这些工具的 profile 里挂载这一行即可。不需要其它配置：本包不提供服务、没有浏览器半部，也没有配置项。

```yaml
- insert:
    - id: tool-desktop
      name: '@deepseek-ai/dsh-tool-desktop'
```

| 工具 | 动作 |
| --- | --- |
| `desktop_windows` | 枚举可见顶层窗口：句柄、进程、标题、几何位置、是否前台与是否最小化。只读。 |
| `desktop_screenshot` | 截取整个虚拟屏或单个窗口，连同像素映射一起返回图片。只读。 |
| `desktop_find` | 通过 UI Automation 在窗口内查找控件，返回每个匹配项的矩形与可用模式。只读。 |
| `desktop_invoke` | 通过 UI Automation 直接操作某个控件（调用、设值/读值、切换、选中、展开、折叠、滚入视野），**不抢前台**。 |
| `desktop_focus` | 把某个窗口带到前台，最小化时先还原。 |
| `desktop_move` | 把鼠标移到绝对屏幕坐标，不按键。 |
| `desktop_click` | 移到绝对坐标并点击（左/右/中键，单击或双击）。 |
| `desktop_type` | 向**指定的**窗口输入文本，支持中文等 Unicode，且不占用剪贴板。 |
| `desktop_keys` | 向**指定的**窗口发送一个组合键，例如 `ctrl+s`、`alt+f4`、`enter`。 |

这些工具是「手」，不是「判断」。它们无法区分个人事务与公司事务：那条边界由围绕它们的使用约定负责，而工具描述里带上了两条最要紧的规则——不可撤销的点击或按键之前先用新截图确认目标；凡是提交、发送、删除或关闭的动作，先问用户。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次调用都会以 `-EncodedCommand`（base64 UTF-16LE）启动一个 PowerShell 进程，因此引号与控制台代码页都无法破坏脚本；结果以 UTF-8 文件回传，由 Node 侧读取——这正是非 ASCII 窗口标题能保持正确的原因。`powerShellExecutable()` 优先使用 `pwsh.exe`，缺失时回落到系统自带的 `powershell.exe`。

窗口遍历与标题匹配都在编译后的 C# 辅助代码里执行，而不是写在 PowerShell 的 scriptblock 里。scriptblock 转换成委托后运行在调用方变量之外，于是"在回调里收集"会静默返回空列表——本包开发期间就踩到了这个坑，改把回调放进 C# 才稳定。

输入注入用 `SendInput` 配 `KEYEVENTF_UNICODE` 完成文本输入，命名按键用 `keybd_event`：Unicode 通道无需剪贴板往返即可发送中文与 emoji，也不需要单线程单元（STA）宿主。截图默认 1:1，并回报被截矩形与缩放比例，因此图上的点可以换算回屏幕像素；整屏截图过大时可用 `max_width` 缩小。截图 PNG 通过附件服务存储，其临时文件无论存储是否接受都会被释放。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具](../../../docs/subsystems/tools.zh.md)——工具流水线、定义与面向模型的 schema 投影。
- [computer-use](../../computer-use/computer-use/README.zh.md)——随产品提供的 macOS 实现所用的提供方注册表；本包不走它，而是直接驱动 Windows。
- [文件系统](../../fs/tool-fs/README.zh.md)——`read_image` 的同族来源；截图工具沿用了它"附件 + 图片块"的结果形状。

-----

<a id="model-experience"></a>
## 模型体验

### Desktop tools

#### What the model sees

八个固定 schema 的工具定义：`desktop_windows`（可选 `title_contains`）、`desktop_screenshot`（`window`、`max_width`）、`desktop_find`（`window`、`name`、`class_name`、`control_type`、`automation_id`、`limit`）、`desktop_focus`（`window`）、`desktop_move`（`x`、`y`）、`desktop_click`（`window`、`x`、`y`、`button`、`count`）、`desktop_type`（`window`、`text`）、`desktop_keys`（`window`、`keys`）。描述里写明了坐标空间、截图会自带原点与缩放比例、键盘输入必须指定窗口，以及两条安全规则：不可撤销的动作之前先用新截图确认目标；凡是提交、发送、删除或关闭的动作都先问用户。

#### Token effect

只要这些工具可见，每个请求都承担固定的 schema 成本。除截图外结果都很小；截图会额外带来一段文本信封与一个图片块，图片 token 随截取面积增长，因此 `max_width` 是这道成本的闸门。

#### KV Cache effect

定义与可见性不变时前缀稳定。注册本包、卸载它，或改变哪些 preset 能看到这些工具，都会改变工具集合，从而影响此后的复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限 Windows**——其它平台宿主不注册任何工具；随产品提供的 Computer Use 实现覆盖的是 macOS。
- **坐标是"盲"的**——工具操作的是绝对屏幕像素，因此截图与点击之间界面一变，点击就会落到别处。动作前应当立刻重新截图。
- **没有元素级定位**——本包不遍历 UI Automation 树，点击无法定位到具名控件；何况 Electron 应用（例如聊天客户端）本就几乎不暴露那棵树。
- **坐标是物理像素**——每个脚本在第一次窗口调用前就把进程设为 DPI 感知，因此窗口矩形、光标位置与截图在显示缩放下共用同一套坐标。150% 缩放的宿主上，不感知 DPI 的调用方看到 1707×1067，而这些工具看到 2560×1600，所以别处取来的坐标会落到别的位置。坐标请一律取自 `desktop_windows`。
- **截图拍的是屏幕，不是窗口内容**——被遮挡的窗口就拍到遮挡物，因此截图辅助会先把目标带到前台。窗口若在读取矩形与拷贝之间被关闭，会报"矩形为空"，而不是返回一张过期的图。
- **键盘输入必须指定窗口**——`desktop_type` 与 `desktop_keys` 都要求给出目标窗口，先把带到前台、校验它确实在前台，然后才注入。焦点**不会**在工具调用之间延续：用户可能在这期间切换窗口，而打进别人窗口的文字收不回来。
- **控件查找取决于目标应用的提供方**——`desktop_find` 读的是 UI Automation 树，而它的质量随应用而异：经典 Win32 控件常常没有可访问名称、也没有可用的模式（记事本的编辑控件只暴露类名，模式列表为空），现代框架则通常既有名称也有自动化 id。名称为空时改用类名或控件类型匹配；匹配到的矩形应当作为 `desktop_click` 的输入，而不是去调用它的模式。另外，部分提供方按需构建这棵树，因此**直接按窗口句柄查询**比遍历某个进程的所有窗口可靠。
- **操作控件可能把窗口抬到前台**——`desktop_invoke` 不需要坐标、不移动鼠标、能够到滚出视野的控件，而且目标窗口**不必已经在前台**，动作也能成功。但两次实测都显示它会把窗口带到前台：`invoke` 作用于计算器（UWP 应用）、`set_value` 作用于经典 Win32 编辑控件；而只读的 `desktop_find` 遍历则不会。所以请把它看作"比像素坐标更稳的瞄准方式"，**而不是"静默的后台操作"**。
- **每次调用都付进程启动成本**——每个动作一个新 PowerShell 进程，含 C# 编译，约一秒。
- **截图会拍到屏幕上的任何内容**——可能包含用户并未提供的东西，并以图片块进入会话；调用方必须先征得同意。
- **本包不强制作用范围**——个人与公司事务的边界写在围绕工具的使用约定里，而不在代码里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包是 `private` 且未发布：它服务于一个本机自用的 profile。其 `lib/index.js` 由包内的 `tsdown.config.ts` 构建，因为根 workspace 构建只为随组合包分发的宿主包提供入口，而这一行是从 profile 补丁挂载的，不在任何组合包的依赖表里。

每份 C# 辅助代码都限制在 **C# 5 语法**内。工具运行在宿主提供的那个 PowerShell 上——包括 Windows PowerShell 5.1 的 `powershell.exe`——而它的 `Add-Type` 会拒绝更晚的语言特性：内联 `out` 声明无法编译，因此 out 参数一律先声明。

所有工具共用**一个常驻 PowerShell 进程**（[session.ts](src/session.ts)）：它每行读入一个脚本路径，dot-source 执行该脚本，再回一行标记——于是解释器与编译好的辅助代码只需付一次成本。否则光是启动进程与编译辅助代码就会主导一次调用：在本机实测，枚举窗口在一次性进程下每次中位数 **1854 ms**，走常驻会话是 **370 ms**。会话只是优化、绝不是前提：会话不可用时 `runPowerShellJson` 会回退到一次性进程；某条命令超时会连带结束该进程，下次调用从干净状态重建。

</details>
