# TRANS-004 Compound Engine - Security Quick Reference

**Status:** ✅ SECURITY APPROVED
**Risk Level:** 2/100 (Minimal)
**Deployment:** Ready for production

---

## Critical Security Properties

### Password Handling
```typescript
// SECURE: Default is Terraform variable
const password = (attrs['password'] as string | undefined) ?? '${var.db_password}';

// Used in RDS (Azure):
administrator_password: (attrs['password'] as string | undefined) ?? '${var.db_password}',

// Used in RDS (GCP):
userAttrs['password'] = password;
```

**Why It's Safe:**
- Never hardcoded in source
- Never logged or echoed
- Terraform manages actual secret value at runtime
- Type-safe: string or undefined only

### No Dangerous Patterns
- ❌ `eval()` - Not found
- ❌ `Function()` constructor - Not found
- ❌ `exec()` / `spawn()` - Not found
- ❌ Hardcoded secrets - Not found
- ❌ User input in findings - Not found

### Pure Functions
All public functions are pure:
- No mutations of inputs
- No side effects
- No global state access
- Deterministic output

---

## What This Engine Does

### Input
- AWS CloudFormation/Terraform resources
- Configuration attributes (instance class, regions, tags, etc.)

### Processing
- Type-validates all attributes
- Maps AWS values to cloud-native equivalents
- Looks up unknowns in ReadonlyMap
- Falls back gracefully for unmapped values

### Output
- Azure or GCP HCL (Terraform syntax)
- TranslationFinding array (metadata + warnings)
- Zero sensitive data in output

---

## Security Patterns to Follow (If Modifying)

### ✅ Good
```typescript
// Type-safe with safe defaults
const engine = (attrs['engine'] as string | undefined) ?? 'postgres';

// ReadonlyMap for lookups (immutable)
const sizeEntry = RDS_INSTANCE_MAP.get(instanceClass);

// Safe fallback
const sku = sizeEntry?.azure ?? 'B_Standard_B1ms';

// Placeholder variables (not secrets)
administrator_password: '${var.db_password}',

// Pure function (no mutations)
export function translateRds(ctx: TranslationContext): EngineResult {
  return { translated, findings };
}
```

### ❌ Never Do
```typescript
// DON'T: Hardcode actual passwords
password: 'p@ssw0rd123',

// DON'T: Eval or dynamic code execution
eval(`var config = ${JSON.stringify(attrs)}`);

// DON'T: Echo user input in findings
message: `User provided password: ${attrs['password']}`

// DON'T: Mutate input objects
attrs['modified_field'] = 'value';

// DON'T: Make unguarded external calls
fetch('https://api.example.com/check');
```

---

## PROHIB Compliance Checklist (For Code Review)

When reviewing changes to this engine, check:

- [ ] No new `eval()` or `Function()` calls
- [ ] No new hardcoded secrets or API keys
- [ ] No new unvalidated external API calls
- [ ] All findings messages are static or metadata-only
- [ ] All functions are pure (no mutations, no side effects)
- [ ] All optional attributes have safe defaults
- [ ] All user input is type-validated

---

## What's NOT Protected (By Design)

These are out of scope - handled by downstream systems:

- **Actual Secret Values:** Managed by Terraform
- **HCL Execution:** Validated by Terraform at apply time
- **File I/O:** Terraform's file() function validates paths
- **Database Connections:** Azure/GCP handle at deploy time

This engine is a **translator**, not a secrets manager or execution engine.

---

## Testing Security

To verify security after changes:

```bash
# Check for dangerous patterns
grep -r "eval\|Function\|exec\|spawn" src/engines/compound/

# Check for hardcoded secrets
grep -r "password\|secret\|api.*key\|token" src/engines/compound/ \
  | grep -v "db_password\|password:"

# Run existing tests
npm run test -- compound-engine.test.ts

# Type check
npm run typecheck
```

---

## Common Modifications & Security Impact

### Adding a New Cloud Provider
✅ **Safe:** Add to translation functions (no new attack surface)
- Verify password handling follows pattern
- Ensure no hardcoded values
- Test with unknown instance types

### Adding a New Resource Type
✅ **Safe:** Add new mapping file (follows same pattern)
- Ensure pure function implementation
- Verify all attributes have safe defaults
- Test unmapped attribute handling

### Changing Password Handling
⚠️ **HIGH RISK:** Requires security review
- Never use hardcoded values
- Always use placeholder variables
- Never log passwords in findings
- Run full security audit after change

### Adding External API Calls
❌ **NOT ALLOWED:** Breaks pure function requirement
- Engine must remain stateless
- No external dependencies
- No HTTP/DNS calls

---

## Questions?

For security questions about this engine:
1. Check `docs/SECURITY_AUDIT_TRANS004.md` (comprehensive audit)
2. Check `docs/SECURITY_VERIFICATION_CHECKLIST.md` (detailed checks)
3. Review test file: `tests/engines/compound-engine.test.ts`

---

**Last Updated:** 2025-03-17
**Auditor:** Security Tester Agent
**Status:** ✅ APPROVED
