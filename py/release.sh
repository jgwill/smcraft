#!/bin/bash
# SMCraft Release Script
# Prepares distribution and publishes to PyPI

set -e  # Exit on any error

echo "🚀 SMCraft Release Script Starting..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
make clean

# Bump version
echo "📈 Bumping version..."
make bump

# Build distribution
echo "🔨 Building distribution..."
make build

# Upload to PyPI
echo "📦 Publishing to PyPI..."
make upload

# Get current version and create git tag
echo "🏷️ Creating git tag..."
# Extract version from pyproject.toml
# Single-quoted patterns: the character class ["'] cannot live inside a
# double-quoted string — bash closes the string on the embedded quote and the
# script dies with "unexpected EOF" long after the upload has already happened.
VERSION=$(grep -E '^[[:space:]]*version[[:space:]]*=' pyproject.toml | head -1 | sed -E 's/.*["'"'"']([^"'"'"']+)["'"'"'].*/\1/')
if [ -z "$VERSION" ]; then
  VERSION=$(grep -E '^__version__[[:space:]]*=' stateloom/__init__.py | head -1 | sed -E 's/.*["'"'"']([^"'"'"']+)["'"'"'].*/\1/')
fi
if [ -z "$VERSION" ]; then
  echo "Could not read a version from pyproject.toml or stateloom/__init__.py" >&2
  exit 1
fi

git add pyproject.toml stateloom/__init__.py
git commit -m "v${VERSION}" || echo "No changes to commit"
git tag "v${VERSION}"

echo "✅ Release complete!"
echo "📋 Version: v${VERSION}"
echo "📋 Next steps:"
echo "   - Push changes: git push origin main"
echo "   - Push tag: git push origin v${VERSION}"
echo "   - Verify package on PyPI: https://pypi.org/project/miadi-stateloom-engine/"
echo "   - Test installation: pip install miadi-stateloom-engine"

