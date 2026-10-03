#!/bin/bash
# 把《Agent 学院》站点打包成 macOS App:同步站点 → swift build → 组装 .app → ad-hoc 签名。
# 产物: macos-app/dist/Agent 学院.app(双击即可运行)
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Agent 学院"
EXEC="AgentAcademy"
DIST="dist"
STAGING=".site-bundle"

# 1. 同步站点文件(排除 tutor 运行时、本目录、临时文件)
echo "→ 同步站点文件…"
rm -rf "$STAGING"
mkdir -p "$STAGING"
rsync -a \
  --exclude 'tutor/' \
  --exclude 'macos-app/' \
  --exclude '.mimosa/' \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  ../ "$STAGING/"

echo "→ 编译 Swift(首次较慢)…"
swift build -c release
BIN="$(swift build -c release --show-bin-path)/$EXEC"

# 2. 图标(静态产物,icns 已存在则复用)
if [ ! -f "AppIcon.icns" ]; then
  echo "→ 生成 App 图标…"
  swift "$PWD/scripts/make-icon.swift" "$PWD/AppIcon-1024.png" >/dev/null
  # iconutil 要求目录以 .iconset 结尾,且不能用前导点命名
  rm -rf AppIcon.iconset && mkdir AppIcon.iconset
  while read -r px name; do
    sips -z "$px" "$px" "AppIcon-1024.png" --out "AppIcon.iconset/${name}.png" >/dev/null
  done <<'ICONS'
16 icon_16x16
32 icon_16x16@2x
32 icon_32x32
64 icon_32x32@2x
128 icon_128x128
256 icon_128x128@2x
256 icon_256x256
512 icon_256x256@2x
512 icon_512x512
1024 icon_512x512@2x
ICONS
  iconutil -c icns AppIcon.iconset -o "AppIcon.icns"
  rm -rf AppIcon.iconset AppIcon-1024.png
fi

# 3. 组装 .app
echo "→ 组装 $APP_NAME.app…"
APP="$DIST/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/site"
cp "$BIN" "$APP/Contents/MacOS/$EXEC"
cp -R "$STAGING/" "$APP/Contents/Resources/site/"
cp "AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$STAGING"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleName</key><string>Agent 学院</string>
    <key>CFBundleDisplayName</key><string>Agent 学院</string>
    <key>CFBundleIdentifier</key><string>com.agentacademy.app</string>
    <key>CFBundleExecutable</key><string>AgentAcademy</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleShortVersionString</key><string>1.3.0</string>
    <key>CFBundleVersion</key><string>3</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
</dict>
</plist>
PLIST

# 4. ad-hoc 签名(本机运行无需开发者账号)
codesign --force --sign - "$APP"

SIZE=$(du -sh "$APP" | cut -f1)
echo "✓ 构建完成: $PWD/$APP ($SIZE)"
echo "  打开运行:  open \"$PWD/$APP\""
