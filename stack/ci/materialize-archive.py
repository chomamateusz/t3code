import pathlib
import subprocess
import sys
import tarfile
import tempfile


archive = pathlib.Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix='t3-package-', dir=archive.parent) as scratch:
    stage = pathlib.Path(scratch)
    with tarfile.open(archive) as source:
        members = source.getmembers()
        roots = {pathlib.PurePosixPath(member.name).parts[0] for member in members}
        assert len(roots) == 1, roots
        stem = roots.pop()
        links = {member.name.rstrip('/') for member in members if member.issym()}
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            assert not path.is_absolute() and '..' not in path.parts, member.name
            assert member.isfile() or member.isdir() or member.issym() or member.islnk(), member.name
            assert not any(str(parent) in links for parent in path.parents), member.name
            if member.islnk():
                target = pathlib.PurePosixPath(member.linkname)
                assert not target.is_absolute() and '..' not in target.parts and target.parts[0] == stem
            if member.issym():
                print(f'Materializing {member.name} -> {member.linkname}', flush=True)
    subprocess.run(['tar', '-xzf', str(archive), '-C', scratch], check=True)
    replacement = stage / 'runtime.tar.gz'
    subprocess.run([
        'tar', '--dereference', '--hard-dereference', '-czf', str(replacement),
        '-C', scratch, stem,
    ], check=True)
    with tarfile.open(replacement) as result:
        members = result.getmembers()
        assert not any(member.issym() or member.islnk() for member in members)
        assert not any(pathlib.PurePosixPath(member.name).name == 't3-web-override.json' for member in members)
        assert result.getmember(f'{stem}/client').isdir()
        assert result.getmember(f'{stem}/client/index.html').isfile()
        print(f'Archive audit: {len(members)} members; zero symlinks/hardlinks; real client/index.html; no desktop override', flush=True)
    replacement.replace(archive)
