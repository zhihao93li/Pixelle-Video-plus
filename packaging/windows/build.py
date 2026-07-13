#!/usr/bin/env python3
"""
Windows Package Builder for Pixelle-Video

This script automates the creation of a Windows portable package:
1. Downloads Python embedded distribution
2. Downloads FFmpeg portable
3. Prepares Python environment (enable site-packages, install pip)
4. Installs project dependencies
5. Copies project files
6. Generates launcher scripts
7. Creates final ZIP package

Usage:
    python build.py [--config CONFIG] [--output OUTPUT] [--cn-mirror]
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.request import urlretrieve

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required. Install it with: pip install pyyaml")
    sys.exit(1)


WINDOWS_RELEASE_PATHS = (
    "api",
    "apps/console/dist",
    "bgm",
    "agent_plugin",
    "data/prompt_templates/script/bazi_storyboard_oral_script.md",
    "data/prompt_templates/script/bazi_storyboard_oral_script_english.md",
    "docs/en/faq.md",
    "docs/images",
    "docs/zh/faq.md",
    "pixelle_video",
    "resources",
    "templates",
    "workflows",
    "config.example.yaml",
    "LICENSE",
    "NOTICE",
    "pyproject.toml",
    "README.md",
    "README_EN.md",
)


class Color:
    """ANSI color codes for terminal output"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


class WindowsPackageBuilder:
    """Build Windows portable package for Pixelle-Video"""
    
    def __init__(self, config_path: str, output_dir: Optional[str] = None, use_cn_mirror: bool = False):
        self.config_path = Path(config_path)
        self.script_dir = Path(__file__).parent
        self.project_root = self.script_dir.parent.parent
        
        # Load configuration
        with open(self.config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        # Override mirror setting if specified
        if use_cn_mirror:
            self.config['mirrors']['use_cn_mirror'] = True
        
        # Setup paths
        self.output_dir = Path(output_dir) if output_dir else self.project_root / self.config['build']['output_dir']
        self.cache_dir = self.project_root / self.config['cache']['cache_dir']
        self.templates_dir = self.script_dir / 'templates'
        
        # Get version from pyproject.toml
        self.version = self._read_version()
        self.package_name = f"{self.config['package']['name']}-v{self.version}-{self.config['package']['architecture']}"
        self.build_dir = self.output_dir / self.package_name
        
    def _read_version(self) -> str:
        """Read version from pyproject.toml"""
        pyproject_path = self.project_root / 'pyproject.toml'
        try:
            import tomllib
        except ImportError:
            # Python < 3.11 fallback
            try:
                import tomli as tomllib
            except ImportError:
                # Simple regex fallback
                import re
                with open(pyproject_path, 'r') as f:
                    content = f.read()
                    match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
                    if match:
                        return match.group(1)
                return "0.1.0"
        
        with open(pyproject_path, 'rb') as f:
            pyproject = tomllib.load(f)
            return pyproject.get('project', {}).get('version', '0.1.0')
    
    def log(self, message: str, level: str = "INFO"):
        """Print colored log message"""
        colors = {
            "INFO": Color.BLUE,
            "SUCCESS": Color.GREEN,
            "WARNING": Color.YELLOW,
            "ERROR": Color.RED,
            "HEADER": Color.HEADER,
        }
        color = colors.get(level, Color.RESET)
        print(f"{color}[{level}]{Color.RESET} {message}")
    
    def _verify_sha256(self, path: Path, expected_sha256: str) -> bool:
        """Verify a downloaded build input against its pinned digest."""
        digest = hashlib.sha256()
        with open(path, "rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest().lower() == expected_sha256.strip().lower()

    def download_file(
        self,
        url: str,
        output_path: Path,
        expected_sha256: str,
        description: str = "",
        max_retries: int = 3,
    ) -> bool:
        """Download through verified TLS and require the pinned SHA-256 digest."""
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    self.log(f"Retry {attempt}/{max_retries}...")

                self.log(f"Downloading {description or url}...")

                def report_progress(block_num, block_size, total_size):
                    downloaded = block_num * block_size
                    percent = min(downloaded / total_size * 100, 100) if total_size > 0 else 0
                    print(f"\r  Progress: {percent:.1f}%", end="", flush=True)

                # urlretrieve uses Python's default verified TLS context.
                urlretrieve(url, output_path, reporthook=report_progress)
                print()
                if not self._verify_sha256(output_path, expected_sha256):
                    output_path.unlink(missing_ok=True)
                    raise RuntimeError("downloaded file SHA-256 does not match the pinned digest")

                self.log(f"Downloaded and verified {output_path}", "SUCCESS")
                return True
            except Exception as exc:
                self.log(f"Download attempt {attempt + 1} failed: {exc}", "WARNING")
                output_path.unlink(missing_ok=True)
                if attempt < max_retries - 1:
                    import time

                    time.sleep(2)
                else:
                    self.log("All urllib download attempts failed", "ERROR")
                    return self._download_with_curl(
                        url,
                        output_path,
                        expected_sha256,
                        description,
                    )
        return False

    def _download_with_curl(
        self,
        url: str,
        output_path: Path,
        expected_sha256: str,
        description: str = "",
    ) -> bool:
        """Fallback download using curl's normal TLS verification."""
        try:
            self.log(f"Trying curl fallback for {description}...")
            subprocess.run(
                ["curl", "--fail", "--location", "--output", str(output_path), url],
                check=True,
            )
            if not self._verify_sha256(output_path, expected_sha256):
                output_path.unlink(missing_ok=True)
                raise RuntimeError("curl download SHA-256 does not match the pinned digest")
            self.log(f"Downloaded and verified with curl: {output_path}", "SUCCESS")
            return True
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            self.log(f"Curl download also failed: {exc}", "ERROR")
            return False
    def download_python(self) -> Path:
        """Download Python embedded distribution"""
        python_config = self.config['python']
        cache_file = self.cache_dir / f"python-{python_config['version']}-embed-amd64.zip"
        
        expected_sha256 = python_config['sha256']
        if cache_file.exists() and self._verify_sha256(cache_file, expected_sha256):
            self.log(f"Using verified cached Python: {cache_file}")
            return cache_file
        cache_file.unlink(missing_ok=True)
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Choose URL based on mirror setting
        url = python_config['mirror_url'] if self.config['mirrors']['use_cn_mirror'] else python_config['download_url']
        
        if self.download_file(
            url,
            cache_file,
            expected_sha256=expected_sha256,
            description=f"Python {python_config['version']}",
        ):
            return cache_file
        else:
            raise RuntimeError("Failed to download Python")
    
    def download_ffmpeg(self) -> Path:
        """Download FFmpeg portable"""
        ffmpeg_config = self.config['ffmpeg']
        cache_file = self.cache_dir / f"ffmpeg-{ffmpeg_config['version']}-win64.zip"
        
        expected_sha256 = ffmpeg_config['sha256']
        if cache_file.exists() and self._verify_sha256(cache_file, expected_sha256):
            self.log(f"Using verified cached FFmpeg: {cache_file}")
            return cache_file
        cache_file.unlink(missing_ok=True)
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        url = ffmpeg_config['mirror_url'] if self.config['mirrors']['use_cn_mirror'] else ffmpeg_config['download_url']
        
        if self.download_file(
            url,
            cache_file,
            expected_sha256=expected_sha256,
            description=f"FFmpeg {ffmpeg_config['version']}",
        ):
            return cache_file
        else:
            raise RuntimeError("Failed to download FFmpeg")
    
    def extract_python(self, zip_path: Path, target_dir: Path):
        """Extract Python embedded distribution"""
        self.log(f"Extracting Python to {target_dir}...")
        target_dir.mkdir(parents=True, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_dir)
        
        # Add execute permissions to .exe files (needed on Unix systems)
        if os.name != 'nt':  # Not on Windows
            for exe_file in target_dir.glob('*.exe'):
                os.chmod(exe_file, 0o755)
            for exe_file in target_dir.glob('**/*.exe'):
                os.chmod(exe_file, 0o755)
        
        self.log("Python extracted successfully", "SUCCESS")
    
    def extract_ffmpeg(self, zip_path: Path, target_dir: Path):
        """Extract FFmpeg portable"""
        self.log(f"Extracting FFmpeg to {target_dir}...")
        temp_extract = target_dir.parent / "ffmpeg_temp"
        temp_extract.mkdir(parents=True, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_extract)
        
        # Find the bin directory (FFmpeg archive has nested structure)
        bin_dir = None
        for root, dirs, files in os.walk(temp_extract):
            if 'bin' in dirs:
                bin_dir = Path(root) / 'bin'
                break
        
        if bin_dir and bin_dir.exists():
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.copytree(bin_dir, target_dir, dirs_exist_ok=True)
            shutil.rmtree(temp_extract)
            self.log("FFmpeg extracted successfully", "SUCCESS")
        else:
            raise RuntimeError("FFmpeg bin directory not found in archive")
    
    def prepare_python_environment(self, python_dir: Path):
        """Prepare Python environment: enable site-packages"""
        self.log("Preparing Python environment...")
        
        # Embedded Python ignores PYTHONPATH while python311._pth is present.
        # Add the packaged project root explicitly and enable site-packages.
        pth_file = python_dir / "python311._pth"
        if not pth_file.exists():
            raise RuntimeError("Embedded Python is missing python311._pth")

        with open(pth_file, 'r') as f:
            lines = f.readlines()

        packaged_project_path = r"..\..\Pixelle-Video"
        if packaged_project_path not in {line.strip() for line in lines}:
            lines.append(f"{packaged_project_path}\n")

        # Uncomment "import site" line or add it
        modified = False
        for i, line in enumerate(lines):
            if line.strip().startswith('#import site'):
                lines[i] = 'import site\n'
                modified = True
                break
            
        if not modified and 'import site' not in ''.join(lines):
            lines.append('import site\n')
            
        with open(pth_file, 'w') as f:
            f.writelines(lines)
            
        self.log("Enabled packaged project and site-packages paths", "SUCCESS")
        
        # Note: On non-Windows systems, we can't run python.exe directly
        # Pip and dependencies will be installed using system Python
        if os.name == 'nt':
            # On Windows, we can install pip directly
            python_exe = python_dir / "python.exe"
            get_pip_path = self.cache_dir / "get-pip.py"

            pip_bootstrap = self.config["pip_bootstrap"]
            pip_sha256 = pip_bootstrap["sha256"]
            if not (
                get_pip_path.exists()
                and self._verify_sha256(get_pip_path, pip_sha256)
            ):
                get_pip_path.unlink(missing_ok=True)
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                if not self.download_file(
                    pip_bootstrap["download_url"],
                    get_pip_path,
                    expected_sha256=pip_sha256,
                    description="get-pip.py",
                ):
                    raise RuntimeError("Failed to download verified get-pip.py")
            
            self.log("Installing pip...")
            result = subprocess.run(
                [str(python_exe), str(get_pip_path)],
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                self.log(f"Pip installation failed: {result.stderr}", "ERROR")
                raise RuntimeError("Failed to install pip into embedded Python")
            self.log("Pip installed successfully", "SUCCESS")
        else:
            raise RuntimeError("Windows portable packages must be built on Windows")
    
    def _read_project_dependencies(self) -> list[str]:
        """Read runtime dependencies without installing an editable source checkout."""
        import tomllib

        pyproject_path = self.project_root / "pyproject.toml"
        with open(pyproject_path, "rb") as file:
            pyproject = tomllib.load(file)

        dependencies = pyproject.get("project", {}).get("dependencies", [])
        if not dependencies:
            raise RuntimeError("No runtime dependencies found in pyproject.toml")
        return [str(dependency) for dependency in dependencies]

    def install_dependencies(self, python_dir: Path):
        """Install Windows runtime dependencies into the embedded Python."""
        if os.name != "nt":
            raise RuntimeError(
                "Windows portable dependencies must be built on Windows; "
                "host-platform wheels cannot be copied into a Windows package"
            )

        python_exe = python_dir / "python.exe"
        dependencies = self._read_project_dependencies()
        cmd = [str(python_exe), "-m", "pip", "install", *dependencies]
        if self.config["mirrors"]["use_cn_mirror"]:
            cmd.extend(["--index-url", self.config["mirrors"]["pypi_mirror"]])

        self.log(f"Installing {len(dependencies)} runtime dependencies with embedded Python")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            self.log(f"Dependency installation failed:\n{result.stderr}", "ERROR")
            raise RuntimeError("Failed to install Windows runtime dependencies")
        self.log("Dependencies installed successfully", "SUCCESS")

    def install_playwright_browser(self, python_dir: Path):
        """Install Chromium inside the portable package instead of the user profile."""
        if not self.config.get("playwright", {}).get("install_browsers", True):
            return
        if os.name != "nt":
            raise RuntimeError("Portable Playwright Chromium must be installed on Windows")

        browsers_dir = self.build_dir / "tools" / "playwright"
        browsers_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)

        python_exe = python_dir / "python.exe"
        result = subprocess.run(
            [str(python_exe), "-m", "playwright", "install", "chromium"],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            self.log(f"Playwright Chromium installation failed:\n{result.stderr}", "ERROR")
            raise RuntimeError("Failed to install portable Playwright Chromium")
        self.log("Portable Playwright Chromium installed", "SUCCESS")

    def build_console(self):
        """Build the React console that the packaged FastAPI service will host."""
        console_dir = self.project_root / "apps" / "console"
        npm = shutil.which("npm") or shutil.which("npm.cmd")
        if npm is None:
            raise RuntimeError(
                "Node.js 20.19+ or 22.12+ and npm are required to build the React console"
            )

        env = os.environ.copy()
        env["VITE_PIXELLE_API_BASE_URL"] = "/api"
        commands = ([npm, "ci"], [npm, "run", "build"])
        for command in commands:
            self.log(f"Running console build command: {' '.join(command)}")
            subprocess.run(command, cwd=console_dir, env=env, check=True)

        dist_dir = console_dir / "dist"
        if not (dist_dir / "index.html").is_file() or not (dist_dir / "assets").is_dir():
            raise RuntimeError("React console build completed without index.html or assets")
        self.log("React console built successfully", "SUCCESS")

    def copy_project_files(self, target_dir: Path):
        """Copy an explicit release allowlist, never arbitrary workspace state."""
        self.log(f"Copying release files to {target_dir}...")

        target_dir.mkdir(parents=True, exist_ok=True)
        copied_count = 0
        for relative_path in WINDOWS_RELEASE_PATHS:
            source = self.project_root / relative_path
            if not source.exists():
                raise RuntimeError(f"Required release path is missing: {relative_path}")

            target = target_dir / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(
                    source,
                    target,
                    dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.py[cod]", ".DS_Store"),
                )
                copied_count += sum(1 for path in target.rglob("*") if path.is_file())
            else:
                shutil.copy2(source, target)
                copied_count += 1

        self.log(f"Copied {copied_count} release files", "SUCCESS")

    def generate_launcher_scripts(self):
        """Generate launcher scripts from templates"""
        self.log("Generating launcher scripts...")
        
        replacements = {
            '{VERSION}': self.version,
            '{BUILD_DATE}': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }
        
        # Copy and process templates
        for template_file in self.templates_dir.glob('*'):
            if template_file.is_file():
                target_file = self.build_dir / template_file.name
                
                with open(template_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Replace placeholders
                for key, value in replacements.items():
                    content = content.replace(key, value)
                
                with open(target_file, 'w', encoding='utf-8', newline='\r\n') as f:
                    f.write(content)
                
                self.log(f"Generated: {template_file.name}")
        
        self.log("Launcher scripts generated", "SUCCESS")
    
    def create_empty_directories(self):
        """Create empty directories specified in config"""
        self.log("Creating empty directories...")
        
        for dir_name in self.config['build'].get('create_empty_dirs', []):
            dir_path = self.build_dir / dir_name
            dir_path.mkdir(parents=True, exist_ok=True)
            # Create .gitkeep to preserve directory in git
            (dir_path / '.gitkeep').touch()
        
        self.log("Empty directories created", "SUCCESS")
    
    def create_zip_package(self):
        """Create final ZIP package"""
        if not self.config['build'].get('create_zip', True):
            return
        
        zip_path = self.output_dir / f"{self.package_name}.zip"
        self.log(f"Creating ZIP package: {zip_path}...")
        
        compression_map = {
            'deflate': zipfile.ZIP_DEFLATED,
            'bzip2': zipfile.ZIP_BZIP2,
            'lzma': zipfile.ZIP_LZMA,
        }
        compression = compression_map.get(
            self.config['build'].get('zip_compression', 'deflate'),
            zipfile.ZIP_DEFLATED
        )
        
        with zipfile.ZipFile(zip_path, 'w', compression) as zipf:
            for root, dirs, files in os.walk(self.build_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(self.build_dir.parent)
                    zipf.write(file_path, arcname)
        
        # Calculate file size and hash
        size_mb = zip_path.stat().st_size / (1024 * 1024)
        
        with open(zip_path, 'rb') as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()
        
        self.log(f"ZIP package created: {zip_path}", "SUCCESS")
        self.log(f"Size: {size_mb:.2f} MB")
        self.log(f"SHA256: {file_hash}")
        
        # Write hash to file
        hash_file = zip_path.with_suffix('.zip.sha256')
        with open(hash_file, 'w') as f:
            f.write(f"{file_hash}  {zip_path.name}\n")
    
    def build(self):
        """Main build process"""
        self.log("=" * 60, "HEADER")
        self.log(f"Building {self.package_name}", "HEADER")
        self.log("=" * 60, "HEADER")
        
        try:
            if os.name != "nt":
                raise RuntimeError(
                    "Windows portable packages must be built on Windows. "
                    "Cross-platform host wheels are not compatible with Windows."
                )

            # Clean build directory
            if self.build_dir.exists():
                self.log(f"Cleaning existing build directory: {self.build_dir}")
                shutil.rmtree(self.build_dir)
            
            self.build_dir.mkdir(parents=True, exist_ok=True)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            
            # Download dependencies
            python_zip = self.download_python()
            ffmpeg_zip = self.download_ffmpeg()
            
            # Extract Python
            python_dir = self.build_dir / "python" / "python311"
            self.extract_python(python_zip, python_dir)
            
            # Extract FFmpeg
            ffmpeg_dir = self.build_dir / "tools" / "ffmpeg" / "bin"
            self.extract_ffmpeg(ffmpeg_zip, ffmpeg_dir)
            
            # Prepare Python environment
            self.prepare_python_environment(python_dir)
            
            # Install dependencies
            if self.config['build'].get('pre_install_deps', True):
                self.install_dependencies(python_dir)
                self.install_playwright_browser(python_dir)

            # Build the production console before copying project files.
            self.build_console()
            
            # Copy project files
            project_target = self.build_dir / "Pixelle-Video"
            self.copy_project_files(project_target)
            
            # Generate launcher scripts
            self.generate_launcher_scripts()
            
            # Create empty directories
            self.create_empty_directories()
            
            # Create ZIP package
            self.create_zip_package()
            
            self.log("=" * 60, "HEADER")
            self.log("Build completed successfully!", "SUCCESS")
            self.log(f"Package location: {self.build_dir}", "SUCCESS")
            self.log("=" * 60, "HEADER")
            
        except Exception as e:
            self.log(f"Build failed: {e}", "ERROR")
            import traceback
            traceback.print_exc()
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Build Windows portable package for Pixelle-Video")
    parser.add_argument(
        '--config',
        default='packaging/windows/config/build_config.yaml',
        help='Path to build configuration file'
    )
    parser.add_argument(
        '--output',
        help='Output directory (default: dist/windows)'
    )
    parser.add_argument(
        '--cn-mirror',
        action='store_true',
        help='Use China mirrors for faster downloads'
    )
    
    args = parser.parse_args()
    
    builder = WindowsPackageBuilder(
        config_path=args.config,
        output_dir=args.output,
        use_cn_mirror=args.cn_mirror
    )
    builder.build()


if __name__ == '__main__':
    main()
