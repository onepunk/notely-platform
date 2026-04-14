# License Signing Keys

This directory contains RSA keys for signing enterprise licenses.

## Files

| File | Purpose | Security |
|------|---------|----------|
| `license-signing-private.pem` | Signs license files | **NEVER COMMIT** |
| `license-signing-public.pem` | Verifies signatures | Safe to distribute |

## Key Generation

If you need to regenerate keys (this will invalidate all existing licenses):

```bash
# Generate 4096-bit RSA private key
openssl genrsa -out license-signing-private.pem 4096

# Extract public key
openssl rsa -in license-signing-private.pem -pubout -out license-signing-public.pem

# Secure the private key
chmod 600 license-signing-private.pem
```

## Signing a License

Use the signing script:

```bash
# Generate sample payload
../scripts/sign-license.sh --generate > acme-corp.json

# Edit the payload with actual details
vim acme-corp.json

# Sign the license
../scripts/sign-license.sh acme-corp.json

# Verify it works
../scripts/sign-license.sh --verify LIC-2024-XXXX.key
```

## Security Notes

1. **Private key must never be committed to git** - It's in .gitignore
2. **Back up the private key securely** - Loss means inability to sign new licenses
3. **Rotate keys periodically** - Old licenses continue to work, new ones use new keys
4. **The public key is embedded in appliances** - Updates required to change it

## Key Rotation

To rotate keys without breaking existing licenses:

1. Generate new key pair with versioned name
2. Update appliance to accept both old and new public keys
3. Sign new licenses with new private key
4. Eventually deprecate old public key
