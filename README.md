# Mess Auto

自动检测并复制 iMessage 验证码的 macOS 菜单栏应用。

## 功能特性

- 自动监控 iMessage 新消息
- 自动识别验证码并复制到剪贴板
- 显示验证码复制通知
- 支持 4-6 位数字验证码
- 菜单栏常驻，不占用 Dock 空间

## 系统要求

- macOS 10.12 或更高版本
- Apple Silicon (M1/M2) Mac
- 需要访问 Messages.app 数据库权限

## 安装说明

1. 下载最新的 DMG 安装包
2. 打开 DMG 文件并将应用拖入 Applications 文件夹
3. 首次运行时需要授予以下权限：
   - 完全磁盘访问权限（用于读取 Messages 数据库）
   - 通知权限（用于显示验证码通知）

## Intel Mac 用户

如果你使用的是 Intel 芯片的 Mac，可以通过以下步骤自行编译：

```bash
# 克隆仓库
git clone https://github.com/nightwhite/mess-auto.git
cd mess-auto

# 安装依赖
npm install

# 构建应用
npm run build
```

## 注意事项

- 应用需要完全磁盘访问权限才能正常工作
- 仅支持 iMessage 消息的验证码识别
- 验证码消息需要包含"验证码"关键词

## 隐私说明

- 应用仅读取本地 Messages 数据库
- 不会收集或上传任何数据
- 所有操作均在本地完成

## 开源协议

MIT License
