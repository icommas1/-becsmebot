"""One bounded, address-only rule evaluator shared by simulation and ingestion."""
import hashlib
import re
import regex as safe_regex

B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
SOL_PATTERN = re.compile(r'(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])')
EVM_PATTERN = re.compile(r'(?<![a-zA-Z0-9])0x[a-fA-F0-9]{40}(?![a-zA-Z0-9])')


def is_base58_32(value):
    if any(c not in B58 for c in value):
        return False
    number = 0
    for c in value:
        number = number * 58 + B58.index(c)
    return (number.bit_length()+7)//8 + len(value)-len(value.lstrip('1')) == 32


def address_key(network, address):
    return address.lower() if network == 'evm' else address


def extract_addresses(text, network='both'):
    text = text[:12000]
    candidates = []
    if network in ('solana', 'both'):
        candidates.extend({'network':'solana','address':m.group(0)}
                          for m in SOL_PATTERN.finditer(text) if is_base58_32(m.group(0)))
    if network in ('evm', 'both'):
        candidates.extend({'network':'evm','address':m.group(0)} for m in EVM_PATTERN.finditer(text))
    seen, result = set(), []
    for candidate in candidates:
        key = (candidate['network'], address_key(candidate['network'],candidate['address']))
        if key not in seen:
            seen.add(key)
            result.append(candidate)
    return result


def split_terms(value):
    return [term.strip() for term in value.split(',') if term.strip()]


def normalized_text(value):
    return ' '.join(re.sub(r'[^\w\s]', ' ', value.lower()).split())


def rule_match(rule, text):
    if rule.startswith('re:'):
        pattern = rule[3:]
        if not pattern or len(pattern) > 250:
            raise ValueError('Regex requires 1 to 250 characters')
        return bool(safe_regex.search(pattern,text,flags=safe_regex.IGNORECASE,timeout=0.025))
    return rule.lower() in text.lower()


def decide(message, route):
    message = message[:12000]
    addresses = extract_addresses(message,route.get('network','both'))
    result = {'addresses':addresses,'allowed_hits':[],'blocked_hits':[],'regex_match':False}
    def answer(decision, reason):
        return {**result,'decision':decision,'reason':reason}
    try:
        blocked = route.get('blocked','').strip()
        block_rules = [blocked] if blocked.startswith('re:') else split_terms(blocked)
        result['blocked_hits'] = [rule for rule in block_rules if rule_match(rule,message)]
        if result['blocked_hits']:
            return answer('block','Blocked keyword or rule matched')
        if not addresses:
            return answer('block','No address-format candidate for the selected network')
        allowed = route.get('allowed','').strip()
        allow_rules = [allowed] if allowed.startswith('re:') else split_terms(allowed)
        result['allowed_hits'] = [rule for rule in allow_rules if rule_match(rule,message)]
        if allow_rules:
            eligible = len(result['allowed_hits']) == len(allow_rules) if route.get('match_mode') == 'all' else bool(result['allowed_hits'])
            if not eligible:
                return answer('block','Allowlist condition not met')
        pattern = route.get('pattern','').strip()
        if pattern:
            result['regex_match'] = rule_match('re:'+pattern,message)
            if not result['regex_match']:
                return answer('block','Custom regex did not match')
    except (safe_regex.error,TimeoutError,ValueError):
        return answer('invalid','Invalid or costly regex; no delivery')
    return answer('forward','Address-only route filters passed')


def dedup_fingerprint(message, result):
    keys = sorted(f"{a['network']}:{address_key(a['network'],a['address'])}" for a in result['addresses'])
    return hashlib.sha256('|'.join(keys).encode()).hexdigest() if keys else ''
