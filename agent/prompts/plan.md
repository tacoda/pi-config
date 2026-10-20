---
description: Plan a change read-only, then hand off the decision — pair with /preset plan
argument-hint: "<what to change>"
---
Plan this change. Do not implement it.

$ARGUMENTS

Read what you need before deciding — a plan naming plausible files instead of
real ones is worse than no plan. Produce:

- what to change, file by file
- why that approach and not the obvious alternative
- what could go wrong, and what you checked to rule it out
- anything the request assumes that is not true of this repository

If it cannot be done as written, say so plainly. Do not write the change out in
full; the implementing turn has the same repository, and what it does not have
is the decision you just made.
