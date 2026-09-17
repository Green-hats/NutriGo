"""Validate, sign and publish the APK produced by this workflow's reusable CI."""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
import zipfile
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "release-output"
MAX_APK_BYTES = 20 * 1024 * 1024


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def metadata(config, cargo_version, event, ref, sha, api, certificate):
    version = config["version"]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Use a numeric major.minor.patch app version")
    if cargo_version != version:
        raise ValueError("Cargo.toml and tauri.conf.json versions must match")
    major, minor, patch = map(int, version.split("."))
    code = major * 1_000_000 + minor * 1000 + patch
    if minor >= 1000 or patch >= 1000 or not 0 < code <= 2_100_000_000:
        raise ValueError("App version cannot be encoded as an Android versionCode")
    android = config["bundle"]["android"]
    if android.get("autoIncrementVersionCode") or android.get("versionCode", code) != code:
        raise ValueError("Use the deterministic versionCode derived from the app version")
    package = config["identifier"] + android.get("debugApplicationIdSuffix", ".debug")
    if package != "com.greenhats.nutrigo.debug":
        raise ValueError("Package must preserve the existing Android installation identity")
    tag = f"android-v{version}"
    if (event, ref) not in [("workflow_dispatch", "refs/heads/main"), ("push", f"refs/tags/{tag}")]:
        raise ValueError(f"Run manually on main or push the matching tag {tag}")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid source commit")
    url = urlsplit(api)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.path not in ("", "/")
        or url.query
        or url.fragment
        or url.hostname == "example.com"
        or url.hostname.endswith(".example.com")
    ):
        raise ValueError("Set NUTRIGO_API_BASE_URL to the actual HTTPS server origin")
    # Also reject malformed port numbers.
    _ = url.port
    if not re.fullmatch(r"[0-9a-fA-F]{64}", certificate):
        raise ValueError("Set ANDROID_SIGNING_CERT_SHA256 to the existing certificate digest")
    return dict(
        version=version,
        code=code,
        tag=tag,
        sha=sha,
        package=package,
        api=api.rstrip("/"),
        certificate=certificate.lower(),
    )


def load_metadata():
    config = json.loads((ROOT / "frontend/src-tauri/tauri.conf.json").read_text())
    cargo = tomllib.loads((ROOT / "frontend/src-tauri/Cargo.toml").read_text())
    lock = tomllib.loads((ROOT / "frontend/src-tauri/Cargo.lock").read_text())
    locked = next(p["version"] for p in lock["package"] if p["name"] == "nutrigo")
    if locked != cargo["package"]["version"]:
        raise ValueError("Cargo.lock app version must match Cargo.toml")
    sha = run("git", "rev-parse", "HEAD")
    if sha != os.environ["GITHUB_SHA"]:
        raise ValueError("Checkout must be the exact workflow commit")
    return metadata(
        config,
        cargo["package"]["version"],
        os.environ["GITHUB_EVENT_NAME"],
        os.environ["GITHUB_REF"],
        sha,
        os.environ.get("NUTRIGO_API_BASE_URL", ""),
        os.environ.get("ANDROID_SIGNING_CERT_SHA256", ""),
    )


def api(path, optional=False, *, method="GET", payload=None, input_file=None):
    command = ["gh", "api", "--method", method, path]
    if payload is not None:
        command.extend(["--input", "-"])
    if input_file is not None:
        command.extend(["--input", str(input_file), "-H", "Content-Type: application/octet-stream"])
    result = subprocess.run(
        command,
        input=json.dumps(payload) if payload is not None else None,
        check=False,
        capture_output=True,
        text=True,
    )
    if optional and result.returncode and "(HTTP 404)" in result.stderr:
        return None
    if result.returncode:
        raise RuntimeError(f"GitHub API request failed: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def marker(meta):
    return f"<!-- nutrigo-android-release:{meta['sha']} -->"


def validate_release_state(meta, release, tag_sha):
    if tag_sha and tag_sha != meta["sha"]:
        raise ValueError("Existing tag points to another commit; it will not be moved")
    if release and (
        not release["draft"]
        or release["target_commitish"] != meta["sha"]
        or marker(meta) not in (release.get("body") or "")
    ):
        raise ValueError("Release already exists; bump the app version instead of overwriting it")


def check_remote(meta):
    repo = os.environ["GITHUB_REPOSITORY"]
    ref = api(f"repos/{repo}/git/ref/tags/{meta['tag']}", optional=True)
    obj = ref["object"] if ref else None
    for _ in range(10):
        if not obj or obj["type"] == "commit":
            break
        if obj["type"] != "tag":
            raise ValueError("Release tag does not resolve to a commit")
        obj = api(f"repos/{repo}/git/tags/{obj['sha']}")["object"]
    if obj and obj["type"] != "commit":
        raise ValueError("Release tag nesting is too deep")
    # Drafts without a published tag are only discoverable via the release list.
    pages = json.loads(run("gh", "api", "--paginate", "--slurp", f"repos/{repo}/releases?per_page=100"))
    release = next((r for page in pages for r in page if r["tag_name"] == meta["tag"]), None)
    validate_release_state(meta, release, obj["sha"] if obj else None)
    return release


def validate_apk_details(meta, badging, signature):
    expected = (
        f"package: name='{meta['package']}' versionCode='{meta['code']}' versionName='{meta['version']}'"
    )
    if expected not in badging or not re.search(r"^native-code: 'arm64-v8a'$", badging, re.MULTILINE):
        raise ValueError("APK package, version or architecture does not match the release")
    certs = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)", signature)
    if [c.lower() for c in certs] != [meta["certificate"]]:
        raise ValueError("APK signing certificate does not match the existing installation")


def sign(meta):
    for name in (
        "ANDROID_KEYSTORE_BASE64",
        "ANDROID_KEYSTORE_PASSWORD",
        "ANDROID_KEY_ALIAS",
        "ANDROID_KEY_PASSWORD",
    ):
        if not os.environ.get(name):
            raise ValueError(f"Missing Actions secret: {name}")
    source = ROOT / "release-input/NutriGo-online-arm64.apk"
    sdk = Path(os.environ["ANDROID_HOME"]) / "build-tools/36.0.0"
    OUTPUT.mkdir(exist_ok=True)
    apk = OUTPUT / f"NutriGo-Android-arm64-{meta['version']}.apk"
    run(str(sdk / "zipalign"), "-c", "-P", "16", "4", str(source))
    with tempfile.TemporaryDirectory(prefix="nutrigo-signing-", dir=os.environ.get("RUNNER_TEMP")) as temp:
        key = Path(temp) / "signing.keystore"
        with key.open("xb") as stream:
            os.chmod(key, 0o600)
            stream.write(base64.b64decode(os.environ["ANDROID_KEYSTORE_BASE64"], validate=True))
        run(
            str(sdk / "apksigner"),
            "sign",
            "--ks",
            str(key),
            "--ks-key-alias",
            os.environ["ANDROID_KEY_ALIAS"],
            "--ks-pass",
            "env:ANDROID_KEYSTORE_PASSWORD",
            "--key-pass",
            "env:ANDROID_KEY_PASSWORD",
            "--v4-signing-enabled",
            "false",
            "--out",
            str(apk),
            str(source),
        )
    signature = run(str(sdk / "apksigner"), "verify", "--print-certs", str(apk))
    validate_apk_details(meta, run(str(sdk / "aapt"), "dump", "badging", str(apk)), signature)
    run(str(sdk / "zipalign"), "-c", "-P", "16", "4", str(apk))
    if apk.stat().st_size > MAX_APK_BYTES:
        raise ValueError("Signed APK exceeds the 20 MiB budget")
    with zipfile.ZipFile(apk) as archive:
        if archive.testzip() is not None:
            raise ValueError("APK contains a corrupt ZIP entry")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    (OUTPUT / "SHA256SUMS.txt").write_text(f"{digest}  {apk.name}\n")
    ci = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    (OUTPUT / "release-manifest.json").write_text(
        json.dumps(
            {**meta, "apk": apk.name, "bytes": apk.stat().st_size, "sha256": digest, "workflow": ci}, indent=2
        )
        + "\n"
    )
    (OUTPUT / "RELEASE_NOTES.md").write_text(
        f"{marker(meta)}\n\nNutriGo Android 测试版 **{meta['version']}**\n\n"
        f"- ARM64 APK：{apk.stat().st_size / 1048576:.2f} MiB，Android 8.0 及以上。\n"
        "- 沿用已发布测试版的包名和签名，可直接覆盖安装，无需卸载。\n"
        "- 已配置线上服务器；AI 对话、识别和数据同步需要联网。\n"
        "- 此包仍使用现有测试签名，不是商店正式发布包。\n"
        f"- [全部 CI 检查]({ci})通过；签名、版本、ZIP 完整性、16 KB 对齐及 20 MiB 上限已验证。\n\n"
        f"源码提交：`{meta['sha']}`。附件包含 APK、SHA256SUMS.txt 和构建信息 release-manifest.json。\n"
    )
    print(f"Verified {apk.name}: {apk.stat().st_size} bytes, SHA-256 {digest}")


def publish(meta):
    release = check_remote(meta)
    notes = OUTPUT / "RELEASE_NOTES.md"
    repo = os.environ["GITHUB_REPOSITORY"]
    if release is None:
        # The release list may lag behind a successful create. Use the returned
        # ID for every mutation instead of trying to rediscover a new draft.
        release = api(
            f"repos/{repo}/releases",
            method="POST",
            payload={
                "tag_name": meta["tag"],
                "target_commitish": meta["sha"],
                "draft": True,
                "prerelease": True,
                "name": f"NutriGo Android {meta['version']}",
                "body": notes.read_text(),
            },
        )
    if release is None:
        raise ValueError("Release draft was not created")
    validate_release_state(meta, release, None)
    files = [
        OUTPUT / f"NutriGo-Android-arm64-{meta['version']}.apk",
        OUTPUT / "SHA256SUMS.txt",
        OUTPUT / "release-manifest.json",
    ]
    # Only this commit's unpublished draft may be resumed after an upload failure.
    for file in files:
        for asset in release.get("assets", []):
            if asset["name"] == file.name:
                api(f"repos/{repo}/releases/assets/{asset['id']}", method="DELETE")
        api(
            f"https://uploads.github.com/repos/{repo}/releases/{release['id']}/assets?name={quote(file.name)}",
            method="POST",
            input_file=file,
        )
    uploaded = api(f"repos/{repo}/releases/{release['id']}")
    validate_release_state(meta, uploaded, None)
    expected = {
        f.name: (f.stat().st_size, "sha256:" + hashlib.sha256(f.read_bytes()).hexdigest()) for f in files
    }
    actual = {a["name"]: (a["size"], a.get("digest")) for a in uploaded["assets"]}
    if expected != actual:
        raise ValueError("Release asset size or checksum mismatch; keeping the release as a draft")
    check_remote(meta)
    published = api(
        f"repos/{repo}/releases/{release['id']}",
        method="PATCH",
        payload={"draft": False, "body": notes.read_text()},
    )
    if published["draft"]:
        raise ValueError("Release is still a draft")
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write(f"Published [{meta['tag']}]({published['html_url']})\n\nCommit: `{meta['sha']}`\n")
    print(published["html_url"])


def main():
    os.chdir(ROOT)
    meta = load_metadata()
    command = sys.argv[1]
    if command == "prepare":
        run("git", "merge-base", "--is-ancestor", meta["sha"], "origin/main")
        check_remote(meta)
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            for key in ("tag", "version", "sha"):
                output.write(f"{key}={meta[key]}\n")
        print(f"Ready to release {meta['tag']} at {meta['sha']}")
    elif command == "sign":
        sign(meta)
    elif command == "publish":
        publish(meta)
    else:
        raise ValueError("Expected prepare, sign or publish")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Never echo signing environment variables or subprocess command arguments.
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"Release failed: {detail}", file=sys.stderr)
        sys.exit(1)
