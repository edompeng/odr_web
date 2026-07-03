# ODR Web Viewer

一个纯静态部署的 OpenDRIVE `.xodr` 前端查看工具，参考本地版 geoviewer 的核心功能边界实现：地图加载、道路/车道可视化、图层控制、层级搜索、元素拾取高亮、测距、统计和截图导出。

解析和几何采样核心提供 C++17 实现，可通过 Emscripten 编译为 WASM。浏览器端会优先加载 `dist/wasm/opendrive_wasm.js`，不可用时回退到内置 JavaScript 解析器，方便本地调试。

## 使用

```bash
npm test
npm run build
```

构建产物会输出到 `dist/`，可以直接发布到任意静态 CDN。

完整 mac/Linux 校验：

```bash
./build_mac.sh
```

生成 WASM 静态产物需要先安装并激活 Emscripten SDK：

```bash
npm run build:wasm
```

该脚本会输出 `dist/index.html`、`dist/src/**`、`dist/wasm/opendrive_wasm.js` 和 `dist/wasm/opendrive_wasm.wasm`，整目录可直接托管到 CDN。

## GitHub CI 与 Pages 部署

仓库内已经提供 GitHub Actions 配置：

- `.github/workflows/ci.yml`：在 PR、`main`、`master` 推送时运行 C++ 构建/测试、JavaScript 测试、静态构建和 WASM 构建。
- `.github/workflows/pages.yml`：在 `main`、`master` 推送或手动触发时构建 WASM 静态站点，并部署 `dist/` 到 GitHub Pages。

首次部署步骤：

1. 将项目推送到 GitHub 仓库。
2. 进入仓库 `Settings -> Pages`。
3. 在 `Build and deployment` 中将 `Source` 设置为 `GitHub Actions`。
4. 推送到 `main` 或 `master`，或在 `Actions -> Deploy GitHub Pages -> Run workflow` 手动触发。
5. 部署成功后访问 Actions 输出的 `github-pages` 环境 URL，通常是 `https://<owner>.github.io/<repo>/`。

发布 workflow 会在 GitHub runner 内安装 Emscripten SDK、执行 native 测试、执行 JavaScript 测试、运行 `npm run build:wasm`，然后上传 `dist/`。不需要配置密钥。

本地预览可以使用任意静态服务器，例如：

```bash
python3 -m http.server 5173
```

然后打开 `http://127.0.0.1:5173/`。
