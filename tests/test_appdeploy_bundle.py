"""Offline release contract. No AppDeploy calls or production network access."""
import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('appdeploy_bundle', ROOT / 'scripts/build_appdeploy_bundle.py')
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)


class AppDeployBundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.changes, cls.info = bundle.build_changes()
        cls.js = cls.changes['public' + cls.info['assets']['app.js']]

    def test_existing_app_payload_is_changed_files_only(self):
        payload = bundle.deployment_payload(self.changes)
        self.assertEqual(payload['app_id'], bundle.APP_ID)
        self.assertEqual(payload['app_type'], 'frontend-only')
        self.assertEqual(payload['frontend_template'], 'html-static')
        self.assertEqual(payload['model'], 'chat')
        self.assertEqual(payload['intent'], 'feature')
        self.assertEqual(payload['initiator'], 'user')
        self.assertEqual(payload['type'], 'feature')
        self.assertEqual(len(payload['files']), 6)
        self.assertEqual(len({file['filename'] for file in payload['files']}), 6)
        for file in payload['files']:
            self.assertEqual(set(file), {'filename', 'content'})
            self.assertEqual(file['content'], self.changes[file['filename']])
            self.assertTrue(bundle.safe_relative(file['filename']))
            self.assertNotIn(file['filename'], bundle.BUILD_BASE_PATHS)
        self.assertNotIn('deletePaths', payload)

    def test_content_hashed_assets_and_index_resolve(self):
        index = self.changes['index.html']
        self.assertNotIn('becs-v2', index)
        for original, url in self.info['assets'].items():
            content = self.changes['public' + url]
            self.assertIn(bundle.digest(content)[:16], url)
            self.assertIn(url, index)
            self.assertNotIn('/assets/' + original, index)
        manifest = json.loads(self.changes['public' + self.info['assets']['manifest.webmanifest']])
        self.assertEqual(manifest['icons'][0]['src'], self.info['assets']['icon.svg'])
        local_urls = re.findall(r'(?:src|href)="(/[^\"]+)"', index)
        self.assertEqual(set(local_urls), set(self.info['assets'].values()))

    def test_sha256_manifest_matches_every_file(self):
        for path, content in self.changes.items():
            self.assertEqual(self.info['changed_sha256'][path], bundle.digest(content))
        for path, sha in self.info['source_sha256'].items():
            self.assertEqual(sha, bundle.digest((ROOT / path).read_bytes()))

    def test_fixed_railway_api_and_signed_header(self):
        self.assertEqual(self.js.count("fetch('" + bundle.API_URL + "' + path"), 1)
        self.assertEqual(self.js.count('await fetch('), 1)
        self.assertIn("'X-Telegram-Init-Data': signed", self.js)
        self.assertIn("credentials: 'omit'", self.js)
        self.assertLess(self.js.index('if (!signed)'), self.js.index('await fetch('))
        self.assertIn('missing_telegram_launch', self.js)
        self.assertIn('missing, invalid or expired', self.js)
        self.assertIn('state.accessVersion++;\n      clearWorkspace();', self.js)

    def test_no_hosted_admin_key_sdk_storage_or_worker(self):
        for forbidden in bundle.FORBIDDEN_HOSTED:
            self.assertNotIn(forbidden.lower(), self.js.lower())
        self.assertNotIn('/assets/sw.js', self.changes['index.html'])
        self.assertFalse(any(path.endswith('/sw.js') for path in self.changes))
        self.assertIn('Open Becs in Telegram', self.js)
        self.assertNotIn('Start the FastAPI service', self.js)

    def test_approved_account_controls_remain(self):
        source = (ROOT / 'static/app.js').read_text()
        start, end = 'async function login(', 'async function reviewItem('
        self.assertEqual(source.split(start, 1)[1].split(end, 1)[0],
                         self.js.split(start, 1)[1].split(end, 1)[0])
        for marker in ['id="phone"', 'id="telegramCode"', 'id="telegramPassword"',
                       "'login-start':", "'login-code':", "'login-password':", "'disconnect':"]:
            self.assertIn(marker, self.js)
        self.assertIn("if(state.access!=='approved'&&target.dataset.action!=='retry-access')return;", self.js)

    def test_approved_source_anchor_drift_fails_closed(self):
        source = (ROOT / 'static/app.js').read_text()
        with self.assertRaisesRegex(ValueError, 'anchors changed'):
            bundle.hosted_script(source.replace('function gatePage(){', 'function otherGate(){'))
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            bundle.replace_once('a a', 'a', 'b')

    def test_production_qa_is_anonymous_and_non_mutating(self):
        cases = json.loads(self.changes['tests/tests.json'])
        self.assertTrue(3 <= len(cases) <= 5)
        self.assertEqual(sum(case.get('sanity') is True for case in cases), 1)
        allowed = {'name', 'description', 'viewport', 'covers', 'steps', 'expected', 'sanity'}
        for case in cases:
            self.assertTrue(set(case) <= allowed)
            self.assertTrue(case['covers'])
            self.assertIn(case['viewport'], ['mobile', 'desktop'])
            self.assertIn('Do not enter credentials', case['steps'][0])
            self.assertIn('or make any live write', case['steps'][0])
            self.assertIn('If already authenticated, stop this test.', case['steps'][0])
            self.assertNotIn('setup', case)

    def test_css_formatting_preserves_tokens(self):
        before = (ROOT / 'static/styles.css').read_text()
        after = self.changes['public' + self.info['assets']['styles.css']]
        self.assertEqual(re.sub(r'\s', '', before), re.sub(r'\s', '', after))
        self.assertGreater(len(after.splitlines()), 500)
        self.assertEqual(bundle.readable_css('a{content:"a;b{}";x:url("a;b")}'),
                         'a {\n  content:"a;b{}";\n  x:url("a;b")\n}\n')

    def test_baseline_is_exact_and_drift_rejected(self):
        base = ROOT / 'scripts/appdeploy_base'
        files = bundle.verified_base(base, False)
        self.assertEqual(set(files), set(bundle.BUILD_BASE_PATHS))
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / 'base'
            shutil.copytree(base, copy)
            (copy / 'package.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Pinned v3 snapshot changed'):
                bundle.verified_base(copy, False)

    def test_bundle_and_zip_are_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            first, second = Path(temporary) / 'first', Path(temporary) / 'second'
            bundle.build_bundle(first)
            bundle.build_bundle(second)
            self.assertEqual(first.with_suffix('.zip').read_bytes(), second.with_suffix('.zip').read_bytes())
            for path in bundle.BUILD_BASE_PATHS:
                self.assertEqual((first / 'project' / path).read_bytes(),
                                 (ROOT / 'scripts/appdeploy_base' / path).read_bytes())
            for path in self.changes:
                self.assertEqual((first / 'changed' / path).read_text(), self.changes[path])
            with self.assertRaisesRegex(ValueError, 'must be empty'):
                bundle.build_bundle(first)

    def test_output_cannot_overwrite_repository(self):
        with self.assertRaisesRegex(ValueError, 'outside the source repository'):
            bundle.build_bundle(ROOT / 'generated')
        for path in ['/etc/passwd', '../escape', 'assets/../../escape', 'assets\\escape']:
            self.assertFalse(bundle.safe_relative(path))

    @unittest.skipUnless(shutil.which('node'), 'Node required for JavaScript syntax validation')
    def test_generated_javascript_parses(self):
        with tempfile.TemporaryDirectory() as temporary:
            script = Path(temporary) / 'hosted.js'
            script.write_text(self.js)
            result = subprocess.run(['node', '--check', str(script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
