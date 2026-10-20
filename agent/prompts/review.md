---
description: Review the finished diff with a reviewer's eye — pair with /preset review
argument-hint: "[scope — defaults to the working tree]"
---
Review the finished changes${1:+ in $1}. Read the diff and the code around it —
the line before the one that changed is usually where the bug is.

Report only what you can point at: file, line, why it is wrong, what would fix
it. Bugs and logic errors first, then security, then error handling, then the
rest. If nothing is wrong, say so plainly rather than manufacture three
nitpicks.
