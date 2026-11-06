# 03 — GIT AND TESTING

1. **Evidence Before Assertions:**
   - Never claim a test passed or a bug was fixed without fresh test execution output and exit code `0`.
2. **Branch Hygiene:**
   - All feature implementation and migration testing must be conducted on dedicated branches (`feat/*`), never directly on `master`.
3. **Database Integrity:**
   - Production database `D:\AI-COMPANY\data\aico.db` is strictly frozen during development and testing.
   - All migration scripts, schema tests, and rollbacks must be exercised against temporary sandbox databases.
4. **Clean Diffs:**
   - Review full diffs before committing. Do not leave debug code or untracked temporary files in the repository.
