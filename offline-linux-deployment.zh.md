# DeepSeek Harness 内网 Linux 离线部署指南

## 1. 文档目的

本文说明如何将 DeepSeek Harness 部署到无法访问互联网的内网 Linux 服务器。部署人员先在一台可联网、且与目标服务器平台一致的 Linux 机器上安装依赖并完成构建，再将完整部署包传入内网。

本文以 Web UI 部署为主。生产环境推荐使用 `systemd` 管理 DSH 进程，并通过 Nginx 提供内网 HTTPS 入口。

### 1.1 已确认的目标环境

当前目标服务器环境为：

```text
CPU 架构：x86_64
操作系统：银河麒麟桌面操作系统 V10 SP1（云桌面版）
系统标识：Kylin V10 SP1
兼容系列：Debian-like
libc：Ubuntu GLIBC 2.31-0kylin9.1k20.8
```

本次交付应选择 Linux x64、glibc 对应的依赖和构建产物。正式交付前仍需在目标服务器运行 `node --version`，确认 Node.js 二进制能在该麒麟版本上正常启动。

### 1.2 当前准备进度

目前已经具备：

```text
pnpm-11.28.5.tgz
node-v22.19.0-linux-x64.tar.xz
```

其中 `pnpm-11.28.5.tgz` 是跨平台 JavaScript 安装包，没有单独的 Windows 版或 Linux 版；它可以在 Windows 上下载，再复制到 Linux 安装。`node-v22.19.0-linux-x64.tar.xz` 是目标麒麟服务器使用的 Linux x64 Node.js 运行时。

当前还必须制作：

```text
deepseek-harness-linux-x64.tar.gz
SHA256SUMS
```

`deepseek-harness-linux-x64.tar.gz` 是最关键的缺失交付物。它必须在 Linux x86_64、glibc 环境中执行 `pnpm install --frozen-lockfile` 和 `pnpm run build` 后制作，不能包含 Windows 生成的 `node_modules`。

建议同时准备：

```text
dsh.env.example
dsh-web.service
nginx-dsh.conf                 # 使用 Nginx 时需要
company-root-ca.crt            # 内网 HTTPS 使用企业 CA 时需要
```

## 2. 部署原则

1. 联网打包机和内网服务器必须使用相同 CPU 架构，例如均为 `x86_64` 或均为 `aarch64`。
2. 两台机器应使用相同 Linux 发行版和主要版本，例如均为 Ubuntu 22.04。
3. 两台机器的 libc 类型必须一致。不要在 glibc 系统上制作依赖后部署到 Alpine/musl，反之亦然。
4. 不得把 Windows 下的 `node_modules` 或构建产物复制到 Linux 使用。
5. 生产运行要求项目依赖和 Web 前端已经构建完成。
6. DSH 的 `--host` 必须是一个具体的本机 IP，不能使用 `0.0.0.0`。
7. 启动日志打印的 URL 包含启动凭据，只能交给授权用户。

## 3. 环境要求

### 3.1 软件版本

| 软件 | 要求 |
|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| pnpm | `11.28.5` |
| Git | 打包机建议 `2.26+`；目标服务器使用完整部署包时可不安装 |
| Nginx | 可选，用于反向代理和 TLS |
| systemd | 推荐，用于进程托管 |

推荐使用 Node.js `22.19.x`。不要在 `NODE_OPTIONS` 中配置 `--no-experimental-strip-types`，否则项目构建会失败。

### 3.2 硬件建议

| 资源 | 最低建议 | 生产建议 |
|---|---:|---:|
| CPU | 2 核 | 4 核及以上 |
| 内存 | 4 GB | 8 GB 及以上 |
| 磁盘 | 10 GB 可用空间 | 根据 Session、日志和 workspace 墓量扩容 |

### 3.3 网络要求

内网服务器不需要访问 npm 或 Git，但必须能够访问以下业务服务：

- 内部 DeepSeek API 或兼容 API 网关；
- 内部 DNS、NTP 和证书吊销服务（如企业策略要求）；
- 运维监控、日志或代理服务（如部署配置启用）。

部署前应从目标服务器确认 API 地址和端口可达。

## 4. 离线交付物清单

建议交付以下文件：

```text
node-v22.19.0-linux-x64.tar.xz
pnpm-11.28.5.tgz
deepseek-harness-linux-x64.tar.gz
SHA256SUMS
dsh.env.example
dsh-web.service
nginx-dsh.conf                 # 可选
company-root-ca.crt            # 使用企业 CA 时提供
```

ARM64 服务器应使用相应的 `linux-arm64` 文件，并将部署包名称中的 `x64` 改为 `arm64`。

## 5. 在联网 Linux 打包机制作离线包

### 5.1 检查平台

```bash
uname -m
cat /etc/os-release
ldd --version | head -n 1
```

保存输出并与目标服务器比对。若平台不一致，应更换打包机，不要继续制作部署包。

### 5.2 下载并校验 Node.js

下面以 Linux x64 和 Node.js 22.19.0 为例：

```bash
mkdir -p "$HOME/dsh-offline"
cd "$HOME/dsh-offline"

curl -LO https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz
curl -LO https://nodejs.org/dist/v22.19.0/SHASUMS256.txt

grep 'node-v22.19.0-linux-x64.tar.xz' SHASUMS256.txt
sha256sum node-v22.19.0-linux-x64.tar.xz
```

确认两个 SHA-256 值一致后解压：

```bash
tar -xJf node-v22.19.0-linux-x64.tar.xz
export PATH="$HOME/dsh-offline/node-v22.19.0-linux-x64/bin:$PATH"
node --version
npm --version
```

### 5.3 制作 pnpm 离线安装包

```bash
cd "$HOME/dsh-offline"
npm pack pnpm@11.28.5
```

命令应生成：

```text
pnpm-11.28.5.tgz
```

在打包机上启用项目要求的 pnpm：

```bash
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm --version
```

版本必须为 `11.28.5`。

### 5.4 获取项目并安装依赖

```bash
cd "$HOME/dsh-offline"
git clone <项目仓库地址> deepseek-harness
cd deepseek-harness

pnpm install --frozen-lockfile
```

如果使用固定提交或标签，应在安装依赖前切换并记录：

```bash
git checkout <提交或标签>
git rev-parse HEAD
```

### 5.5 构建生产产物

```bash
pnpm run build
```

构建必须成功退出。项目运行依赖构建后的 package 和 Web 前端产物，不能跳过此步骤。

### 5.6 打包项目目录

在项目上一级目录执行：

```bash
cd "$HOME/dsh-offline"

tar \
  --exclude='deepseek-harness/.git' \
  --exclude='deepseek-harness/.env' \
  --exclude='deepseek-harness/.dsh' \
  --exclude='deepseek-harness/coverage' \
  -czf deepseek-harness-linux-x64.tar.gz \
  deepseek-harness
```

必须使用能够保留符号链接的归档工具。pnpm 的 `node_modules` 使用符号链接；不要使用会展开、丢弃或改写这些链接的文件传输工具。

### 5.7 生成校验文件

```bash
cd "$HOME/dsh-offline"

sha256sum \
  node-v22.19.0-linux-x64.tar.xz \
  pnpm-11.28.5.tgz \
  deepseek-harness-linux-x64.tar.gz \
  > SHA256SUMS
```

将三个安装包和 `SHA256SUMS` 一起传入内网。

## 6. 在内网服务器安装

以下命令默认离线文件已上传到 `/tmp/dsh-offline`。

### 6.1 核对服务器平台

```bash
uname -m
cat /etc/os-release
ldd --version | head -n 1
```

其 CPU 架构、Linux 发行版主要版本和 libc 类型应与打包机一致。

### 6.2 校验离线文件

```bash
cd /tmp/dsh-offline
sha256sum -c SHA256SUMS
```

所有文件必须显示 `OK`。任何文件校验失败都应停止部署并重新传输。

### 6.3 安装 Node.js

```bash
sudo mkdir -p /opt/node
sudo tar -xJf node-v22.19.0-linux-x64.tar.xz \
  -C /opt/node \
  --strip-components=1

sudo ln -sfn /opt/node/bin/node /usr/local/bin/node
sudo ln -sfn /opt/node/bin/npm /usr/local/bin/npm
sudo ln -sfn /opt/node/bin/npx /usr/local/bin/npx

node --version
npm --version
```

`node --version` 应显示 `v22.19.0`。

### 6.4 离线安装 pnpm

```bash
cd /tmp/dsh-offline
sudo /opt/node/bin/npm install -g ./pnpm-11.28.5.tgz \
  --offline \
  --ignore-scripts

sudo ln -sfn /opt/node/bin/pnpm /usr/local/bin/pnpm
sudo ln -sfn /opt/node/bin/pnpx /usr/local/bin/pnpx

pnpm --version
```

版本必须为 `11.28.5`。

### 6.5 创建运行用户和目录

```bash
sudo useradd \
  --system \
  --home-dir /var/lib/dsh \
  --create-home \
  --shell /usr/sbin/nologin \
  dsh

sudo mkdir -p /var/lib/dsh/.dsh
sudo mkdir -p /var/lib/dsh/workspaces
```

如果 `dsh` 用户已经存在，`useradd` 会报错；确认现有用户符合要求后可继续执行目录创建。

### 6.6 解压项目

```bash
cd /tmp/dsh-offline
sudo tar -xzf deepseek-harness-linux-x64.tar.gz -C /opt
sudo chown -R dsh:dsh /opt/deepseek-harness
sudo chown -R dsh:dsh /var/lib/dsh
```

检查依赖目录：

```bash
test -d /opt/deepseek-harness/node_modules/.pnpm \
  && echo 'pnpm dependencies OK'
```

完整部署包已经包含依赖和构建产物。目标服务器不应再次执行联网形式的 `pnpm install`。

## 7. 配置模型 API

### 7.1 创建环境文件

创建 `/etc/dsh/dsh.env`：

```bash
sudo mkdir -p /etc/dsh
sudo editor /etc/dsh/dsh.env
```

示例内容：

```dotenv
DEEPSEEK_API_KEY=replace-with-real-secret
DEEPSEEK_BASE_URL=http://10.10.20.30:8000/v1
DSH_HOME=/var/lib/dsh/.dsh
NO_PROXY=127.0.0.1,localhost,10.10.20.30,.intra.example.com
```

如果需要通过内网代理访问 API，可增加：

```dotenv
HTTP_PROXY=http://proxy.intra.example.com:3128
HTTPS_PROXY=http://proxy.intra.example.com:3128
```

保护凭据文件：

```bash
sudo chown root:dsh /etc/dsh/dsh.env
sudo chmod 640 /etc/dsh/dsh.env
```

不要把真实密钥写进部署包、项目仓库、systemd unit 或普通运维文档。

### 7.2 安装企业 CA（可选）

Ubuntu/Debian：

```bash
sudo cp company-root-ca.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

RHEL/Rocky Linux：

```bash
sudo cp company-root-ca.crt /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust
```

证书安装后，从目标服务器验证 API TLS 和连通性。不要使用关闭 TLS 校验的方式绕过证书错误。

## 8. 选择监听方式

### 8.1 方案 A：内网 IP 直连

假设服务器内网 IP 为 `192.168.10.25`：

```bash
cd /opt/deepseek-harness
sudo -u dsh env \
  DSH_HOME=/var/lib/dsh/.dsh \
  pnpm dsh web \
  --no-open \
  --host 192.168.10.25 \
  --port 3080 \
  --trusted-host 192.168.10.25
```

浏览器访问启动日志打印的完整 URL。不要省略 URL 中的启动 token。

DSH 不允许绑定 `0.0.0.0`。必须使用目标服务器某个网络接口的具体 IP。

该方案使用明文 HTTP，只适用于受控且可信的内网。生产环境优先选择反向代理方案。

### 8.2 方案 B：Nginx 反向代理（推荐）

DSH 只监听 loopback：

```bash
cd /opt/deepseek-harness
sudo -u dsh env \
  DSH_HOME=/var/lib/dsh/.dsh \
  pnpm dsh web \
  --no-open \
  --host 127.0.0.1 \
  --port 3080 \
  --public-url https://dsh.intra.example.com/ \
  --trusted-host dsh.intra.example.com
```

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name dsh.intra.example.com;

    ssl_certificate     /etc/nginx/tls/dsh.crt;
    ssl_certificate_key /etc/nginx/tls/dsh.key;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

反向代理必须满足以下要求：

- 保留浏览器可见的 `Host`；
- 转发 WebSocket 的 `Upgrade` 和 `Connection` 请求头；
- 外部使用路径前缀时，在请求到达 DSH 前剥离该前缀；
- 外部使用路径前缀时，正确改写 Cookie 的 `Path`；
- HTTPS 在代理终止时，由代理维护证书和 TLS 配置；
- DSH 的 3080 端口只能由本机或受信任代理访问。

## 9. 使用 systemd 管理服务

创建 `/etc/systemd/system/dsh-web.service`：

```ini
[Unit]
Description=DeepSeek Harness Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dsh
Group=dsh
WorkingDirectory=/opt/deepseek-harness
EnvironmentFile=/etc/dsh/dsh.env
Environment=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/node/bin/pnpm dsh web --no-open --host 127.0.0.1 --port 3080 --public-url https://dsh.intra.example.com/ --trusted-host dsh.intra.example.com
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
UMask=0077

[Install]
WantedBy=multi-user.target
```

如果采用内网 IP 直连，应将 `ExecStart` 改为：

```ini
ExecStart=/opt/node/bin/pnpm dsh web --no-open --host 192.168.10.25 --port 3080 --trusted-host 192.168.10.25
```

加载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-web
sudo systemctl status dsh-web
```

查看日志：

```bash
sudo journalctl -u dsh-web -f
```

停止和重启：

```bash
sudo systemctl stop dsh-web
sudo systemctl restart dsh-web
```

`SIGTERM` 是 DSH 的正常停止信号。systemd 停止服务时会触发该退出流程。

## 10. 防火墙

直连模式只允许指定内网网段访问 3080。UFW 示例：

```bash
sudo ufw allow from 192.168.10.0/24 to any port 3080 proto tcp
sudo ufw status
```

firewalld 示例：

```bash
sudo firewall-cmd \
  --permanent \
  --add-rich-rule='rule family="ipv4" source address="192.168.10.0/24" port port="3080" protocol="tcp" accept'

sudo firewall-cmd --reload
```

反向代理模式不应对其他机器开放 DSH 的 3080 端口，只开放 Nginx 使用的 443 端口。

## 11. 部署验证

### 11.1 版本检查

```bash
node --version
pnpm --version
```

### 11.2 服务和端口检查

```bash
sudo systemctl status dsh-web
sudo ss -lntp | grep 3080
```

反向代理模式应看到 DSH 监听 `127.0.0.1:3080`。

### 11.3 本机 HTTP 检查

```bash
curl -I http://127.0.0.1:3080/
```

认证入口可能返回重定向或未认证响应；关键是服务器能够建立连接并返回 HTTP 响应，而不是连接拒绝或超时。

### 11.4 浏览器验收

1. 使用启动日志中带 token 的完整 URL 首次访问。
2. 确认页面可以加载。
3. 新建 Session。
4. 发送一条最小模型请求。
5. 确认模型网关收到请求并返回响应。
6. 执行一个只读工具调用。
7. 重启 `dsh-web`，确认已有 Session 仍然存在。
8. 在浏览器开发者工具中确认 WebSocket 连接成功。

### 11.5 常见故障

| 现象 | 检查项 |
|---|---|
| `node: command not found` | `/opt/node/bin` 和 systemd 的 `PATH` |
| pnpm 版本错误 | 是否安装了 `pnpm-11.28.5.tgz`，是否调用 `/opt/node/bin/pnpm` |
| 模块找不到 | 部署包是否包含完整 `node_modules`，pnpm 符号链接是否在传输时损坏 |
| 提示缺少 Web 构建产物 | 打包机是否成功执行 `pnpm run build` |
| `EADDRINUSE` | 3080 端口是否已被其他进程占用 |
| `--host 0.0.0.0` 被拒绝 | 改为服务器具体内网 IP 或 `127.0.0.1` |
| 浏览器 API 返回 403 | 浏览器使用的主机名/IP 是否传给 `--trusted-host`，代理是否保留 `Host` |
| 页面可打开但流式响应失败 | Nginx 是否正确转发 WebSocket 升级请求 |
| 模型请求失败 | `DEEPSEEK_BASE_URL`、密钥、企业 CA、路由和防火墙 |
| systemd 能启动但手工命令正常 | `WorkingDirectory`、`EnvironmentFile`、`PATH` 和文件权限 |

启动失败时，DSH 会将详细诊断写入 `$DSH_HOME/logs/`。诊断可能包含插件错误中的配置或凭据值，分享前必须检查和脱敏。

## 12. 升级流程

每次升级都在联网 Linux 打包机重新执行完整流程：

1. 检出目标提交或版本；
2. 执行 `pnpm install --frozen-lockfile`；
3. 执行 `pnpm run build`；
4. 生成新的项目归档和 SHA-256；
5. 将新归档传入内网；
6. 停止服务；
7. 解压到一个新的版本目录；
8. 保留 `/var/lib/dsh/.dsh` 和 workspace；
9. 切换 `/opt/deepseek-harness` 软链接；
10. 启动并完成验收。

推荐目录布局：

```text
/opt/deepseek-harness-2026.01.01/
/opt/deepseek-harness-2026.02.01/
/opt/deepseek-harness -> /opt/deepseek-harness-2026.02.01
```

切换示例：

```bash
sudo systemctl stop dsh-web
sudo ln -sfn /opt/deepseek-harness-2026.02.01 /opt/deepseek-harness
sudo systemctl start dsh-web
```

不要在升级时覆盖或删除：

```text
/var/lib/dsh/.dsh
/var/lib/dsh/workspaces
/etc/dsh/dsh.env
```

## 13. 回滚流程

如果新版本启动或验收失败：

```bash
sudo systemctl stop dsh-web
sudo ln -sfn /opt/deepseek-harness-2026.01.01 /opt/deepseek-harness
sudo systemctl start dsh-web
sudo systemctl status dsh-web
```

回滚前应阅读目标版本的升级说明，确认 Session 持久化格式和配置是否允许回到旧版本。不要通过删除或覆盖 `$DSH_HOME` 的方式解决兼容问题。

## 14. 安全检查清单

- [ ] API 密钥只保存在权限为 `0640` 或更严格的环境文件中。
- [ ] DSH 使用独立的非登录系统用户运行。
- [ ] `/var/lib/dsh` 和项目目录不对无关用户开放写权限。
- [ ] 直连端口只允许指定内网网段访问。
- [ ] 反向代理模式下，3080 只监听 `127.0.0.1`。
- [ ] 内网 HTTPS 使用浏览器信任的企业 CA 证书。
- [ ] Nginx 转发 WebSocket 并保留 `Host`。
- [ ] `--trusted-host` 与浏览器实际访问的 authority 一致。
- [ ] 启动 URL/token 不进入公开工单、聊天群或普通监控日志。
- [ ] 离线包通过 SHA-256 校验，并记录来源提交和打包环境。
- [ ] 备份 `$DSH_HOME`，并验证恢复流程。

## 15. 部署记录模板

```text
项目版本/提交：
打包日期：
打包人员：
打包机发行版：
打包机 CPU 架构：
打包机 libc：
Node.js 版本：
pnpm 版本：
目标服务器：
目标服务器 IP：
DSH 监听地址：
浏览器访问地址：
模型 API 地址：
项目包 SHA-256：
部署时间：
部署人员：
验收结果：
回滚版本：
```

## 16. 当前验证说明

本文中的 DSH 版本要求、构建命令、Web 启动参数、默认端口、具体地址绑定限制、代理信任要求和停止行为来自当前项目配置与文档。本文未在当前 Windows 工作区中实际执行 Linux 的 Node.js 安装、systemd、Nginx、防火墙和企业 CA 命令；生产使用前，运维人员应在与目标服务器一致的预生产 Linux 环境完成一次全流程演练。

