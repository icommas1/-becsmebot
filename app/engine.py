"""Pure, fast crypto text filters. Address patterns find *candidates*, not verified token contracts."""
import hashlib
import re
import regex as safe_regex

B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
SOL_PATTERN = re.compile(r'(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])')
EVM_PATTERN = re.compile(r'(?<![a-zA-Z0-9])0x[a-fA-F0-9]{40}(?![a-zA-Z0-9])')


def is_base58_32(value: str) -> bool:
    if any(c not in B58 for c in value):
        return False
    number = 0
    for c in value:
        number = number * 58 + B58.index(c)
    length = (number.bit_length() + 7) // 8 + len(value) - len(value.lstrip('1'))
    return length == 32


def extract_addresses(text: str, network: str = 'both') -> list[dict]:
    candidates = []
    if network in ('solana', 'both'):
        candidates += [{'network': 'solana', 'address': m.group(0)} for m in SOL_PATTERN.finditer(text) if is_base58_32(m.group(0))]
    if network in ('evm', 'both'):
        candidates += [{'network': 'evm', 'address': m.group(0)} for m in EVM_PATTERN.finditer(text)]
    seen = set()
    return [p for p in candidates if not ((p['network'], p['address'].lower()) in seen or seen.add((p['network'], p['address'].lower())))]


def split_terms(value: str) -> list[str]:
    return [term.strip() for term in value.split(',') if term.strip()]


def normalized_text(value: str) -> str:
    return ' '.join(re.sub(r'[^\w\s]', ' ', value.lower()).split())


def decide(message: str, route: dict) -> dict:
    """Deterministic filter result, used by simulation and live ingestion."""
    message = message[:12000]
    low = message.lower()
    addresses = extract_addresses(message, route.get('network', 'both'))
    blocked = [term for term in split_terms(route.get('blocked', '')) if term.lower() in low]
    allowed = split_terms(route.get('allowed', ''))
    found = [term for term in allowed if term.lower() in low]
    if blocked:
        return {'decision': 'block', 'reason': 'Blocked keyword: ' + ', '.join(blocked), 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': blocked, 'regex_match': False}
    if route.get('mode') == 'express':
        return {'decision': 'forward', 'reason': 'Express route: essential checks passed', 'addresses': addresses, 'allowed_hits': [], 'blocked_hits': [], 'regex_match': False}
    if route.get('require_contract', False) and not addresses:
        return {'decision': 'block', 'reason': 'No valid address-format candidate', 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': [], 'regex_match': False}
    mode = route.get('match_mode', 'any')
    if allowed and not (len(found) == len(allowed) if mode == 'all' else bool(found)):
        return {'decision': 'block', 'reason': 'Allowlist condition not met', 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': [], 'regex_match': False}
    pattern = route.get('pattern', '').strip()
    matched = False
    if pattern:
        try:
            if len(pattern) > 250:
                raise ValueError('Regex is too long (maximum 250 characters)')
            matched = bool(safe_regex.search(pattern, message, flags=safe_regex.IGNORECASE, timeout=0.025))
        except (safe_regex.error, TimeoutError, ValueError) as ex:
            return {'decision': 'invalid', 'reason': f'Invalid or costly regex: {str(ex)[:120]}', 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': [], 'regex_match': False}
        if not matched:
            return {'decision': 'block', 'reason': 'Custom regex did not match', 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': [], 'regex_match': False}
    return {'decision': 'forward', 'reason': 'All local checks passed', 'addresses': addresses, 'allowed_hits': found, 'blocked_hits': [], 'regex_match': matched}


def dedup_fingerprint(message: str, result: dict) -> str:
    contracts = sorted(f"{a['network']}:{a['address'].lower()}" for a in result['addresses'])
    key = '|'.join(contracts) if contracts else normalized_text(message)
    return hashlib.sha256(key.encode()).hexdigest()
