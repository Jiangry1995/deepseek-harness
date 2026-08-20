# Agent Note：等待页 Host 与页面桥定时器长于页内等待

Status: implemented

[English](2026-08-20-browser-wait-bridge-timeout.md) | 中文

## 问题

`browser_wait_for` 可以在页面内等待最长 30 秒。Host 已经会把 wait-page 请求保留得比 `requestTimeoutMs` 更久，但 Web Client 页面桥忽略 `operation.timeoutMs`，只用租约里的超时减去 1000ms 余量。因此一次 30 秒的「文本消失」等待大约 14 秒就会以 `browser extension bridge response timed out` 结束，并作为 `BROWSER_API_FAILED` 完成，而页内等待仍在进行。聊天发送与不完整等待的恢复记录在[聊天发送从快照控件发出](2026-08-19-browser-composer-send-and-wait-recovery.md)。

## 决策

保持三层嵌套定时器：页内等待 T、页面桥、Host。

Host 将 wait-page 保留 `max(requestTimeoutMs, timeoutMs + 1500)`。Client 使用同一 Host 公式，再减去 1000ms 余量。当 T=30000 且默认 `requestTimeoutMs` 为 15000 时，页内等待 30000ms，页面桥 30500ms，Host 31500ms。其他操作仍使用租约超时减去余量。1500ms 的 Host 余量在 `dsh-browser` 与 `dsh-client-browser-extension` 中各写一份，避免 Client 包导入 Host 服务。

## 备选方案

**把默认 `requestTimeoutMs` 提高到 32 秒。** 否决。扩展挂起时，列表、点击和填写仍应在 15 秒内失败；只有 wait-page 有调用方选定的预算。

**Host 仍用 +500，只缩小 wait-page 的余量。** 否决。Host 若已用 +500，500ms 间隙等于 1000ms 余量上限，页面桥与页内等待会在同一时刻到期。

**限制余量使桥永不短于 T，Host 仍用 +500。** 在 T 完成的等待会与桥定时器竞态。Host 上的余量加上桥上的 slack 才能保持间隙。

## 影响

一次 30 秒的「文本消失」等待可以完成，或返回 `BROWSER_WAIT_TIMEOUT`，而不是 14 秒的桥失败。工具 32 秒上限仍覆盖 Host 的 31500ms。挂起的等待仍然会失败关闭。普通操作仍使用 15 秒 Host 超时。

## 测试

`packages/web/browser` 在超过 `requestTimeoutMs` 后仍保持 wait-page 未结算，并在 `timeoutMs + 1500` 超时。`packages/client/browser-extension` 在超过仅按租约计算的页面桥超时后仍保持 wait-page 未完成，无响应时再于 Host 公式减去余量处完成 `BROWSER_API_FAILED`。
