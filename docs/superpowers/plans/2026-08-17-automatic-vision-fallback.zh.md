# 自动视觉降级实现计划

[English](2026-08-17-automatic-vision-fallback.md) | 中文

> **执行方式：** 当前工作树包含需要保留的未提交改动，因此在原工作树中顺序执行，不创建隔离 worktree 或子智能体。

**目标：** 当前确切模型明确不支持图片时，自动调用已配置的视觉模型生成持久、可回放的图片转译，再把纯文本投影交给原模型；原生视觉模型和能力未知的模型保持原路径。

**架构：** `@deepseek-ai/dsh-llm` 增加单一、effect-scoped 图片降级注册和四态能力解析。`@deepseek-ai/dsh-llm-vision-fallback` 通过现有 LLM 路由执行辅助视觉请求，并在请求前、结果后分别记录 `vision/fallback-request` 与 `vision/fallback-result`。Web 图片准入、模型切换和 `read_image` 共用同一解析结果。

**技术栈：** TypeScript、Cordis、Schemastery、React、Vitest、Loader 真实组合测试、现有 settings／LLM／attachment／session 服务。

## 硬约束

- `inputModalities` 包含 `image`：不调用辅助模型，不改消息。
- `inputModalities` 明确排除 `image`：仅在降级提供方可用时转译。
- `inputModalities` 缺失：保持 unknown，不推断为纯文本。
- 辅助视觉模型必须明确声明 `image`，禁止递归降级。
- 辅助请求、结果和主模型文本投影必须能由同一会话日志重建。
- 插件以 opt-in bundle 交付，不进入 `dsh-base` 默认组合。
- 供应商端点、API Key 和模型 profile 继续由 Models、credentials 与现有适配器管理。

## 设置页设计

参考 `dsh-vision-recognizer` 的独立 Vision 标签结构，但沿用 Harness 设置页 token、间距、按钮和状态，不复制其私有 CSS、API Key 或 Endpoint 表单。

页面提供视觉 provider/model、最大输出 Token、超时和转译提示词。桌面端路由与数值字段双列，窄于 640 像素时单列；覆盖加载、空、目录局部失败、整体失败、只读、无效草稿、保存失败和成功状态。Provider/model 选择器只显示模型目录中明确声明 `image` 的模型。

## Task 1：LLM 图片输入解析与降级扩展点

**文件：**

- `packages/llm/llm/src/index.ts`
- `packages/llm/llm/src/types.ts`
- `packages/llm/llm/tests/service.spec.ts`

- [x] 先写失败测试，覆盖 native、fallback、unsupported、unknown 和 dispose。
- [x] 新增 `ImageInputResolution`、`LlmImageFallback`、`registerImageFallback()` 与 `resolveImageInput()`。
- [x] 在最终适配器边界只投影明确纯文本且带图片的请求。

```ts ignore-check
type ImageInputResolution =
  | { kind: 'native' }
  | { kind: 'fallback' }
  | { kind: 'unsupported' }
  | { kind: 'unknown' }
```

## Task 2：统一 Host 与 read_image 准入

**文件：**

- `packages/host/apiproxy/src/api-proxy.ts`
- `packages/host/apiproxy/src/api/sessions.ts`
- `packages/host/apiproxy/src/api/sessions.schema.ts`
- `packages/fs/tool-fs/src/read-image.ts`
- 对应 Host 与 tool-fs 测试

- [x] Web prompt 与模型切换对 `native`、`fallback`、`unknown` 放行，只拒绝 `unsupported`。
- [x] `read_image` 只接受 `native` 与 `fallback`，继续严格拒绝 unknown。
- [x] 将确切模型 `inputModalities` 投影到 Host 模型目录，供设置页筛选。

## Task 3：持久视觉降级提供方

**文件：**

- `packages/llm/llm-vision-fallback/src/config.ts`
- `packages/llm/llm-vision-fallback/src/events.ts`
- `packages/llm/llm-vision-fallback/src/fallback.ts`
- `packages/llm/llm-vision-fallback/src/index.ts`
- `packages/llm/llm-vision-fallback/src/invariant.ts`
- 包测试与真实 Loader 组合测试

- [x] 配置 provider、model、maxTokens、timeoutMs 与 prompt；缺少完整路由时休眠。
- [x] 辅助 dispatch 前记录完整、无机密请求，成功后记录确切文本投影。
- [x] 递归替换直接与 tool-result 内图片，保留消息身份和非图片块。
- [x] 按 session/attachment 协调并发；等待方取消不终止所有者。
- [x] Invariant 拒绝未出现附件、重复请求、孤立／重复结果及无效 payload。

```ts ignore-check
interface VisionFallbackRequestEventData {
  requestId: VisionFallbackRequestId
  attachment: ImageAttachmentRef
  route: { provider: string; model: string }
  messages: Message[]
  maxTokens: number
}
```

## Task 4：设置页与可安装 bundle

**文件：**

- `packages/client/ui-settings-vision-fallback/`
- `packages/bundle/vision-fallback/`

- [x] 注册本地化 `settings.plugins.tab`，目录在标签挂载后惰性加载。
- [x] 实现分阶段草稿、数值校验、provider 变更清空 model、保存回读和失败保留。
- [x] 添加响应式表单与完整状态设计。
- [x] Bundle 插入 Host 提供方和浏览器配套包的空操作 Loader 行，让 Web 扫描器发现 `dsh.client` 标签页。

## Task 5：文档、Agent Note 与生成目录

**文件：**

- 三个新包的双语 README
- `packages/llm/llm/README.md` and `README.zh.md`
- `packages/fs/tool-fs/README.md` and `README.zh.md`
- `docs/architecture*.md`
- `docs/subsystems/llm-streaming*.md`
- 新增自动视觉降级 Agent Note，更新 `minimal-read-image-tool` Note
- 配置、持久化、工具与模块图生成目录

- [x] 记录配置、隐私、失败、Model Experience、KV Cache 与限制。
- [x] 新 Note 拒绝代理路由、未记录 stream 转译、独立工具和重复供应商协议。
- [x] 保留并交叉链接仍有未来价值的图片附件与 `read_image` 既有 Note，不归档。
- [x] 从权威源码重新生成派生目录并同步双语结构。

## Task 6：风险匹配验证

- [ ] 运行 LLM core、vision fallback、Host、tool-fs 和 Client 定向测试。
- [ ] 运行 Host/Client 完整 typecheck；本次修改公共 LLM API、BFF wire 与跨包契约，满足全量类型检查条件。
- [ ] 运行 `doc-sync` 与 `git diff --check`，区分当前任务和工作树原有失败。
- [ ] 在真实 Web 设置弹窗检查桌面、窄视口、键盘焦点、空态、错误态和中英文。
- [ ] 报告未运行的全仓测试、生产构建和真实供应商调用；keyless 测试只证明路由、持久化和投影。
