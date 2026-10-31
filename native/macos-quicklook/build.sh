#!/bin/sh
# Build CDXMLThumbnail.appex and place it in a built ChemEditor.app (macOS only, UNTESTED).
# Usage: native/macos-quicklook/build.sh path/to/ChemEditor.app
set -eu
app="$1"
here="$(cd "$(dirname "$0")" && pwd)"
appex="$app/Contents/PlugIns/CDXMLThumbnail.appex"
mkdir -p "$appex/Contents/MacOS"
cp "$here/Info.plist" "$appex/Contents/Info.plist"
xcrun swiftc -O -module-name CDXMLThumbnail -parse-as-library \
  -framework QuickLookThumbnailing -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$appex/Contents/MacOS/CDXMLThumbnail" "$here/ThumbnailProvider.swift"
codesign --force --sign "${CODESIGN_IDENTITY:--}" --entitlements "$here/entitlements.plist" "$appex"
codesign --force --sign "${CODESIGN_IDENTITY:--}" "$app"
echo "Built $appex; check with: qlmanage -t -s 256 some.cdxml"
