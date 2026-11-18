# Ubuntu 本地多用户 Gateway 部署工具包

[English](README.md) | 中文

这些脚本会将当前定制源码复制到 Ubuntu Linux 文件系统、安装 Linux 依赖、重建 Linux 原生运行时以及与部署相关的 Host、Client 和 Web 产物，并默认生成带校验和的应用升级包。全新安装所需的完整离线包通过显式构建模式生成。脚本不会下载或合并上游源码归档。

## 1. 构建应用升级包

在 Ubuntu 20.04 x86_64、glibc 2.31 上运行。构建会把给定源码树复制到 `$HOME` 下的临时目录，并排除 Git 数据、`node_modules`、`.env*`、`.local`、Harness 状态、覆盖率数据和根目录交付报告。Linux 依赖根据 `pnpm-lock.yaml` 安装，然后在打包前重新生成 Linux 原生运行时、workspace-controller Host bundle、文件资源与远程接口 bundle、日程目录 bundle、相互耦合的共享设置与模型设置 bundle、插件管理/市场/清单 bundle，以及 Web 分发产物。如果日程 bundle 缺少完整目录读取，或共享设置 bundle 仍会在非回环页面禁用 Host 设置，构建会直接失败。

构建需要 Node.js 24.9.0、pnpm 11.28.5、Git、curl、tar、xz、C 编译器、`make`、`g++` 和 Python 3。输出目录必须是新目录；脚本拒绝覆盖已有交付文件。

```sh
REPO=/path/to/deepseek-harness
OUT="$HOME/dsh-linux-upgrade-$(date +%Y%m%d-%H%M%S)"
bash "$REPO/linux-deployment-kit/build-deployment-package.sh" "$REPO" "$OUT"
```

默认输出包含应用归档、`VERSION`、`BUILD_SOURCE_COMMIT`、`PACKAGE_TYPE` 和 `SHA256SUMS`，不包含 Node.js 或 pnpm。目标安装必须已在配置的运行时路径中提供 Node.js 24.9.0；pnpm 只在构建主机上需要。

构建还会重建 MCP 客户端和管理器 Host bundle，安装 CPIC 独立锁定的生产依赖，保留其嵌套角色技能，并检查相应文件和依赖导入。构建会验证 Gateway、CLI、Web、CPIC、workflow-panel 和 HTTP extension 所需文件，并在 `BUILD_SOURCE_COMMIT` 中记录构建副本标识。锁文件过期会导致构建停止；构建前应更新并审查源码锁文件。

可在构建前额外准备持久化的 Linux 源码副本。目标路径必须不存在：

```sh
bash "$REPO/linux-deployment-kit/prepare-customized-source.sh" \
  "$REPO" "$HOME/deepseek-harness-linux-source"
```

部署前应验证所有升级文件：

```sh
cd "$OUT"
sha256sum --check SHA256SUMS
cat PACKAGE_TYPE
cat BUILD_SOURCE_COMMIT
ls -lh
```

只有每项校验均显示 `OK` 且 `PACKAGE_TYPE` 为 `application-upgrade` 时才可部署。

## 2. 构建完整离线安装包

只有全新安装或灾备交付需要自带 Node.js 和 pnpm 归档时才使用完整模式：

```sh
REPO=/path/to/deepseek-harness
OUT="$HOME/dsh-linux-full-$(date +%Y%m%d-%H%M%S)"
bash "$REPO/linux-deployment-kit/build-deployment-package.sh" --full "$REPO" "$OUT"
```

完整输出包含 Node.js 24.9.0、pnpm 11.28.5、应用归档、全新安装脚本、来源记录和 `SHA256SUMS`。

## 3. 迁移并安装多用户 Gateway

本节仅适用于完整包和全新的系统级安装。不要运行 `install-offline-package.sh` 更新现有用户级 Gateway 服务。

安装器会从指定输入目录迁移 Gateway 配置和 tenant 数据，将 tenant 路径改为 `/var/lib/dsh-gateway/tenants`，保留 profile 设置，修复已知的 Windows workspace 路径，并将迁移得到的 `.credentials.yaml` 权限限制为仅文件所有者可读写。

安装前应确认 systemd 是 PID 1，且 `/opt/node-v24.9.0`、`/opt/deepseek-harness-<version>`、`/opt/deepseek-harness`、`/var/lib/dsh-gateway`、`/etc/systemd/system/dsh-gateway.service` 及 `dsh-gateway` 账户均不存在。安装器不会替换已有安装。修改系统状态前，安装器会要求输入 `MIGRATE-GATEWAY`。

```sh
sudo bash "$OUT/install-offline-package.sh" \
  "$OUT" \
  /path/to/migration/multi-user \
  /path/to/migration/tenants
```

服务仅在 loopback 监听：Gateway 流量使用 `127.0.0.1:3000`，管理流量使用 `127.0.0.1:3001`，tenant 使用 `127.0.0.1:3081-3999`。配置保存在 `/var/lib/dsh-gateway/config`；tenant 数据保存在 `/var/lib/dsh-gateway/tenants`；tenant 日志保存在 `/var/lib/dsh-gateway/.dsh/multi-user-tenant-logs`。

## 4. 配置凭据并验证

安装器会创建权限为 `0600` 的 `/var/lib/dsh-gateway/config/gateway.env`。只添加迁移后的 tenant profile 所需的模型提供商变量，然后重启服务：

```sh
sudoedit /var/lib/dsh-gateway/config/gateway.env
sudo systemctl restart dsh-gateway
```

不要将凭据粘贴到对话中或保存在源码树内。

检查进程和监听端口：

```sh
sudo systemctl --no-pager --full status dsh-gateway
sudo ss -lntp | grep -E ':(3000|3001|3081|3082)\b'
curl -I http://127.0.0.1:3000/
sudo journalctl -u dsh-gateway -n 100 --no-pager
```

直接发送的未认证请求必须被拒绝。可信请求必须启动映射的 tenant 并返回小于 400 的状态码。应在 3000 端口前放置可信身份验证代理，并由代理设置 `X-Auth-Request-User` 和匹配的 `X-DSH-Proxy-Secret`。

迁移后的 Xtest2 ticket resolver 和 CPIC URL 使用 `127.0.0.1:8080`。WSL NAT 模式下，Ubuntu loopback 无法访问 Windows 主机服务。保持 Gateway URL 仅限 loopback，并使用 loopback TCP 转发器连接 WSL 默认路由的主机地址；不要通过配置指向非 loopback 主机的明文 HTTP 来放宽 Gateway URL 验证。从 Ubuntu 验证 CPIC，然后通过可信 tenant 请求、模型请求及 `systemctl restart dsh-gateway` 后的 Session 持久化检查完成验收。
