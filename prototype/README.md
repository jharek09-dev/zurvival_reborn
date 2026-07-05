# prototype/

Reserved for engine code. **Empty on purpose.**

Per the current plan, no technology stack is committed until the design is locked and the
engine-language ADR (`design/decisions/0001-engine-language.md`) is accepted. The GDD's
technical architecture (Part XIII) is deliberately language-agnostic — a pure, deterministic
simulation core with content loaded as data — so it can be implemented in whichever runtime
is chosen.

When code lands, the first target is the **vertical slice** defined in `docs/PRD.md`:
one region, a few locations, and the core turn loop (choose action → resolve → advance
time → world reacts).
