import unittest
from app.engine import dedup_fingerprint, extract_addresses

class ContractOnlyDedupTests(unittest.TestCase):
    def test_no_contract_has_no_dedup_fingerprint(self):
        self.assertEqual(dedup_fingerprint('Repeated chat announcement', {'addresses': []}), '')
    def test_identical_contract_ignores_surrounding_text(self):
        ca='0x1111111111111111111111111111111111111111'
        first={'addresses':extract_addresses('BUY '+ca)}
        second={'addresses':extract_addresses('SELL '+ca)}
        self.assertEqual(dedup_fingerprint('BUY '+ca,first),dedup_fingerprint('SELL '+ca,second))
    def test_different_contracts_not_duplicates(self):
        a='0x1111111111111111111111111111111111111111'
        b='0x2222222222222222222222222222222222222222'
        self.assertNotEqual(dedup_fingerprint(a,{'addresses':extract_addresses(a)}),dedup_fingerprint(b,{'addresses':extract_addresses(b)}))
if __name__=='__main__':
    unittest.main()
