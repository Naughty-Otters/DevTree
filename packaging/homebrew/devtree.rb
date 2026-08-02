# typed: false
# Homebrew Cask for the DevTree desktop app.
# Copy into Naughty-Otters/homebrew-tap Casks/devtree.rb after each release.
#
# sha256 values are filled by the release pipeline:
#   node scripts/update-homebrew-cask.mjs
#
#   brew tap Naughty-Otters/tap
#   brew install --cask devtree

cask "devtree" do
  version "0.1.1"
  desc "Desktop codebase dependency graph and architecture validation"
  homepage "https://github.com/Naughty-Otters/DevTree"

  livecheck do
    url :url
    strategy :github_latest
  end

  on_arm do
    url "https://github.com/Naughty-Otters/DevTree/releases/download/v#{version}/devtree_#{version}_aarch64.dmg"
    # Placeholder until the next mac release job runs update-homebrew-cask.mjs
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  end

  app "devtree.app"

  zap trash: [
    "~/Library/Application Support/com.devtree.app",
    "~/Library/Caches/com.devtree.app",
    "~/Library/Preferences/com.devtree.app.plist",
    "~/Library/WebKit/com.devtree.app",
  ]
end
