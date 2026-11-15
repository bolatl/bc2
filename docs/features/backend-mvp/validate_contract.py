#!/usr/bin/env python3
"""Validate the OpenAPI vocabulary and every request/response fixture.

Install the project's requirements.txt for PyYAML, jsonschema format checks,
referencing, and complete OpenAPI 3.1 document validation. Without
openapi-spec-validator, only the schema and fixture checks run.
No server is contacted unless --live-url is supplied.
"""
from pathlib import Path
import json
import re
import sys
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent
spec = yaml.safe_load((ROOT / 'OPENAPI.yaml').read_text())
assert spec['openapi'] == '3.1.0'
operations = {(method.upper(), path): op for path, item in spec['paths'].items()
              for method, op in item.items() if method in ('get', 'post', 'delete', 'put', 'patch')}
assert len(operations) == 21, f'Expected 21 business operations, got {len(operations)}'
router = (ROOT.parents[2] / 'internal/handler/router.go').read_text()
registered = {(method.upper(), '/api/v1' + path)
              for method, path in re.findall(r'(?m)^\s*r\.(Get|Post|Delete|Put|Patch)\("([^"]+)"', router)}
assert registered == set(operations), f'Router/schema mismatch: {registered ^ set(operations)}'
ids = [op['operationId'] for op in operations.values()]
assert len(set(ids)) == len(ids), 'Duplicate operation ID'
root_uri = 'urn:lovelab:openapi'
schema_root = {'$schema': 'https://json-schema.org/draft/2020-12/schema', **spec}
registry = Registry().with_resource(root_uri, Resource.from_contents(schema_root))

def check_refs(value):
    if isinstance(value, dict):
        if '$ref' in value:
            ref = value['$ref']
            assert ref.startswith('#/'), f'Unexpected external ref {ref}'
            target = spec
            for part in ref[2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        for nested in value.values():
            check_refs(nested)
    elif isinstance(value, list):
        for nested in value:
            check_refs(nested)
check_refs(spec)
for name, schema in spec['components']['schemas'].items():
    Draft202012Validator.check_schema(schema)

def validate(payload, schema, label):
    # Give fragment references the OpenAPI document as their resolution base.
    validator = Draft202012Validator({'components': spec['components'], **schema}, registry=registry,
                                      format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(payload), key=lambda e: str(e.path))
    assert not errors, label + ': ' + '; '.join(e.message for e in errors)

fixtures = json.loads((ROOT / 'MOCK_RESPONSES.json').read_text())['scenarios']
covered = set()
for case in fixtures:
    candidates = [(key, op) for key, op in operations.items()
                  if key[0] == case['method'] and re.fullmatch(re.sub(r'\{[^}]+\}', '[^/]+', key[1]), case['path'])]
    # Static paths such as /journal/stats take precedence over parameters.
    candidates.sort(key=lambda item: item[0][1].count('{'))
    assert candidates, f"Unknown route in {case['name']}"
    key, operation = candidates[0]
    status = str(case['status'])
    assert status in operation['responses'], f"Undeclared status in {case['name']}: {status}"
    if 'request' in case:
        validate(case['request'], operation['requestBody']['content']['application/json']['schema'], case['name'] + ' request')
    content = operation['responses'][status].get('content')
    if content:
        assert 'response' in case, f"Missing response in {case['name']}"
        validate(case['response'], content['application/json']['schema'], case['name'] + ' response')
    else:
        assert 'response' not in case, f"Unexpected response body in {case['name']}"
    if 200 <= case['status'] < 300:
        covered.add(key)
assert covered == set(operations), 'Missing success fixtures: ' + repr(set(operations) - covered)
try:
    from openapi_spec_validator import validate as validate_openapi
except ImportError:
    print('OpenAPI schema/ref checks passed (full document validator not installed).')
else:
    validate_openapi(spec)
    print('Full OpenAPI 3.1 document validation passed.')
print(f'{len(operations)} operations, {len(spec["components"]["schemas"])} schemas, {len(fixtures)} request/response fixtures passed.')


def validate_live(base_url):
    """Exercise all 21 routes with synthetic data and check real response schemas."""
    import http.cookiejar
    import importlib.util
    import urllib.error
    import urllib.parse
    import urllib.request

    demo_path = ROOT.parents[2] / 'scripts/demo.py'
    module_spec = importlib.util.spec_from_file_location('lovelab_demo', demo_path)
    demo = importlib.util.module_from_spec(module_spec)
    old_bytecode_setting = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        module_spec.loader.exec_module(demo)
    finally:
        sys.dont_write_bytecode = old_bytecode_setting
    live_covered = set()
    count = 0

    class Browser(demo.Browser):
        def request(self, method, path, body=None, expected=None):
            nonlocal count
            request = urllib.request.Request(self.base + '/api/v1' + path,
                data=None if body is None else json.dumps(body).encode(), method=method,
                headers={'Content-Type': 'application/json'})
            try:
                response = self.http.open(request, timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.code
                raw = response.read()
                payload = json.loads(raw) if raw else None
            candidates = [(key, op) for key, op in operations.items()
                if key[0] == method and re.fullmatch(re.sub(r'\{[^}]+\}', '[^/]+', key[1]), '/api/v1' + path)]
            candidates.sort(key=lambda item: item[0][1].count('{'))
            assert candidates, f'Undocumented live route: {method} {path}'
            key, operation = candidates[0]
            assert str(status) in operation['responses'], f'Undocumented live status: {method} {path}: {status}'
            content = operation['responses'][str(status)].get('content')
            if content:
                validate(payload, content['application/json']['schema'], f'live {method} {path}: {status}')
            else:
                assert payload is None
            if expected is not None:
                assert status == expected, f'{method} {path}: wanted {expected}, got {status}'
            else:
                assert 200 <= status < 300, f'{method} {path}: HTTP {status}: {payload}'
            if 200 <= status < 300:
                live_covered.add(key)
            count += 1
            return payload

    a, b, anonymous = Browser(base_url), Browser(base_url), Browser(base_url)
    created = False
    try:
        a.request('POST', '/couples', {'age': '30-34', 'relationshipStatus': 'married',
            'togetherDuration': '3-7', 'hasKids': 'no', 'conflictStyle': 'talk_now',
            'repairNeed': 'plan', 'fightTopics': ['chores'], 'goal': 'understand_each_other'})
        created = True
        anonymous.request('GET', '/couples/me', expected=401)
        a.request('POST', '/personality-tests', {'answers': [3] * 20})
        a.request('GET', '/personality-tests/me')
        a.request('GET', '/subscriptions/me')
        session_id = a.request('POST', '/fight-sessions', {})['sessionId']
        a.request('POST', f'/fight-sessions/{session_id}/turns',
                  {'turnIndex': 0, 'answerSource': 'free_text', 'answerText': '8'})
        a.request('POST', f'/fight-sessions/{session_id}/back', {'turnIndex': 0})
        assert demo.drive(a, session_id)['type'] == 'paywall_required'
        a.request('GET', f'/fight-sessions/{session_id}/result')
        a.request('GET', '/journal', expected=402)
        checkout = a.request('POST', '/subscriptions/checkout', {'plan': 'yearly'})
        assert checkout['checkoutSessionId'].startswith('cs_mock_'), 'Live validation requires local mock payment mode.'
        assert a.request('POST', '/subscriptions/checkout', {'plan': 'yearly'}) == checkout
        a.request('POST', '/subscriptions/checkout', {'plan': 'monthly'}, expected=409)
        a.request('POST', '/subscriptions/confirm', {'checkoutSessionId': checkout['checkoutSessionId']})
        a.request('GET', f'/fight-sessions/{session_id}/result')
        assert demo.drive(a, session_id)['type'] == 'completed'
        invitation = urllib.parse.urlparse(a.request('GET', '/couples/me')['inviteUrl']).path
        b.request('GET', invitation)
        b.request('POST', invitation + '/join', {'age': '30-34', 'conflictStyle': 'need_space', 'repairNeed': 'being_heard'})
        b.request('GET', f'/fight-sessions/{session_id}', expected=404)
        second = b.request('POST', '/fight-sessions', {})['sessionId']
        assert demo.drive(b, second)['type'] == 'completed'
        a.request('GET', f'/fight-sessions/{session_id}/result')
        record_id = a.request('GET', '/journal')[0]['id']
        a.request('POST', f'/journal/{record_id}/rating', {'rating': 9})
        b.request('POST', f'/journal/{record_id}/rating', {'rating': 5})
        a.request('GET', '/journal/stats')
        a.request('GET', f'/journal/{record_id}')
        a.request('GET', '/journal/unknown-record', expected=404)
        # Checkpoints are enabled by ENABLE_CHECKPOINTS, so this route is only
        # exercised for its documented "nothing to answer" conflict here.
        a.request('POST', f'/fight-sessions/{session_id}/checkpoint', {'decision': 'continue'}, expected=409)
        b.request('POST', f'/journal/{record_id}/rating', {'rating': None})
        abandoned = a.request('POST', '/fight-sessions', {})['sessionId']
        a.request('POST', f'/fight-sessions/{abandoned}/skip-topic', {})
        stopped = a.request('POST', '/fight-sessions', {})['sessionId']
        a.request('POST', f'/fight-sessions/{stopped}/turns',
                  {'turnIndex': 0, 'answerSource': 'free_text', 'answerText': 'My partner hit me.'})
        a.request('GET', f'/fight-sessions/{stopped}')
        a.request('GET', f'/fight-sessions/{stopped}/result', expected=409)
    finally:
        if created:
            a.request('DELETE', '/couples/me')
    flag_gated = {('POST', '/api/v1/fight-sessions/{sessionId}/checkpoint')}
    assert live_covered | flag_gated == set(operations), f'Missing live routes: {set(operations) - live_covered - flag_gated}'
    print(f'Live validation passed: {count} actual response bodies across all 21 operations; synthetic couple deleted.')


if '--live-url' in sys.argv:
    index = sys.argv.index('--live-url')
    assert index + 1 < len(sys.argv), '--live-url needs a URL'
    validate_live(sys.argv[index + 1])
