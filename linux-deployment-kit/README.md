# Local Ubuntu multi-user Gateway deployment kit

English | [中文](README.zh.md)

These scripts copy the current customized source tree into Ubuntu's Linux filesystem, install Linux dependencies, rebuild the Linux native runtime and the deployment-sensitive Host, Client, and Web artifacts, and create a checksummed application upgrade package by default. A full offline package for a new installation is available as an explicit build mode. The scripts do not download or merge an upstream source archive.

## 1. Build an application upgrade package

Run from Ubuntu 20.04 x86_64 with glibc 2.31. The build copies the provided source tree into a temporary directory under `$HOME` and excludes Git data, `node_modules`, `.env*`, `.local`, Harness state, coverage, and root delivery reports. Linux dependencies are installed from `pnpm-lock.yaml`, then the build regenerates the Linux native runtime, the workspace-controller Host bundle, file-resource and remote bundles, the schedule catalog bundle, the coupled settings and model-settings bundles, the plugin manager, market, and inventory bundles, and the Web distribution before packaging. It rejects a schedule bundle without the full catalog reader and a shared settings bundle that still disables Host-backed settings on non-loopback pages.

The build requires Node.js 24.9.0, pnpm 11.28.5, Git, curl, tar, xz, a C compiler, `make`, `g++`, and Python 3. Use a new output directory; the script refuses to overwrite delivery artifacts.

```sh
REPO=/path/to/deepseek-harness
OUT="$HOME/dsh-linux-upgrade-$(date +%Y%m%d-%H%M%S)"
bash "$REPO/linux-deployment-kit/build-deployment-package.sh" "$REPO" "$OUT"
```

The default output contains the application archive, `VERSION`, `BUILD_SOURCE_COMMIT`, `PACKAGE_TYPE`, and `SHA256SUMS`. It does not contain Node.js or pnpm. The target installation must already provide Node.js 24.9.0 at its configured runtime path; pnpm is required only on the build host.

The build also regenerates the MCP client and manager Host bundles, installs CPIC's independent locked production dependencies, preserves its nested role skills, and checks their files and dependency imports. It validates the required Gateway, CLI, Web, CPIC, workflow-panel, and HTTP extension artifacts and records a build-copy identifier in `BUILD_SOURCE_COMMIT`. A stale lockfile stops the build; update and review the source lockfile before building.

An optional persistent Linux copy can be made before the build. The destination must not already exist:

```sh
bash "$REPO/linux-deployment-kit/prepare-customized-source.sh" \
  "$REPO" "$HOME/deepseek-harness-linux-source"
```

Verify every upgrade artifact before deployment:

```sh
cd "$OUT"
sha256sum --check SHA256SUMS
cat PACKAGE_TYPE
cat BUILD_SOURCE_COMMIT
ls -lh
```

Do not deploy unless every checksum reports `OK` and `PACKAGE_TYPE` is `application-upgrade`.

## 2. Build a full offline installation package

Use full mode only for a new installation or disaster-recovery delivery that must carry its own Node.js and pnpm archives:

```sh
REPO=/path/to/deepseek-harness
OUT="$HOME/dsh-linux-full-$(date +%Y%m%d-%H%M%S)"
bash "$REPO/linux-deployment-kit/build-deployment-package.sh" --full "$REPO" "$OUT"
```

The full output contains Node.js 24.9.0, pnpm 11.28.5, the application archive, the fresh-installation script, provenance files, and `SHA256SUMS`.

## 3. Migrate and install the multi-user Gateway

This section applies only to the full package and a fresh system-level installation. Do not run `install-offline-package.sh` to update an existing user-level Gateway service.

The installer migrates Gateway configuration and tenant state from the input directories you provide. It converts tenant paths to `/var/lib/dsh-gateway/tenants`, preserves profile settings, repairs known Windows workspace paths, and restricts migrated `.credentials.yaml` files to owner-only access.

Before installation, confirm that systemd is PID 1 and that `/opt/node-v24.9.0`, `/opt/deepseek-harness-<version>`, `/opt/deepseek-harness`, `/var/lib/dsh-gateway`, `/etc/systemd/system/dsh-gateway.service`, and the `dsh-gateway` account do not exist. The installer refuses to replace an existing installation. It asks for `MIGRATE-GATEWAY` before changing system state.

```sh
sudo bash "$OUT/install-offline-package.sh" \
  "$OUT" \
  /path/to/migration/multi-user \
  /path/to/migration/tenants
```

The service listens on loopback at `127.0.0.1:3000` for Gateway traffic, `127.0.0.1:3001` for management, and `127.0.0.1:3081-3999` for tenants. Configuration is stored in `/var/lib/dsh-gateway/config`; tenant data is stored in `/var/lib/dsh-gateway/tenants`; tenant logs are stored in `/var/lib/dsh-gateway/.dsh/multi-user-tenant-logs`.

## 4. Configure credentials and validate

The installer creates `/var/lib/dsh-gateway/config/gateway.env` with mode `0600`. Add only the provider variables required by the migrated tenant profiles, then restart the service:

```sh
sudoedit /var/lib/dsh-gateway/config/gateway.env
sudo systemctl restart dsh-gateway
```

Do not paste credentials into chat or store them in the source tree.

Verify the process and listeners:

```sh
sudo systemctl --no-pager --full status dsh-gateway
sudo ss -lntp | grep -E ':(3000|3001|3081|3082)\b'
curl -I http://127.0.0.1:3000/
sudo journalctl -u dsh-gateway -n 100 --no-pager
```

A direct unauthenticated request must be rejected. A trusted request must start the mapped tenant and return a status below 400. Keep the trusted authentication proxy in front of port 3000; it must set `X-Auth-Request-User` and the matching `X-DSH-Proxy-Secret`.

The migrated Xtest2 ticket resolver and CPIC URLs use `127.0.0.1:8080`. In WSL NAT mode, Windows host services are not reachable through Ubuntu loopback. Keep Gateway URLs loopback-only and use a loopback-only TCP forwarder to the WSL default-route host address; do not weaken Gateway URL validation by configuring plain HTTP to a non-loopback host. Verify CPIC from Ubuntu, then complete acceptance with a trusted tenant request, a model request, and Session persistence across `systemctl restart dsh-gateway`.
