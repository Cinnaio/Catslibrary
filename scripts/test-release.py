#!/usr/bin/env python3
"""Run the real release shell against temporary directories and failed command fixtures."""
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHA = 'a' * 40
NODE = (ROOT / '.node-version').read_text().strip()
spec = importlib.util.spec_from_file_location('release_validator', ROOT / 'scripts/validate-release.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding='utf-8', newline='\n')
    path.chmod(0o755)


def make_archive(root, extra=None, corrupt=False):
    source = root / 'candidate'
    files = {
        'api/dist/index.js': 'new-api', 'api/dist/build-info.js': 'build-info',
        'api/dist/check-release-runtime.mjs': 'runtime-check', 'api/dist/runtime/node': 'new-node',
        'api/dist/node_modules/example/index.js': 'new-dependency', 'api/dist/release-lock.json': '{}',
        'api/dist/migrations/001_initial.sql': 'SELECT 1;',
        'web/dist/index.html': '<script src="/assets/index-new.js"></script>', 'web/dist/assets/index-new.js': 'new-web',
    }
    for name, data in files.items():
        write(source / name, data)
    manifest = {'format': 2, 'releaseSha': SHA, 'nodeVersion': NODE, 'platform': 'linux',
                'arch': 'arm64' if platform.machine() in ('aarch64', 'arm64') else 'x64',
                'executable': 'api/dist/runtime/node', 'migrations': [{'version': 1, 'name': '001_initial.sql'}],
                'lockHash': hashlib.sha256(b'{}').hexdigest(),
                'files': {name: hashlib.sha256(data.encode()).hexdigest() for name, data in files.items()}}
    write(source / 'api/dist/release.json', json.dumps(manifest))
    if corrupt:
        write(source / 'api/dist/index.js', 'tampered-api')
    archive = root / ('release-' + SHA + '.tgz')
    with tarfile.open(archive, 'w:gz') as out:
        for file in sorted(source.rglob('*')):
            if file.is_file():
                out.add(file, arcname=file.relative_to(source).as_posix())
        if extra:
            info, data = extra
            out.addfile(info, io.BytesIO(data) if data else None)
    return archive


STUB = r'''
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ['RELEASE_FIXTURE'])
mode = os.environ.get('RELEASE_FAILURE', '')
command, *args = sys.argv[1:]
with (root / 'calls').open('a') as log: log.write(command + ' ' + ' '.join(args) + '\n')
def fail_once(label):
    flag = root / ('failed-' + label)
    if not flag.exists(): flag.touch(); return True
    return False
if command == 'id': print('0')
elif command in ('flock', 'sleep'): pass
elif command == 'runuser': sys.exit(1 if mode == 'runtime-fail' else 0)
elif command == 'systemctl':
    if args[0] == 'show': print('/usr/local/bin/zhizhou-start')
    if mode in ('restart-fail', 'restart-fail-protocol2') and args[0] == 'restart' and fail_once('restart'): sys.exit(1)
    if mode == 'stop-fail' and args[0] == 'stop' and fail_once('stop'): sys.exit(1)
elif command == 'curl':
    url = args[-1]
    if url.endswith('/api/ready'):
        if mode == 'readiness-fail': sys.exit(22)
        active = (root / 'site/api/dist/index.js').read_text() == 'new-api'
        release = ('wrong' if mode == 'wrong-sha' else 'a' * 40) if active else 'b' * 40
        print(json.dumps({'ready': True, 'release': release}))
    elif url.endswith('/'):
        print('<script src="/assets/index-new.js"></script>')
    elif '/assets/' in url and mode == 'asset-fail': sys.exit(22)
    elif '/api/novels' in url and mode == 'business-fail': sys.exit(22)
elif command == 'mv':
    paths = [arg.replace(chr(92), '/') for arg in args if arg != '--']
    source, target = paths
    label = ''
    if source.endswith('/web/dist'): label = 'move-new-web' if '.release-stage-' in source else 'move-old-web'
    if source.endswith('/api/dist'): label = 'move-new-api' if '.release-stage-' in source else 'move-old-api'
    if mode == label and fail_once(label): sys.exit(1)
    result = subprocess.call([os.environ['RELEASE_REAL_MV'], *args])
    if mode == 'move-completed-error' and label == 'move-new-api' and fail_once('moved'): sys.exit(1)
    sys.exit(result)
'''


class ReleaseTests(unittest.TestCase):
    def test_valid_inventory_and_runtime_policy(self):
        with tempfile.TemporaryDirectory(prefix='zhi-release-') as name:
            root = pathlib.Path(name)
            archive = make_archive(root)
            stage = root / 'stage'
            stage.mkdir()
            result = validator.validate_archive(archive, stage, SHA, NODE)
            self.assertEqual(result['releaseSha'], SHA)
            self.assertEqual((stage / 'api/dist/runtime/node').read_text(), 'new-node')

    def test_tampered_file_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='zhi-release-') as name:
            root = pathlib.Path(name)
            archive = make_archive(root, corrupt=True)
            stage = root / 'stage'
            stage.mkdir()
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                validator.validate_archive(archive, stage, SHA, NODE)

    def test_links_paths_duplicates_and_oversize_are_rejected(self):
        for kind in ('traversal', 'symlink', 'hardlink', 'duplicate', 'oversize'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(prefix='zhi-release-') as name:
                root = pathlib.Path(name)
                info = tarfile.TarInfo('../escape' if kind == 'traversal' else 'api/dist/unsafe')
                data = b''
                if kind in ('symlink', 'hardlink'):
                    info.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                    info.linkname = '../../outside'
                elif kind == 'duplicate':
                    info.name = 'api/dist/index.js'
                archive = make_archive(root, extra=(info, data))
                stage = root / 'stage'
                stage.mkdir()
                old_limit = validator.MAX_BYTES
                if kind == 'oversize': validator.MAX_BYTES = 1
                try:
                    with self.assertRaises(ValueError): validator.validate_archive(archive, stage, SHA, NODE)
                    self.assertEqual(list(stage.iterdir()), [])
                finally: validator.MAX_BYTES = old_limit

    def test_wrong_sha_or_runtime_is_rejected(self):
        for sha, version in [('b' * 40, NODE), (SHA, '0.0.0')]:
            with self.subTest(sha=sha, version=version), tempfile.TemporaryDirectory(prefix='zhi-release-') as name:
                root = pathlib.Path(name)
                archive = make_archive(root)
                stage = root / 'stage'
                stage.mkdir()
                with self.assertRaises(ValueError): validator.validate_archive(archive, stage, sha, version)

    def test_real_shell_success_and_rollback_paths(self):
        bash = os.environ.get('RELEASE_TEST_BASH') or shutil.which('bash')
        self.assertTrue(bash, '需要 Bash 执行发布脚本回归')
        modes = ['', 'runtime-fail', 'stop-fail', 'restart-fail', 'move-old-web', 'move-new-web',
                 'move-old-api', 'move-new-api', 'readiness-fail', 'wrong-sha', 'asset-fail', 'business-fail',
                 'restart-fail-protocol2', 'move-completed-error']
        for mode in modes:
            with self.subTest(mode=mode or 'success'), tempfile.TemporaryDirectory(prefix='zhi-release-shell-') as name:
                root = pathlib.Path(name)
                site = root / 'site'
                for file, text in [('web/dist/index.html', 'old-web'), ('api/dist/index.js', 'old-api'),
                                   ('api/dist/runtime/node', 'old-node'), ('api/dist/node_modules/example/index.js', 'old-dependency')]:
                    write(site / file, text)
                if mode == 'restart-fail-protocol2':
                    write(site / 'api/dist/release.json', json.dumps({'releaseSha': 'b' * 40}))
                archive = make_archive(root)
                trusted = root / 'trusted'
                write(trusted / 'validate-release.py', (ROOT / 'scripts/validate-release.py').read_text('utf-8'))
                write(trusted / 'node-version', NODE)
                script = (ROOT / 'scripts/zhizhou-release.sh').read_text('utf-8')
                constants = {'SITE_ROOT': site, 'BACKUP_ROOT': root / 'backups', 'VALIDATOR': trusted / 'validate-release.py',
                             'LOCK_FILE': root / 'release.lock', 'ARCHIVE_ROOT': root}
                for key, path in constants.items():
                    shell_path = path.as_posix()
                    if os.name == 'nt':
                        shell_path = subprocess.check_output([bash, '-c', 'cygpath -u "$1"', '--', shell_path], text=True).strip()
                    script, count = re.subn(r'^' + key + '=.*$', key + '=' + shlex.quote(shell_path), script, flags=re.M)
                    self.assertEqual(count, 1)
                write(root / 'release.sh', script)
                write(root / 'stub.py', STUB)
                bins = root / 'bin'
                python = shlex.quote(pathlib.Path(sys.executable).as_posix())
                for command in ['id', 'flock', 'sleep', 'runuser', 'systemctl', 'curl', 'mv']:
                    write(bins / command, '#!/usr/bin/env bash\nexec ' + python + ' ' + shlex.quote((root / 'stub.py').as_posix()) + ' ' + command + ' "$@"\n')
                write(bins / 'python3', '#!/usr/bin/env bash\nexec ' + python + ' "$@"\n')
                env = dict(os.environ, RELEASE_FIXTURE=root.as_posix(), RELEASE_FAILURE=mode, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
                real_mv = subprocess.check_output([bash, '-c', 'command -v mv'], text=True).strip()
                if os.name == 'nt':
                    real_mv = subprocess.check_output([bash, '-c', 'cygpath -w "$(command -v mv)"'], text=True).strip()
                env['RELEASE_REAL_MV'] = real_mv
                # Bash PATH 使用冒号；不修改父进程或开发环境 PATH。
                bins_path = bins.as_posix()
                if os.name == 'nt':
                    bins_path = subprocess.check_output([bash, '-c', 'cygpath -u "$1"', '--', bins_path], text=True).strip()
                command = 'export PATH=' + shlex.quote(bins_path) + ':"$PATH"; exec bash ' + shlex.quote((root / 'release.sh').as_posix()) + ' ' + SHA
                result = subprocess.run([bash, '-c', command], env=env, capture_output=True, text=True, encoding='utf-8', timeout=40)
                if not mode:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual((site / 'api/dist/index.js').read_text(), 'new-api')
                    self.assertEqual((site / 'api/dist/runtime/node').read_text(), 'new-node')
                    self.assertFalse(archive.exists())
                else:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    for file, value in [('web/dist/index.html', 'old-web'), ('api/dist/index.js', 'old-api'),
                                        ('api/dist/runtime/node', 'old-node'), ('api/dist/node_modules/example/index.js', 'old-dependency')]:
                        self.assertEqual((site / file).read_text(), value, result.stdout + result.stderr)
                    self.assertTrue(archive.exists())
                    calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
                    if mode == 'runtime-fail': self.assertNotIn('systemctl stop', calls)
                    else: self.assertIn('systemctl restart', calls)
                    if mode == 'restart-fail-protocol2':
                        self.assertIn('/api/ready', calls)
                        self.assertIn('旧版本就绪检查通过', result.stderr)
                self.assertFalse(list(site.glob('.release-stage-*')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
