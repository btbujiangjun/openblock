# Android Release 签名

Release APK 需要本目录下的 `keystore.properties` 与 `.keystore` 文件（均已 gitignore，不会提交）。

## 首次配置

```bash
cp keystore.properties.example keystore.properties
# 编辑 storePassword / keyPassword / keyAlias，并放入你的 .keystore
```

## 本地一键打 Release 包（仓库根目录）

```bash
npm run mobile:apk:release
```

产物：`mobile/android/app/build/outputs/apk/release/app-release.apk`

## 上架说明

- **Google Play / 正式渠道**：请使用独立生产密钥，勿与团队共享的开发密钥混用。
- 丢失 keystore 将无法对同一 `applicationId` 发布更新，请妥善备份。
