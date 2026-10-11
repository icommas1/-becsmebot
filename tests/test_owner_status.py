import unittest
from types import SimpleNamespace
from unittest.mock import patch
from app.main import is_owner, is_valid_init_data
class OwnerStatusTests(unittest.TestCase):
    def test_shared_admin_key_not_owner(self):
        req=SimpleNamespace(headers={'x-becs-key':'any-key'})
        with patch('app.main.is_valid_init_data',return_value=False):
            self.assertFalse(is_owner(req))
    def test_signed_owner_required(self):
        req=SimpleNamespace(headers={'x-telegram-init-data':'signed'})
        with patch('app.main.is_valid_init_data',return_value=True) as check:
            self.assertTrue(is_owner(req))
            check.assert_called_once_with('signed')
    def test_missing_init_data_rejected(self):
        with patch.dict('os.environ',{'TELEGRAM_BOT_TOKEN':'test','BECS_ALLOWED_TELEGRAM_ID':'1'}):
            self.assertFalse(is_valid_init_data(''))
if __name__=='__main__':unittest.main()
