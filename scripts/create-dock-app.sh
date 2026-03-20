#!/bin/bash
# One-time setup: creates Pepper.app in ~/Applications.
# After running this script, drag ~/Applications/Pepper.app to your dock.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER="$SCRIPT_DIR/pepper-server.sh"
APP_DEST="$HOME/Applications/Pepper.app"

chmod +x "$LAUNCHER"

# Write the AppleScript source
APPLESCRIPT=$(cat <<APPLESCRIPT_EOF
property launcherScript : "$LAUNCHER"
property shellPID : ""

on run
  -- Start the launcher script (no terminal window)
  set shellPID to do shell script "\"" & launcherScript & "\" &>/dev/null & echo \$!"

  -- Wait until the browser has been opened (the script handles it)
  -- Show a notification
  delay 5
  display notification "Pepper is starting… browser will open shortly." with title "Pepper"

  -- Keep the app alive so the quit handler fires when user quits from dock
  repeat
    delay 30
  end repeat
end run

on quit
  -- Kill the launcher and any server on port 3000
  do shell script "[ -n \\"" & shellPID & "\\" ] && kill \\"" & shellPID & "\\" 2>/dev/null; lsof -ti:3000 | xargs kill -9 2>/dev/null; exit 0"
  display notification "Pepper stopped." with title "Pepper"
  continue quit
end quit
APPLESCRIPT_EOF
)

# Compile to a .app
mkdir -p "$HOME/Applications"
echo "$APPLESCRIPT" | osacompile -o "$APP_DEST"

echo "✅  Created $APP_DEST"
echo ""
echo "Next steps:"
echo "  1. Open Finder → Go → Home → Applications"
echo "  2. Drag 'Pepper.app' to your Dock"
echo "  3. Double-click (or click in Dock) to start Pepper"
echo "  4. Right-click the Dock icon → Quit to stop the server"
echo ""
echo "Server logs: /tmp/pepper-server.log"
