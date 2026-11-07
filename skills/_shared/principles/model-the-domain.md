# Model the domain

**When:** before writing logic, especially stateful code or code that branches a lot.

Name the data shape first, then pick a structure that encodes the rules instead of scattering them as conditionals.

- Several booleans that can't all be true at once → one state enum or a state machine.
- A growing `if/else` or `switch` over kinds → a table or registry keyed by kind.
- The same shape assumption repeated across files → one typed model, parsed once at the boundary.
- Use the exact terms from `.harness/product/CONTEXT.md` when it exists.

Get the structure right and the downstream code gets obvious. Get it wrong and every feature pays for it.
