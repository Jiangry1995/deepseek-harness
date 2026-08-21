# `@deepseek-ai/dsh-vision-fallback`

[English](README.md) | 中文

为明确纯文本模型路由提供自动识图的可选安装 bundle。它的 [`cordis.patch.yml`](cordis.patch.yml) 会插入 [`@deepseek-ai/dsh-llm-vision-fallback`](../../llm/llm-vision-fallback/README.zh.md)，并为 [`@deepseek-ai/dsh-client-ui-settings-vision-fallback`](../../client/ui-settings-vision-fallback/README.zh.md) 插入一个 Host 侧空操作配置项；后者的 `dsh.client` 声明让 Web 模块扫描器贡献浏览器标签页。

```powershell
dsh plugin --profile web add @deepseek-ai/dsh-vision-fallback
```

重启后，到**设置 → 插件 → 自动识图**选择一条已注册的原生视觉辅助路由。provider/model 缺失时 bundle 保持休眠，并且它不会进入 `dsh-base`；安装 Harness 不会静默把图片发送给第二个提供方，也不会默认产生辅助模型费用。

## 模型体验

当已配置的纯文本路由收到图片内容时，通过 `@deepseek-ai/dsh-llm-vision-fallback` 间接产生影响。

#### KV Cache 影响

静态 bundle 不增加请求内容；提供方包记录其条件投影与缓存影响。

## 已知限制与延期工作

- **必须安装到 profile**——本包是 opt-in；加入 profile 前不会改变现有 Web 或 headless 组合。
- **Web UI 依赖依赖扫描器**——非 Web profile 可通过 YAML settings 使用 Host 降级行为，但不会渲染浏览器标签页。
