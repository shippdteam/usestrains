# Security model

## Keys

- Platform wallets are generated server-side and stored only in encrypted form (AES-256-GCM). The encryption key is supplied by environment variable and never stored.
- No user keys are ever handled. Users sign transactions and messages in their own wallet.

## Money movement

- **Fuel accounting is atomic.** Charges, refunds and fee credits run as PostgreSQL functions that lock the affected rows, so a charge across co-owners is all or nothing.
- **Deposits are single-use.** A payment signature is recorded on first use, and any reuse is rejected. Payments are checked on-chain for the sender, the recipient and the amount.
- **Payouts are bounded.** A payout only goes out if the platform wallet holds enough above the sum of all users' fuel. Fees are only counted once they have actually arrived.
- **Withdrawals are signed.** Every owner action carries a wallet signature over its exact parameters and a timestamp. Signatures expire, and each can be used only once.
- **The burn wallet is isolated.** It only receives strain purchases and can only buy and burn $STRAINS.
- **Operator withdrawals are limited** to spare funds above all users' fuel and owed fees, and only to a fixed address.

## AI safety

- Coin concepts are generated under fixed rules: no real people, brands or projects, no financial promises, and no hateful, sexual or violent content.
- Model output is treated as untrusted. It is length-limited, stripped of markup and validated before use.
- Operators can remove a strain that breaks the rules.

## Reporting

Please report vulnerabilities privately via X [@usestrains](https://x.com/usestrains) before disclosing them publicly.
