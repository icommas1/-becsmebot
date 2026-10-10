import unittest
from app.engine import extract_addresses, decide
SOL='So11111111111111111111111111111111111111112'
EVM='0x'+'a'*40
def route(**kw):
    base={'mode':'smart','network':'both','blocked':'','allowed':'','pattern':'','match_mode':'any','require_contract':True}
    return {**base,**kw}
class IsolatedCryptoFilterTests(unittest.TestCase):
    def test_solana_and_evm(self):
        found=extract_addresses('🚀 '+SOL+' '+EVM)
        self.assertEqual({x['network'] for x in found},{'solana','evm'})
    def test_no_contract_no_forward(self):
        self.assertEqual(decide('📈 https://x.com/example/status/123',route())['decision'],'block')
    def test_all_emojis_including_variation(self):
        self.assertEqual(decide('📈 🚀 '+SOL,route(allowed='🚀'))['decision'],'forward')
        self.assertEqual(decide('🧑🏽‍🚀 '+SOL,route(allowed='🧑🏽‍🚀'))['decision'],'forward')
    def test_blocked_keyword_takes_priority(self):
        self.assertEqual(decide('🎁 giveaway '+SOL,route(blocked='giveaway'))['decision'],'block')
    def test_x_status_regex(self):
        pattern=r'https?://(?:www\.)?(?:x\.com|twitter\.com)/[A-Za-z0-9_]+/status/\d+'
        self.assertEqual(decide('https://x.com/example/status/123 '+SOL,route(pattern=pattern))['decision'],'forward')
        self.assertEqual(decide('https://twitter.com/example/status/123 '+SOL,route(pattern=pattern))['decision'],'forward')
        self.assertEqual(decide('https://x.com/example '+SOL,route(pattern=pattern))['decision'],'block')
    def test_market_cap_regex(self):
        pattern=r'(?i)\b(?:mc|market cap)\s*[:=$ ]*\s*\$?\d+(?:\.\d+)?\s*[kmb]\b'
        self.assertEqual(decide('MC $28K '+SOL,route(pattern=pattern))['decision'],'forward')
        self.assertEqual(decide('price $28K '+SOL,route(pattern=pattern))['decision'],'block')
    def test_bad_regex_is_not_allowed(self):
        self.assertEqual(decide(SOL,route(pattern='('))['decision'],'invalid')
if __name__=='__main__':unittest.main()
