# Agent Note: MAIN 世界 page-probe 渲染 console 时不得把异常抛进页面

Status: implemented

[English](2026-08-20-page-probe-console-inspect.md) | 中文

## 问题

在一次有效的 `inspect-page` 捕获期间，侧边助手会包装 `console.log` / `info` / `warn` / `error` / `debug`。使用 `JSON.stringify` 或 `String()` 渲染任意参数会触发 Vue 响应式 Proxy 陷阱，并可能抛出 `TypeError: Cannot convert object to primitive value`。诊断包装器既不能增加与对象图规模成正比的同步工作，也不能阻止页面原有的 console 方法运行。

## 决策

`inspectValue` 直接渲染字符串和原始值，在可用时读取受保护的 Error 信息，并对其他值使用固定的 `[Array]`、`[Object]` 或 `[Function]` 标记。它绝不枚举任意页面对象。console 包装器先调用原方法，再执行尽力而为的记录，因此诊断失败不会改变页面 console 行为。fetch 失败和 `unhandledrejection` 使用同一套有界转换。

## 备选方案

**在有效捕获期间禁用 MAIN 世界探针。** 否决。`inspect-page` 在显式会话期间需要页面世界权限来观察 console 和 fetch/XHR 调用。[按需页面观察](2026-08-20-side-assistant-on-demand-page-observation.zh.md)规定探针不进入未触碰的标签页，并在捕获之外保持休眠。

**吞掉转换错误并丢弃该 console 行。** 否决。`inspect-page` 会因此看不到触发失败的那条框架警告；若抛错发生在转发之前，原来的 `console.warn` 也不会执行。

**从 `JSON.stringify` 回退到 `String(arg)`。** 否决。两种操作都会调用页面自有代码并可能抛错。

## 影响

页面对 Vue Proxy 调用 `console.warn` 时，探针记录 `[Object]`，并且仍会调用原来的 console。inspect 输出有意省略对象字段；字符串参数仍保留框架诊断文本，而不会遍历对象。

## 测试

`packages/client/browser-extension/tests/page-probe.client.spec.ts` 断言探针不会读取会抛错的 Proxy，其警告仍到达原 console，inspect 输出包含固定对象标记。同一文件还钉住原始值、Error、数组、对象和函数的渲染。

## 相关

- [浏览器标签页扩展](../feature/2026-08-14-browser-tab-extension.zh.md) — 拥有侧边助手和本渲染辅助函数所服务的 `inspect-page` 捕获路径。
- [按需页面观察](2026-08-20-side-assistant-on-demand-page-observation.zh.md) — 负责探针注入与捕获生命周期。
