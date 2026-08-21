# 侧边助手页面隔离实施计划

[English](2026-08-20-side-assistant-page-isolation.md) | 中文

> **供 agent 工作者使用：** 在当前 worktree 中执行本计划，因为这里已经包含本工作需要保留的 page-probe 异常回归修复。

**目标：** 普通 HTTP(S) 页面在浏览器操作真正选中其标签页前不运行侧边助手钩子，并在检查或检测文档变化后释放高成本观察。

**架构：** MV3 manifest 只静态注入回环 Web Client 桥。Service Worker 分别保证隔离世界页面读取器和休眠的 MAIN 世界探针控制器可用。`browser_inspect` 使用显式的 `start` / `snapshot` / `stop` 捕获生命周期；只有有效捕获才包装 console 和网络 API。页面快照启动一次文档变更 observer，稳定性等待拥有并 dispose（资源释放）自己的 observer。

**技术栈：** TypeScript、Chromium MV3 API、Vitest、tsdown、Markdown 双语文档。

---

### 任务 1：钉住懒注入和捕获协议

**文件：**
- 修改：`packages/client/browser-extension/tests/extension-runtime.client.spec.ts`
- 修改：`packages/client/browser-extension/tests/page-content-runtime.client.spec.ts`
- 修改：`packages/web/browser/tests/browser.spec.ts`
- 修改：`packages/web/tool-browser/tests/tool-browser.spec.ts`

- [ ] 添加失败测试，证明 manifest 不含普通页面 content script，读取／操作恢复只注入 `page-content.js`，即使读取器已经存在，inspect 仍会注入 `page-probe.js`，并且 inspect 模式能通过每一层协议。
- [ ] 只运行这些测试文件，并确认失败指向尚未实现的生命周期。

### 任务 2：实现独立注入和显式检查生命周期

**文件：**
- 修改：`packages/web/browser/src/types.ts`
- 修改：`packages/web/browser/src/index.ts`
- 修改：`packages/web/tool-browser/src/index.ts`
- 修改：`packages/client/browser-extension/src/protocol.ts`
- 修改：`packages/client/browser-extension/src/extension/runtime.ts`
- 修改：`packages/client/browser-extension/src/extension/page-content-runtime.ts`
- 修改：`packages/client/browser-extension/src/extension/page-probe-protocol.ts`
- 修改：`packages/client/browser-extension/src/extension/page-probe-collector.ts`
- 修改：`packages/client/browser-extension/extension/manifest.json`

- [ ] 把 `BrowserInspectMode` 定义为 `start | snapshot | stop`，要求检查请求携带它，渲染所选生命周期状态，并提升扩展协议版本。
- [ ] 用仅恢复读取器的路径和 inspect 自有的 MAIN 世界探针注入替换组合注入器。
- [ ] 让模型工具解释并强制执行 start → 复现 → stop，同时允许中间 snapshot。
- [ ] 重新运行任务 1 的测试，确认通过后再改动探针内部实现。

### 任务 3：让探针保持休眠、低成本并且可释放

**文件：**
- 修改：`packages/client/browser-extension/tests/page-probe.client.spec.ts`
- 修改：`packages/client/browser-extension/src/extension/page-probe.ts`

- [ ] 添加失败测试，证明安装状态保持休眠，start 开始捕获，snapshot 保持捕获，stop 停止捕获，不会遍历任意对象，原 console 调用总会继续，并且复用 XHR 实例时每次 send 只记录一次。
- [ ] 实现文档生命周期控制器，由有效捕获拥有包装器与监听器；stop 只在控制器仍拥有已安装包装时恢复方法，否则保留一条休眠转发链。
- [ ] 直接渲染字符串和原始值，渲染受保护的 Error 信息，并对对象、数组和函数使用固定标记，不执行 `JSON.stringify`。
- [ ] 让 XHR 完成监听器只归属一个请求。
- [ ] 运行聚焦的探针测试文件并确认通过。

### 任务 4：限制文档 revision 观察

**文件：**
- 修改：`packages/client/browser-extension/tests/page-reader.client.spec.ts`
- 修改：`packages/client/browser-extension/src/extension/page-document.ts`
- 修改：`packages/client/browser-extension/src/extension/page-reader.ts`
- 修改：`packages/client/browser-extension/src/extension/page-waiter.ts`

- [ ] 添加失败测试，证明每个页面快照只观察第一次外部变更，稳定性等待会在完成或超时后断开其 observer。
- [ ] 每次读取后重新启动单次变更 revision observer，忽略 `data-dsh-*` 变更，并在第一次相关变更后断开。
- [ ] 让每次稳定性等待拥有自己的 observer，并在 `finally` 中 dispose。
- [ ] 运行聚焦的页面读取测试文件并确认通过。

### 任务 5：同步产物、文档和决策记录

**文件：**
- 修改：`packages/client/browser-extension/README.md`
- 修改：`packages/client/browser-extension/README.zh.md`
- 修改：`.agents/notes/implemented/bug-fix/2026-08-20-page-probe-console-inspect.md`
- 修改：`.agents/notes/implemented/bug-fix/2026-08-20-page-probe-console-inspect.zh.md`
- 创建：`.agents/notes/implemented/bug-fix/2026-08-20-side-assistant-on-demand-page-observation.md`
- 创建：`.agents/notes/implemented/bug-fix/2026-08-20-side-assistant-on-demand-page-observation.zh.md`
- 生成：由这些源拥有的包 bundle 和双语配对伴随记录。

- [ ] 记录当前懒注入、捕获时机、无法获得捕获前历史以及 observer 生命周期，不叙述实施过程。
- [ ] 记录否决永久 document-start 观察、只优化格式化器和附加调试器的原因。
- [ ] 从源码重新生成浏览器扩展 bundle，并且只重新记录受影响的双语配对。

### 任务 6：执行风险匹配的验证

**文件：**
- 只验证受影响的浏览器服务、工具、扩展、文档和生成产物。

- [ ] 运行四个聚焦 Vitest 文件，以及失败所指向的协议／工具测试。
- [ ] 运行最小包级类型检查或源码构建，证明共享 inspect 类型能够编译并重新生成扩展产物；这项跨包公共操作变更只要求检查三个受影响的包，而不是整个仓库。
- [ ] 对变更的 README 和 Agent Note 运行定向文档配对与格式检查。
- [ ] 运行 `git diff --check`，检查最终差异并排除 `vendor/`。
