# ADR-001: RSA-4096 + JWT for License Format

## Status
Accepted

## Context
Notely requires a license format that is:
- Cryptographically secure and tamper-proof
- Copy/paste friendly for easy distribution
- Self-contained with all necessary information
- Verifiable offline without server connection
- Industry-standard and well-understood

Licenses must encode organization details, feature flags, expiration dates, and device bindings while preventing forgery or modification. The format needs to work across both portal (server) and desktop (client) deployments.

## Decision
Use RSA-4096 asymmetric encryption with JWT (JSON Web Tokens) as the license format.

**License Structure:**
```
eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJvcmdJZCI6Im9yZ18xMjMiLCJmZWF0dXJlcyI6eyJwb3J0YWwiOnRydWUsImRlc2t0b3AiOnRydWUsIm1lZXRpbmdzIjp0cnVlLCJzdG9yYWdlIjoxMDAwfSwiaHdpZCI6ImVuMC0wMDoxMToyMjozMzoxMToyMiIsImlhdCI6MTczMTQ1MzYwMCwiZXhwIjoxNzYyOTg5NjAwfQ.signature...
```

**Key Components:**
- **Algorithm**: RS512 (RSA with SHA-512)
- **Key Size**: 4096 bits
- **Payload**: Organization ID, features, hardware ID (portal only), timestamps
- **Encoding**: Base64URL for easy copy/paste

## Alternatives Considered

### 1. HMAC-based JWT (HS256/HS512)
**Pros:**
- Simpler implementation
- Faster signing/verification
- Smaller signatures

**Cons:**
- Symmetric key required on clients for verification
- Key distribution security risk
- Cannot support offline validation without exposing signing key

### 2. Symmetric Encryption (AES-256)
**Pros:**
- Fast encryption/decryption
- Smaller payload size

**Cons:**
- Custom format requires client implementation
- Key distribution challenges
- Not industry standard
- Less transparent (binary format)

### 3. Custom License Format
**Pros:**
- Optimized for specific use case
- Can be highly compact

**Cons:**
- Requires custom parser implementation
- No standard tooling support
- Higher maintenance burden
- Potential security vulnerabilities in custom implementation

## Rationale

**RSA-4096 + JWT chosen because:**

1. **Offline Validation**: Public key can be safely distributed to all clients for signature verification without exposing the private signing key

2. **Copy/Paste Friendly**: Base64URL encoding produces a single-line string that can be easily copied, pasted, and stored in configuration files or environment variables

3. **Cryptographically Secure**: RSA-4096 provides strong asymmetric encryption. SHA-512 hashing ensures tamper detection. Industry-proven security model

4. **Self-Contained**: JWT payload includes all license information (organization, features, expiration) without requiring database lookups

5. **Industry Standard**: JWT is widely adopted, well-documented, and supported by libraries in all major languages (Node.js, Python, Go, Rust, etc.)

6. **Transparent Format**: Base64-decoded payload is readable JSON, making debugging and inspection straightforward

7. **Future-Proof**: Standard JWT claims (iat, exp, iss, sub) provide compatibility with existing tooling and monitoring systems

## Consequences

### Positive
- Clients can validate licenses without network connectivity
- Public key distribution is safe and simple
- No shared secret management required
- Standard tooling available for generation and validation
- Transparent payload aids debugging and support
- Copy/paste workflow is user-friendly

### Negative
- **Large Key Sizes**: RSA-4096 signatures are ~512 bytes, making licenses longer than symmetric alternatives
- **Key Rotation Complexity**: Must manage public key distribution when rotating signing keys
- **Performance**: RSA verification is slower than HMAC (though still fast enough for license checks)
- **Key Management**: Private key must be highly secured (hardware security module recommended for production)

### Mitigation Strategies
- **Key Rotation**: Implement versioned public keys with grace periods during rotation
- **Key Storage**: Use environment variables or secure key management service (AWS KMS, Azure Key Vault)
- **Performance**: Cache validation results with appropriate TTL (7 days)
- **Monitoring**: Log all license issuance and validation attempts for audit trail

## Related
- [ADR-002: Offline Validation Strategy](./ADR-002-offline-validation-strategy.md)
- [ADR-005: Stateless Validation with Cached Public Key](./ADR-005-stateless-validation-cached-public-key.md)
- Implementation: `/services/license/src/core/jwt-manager.ts`
- Validation: `/services/license/src/core/validator.ts`
