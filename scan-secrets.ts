#!/usr/bin/env node
// Fails if the repository holds a credential. Run by check.ts and the
// pre-commit hook; the pattern lives in lib.ts.
import { report, scanSecrets } from "./lib.ts";

process.exit(report(scanSecrets()));
