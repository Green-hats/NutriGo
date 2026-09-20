import copy
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import android_release
from android_release import marker, metadata, validate_apk_details, validate_release_state


class ReleaseGuardsTest(unittest.TestCase):
    def setUp(self):
        self.args = dict(
            config={
                "version": "0.1.2",
                "identifier": "com.greenhats.nutrigo",
                "bundle": {"android": {"debugApplicationIdSuffix": ".debug"}},
            },
            cargo_version="0.1.2",
            event="workflow_dispatch",
            ref="refs/heads/main",
            sha="a" * 40,
            api="https://154.8.198.71",
            certificate="b" * 64,
        )
        self.meta = metadata(**self.args)

    def test_manual_release_uses_version_and_deterministic_android_code(self):
        self.assertEqual((self.meta["tag"], self.meta["code"]), ("android-v0.1.2", 1002))
        self.assertEqual(self.meta["package"], "com.greenhats.nutrigo")

    def test_matching_tag_can_trigger_release(self):
        self.args.update(event="push", ref="refs/tags/android-v0.1.2")
        self.assertEqual(metadata(**self.args), self.meta)

    def test_wrong_trigger_or_tag_is_rejected(self):
        for event, ref in [
            ("push", "refs/heads/main"),
            ("push", "refs/tags/android-v0.1.1"),
            ("pull_request", "refs/pull/1/merge"),
            ("workflow_dispatch", "refs/heads/test"),
        ]:
            with self.subTest(event=event, ref=ref), self.assertRaises(ValueError):
                metadata(**{**self.args, "event": event, "ref": ref})

    def test_invalid_version_is_rejected(self):
        for version in ["0.1.2-beta", "01.1.2", "0.1.2\nx=y", "0.0.0", "0.1000.0", "0.1.1000", "2101.0.0"]:
            args = copy.deepcopy(self.args)
            args["config"]["version"] = args["cargo_version"] = version
            with self.subTest(version=version), self.assertRaises(ValueError):
                metadata(**args)

    def test_mismatched_cargo_version_is_rejected(self):
        with self.assertRaises(ValueError):
            metadata(**{**self.args, "cargo_version": "0.1.1"})

    def test_changing_package_or_version_code_is_rejected(self):
        args = copy.deepcopy(self.args)
        args["config"]["identifier"] = "com.greenhats.other"
        with self.assertRaises(ValueError):
            metadata(**args)
        for override in [
            {"versionCode": 1},
            {"autoIncrementVersionCode": True},
        ]:
            args = copy.deepcopy(self.args)
            args["config"]["bundle"]["android"].update(override)
            with self.subTest(override=override), self.assertRaises(ValueError):
                metadata(**args)

    def test_placeholder_and_invalid_endpoints_are_rejected(self):
        for endpoint in [
            "",
            "https://api.example.com",
            "http://154.8.198.71",
            "https://a.test/api",
            "https://u:p@a.test",
            "https://a.test/?token=secret",
            "https://a.test/#x",
            "https://a.test:wrong",
        ]:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                metadata(**{**self.args, "api": endpoint})

    def test_missing_signing_fingerprint_is_rejected(self):
        with self.assertRaises(ValueError):
            metadata(**{**self.args, "certificate": ""})

    def test_published_release_can_never_be_overwritten(self):
        with self.assertRaises(ValueError):
            validate_release_state(self.meta, {"draft": False}, self.meta["sha"])

    def test_existing_tag_cannot_be_moved(self):
        with self.assertRaises(ValueError):
            validate_release_state(self.meta, None, "c" * 40)

    def test_only_own_draft_from_same_commit_can_resume(self):
        draft = {"draft": True, "target_commitish": self.meta["sha"], "body": marker(self.meta)}
        validate_release_state(self.meta, draft, None)
        for change in [{"body": "someone else's draft"}, {"target_commitish": "c" * 40}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_release_state(self.meta, {**draft, **change}, None)

    def test_apk_must_match_package_version_abi_and_certificate(self):
        badging = (
            "package: name='com.greenhats.nutrigo' versionCode='1002' versionName='0.1.2'\n"
            "native-code: 'arm64-v8a'\n"
        )
        signature = "Signer #1 certificate SHA-256 digest: " + self.meta["certificate"]
        manifest = "A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0\n"
        validate_apk_details(self.meta, badging, signature, manifest)
        for invalid in [
            badging.replace("com.greenhats.nutrigo", "com.greenhats.other"),
            badging.replace("1002", "1001"),
            badging.replace("0.1.2", "0.1.1"),
            badging.replace("'arm64-v8a'", "'arm64-v8a' 'x86_64'"),
            badging + "application-debuggable\n",
        ]:
            with self.subTest(badging=invalid), self.assertRaises(ValueError):
                validate_apk_details(self.meta, invalid, signature, manifest)
        for invalid in [
            "",
            signature.replace("b" * 64, "c" * 64),
            signature + "\n" + signature.replace("#1", "#2"),
        ]:
            with self.subTest(signature=invalid), self.assertRaises(ValueError):
                validate_apk_details(self.meta, badging, invalid, manifest)
        for invalid in [
            "",
            manifest.replace("0x0", "0xffffffff"),
            manifest + "A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff\n",
        ]:
            with self.subTest(manifest=invalid), self.assertRaises(ValueError):
                validate_apk_details(self.meta, badging, signature, invalid)

    def test_new_draft_publishes_when_release_list_is_stale(self):
        self.check_publish(existing=False)

    def test_resume_only_publishes_after_uploaded_asset_digests_match(self):
        self.check_publish(existing=True)

    def check_publish(self, existing):
        draft = {"id": 1, "draft": True, "target_commitish": self.meta["sha"], "body": marker(self.meta)}
        for mismatch in [False, True]:
            with self.subTest(mismatch=mismatch), tempfile.TemporaryDirectory() as temp:
                output = Path(temp)
                (output / "RELEASE_NOTES.md").write_text(marker(self.meta))
                names = ["NutriGo-Android-arm64-0.1.2.apk", "SHA256SUMS.txt", "release-manifest.json"]
                assets = []
                for name in names:
                    data = name.encode()
                    (output / name).write_bytes(data)
                    assets.append(
                        {
                            "name": name,
                            "size": len(data),
                            "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
                        }
                    )
                if mismatch:
                    assets[0]["digest"] = "sha256:" + "0" * 64

                def respond(path, *, method="GET", payload=None, input_file=None):
                    if method == "POST" and path == "repos/example/repo/releases":
                        self.assertTrue(payload["draft"])
                        self.assertFalse(payload["prerelease"])
                        self.assertEqual(payload["target_commitish"], self.meta["sha"])
                        return draft
                    if method == "POST" and input_file:
                        self.assertEqual(
                            path,
                            "https://uploads.github.com/repos/example/repo/releases/1/assets?name="
                            + input_file.name,
                        )
                        return next(a for a in assets if a["name"] == input_file.name)
                    if method == "DELETE":
                        self.assertEqual(path, "repos/example/repo/releases/assets/9")
                        return None
                    self.assertEqual(path, "repos/example/repo/releases/1")
                    if method == "PATCH":
                        self.assertFalse(payload["draft"])
                        self.assertFalse(payload["prerelease"])
                        return {
                            "draft": False,
                            "prerelease": False,
                            "html_url": "https://github.com/example/repo/releases/tag/test",
                        }
                    self.assertEqual(method, "GET")
                    return {**draft, "assets": assets}

                previous = {**draft, "assets": [{"id": 9, "name": names[0]}]} if existing else None
                with (
                    patch.object(android_release, "OUTPUT", output),
                    # A successful create must not depend on this list becoming current.
                    patch.object(android_release, "check_remote", return_value=previous),
                    patch.object(android_release, "api", side_effect=respond) as requests,
                    patch.dict(
                        os.environ,
                        GITHUB_REPOSITORY="example/repo",
                        GITHUB_STEP_SUMMARY=str(output / "summary"),
                    ),
                ):
                    if mismatch:
                        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                            android_release.publish(self.meta)
                    else:
                        android_release.publish(self.meta)
                    publication = [c for c in requests.call_args_list if c.kwargs.get("method") == "PATCH"]
                    self.assertEqual(len(publication), 0 if mismatch else 1)
                    uploads = [c for c in requests.call_args_list if c.kwargs.get("input_file")]
                    self.assertEqual(len(uploads), 3)
                    creations = [
                        c
                        for c in requests.call_args_list
                        if c.args == ("repos/example/repo/releases",) and c.kwargs.get("method") == "POST"
                    ]
                    self.assertEqual(len(creations), 0 if existing else 1)
                    deletions = [c for c in requests.call_args_list if c.kwargs.get("method") == "DELETE"]
                    self.assertEqual(len(deletions), 1 if existing else 0)


if __name__ == "__main__":
    unittest.main()
