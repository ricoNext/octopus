# octopus

macOS 上的 Worktree 编排台。登记本地 git 仓，创建、导入、删除真实
`git worktree`；每个工作树一个内嵌终端和一块只读 diff。正式产品名未定，
窗口标题为「工作树编排」。

实现以 [MVP 产品规格](docs/product-spec.md) 为准。背景见
[产品设计](docs/product-design.md) 与 [项目上下文](docs/project-context.md)。

## 环境

- macOS（Apple Silicon 优先）
- [bun](https://bun.sh/)
- Rust / Cargo（Tauri 2）
- 本机 PATH 中的 `git`（不内嵌）
- Xcode 命令行工具

## 本地运行

在仓库根目录：

```bash
bun install
bun run tauri:dev
```

首次会编译 Rust 后端，之后启动名为「工作树编排」的窗口。

## 产品文档

- [项目上下文](docs/project-context.md)
- [产品设计](docs/product-design.md)
- [MVP 产品规格](docs/product-spec.md)
