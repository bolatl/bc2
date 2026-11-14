#!/usr/bin/env python3
"""Exercise the backend golden path using two independent cookie jars.

Start the server with empty STRIPE_SECRET_KEY, then run this script.
Uses only Python's standard library. All submitted text is synthetic demo data.
"""
import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request


class Browser:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.http = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + '/api/v1' + path, data=data,
                                     method=method, headers={'Content-Type': 'application/json'})
        try:
            with self.http.open(req, timeout=20) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'{method} {path}: HTTP {error.code}: {error.read().decode()}') from None


def drive(browser, session_id):
    answers = {'thermometer_start': '8', 'facts': 'We argued about doing the dishes.',
               'feelings': 'I felt alone with the chores.', 'needs': 'I wanted us to agree on a plan.',
               'partner_view': 'Maybe they were tired too.',
               'rehearsal': 'Could we agree on one small thing to do differently?',
               'thermometer_end': '3', 'ready': 'I am ready to talk'}
    for _ in range(12):
        turn = browser.request('GET', f'/fight-sessions/{session_id}')['currentTurn']
        if turn['type'] != 'next_turn':
            return turn
        result = browser.request('POST', f'/fight-sessions/{session_id}/turns', {
            'turnIndex': turn['turnIndex'], 'answerSource': 'free_text',
            'answerText': answers[turn['stage']]})
        if result['type'] != 'next_turn':
            return result
    raise RuntimeError('Session exceeded its bounded flow')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:8080')
    parser.add_argument('--delete-after', action='store_true', help='Delete the synthetic couple after verification')
    args = parser.parse_args()
    a, b = Browser(args.base_url), Browser(args.base_url)
    a.request('POST', '/couples', {'age': '30-34', 'relationshipStatus': 'married',
        'togetherDuration': '3-7', 'hasKids': 'no', 'conflictStyle': 'talk_now',
        'repairNeed': 'plan', 'fightTopics': ['chores'], 'goal': 'understand_each_other'})
    a.request('POST', '/personality-tests', {'answers': [3] * 20})
    first = a.request('POST', '/fight-sessions', {})['sessionId']
    assert drive(a, first)['type'] == 'paywall_required'
    teaser = a.request('GET', f'/fight-sessions/{first}/result')
    assert teaser['openingLine'] == '' and teaser['tier'] == 'free_short'
    checkout = a.request('POST', '/subscriptions/checkout', {'plan': 'yearly'})
    if not checkout['checkoutSessionId'].startswith('cs_mock_'):
        raise RuntimeError('This script requires local mock payment mode. Use an empty STRIPE_SECRET_KEY.')
    a.request('POST', '/subscriptions/confirm', {'checkoutSessionId': checkout['checkoutSessionId']})
    assert drive(a, first)['type'] == 'completed'
    invite = urllib.parse.urlparse(a.request('GET', '/couples/me')['inviteUrl']).path
    b.request('GET', invite)
    b.request('POST', invite + '/join', {'age': '30-34', 'conflictStyle': 'need_space', 'repairNeed': 'being_heard'})
    second = b.request('POST', '/fight-sessions', {})['sessionId']
    assert drive(b, second)['type'] == 'completed'
    records = a.request('GET', '/journal')
    assert len(records) == 1
    record = records[0]['id']
    a.request('POST', f'/journal/{record}/rating', {'rating': 9})
    rated = b.request('POST', f'/journal/{record}/rating', {'rating': 8})
    assert rated['averageRating'] == 8.5 and rated['color'] == 'green'
    stats = a.request('GET', '/journal/stats')
    assert stats['totalFights'] == 1 and stats['topicCounts']['chores'] == 1
    assert a.request('GET', f'/fight-sessions/{first}')['turns'] == []
    assert b.request('GET', f'/fight-sessions/{second}')['turns'] == []
    if args.delete_after:
        a.request('DELETE', '/couples/me')
    print('PASS: personality → free teaser → mock payment → same session resumed → partner B → shared journal')
    print(json.dumps({'averageRating': rated['averageRating'], 'color': rated['color'],
                      'rawHistoryDeleted': True, 'coupleDeleted': args.delete_after, 'stats': stats}, indent=2))


if __name__ == '__main__':
    main()
