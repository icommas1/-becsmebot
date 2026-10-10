from pydantic import BaseModel, Field, field_validator
from typing import Literal

class RouteInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    mode: Literal['express', 'smart', 'hybrid', 'ai-gated'] = 'smart'
    enabled: bool = False
    sources: list[str] = Field(default_factory=list, max_length=30)
    destinations: list[str] = Field(default_factory=list, max_length=30)
    allowed: str = Field(default='', max_length=500)
    blocked: str = Field(default='', max_length=500)
    pattern: str = Field(default='', max_length=250)
    match_mode: Literal['any', 'all'] = 'any'
    network: Literal['solana', 'evm', 'both'] = 'both'
    require_contract: bool = False
    dedup_minutes: int = Field(default=60, ge=0, le=10080)
    delivery_style: Literal['native', 'text'] = 'native'

    @field_validator('sources','destinations')
    @classmethod
    def clean_chat_ids(cls, value):
        cleaned = []
        for entry in value:
            val = str(entry).strip()
            if not val or len(val) > 80:
                raise ValueError('Choose valid, non-empty Telegram chat IDs or usernames')
            if val not in cleaned: cleaned.append(val)
        return cleaned

class Simulation(BaseModel):
    text: str = Field(max_length=12000)
    route: RouteInput

class PhoneInput(BaseModel):
    phone: str = Field(min_length=6,max_length=30)

class CodeInput(BaseModel):
    code: str = Field(min_length=3,max_length=16)

class PasswordInput(BaseModel):
    password: str = Field(min_length=1,max_length=200)

class ReviewAction(BaseModel):
    approve: bool
