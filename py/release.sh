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
VERSION=$(grep -E "^\s*version\s*=\s*["']" pyproject.toml | sed -E "s/.*["']([^"']+)["'].*/\1/" || 
          grep -E "__version__\s*=\s*["']" smcraft/__init__.py | sed -E "s/.*["']([^"']+)["'].*/\1/")

git add pyproject.toml smcraft/__init__.py
git commit -m "v${VERSION}" || echo "No changes to commit"
git tag "v${VERSION}"

echo "✅ Release complete!"
echo "📋 Version: v${VERSION}"
echo "📋 Next steps:"
echo "   - Push changes: git push origin main"
echo "   - Push tag: git push origin v${VERSION}"
echo "   - Verify package on PyPI: https://pypi.org/project/smcraft/"
echo "   - Test installation: pip install smcraft"
