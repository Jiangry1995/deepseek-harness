# Agent Note: 侧边助手仅按需观察浏览器页面

Status: implemented

[English](2026-08-20-side-assistant-on-demand-page-observation.md) | 中文

## 问题

侧边助手的 manifest 会向每个普通 HTTP(S) 页面注入 MAIN 世界 fetch/XHR/console 探针和约 70 KiB 的隔离世界读取器。即使没有浏览器工具操作该标签页，探针也会在页面同步热路径上序列化 console 参数并清理每个请求 URL。首次读取页面还会为文档剩余生命周期安装监听完整子树的 MutationObserver。因此，频繁产生警告和 DOM 变更的 Vue、Element Plus 应用会在无关表单操作期间承担扩展 CPU 开销。

## 决策

manifest 只静态注入 loopback Web Client 桥。读取、操作或等待仅在所选标签页的当前文档缺少兼容读取器时注入 `page-content.js`。inspect 操作独立地向 MAIN 世界注入幂等的 `page-probe.js` 控制器；读取器可用不代表探针可用。

`inspect-page` 必须指定 `start`、`snapshot` 或 `stop` 模式。`start` 清空旧观察并包装标签页当前的 fetch、XHR 和 console 方法。`snapshot` 读取有界缓冲而不结束捕获。`stop` 返回最终缓冲、停用记录、移除仅限捕获期间的错误监听器，并且仅在方法仍等于控制器包装函数时恢复它。页面之后安装的包装因此保持不变；残留的探针包装仅在休眠时直接转发。导航会随文档一起销毁两个控制器。

console 捕获记录字符串、原始值和固定对象类别标记，绝不枚举页面自有对象。每次 XHR send 只拥有一个一次性 `loadend` 监听器，因此复用 XHR 对象不会累积完成处理器。网络和 console 缓冲各保留四十条，每个文本字段最多五百个字符。

每次页面读取会启动一个监听完整子树的 observer；它在第一次非 `data-dsh-*` 变更后把文档 revision 增加一次并断开。稳定性等待拥有另一个 observer，并在成功或失败时断开。新的页面读取会重新观察下一次变更。

## 备选方案

**保留 document-start 注入，只优化 console 渲染。** 否决。未触碰的页面仍会让每次 fetch、XHR 和 console 调用经过扩展包装，并继续加载读取器 bundle。

**首次使用时注入，并把所有钩子保留到导航。** 否决。一次 inspect 或读取就会在用户继续操作该标签页时恢复同样的长期成本。

**通过 `chrome.debugger` 附加。** 否决。它会增加调试器权限与浏览器 UI、和 DevTools 附加冲突，而且仍然只能观察附加后的事件。

**使用 `chrome.webRequest` 代替页面探针。** 否决。它无法提供页面 console 消息，还会把同一个 inspect 结果拆到无关的观察机制中。

## 影响

未触碰的 HTTP(S) 标签页不会运行侧边助手页面代码。DOM 操作为当前文档承担一次读取器注入；快照 observer 在第一次相关变更后停止。网络和 console 检查只能看到 `start` 之后的事件，因此模型必须复现行为并以 `stop` 结束。有效捕获仍会给所选标签页增加有意的诊断开销，但停止捕获会恢复自有钩子，而不改变页面之后安装的补丁。

## 测试

扩展运行时测试钉住 manifest、仅恢复读取器、独立 MAIN 世界探针注入和三种 inspect 模式。页面探针测试钉住休眠安装、start/snapshot/stop 行为、不枚举对象的 console 渲染、原 console 转发和 XHR 监听器所有权。页面读取测试钉住单次变更 revision 观察和稳定性 observer 的 dispose（资源释放）。

## 相关

- [Console 渲染](2026-08-20-page-probe-console-inspect.md) — 负责有效捕获期间的诊断值转换。
- [浏览器标签页扩展](../feature/2026-08-14-browser-tab-extension.md) — 负责扩展提供方和浏览器操作集。
- [语义浏览器自动化](../feature/2026-08-16-semantic-browser-automation.md) — 负责文档标识、revision 和等待语义。
