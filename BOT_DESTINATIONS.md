# Telegram bot destinations

Becs accepts a bot already present in the connected personal Telegram account's dialogs as a forwarding destination. Both public @username resolution and selection by its resolved numeric ID are supported. Bots are labeled `bot` and include `is_bot: true` in chat metadata.

Deleted accounts remain rejected. Bot destinations additionally require a personal user session and an unblocked bot. Resolution only reads Telegram state: it never presses Start, unblocks a bot, sends a test message, or changes a route. Channel posting restrictions, group permissions and source/destination loop protection are unchanged.

## Using a trading bot

Open the intended bot directly in the same Telegram account connected to Becs and press Start yourself when needed. Unblock it when applicable. Refresh chats in the route editor and select the bot as the destination. Verify the bot's exact @username; a display name is not an identity check.

The route's existing delivery choice is preserved. `Send text only (loses media)` sends literal message text from the connected account, without a forward header, Markdown parsing or a link preview. `Telegram native forward (preserves media)` remains a native forward. Choose the format accepted by the receiving bot; Becs does not guarantee that a bot accepts every message format.

Review any auto-buy or other automation settings in the receiving bot before enabling a live route. Forwarded content may be treated as an instruction by that bot. This change does not configure trading, click bot buttons, enable live routes, or submit any orders.

## Verification

Run `python -m unittest discover -s tests -p 'test_*.py' -v` and `python tests/browser_bot_destination.py` after installing the test dependencies from the workflow. Backend tests use fake Telegram clients and isolated SQLite databases. The mobile-sized Chromium test serves the repository's real UI through request interception, mocks every API request and blocks external traffic. No production credentials, Telegram messages or trades are used in these tests.
