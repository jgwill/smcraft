import re
import sys
import os
import argparse

def bump_version(file_path, new_version):
    """Update version string in a file."""
    if not os.path.exists(file_path):
        print(f"Skipping {file_path} (not found)")
        return False

    with open(file_path, 'r') as file:
        content = file.read()

    # Handle both version = "x.y.z" and __version__ = "x.y.z"
    # This regex is specifically tuned for pyproject.toml and __init__.py patterns
    updated = re.sub(r'(^version\s*=\s*["\']([^\'"]*)["\']|__version__\s*=\s*["\']([^\'"]*)["\'])',
                     lambda m: f'version = "{new_version}"' if m.group(1).startswith('version') else f'__version__ = "{new_version}"',
                     content, flags=re.MULTILINE)

    if updated != content:
        with open(file_path, 'w') as file:
            file.write(updated)
        return True
    return False


def get_current_version(file_path):
    """Extract current version from a file."""
    if not os.path.exists(file_path):
        return "0.0.0"

    with open(file_path, 'r') as file:
        content = file.read()
        # Try to find version in pyproject.toml format first
        match = re.search(r'^version\s*=\s*["\']([^\'"]*)["\']', content, re.MULTILINE)
        if match:
            return match.group(1)
        # Then try to find __version__ in __init__.py format
        match = re.search(r'^__version__\s*=\s*["\']([^\'"]*)["\']', content, re.MULTILINE)
        return match.group(1) if match else "0.0.0"


def increment_patch(version):
    """Increment the patch version number."""
    parts = version.split('.')
    if len(parts) == 3 and parts[-1].isdigit():
        parts[-1] = str(int(parts[-1]) + 1)
    else:
        # If version is not in x.y.z format, append .1 (e.g., 0.1 -> 0.1.1)
        parts.append('1')
    return '.'.join(parts)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Bump version in Python package files')
    parser.add_argument('version', nargs='?', help='New version number (e.g., 1.2.3)')
    args = parser.parse_args()

    # Determine the base directory for smcraft
    script_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = script_dir # For smcraft, base_dir is the script's directory
    package_name = 'smcraft'

    # Get or increment version
    pyproject_path = os.path.join(base_dir, 'pyproject.toml')
    init_py_path = os.path.join(base_dir, package_name, '__init__.py')

    if args.version:
        new_version = args.version
    else:
        # Prefer pyproject.toml for current version if it exists and has one
        current = get_current_version(pyproject_path)
        if current == "0.0.0": # Fallback to __init__.py if pyproject.toml doesn't have it
            current = get_current_version(init_py_path)
        new_version = increment_patch(current)

    # Define files to update
    files_to_update = [
        pyproject_path,
        init_py_path
    ]

    # Update files
    updated_files = []
    for file_path in files_to_update:
        if bump_version(file_path, new_version):
            updated_files.append(file_path)

    if updated_files:
        print(f"✅ Version bumped to {new_version} in:")
        for f in updated_files:
            print(f"   - {f}")
    else:
        print(f"⚠️  No files were updated or version was already {new_version}")
