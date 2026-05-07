# Capibara 发布 SOP (Release Runbook)

> 每次发布新版本时，从上到下照着执行。范围：Windows + Linux。

---

## 1. 版本号约定

- **正式版**：`vX.Y.Z`（例 `v0.1.1`）。Tag 不含 `-`，Release 标记为 stable，自动更新会被默认配置（`allowPrerelease: false`）拉取。
- **预发布版**：`vX.Y.Z-<label>.<n>`（例 `v0.1.1-rc.0`、`v0.2.0-beta.1`）。Tag 含 `-`，Release 自动标为 prerelease；默认不会被 stable 用户的客户端自动升级。
- **遵循 SemVer**：新版本号必须严格大于线上最新版本；客户端通过版本比较决定是否升级。
- **版本号源**：`apps/electron/package.json` 的 `version` 字段。`electron-builder` 从这里读取，并写进 `latest*.yml`。根 `package.json` 仅作展示。

---

## 2. 发布前检查

1. `develop` 分支已合入所有计划发布的改动
2. `pnpm --filter @capibara/electron typecheck` 通过
3. `pnpm --filter @capibara/electron test:unit` 通过
4. `pnpm build:electron` 通过
5. 仓库 GitHub 页面 **Settings → Actions → General → Workflow permissions** 为 "Read and write"
6. 没有其他 Release workflow 正在跑（避免同 Tag 竞争）

---

## 3. 发布步骤

### 3.1 改版本号

```bash
# 替换 X.Y.Z 为目标版本
pnpm --filter @capibara/electron version 0.1.1
```

此命令会自动：
- 修改 `apps/electron/package.json` 的 `version`
- 创建 `v0.1.1` git tag
- 生成一个 commit

> ⚠️ 执行前确认工作区干净（`git status` 无未提交改动），否则 `pnpm version` 会报错。

### 3.2 推送

```bash
git push origin develop --follow-tags
```

`--follow-tags` 会同时推送刚生成的 Tag。Tag 一推送即触发 `.github/workflows/release.yml`。

### 3.3 监控 Actions

1. 打开 `https://github.com/uoyoCsharp/capibara/actions`
2. 看到名为 `Release` 的 workflow run，点入
3. 等待 `windows-latest` 和 `ubuntu-latest` 两个 job 都变绿（通常 10~20 分钟，首次冷启动更长）
4. 任一 job 失败：点日志定位问题；常见原因见 §5

### 3.4 校验 Release 资产

Actions 绿灯后，打开 `https://github.com/uoyoCsharp/capibara/releases`，确认最新 Release 至少包含：

**Windows：**
- `Capibara Setup <ver>.exe`（x64）
- `Capibara Setup <ver>-arm64.exe`
- 每个 `.exe` 对应的 `.exe.blockmap`
- `latest.yml` ← **自动更新必需**

**Linux：**
- `Capibara-<ver>.AppImage`（x64）
- `Capibara-<ver>-arm64.AppImage`
- `capibara_<ver>_amd64.deb`
- 每个 AppImage 对应的 `.AppImage.blockmap`
- `latest-linux.yml` ← **自动更新必需**

**自检**：下载 `latest.yml` 打开，确认里面 `version:` 字段与 Tag 一致、`path:` 指向有效的下载 URL。

---

## 4. 自动更新验证（仅正式版需做）

1. 在测试机安装上一版客户端，启动后确认版本号
2. 保持 app 启动状态，5~30 秒内观察：
   - `%APPDATA%\Capibara\logs\main.log`（Windows）或 `~/.config/Capibara/logs/main.log`（Linux）出现 `Checking for update` → `Found version <new>` → `Downloading update` → `Update downloaded`
   - 渲染层 toast 提示"检测到新版本 … 正在后台下载"→"更新已就绪，将在下次启动生效"
   - 系统原生对话框弹出"立即重启 / 稍后"
3. 两分支都测一次：
   - **立即重启**：app 退出重启后版本号变为新版，数据（组织 / 任务 / 对话 / SQLite 数据库）完好
   - **稍后**：关闭对话框，手动退出再启动，应已升级

---

## 5. 常见故障与排查

| 症状 | 原因 / 处置 |
|---|---|
| Release workflow 失败，日志报 `not allowed to create Release` | 仓库 Workflow permissions 未开 write。改完后重新 run workflow（不需要重新打 Tag） |
| Windows job 卡在 `electron-rebuild` 超时 | Windows runner 冷启动慢，重跑通常恢复；持续失败可在 release.yml 里加 `microsoft/setup-msbuild@v2` |
| `pnpm version` 报 "Git working directory not clean" | 先 `git stash` 或 commit 本地改动再执行 |
| Release 已建但缺少 `latest.yml` | 多半是 `electron-builder.yml` 的 `publish:` 段缺失或 owner/repo 写错。修正后重打 Tag |
| 客户端拉到 `latest.yml` 后下载 404 | `*.blockmap` 或主安装包未上传。检查 release.yml 的 `files` glob |
| 旧版启动后日志一直 `Update not available`，但 Release 已发 | ① 新版本号未严格大于线上；② 新版被标记为 prerelease（Tag 含 `-`），而客户端 `allowPrerelease: false` |
| 用户反馈 Windows 首次安装弹 SmartScreen | 未做代码签名，当前是已知接受现状。用户点 "更多信息 → 仍要运行" 即可 |
| 打错 Tag 推到远端了 | `git tag -d vX.Y.Z`、`git push --delete origin vX.Y.Z`；GitHub Release 页面手动删除 Release 与关联 assets |

---

## 6. Tag 命名速查

| 场景 | Tag 形式 | prerelease 标记 | stable 用户会拉吗 |
|---|---|---|---|
| 流水线演练 | `v0.1.1-rc.0` | 是 | 否 |
| 正式发布 | `v0.1.1` | 否 | 是 |
| 公测 | `v0.2.0-beta.1` | 是 | 否 |
| hotfix 小修 | `v0.1.2` | 否 | 是 |

如需让 stable 用户收到 beta 更新，临时把客户端 `autoUpdater.allowPrerelease` 改为 `true` 再发版（不建议长期开启）。

---

## 7. 回滚

GitHub 上的 Release 一旦发布就会被客户端拉到。若发现新版有严重问题：

1. **立即把 Release 改为 draft 或 prerelease**（GitHub Release 页面 edit）——新启动的客户端不会再升级
2. **已升级的用户**：他们已落地新版本，无法被动"降级"。需要发更高版本号的修复版（例如 `v0.1.2`）
3. **不要删除旧 Tag**，否则客户端日志里会留 404 痕迹且未来复盘困难

预防：正式版前用 `-rc.N` 跑一遍流水线，避免线上翻车。

---

## 8. 文件索引

- 方案设计：`docs/github-actions-release.md`
- 落地计划：`docs/github-actions-release-plan.md`
- Release workflow：`.github/workflows/release.yml`
- electron-builder 配置：`apps/electron/electron-builder.yml`
- 主进程更新服务：`apps/electron/src/core/infrastructure/auto-updater.ts`
- 渲染层 toast hook：`apps/electron/src/renderer/hooks/use-auto-update-toasts.ts`
- 本地调试配置：`apps/electron/dev-app-update.yml`
