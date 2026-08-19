# WeChat Claude Code Bridge

<p align="center">
  <strong>Chat with Claude Code in WeChat, just like texting a friend</strong>
</p>

<p align="center">
  <a href="https://github.com/Wechat-ggGitHub/wechat-claude-code/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License: MIT"></a>
  <a href="https://skills.sh/Wechat-ggGitHub/wechat-claude-code"><img src="https://img.shields.io/badge/skills.sh-view_page-blue?style=flat-square" alt="skills.sh"></a>
  <a href="README_en.md"><img src="https://img.shields.io/badge/Lang-English-lightgrey?style=flat-square" alt="English"></a>
</p>

扫码绑定微信后，你的微信里会多出一个好友。给它发消息，消息会自动转发给你电脑上运行的 Claude Code，回复也会实时推送到微信。支持文字、图片、语音、文件的收发。

<img width="3018" height="1216" alt="ScreenShot_2026-06-10_211251_410" src="https://github.com/user-attachments/assets/2ba4c53b-9c63-4ffd-bd0a-71935a6eabec" />

## 核心亮点
| | |
|---|---|
| **扫码即用** | 不用注册账号，不用部署服务器。微信扫码绑定，一分钟搞定。数据全在本地，隐私有保障。 |
| **消息不刷屏** | 只推送核心信息——进度、结果、关键决策。工具调用、中间过程等噪音自动过滤，阅读体验清爽。 |
| **"对方正在输入中..."** | Claude 在处理任务时，微信顶部会显示输入状态，随时感知它在干活。 |
| **电脑手机体验一致** | 手机端和电脑端 Claude Code 行为完全相同——同样的编排逻辑、同样的输出效果。不是两个割裂的 AI。 |
| **文件双向收发** | 发图片、Word、PDF 给 Claude 分析；Claude 生成的文件也会直接推送到微信，不用回到电脑前查看。 |
| **超时安抚** | 任务超过 5 分钟没响应？它会自动发一条消息告诉你还在干，不会让你对着空白聊天框干等。 |
| **多实例与 Git 审批** | 一份项目可绑定多个微信账号；普通实例只读并提交请求，唯一管理员审批后才执行修改。 |

## 快速安装

**方式一：skills CLI（推荐）**

```bash
npx skills add Wechat-ggGitHub/wechat-claude-code
```

首次在对话中触发时，会自动克隆项目源码并安装依赖。

**方式二：手动克隆**

```bash
git clone https://github.com/Wechat-ggGitHub/wechat-claude-code.git ~/.claude/skills/wechat-claude-code
cd ~/.claude/skills/wechat-claude-code && npm install
```

## 快速开始

### 1. 扫码绑定

```bash
cd ~/.claude/skills/wechat-claude-code
npm run setup
```

弹出二维码，用微信扫码。

### 2. 启动服务

```bash
npm run daemon -- start
```

macOS 下自动注册 launchd，开机自启、崩溃自动重启。

### 3. 开始聊天

打开微信，给你新出现的那个"好友"发条消息试试。

### 管理服务

```bash
npm run daemon -- status   # 查看运行状态
npm run daemon -- stop     # 停止服务
npm run daemon -- restart  # 重启服务（更新代码后使用）
npm run daemon -- logs     # 查看日志
```

Windows 原生后台管理使用 PowerShell：

```powershell
npm run daemon:windows -- start -Instance default
npm run daemon:windows -- status -Instance default

# 注册“当前用户登录时启动”的计划任务，并立即切换为受管运行
npm run daemon:windows -- enable-startup -Instance default
npm run daemon:windows -- startup-status -Instance default
```

`enable-startup` 会固定当前项目路径、数据目录和 Node 路径。Windows 用户登录后自动启动；Node 进程异常退出时，常驻监督器会在一分钟后重启，任务计划程序也会在监督器自身失败时恢复。项目或 Node 路径改变后应重新运行一次该命令。用 `disable-startup` 删除计划任务（当前实例会继续以普通后台模式运行）。

## 多微信账号与 Git 审批

每个命名实例拥有独立的微信凭据、配置、session、同步游标和日志。同一份项目源码可以同时运行多个实例。
实例名必须以字母或数字开头，只能包含字母、数字、点、下划线和连字符，最长 64 位。

```bash
# 第一个实例设为唯一管理员
npm run setup -- --instance admin --role admin

# 其它微信号设为普通请求实例（每条命令分别扫码）
npm run setup -- --instance writer-a --role requester
npm run setup -- --instance writer-b --role requester

# macOS / Linux
npm run daemon -- start --instance admin
npm run daemon -- start --instance writer-a
npm run daemon -- start --instance writer-b
```

Windows：

```powershell
npm run daemon:windows -- enable-startup -Instance admin
npm run daemon:windows -- enable-startup -Instance writer-a
npm run daemon:windows -- enable-startup -Instance writer-b

npm run daemon:windows -- startup-status -Instance admin
npm run daemon:windows -- status -Instance writer-a
```

启用后，原有的 `start`、`stop`、`restart` 会自动通过对应计划任务管理实例。`stop` 只停止当前运行，实例仍会在下次登录时自动启动；需要永久取消时使用 `disable-startup`。

查看已配置实例：

```bash
npm run instances
```

权限规则：

- 系统只允许配置一个 `admin` 实例。
- `requester` 的 Claude 使用 `plan` 权限模式和 `Read,Grep,Glob` 工具，禁用写文件、Shell、hooks、MCP 与插件。
- 普通实例通过 `/request <修改需求>` 将请求写入本地 Git 审批账本。
- 管理员通过 `/requests` 查看，通过 `/approve <请求号>` 或 `/reject <请求号>` 处理。
- 审批执行因重启或崩溃中断时，管理员用 `/recover <请求号>` 将残留修改提交到提案分支并收口。
- 批准时会从目标仓库创建 `wcc/request/<请求号>` 分支和隔离 worktree。Claude 完成后自动提交；目标分支未变化时自动快进合并。
- 管理员直接执行的修改也会自动提交。目标目录不是 Git 仓库或已有未提交改动时，任务自动降级为只读。

> 这是应用级权限边界。所有实例若以同一个操作系统用户运行，该用户仍可在程序外修改配置或文件。需要抵抗恶意进程时，应再使用独立 Windows 用户、容器或虚拟机隔离。

## 微信端命令

直接在微信聊天中发送即可：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清除当前会话，开始新对话 |
| `/stop` | 停止当前任务 |
| `/model <名称>` | 切换 Claude 模型 |
| `/prompt <内容>` | 设置系统提示词（如"用中文回答"） |
| `/cwd <路径>` | 切换工作目录 |
| `/skills` | 查看已安装的 Skill |
| `/status` | 查看当前会话状态 |
| `/history [数量]` | 查看最近对话记录 |
| `/compact` | 压缩上下文，开始新 CLI 会话 |
| `/reset` | 完全重置（包括工作目录等设置） |
| `/undo [数量]` | 撤销最近几条对话 |
| `/request <需求>` | 提交 Git 修改请求 |
| `/requests [all]` | 查看修改请求（仅管理员） |
| `/approve <请求号>` | 批准、执行并提交修改（仅管理员） |
| `/reject <请求号> [原因]` | 拒绝修改请求（仅管理员） |
| `/recover <请求号>` | 保存并收口中断的审批（仅管理员） |
| `/<skill> [参数]` | 触发任意已安装的 Skill |

## 工作原理

```
微信（手机） ←→ ilink Bot API ←→ Node.js 守护进程 ←→ Claude Code CLI（本地）
```

守护进程通过长轮询监听微信消息，转发给本地 `claude` CLI 处理，回复实时流式推送回微信。全程跑在你自己电脑上。

## 后续计划

- **消息队列优化** — 连续发多条指令时，回复容易串。正在研究更好的队列策略，也欢迎讨论。
- **电脑休眠不中断** — 利用 macOS 的 `caffeinate` 命令阻止系统睡眠，合上盖子也能响应微信消息。
- **接续电脑会话** — 在电脑上聊了很久，出门想接着聊。计划支持从当前电脑端的 Claude Code 会话直接续聊，工作空间和上下文保持一致。

## 前置条件

- Node.js >= 18
- Windows、macOS 或 Linux（Windows 使用 `daemon:windows`）
- 个人微信账号
- 已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 并完成认证

> **提示：** Claude Code 支持第三方 API 提供商（OpenRouter、AWS Bedrock 等），设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY` 即可。

## 数据目录

所有数据存储在 `~/.wechat-claude-code/`：

```
~/.wechat-claude-code/
├── accounts/                    # default 实例凭据（向后兼容）
├── instances/<实例名>/          # 命名实例的凭据、配置、session、游标和日志
├── approval-ledger/.git/        # Git 审批账本
├── approval-ledger/requests/    # 修改请求及状态
└── approval-worktrees/          # 审批执行时的临时隔离 worktree
```

## License

[MIT](LICENSE)
